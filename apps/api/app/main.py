from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

_module_path = Path(__file__).resolve()
_repository_env = (
    _module_path.parents[3] / ".env" if len(_module_path.parents) > 3 else None
)
if _repository_env is not None:
    load_dotenv(_repository_env, override=False)

from app.backtest import run_independent_backtests
from app.data_sources import (
    DataSourceError,
    load_bls_signals,
    load_open_meteo_signal,
    load_yahoo_prices,
    load_yahoo_signal,
    load_yahoo_signals,
)
from app.generator import GenerationError, generate_strategy
from app.models import (
    BacktestErrorResponse,
    BacktestRequest,
    BacktestResponse,
    BacktestSuccessResponse,
    DeployErrorResponse,
    DeployResponse,
    DeploySuccessResponse,
    ErrorObject,
    HealthResponse,
)
from app.repository import (
    RepositoryError,
    StrategyNotDeployableError,
    StrategyNotFoundError,
    StrategyRepository,
)
from app.strategy_runtime import (
    StrategyExecutionTimeout,
    StrategyValidationError,
    build_fallback_source,
    execute_strategy,
    validate_strategy_source,
)


app = FastAPI(title="Uncle Trading API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("API_CORS_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@lru_cache(maxsize=1)
def get_repository() -> StrategyRepository:
    return StrategyRepository()


@app.exception_handler(RequestValidationError)
async def request_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    safe_errors = [
        {
            "location": ".".join(str(part) for part in error["loc"]),
            "message": error["msg"],
        }
        for error in exc.errors()[:5]
    ]
    return JSONResponse(
        status_code=422,
        content={
            "status": "error",
            "generated_code": "",
            "error": {
                "code": "invalid_request",
                "message": "The backtest request is invalid.",
                "details": {"issues": str(safe_errors)},
            },
        },
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.post(
    "/backtest",
    response_model=BacktestResponse,
    response_model_exclude_none=True,
)
def backtest(
    request: BacktestRequest,
    repository: StrategyRepository = Depends(get_repository),
) -> BacktestSuccessResponse | BacktestErrorResponse:
    warnings = [
        "This is a paper-money simulation only.",
        "Short positions, when used, use simplified assumptions and losses are capped at the allocated capital.",
        "Fees and slippage are not included.",
        "Historical results do not predict future results.",
    ]
    if request.strategy.version == "1.1" and any(
        source.source == "bls" for source in request.strategy.signal.sources
    ):
        warnings.append(
            "Monthly BLS observations use a conservative availability date to avoid look-ahead bias."
        )
    generated_code = ""

    try:
        generated_code = generate_strategy(request.strategy).code
        validate_strategy_source(generated_code)
        _fixture_check(generated_code, request)
    except (GenerationError, StrategyValidationError, StrategyExecutionTimeout):
        generated_code = build_fallback_source(request.strategy)
        warnings.append(
            "A deterministic fallback strategy was used because model generation was unavailable or rejected."
        )
        try:
            validate_strategy_source(generated_code)
            _fixture_check(generated_code, request)
        except (StrategyValidationError, StrategyExecutionTimeout) as exc:
            return _backtest_error(
                "generated_code_rejected",
                "The generated strategy did not pass the safety checks.",
                generated_code,
                reason=str(exc),
            )

    try:
        data = _load_data(request)
        output = execute_strategy(generated_code, data, timeout_seconds=2.0)
        _validate_required_data_matches(output.required_data, request)
        _validate_signals_match(output.signals, request)
        results = run_independent_backtests(
            target_tickers=request.strategy.target_tickers,
            signals=output.signals,
            prices=data["prices"],
            initial_capital=request.backtest.initial_capital,
            allocation_percent=request.strategy.execution.allocation_percent,
            holding_period_days=request.strategy.execution.holding_period_days,
            direction=request.strategy.direction,
        )
    except DataSourceError as exc:
        return _backtest_error("data_unavailable", str(exc), generated_code)
    except (StrategyValidationError, StrategyExecutionTimeout, KeyError, ValueError) as exc:
        return _backtest_error(
            "backtest_failed",
            "The strategy could not be backtested with the available data.",
            generated_code,
            reason=str(exc),
        )

    strategy_id = _strategy_id(request.strategy.name)
    response = BacktestSuccessResponse(
        status="complete",
        strategy_id=strategy_id,
        strategy_summary=_strategy_summary(request),
        generated_code=generated_code,
        warnings=warnings,
        results=results,
    )
    try:
        repository.save_completed(request, response)
    except RepositoryError:
        return _backtest_error(
            "backtest_failed",
            "The completed backtest could not be saved.",
            generated_code,
        )
    return response


@app.post(
    "/strategies/{strategy_id}/deploy",
    response_model=DeployResponse,
    response_model_exclude_none=True,
)
def deploy_strategy(
    strategy_id: str,
    repository: StrategyRepository = Depends(get_repository),
) -> DeploySuccessResponse | DeployErrorResponse:
    try:
        stored = repository.activate(strategy_id, _next_daily_check())
    except StrategyNotFoundError:
        return _deploy_error("strategy_not_found", "The strategy was not found.")
    except StrategyNotDeployableError:
        return _deploy_error(
            "backtest_failed", "Only a successfully tested strategy can be activated."
        )
    except RepositoryError:
        return _deploy_error("backtest_failed", "The strategy could not be activated.")
    return DeploySuccessResponse(
        status="active",
        strategy_id=stored.strategy_id,
        active=True,
        next_check_at=stored.next_check_at,
    )


@app.get(
    "/strategies/{strategy_id}",
    response_model=BacktestResponse,
    response_model_exclude_none=True,
)
def get_strategy(
    strategy_id: str,
    repository: StrategyRepository = Depends(get_repository),
) -> BacktestSuccessResponse | BacktestErrorResponse:
    try:
        stored = repository.fetch(strategy_id)
    except RepositoryError:
        return _backtest_error(
            "backtest_failed",
            "The strategy could not be loaded.",
            "",
        )

    if stored is None:
        return _backtest_error("strategy_not_found", "The strategy was not found.", "")

    return BacktestSuccessResponse.model_validate(stored.response)


def _fixture_check(source: str, request: BacktestRequest) -> None:
    dates = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
    data: dict[str, Any] = {
        "prices": {
            ticker: [
                {"date": item_date, "close": 100.0 + index, "volume": 1000.0}
                for index, item_date in enumerate(dates)
            ]
            for ticker in request.strategy.target_tickers
        },
    }
    fixture_rows = [
        {"date": item_date, "value": value}
        for item_date, value in zip(dates, [4.3, 4.2, 4.1, 4.0])
    ]
    if request.strategy.version == "1.1":
        data["signals"] = {
            signal_source.key: list(fixture_rows)
            for signal_source in request.strategy.signal.sources
        }
    else:
        data["signal"] = fixture_rows
    output = execute_strategy(source, data, timeout_seconds=1.0)
    _validate_required_data_matches(output.required_data, request)


def _validate_required_data_matches(
    required_data: list[dict[str, Any]], request: BacktestRequest
) -> None:
    signal = request.strategy.signal
    if request.strategy.version == "1.1":
        expected = {
            source.key: source.model_dump(mode="json")
            for source in signal.sources
        }
        actual = {
            item.get("key"): item
            for item in required_data
            if isinstance(item.get("key"), str)
        }
        if len(actual) != len(required_data) or actual != expected:
            raise StrategyValidationError(
                "Strategy requested sources outside the confirmed signals."
            )
        return

    if len(required_data) != 1:
        raise StrategyValidationError("Strategy must request exactly one signal series.")
    required = required_data[0]
    if required.get("source") != signal.source or required.get("field") != signal.field:
        raise StrategyValidationError("Strategy requested data outside the confirmed signal.")
    if signal.source == "yahoo" and required.get("symbol") != signal.symbol:
        raise StrategyValidationError("Strategy requested an unconfirmed Yahoo symbol.")
    if signal.source == "open_meteo":
        expected = signal.location.model_dump(mode="json")
        if required.get("location") != expected:
            raise StrategyValidationError("Strategy requested an unconfirmed location.")


def _validate_signals_match(
    signals: list[dict[str, str]], request: BacktestRequest
) -> None:
    requested_tickers = set(request.strategy.target_tickers)
    for signal in signals:
        if signal["ticker"] not in requested_tickers:
            raise StrategyValidationError("Strategy emitted an unconfirmed target ticker.")
        if signal["direction"] != request.strategy.direction:
            raise StrategyValidationError("Strategy emitted an unconfirmed direction.")


def _load_data(request: BacktestRequest) -> dict[str, Any]:
    start = request.backtest.start_date
    end = request.backtest.end_date
    signal = request.strategy.signal
    prices = load_yahoo_prices(request.strategy.target_tickers, start, end)
    if request.strategy.version == "1.1":
        yahoo_sources = [source for source in signal.sources if source.source == "yahoo"]
        bls_sources = [source for source in signal.sources if source.source == "bls"]
        signals: dict[str, list[dict[str, Any]]] = {}
        if yahoo_sources:
            signals.update(load_yahoo_signals(yahoo_sources, start, end))
        if bls_sources:
            signals.update(
                load_bls_signals(
                    bls_sources,
                    start,
                    end,
                    registration_key=os.getenv("API_BLS_REGISTRATION_KEY"),
                )
            )
        return {
            "signals": signals,
            "prices": prices,
        }
    if signal.source == "yahoo":
        signal_rows = load_yahoo_signal(signal.symbol, signal.field, start, end)
    else:
        location = signal.location
        signal_rows = load_open_meteo_signal(
            latitude=location.latitude,
            longitude=location.longitude,
            timezone=location.timezone,
            field=signal.field,
            start_date=start,
            end_date=end,
        )
    return {"signal": signal_rows, "prices": prices}


def _strategy_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "strategy"
    return f"{slug}-{uuid.uuid4().hex[:8]}"


def _strategy_summary(request: BacktestRequest) -> str:
    tickers = ", ".join(request.strategy.target_tickers)
    return (
        f"{request.strategy.direction.title()} {tickers} at the next trading-day close "
        f"when {request.strategy.signal.rule.rstrip('.')}, then hold for "
        f"{request.strategy.execution.holding_period_days} trading days."
    )


def _next_daily_check(now: datetime | None = None) -> datetime:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    candidate = datetime.combine(current.date(), time(20, 0), tzinfo=timezone.utc)
    if candidate <= current:
        candidate += timedelta(days=1)
    return candidate


def _backtest_error(
    code: str,
    message: str,
    generated_code: str,
    **details: Any,
) -> BacktestErrorResponse:
    error_arguments = {"code": code, "message": message}
    if details:
        error_arguments["details"] = details
    return BacktestErrorResponse(
        status="error",
        generated_code=generated_code,
        error=ErrorObject(**error_arguments),
    )


def _deploy_error(code: str, message: str) -> DeployErrorResponse:
    return DeployErrorResponse(
        status="error",
        error=ErrorObject(code=code, message=message),
    )
