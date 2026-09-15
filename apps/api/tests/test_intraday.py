from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main
from app.backtest import run_ticker_backtest
from app.data_sources import (
    DataSourceError,
    load_yahoo_intraday_prices,
    load_yahoo_intraday_signals,
)
from app.generator import _instructions_for_strategy
from app.models import BacktestRequest
from app.repository import StrategyRepository
from app.strategy_runtime import StrategyValidationError, _valid_signal_time


def _request_payload() -> dict:
    return {
        "strategy": {
            "version": "1.2",
            "name": "Hourly FICO confirmation",
            "thesis": "Hourly market weakness creates an entry.",
            "target_tickers": ["FICO"],
            "direction": "long",
            "signal": {
                "sources": [
                    {
                        "key": "market",
                        "source": "yahoo",
                        "symbol": "SPY",
                        "field": "close",
                    },
                    {
                        "key": "technology",
                        "source": "yahoo",
                        "symbol": "QQQ",
                        "field": "volume",
                    },
                ],
                "rule": "Enter when both hourly sources decline together.",
                "parameters": {"consecutive_observations": 1},
            },
            "execution": {
                "bar_interval": "1h",
                "session": "regular",
                "entry_timing": "next_trading_bar_close",
                "holding_period_bars": 7,
                "allocation_percent": 20,
                "ignore_overlapping_signals": True,
            },
        },
        "backtest": {
            "start_date": "2026-01-05",
            "end_date": "2026-01-06",
            "initial_capital": 10_000,
        },
    }


def _hourly_times() -> list[str]:
    return [
        f"2026-01-05T{item}Z"
        for item in ["15:30:00", "16:30:00", "17:30:00", "18:30:00", "19:30:00", "20:30:00", "21:00:00"]
    ] + [
        f"2026-01-06T{item}Z"
        for item in ["15:30:00", "16:30:00", "17:30:00", "18:30:00", "19:30:00", "20:30:00", "21:00:00"]
    ]


def _normalized_data() -> dict:
    times = _hourly_times()
    return {
        "signals": {
            "market": [
                {"date": item_time, "value": 500.0 - index}
                for index, item_time in enumerate(times)
            ],
            "technology": [
                {"date": item_time, "value": 1_000_000.0 - index * 1000}
                for index, item_time in enumerate(times)
            ],
        },
        "prices": {
            "FICO": [
                {
                    "date": item_time,
                    "close": 100.0 + index,
                    "volume": 10_000 + index,
                }
                for index, item_time in enumerate(times)
            ]
        },
    }


def test_version_12_contract_accepts_hourly_shape_and_rejects_daily_or_night_options():
    request = BacktestRequest.model_validate(_request_payload())
    assert request.strategy.version == "1.2"
    assert request.strategy.execution.holding_period_bars == 7

    for field, value in [
        ("bar_interval", "30m"),
        ("session", "extended"),
        ("entry_timing", "next_trading_day_close"),
        ("holding_period_bars", 0),
    ]:
        invalid = _request_payload()
        invalid["strategy"]["execution"][field] = value
        with pytest.raises(ValidationError):
            BacktestRequest.model_validate(invalid)

    multiple_targets = _request_payload()
    multiple_targets["strategy"]["target_tickers"] = ["FICO", "AAPL"]
    with pytest.raises(ValidationError, match="exactly one target ticker"):
        BacktestRequest.model_validate(multiple_targets)


def test_versions_11_and_12_accept_one_source():
    payload = _request_payload()
    payload["strategy"]["signal"]["sources"] = payload["strategy"]["signal"]["sources"][:1]
    BacktestRequest.model_validate(payload)

    payload["strategy"]["version"] = "1.1"
    payload["strategy"]["execution"] = {
        "entry_timing": "next_trading_day_close",
        "holding_period_days": 5,
        "allocation_percent": 20,
        "ignore_overlapping_signals": True,
    }
    BacktestRequest.model_validate(payload)


def test_version_12_enforces_source_and_holding_boundaries():
    ten_sources = _request_payload()
    ten_sources["strategy"]["signal"]["sources"] = [
        {
            "key": f"source_{index}",
            "source": "yahoo",
            "symbol": f"S{index}",
            "field": "close",
        }
        for index in range(10)
    ]
    ten_sources["strategy"]["execution"]["holding_period_bars"] = 1764
    BacktestRequest.model_validate(ten_sources)

    eleven_sources = _request_payload()
    eleven_sources["strategy"]["signal"]["sources"] = (
        ten_sources["strategy"]["signal"]["sources"]
        + [
            {
                "key": "source_10",
                "source": "yahoo",
                "symbol": "S10",
                "field": "close",
            }
        ]
    )
    with pytest.raises(ValidationError):
        BacktestRequest.model_validate(eleven_sources)

    too_long = _request_payload()
    too_long["strategy"]["execution"]["holding_period_bars"] = 1765
    with pytest.raises(ValidationError):
        BacktestRequest.model_validate(too_long)


def test_signal_time_validation_requires_contract_dates_or_exact_utc_timestamps():
    assert _valid_signal_time("2026-01-05")
    assert _valid_signal_time("2026-01-05T15:30:00Z")
    assert not _valid_signal_time("2026-01-05T15:30Z")
    assert not _valid_signal_time("2026-01-05T15:30:00+00:00")
    assert not _valid_signal_time("2026-02-30T15:30:00Z")


def test_intraday_signals_must_come_from_trusted_regular_session_rows():
    request = BacktestRequest.model_validate(_request_payload())
    valid_signal = {
        "ticker": "FICO",
        "signal_date": _hourly_times()[0],
        "direction": "long",
    }
    main._validate_signals_match([valid_signal], request, _normalized_data())

    fabricated_night_signal = {
        **valid_signal,
        "signal_date": "2026-01-05T03:30:00Z",
    }
    with pytest.raises(StrategyValidationError, match="outside trusted"):
        main._validate_signals_match(
            [fabricated_night_signal], request, _normalized_data()
        )


def test_hourly_loader_filters_extended_hours_and_normalizes_bar_close_to_utc():
    frame = pd.DataFrame(
        {
            "Close": [99, 100, 101, 102, 103, 104],
            "Volume": [10, 20, 30, 40, 50, 60],
        },
        index=pd.DatetimeIndex(
            [
                "2026-01-05 08:30:00-05:00",
                "2026-01-05 09:30:00-05:00",
                "2026-01-05 10:30:00-05:00",
                "2026-01-05 15:30:00-05:00",
                "2026-01-05 16:00:00-05:00",
                "2026-01-10 09:30:00-05:00",
            ],
            name="Datetime",
        ),
    )
    calls = []

    def download(*args, **kwargs):
        calls.append((args, kwargs))
        return frame

    result = load_yahoo_intraday_prices(
        ["FICO"], "2026-01-05", "2026-01-10", download=download
    )

    assert result["FICO"] == [
        {"date": "2026-01-05T15:30:00Z", "close": 100.0, "volume": 20},
        {"date": "2026-01-05T16:30:00Z", "close": 101.0, "volume": 30},
        {"date": "2026-01-05T21:00:00Z", "close": 102.0, "volume": 40},
    ]
    assert calls[0][1]["interval"] == "1h"
    assert calls[0][1]["prepost"] is False
    assert calls[0][1]["ignore_tz"] is False


def test_hourly_loader_converts_winter_and_summer_sessions_for_daylight_saving():
    frame = pd.DataFrame(
        {"Close": [100, 101], "Volume": [10, 11]},
        index=pd.DatetimeIndex(
            pd.to_datetime(
                [
                    "2026-01-05 09:30:00-05:00",
                    "2026-07-06 09:30:00-04:00",
                ],
                utc=True,
            )
        ),
    )
    result = load_yahoo_intraday_prices(
        ["FICO"], "2026-01-05", "2026-07-06", download=lambda *a, **k: frame
    )
    assert [row["date"] for row in result["FICO"]] == [
        "2026-01-05T15:30:00Z",
        "2026-07-06T14:30:00Z",
    ]


def test_hourly_loader_honors_nyse_holidays_and_early_closes():
    frame = pd.DataFrame(
        {
            "Close": [99, 100, 101],
            "Volume": [10, 20, 30],
        },
        index=pd.DatetimeIndex(
            [
                "2026-11-26 09:30:00-05:00",
                "2026-11-27 12:30:00-05:00",
                "2026-11-27 13:00:00-05:00",
            ]
        ),
    )
    result = load_yahoo_intraday_prices(
        ["FICO"], "2026-11-26", "2026-11-27", download=lambda *a, **k: frame
    )
    assert result["FICO"] == [
        {"date": "2026-11-27T18:00:00Z", "close": 100.0, "volume": 20}
    ]


def test_hourly_signal_loader_batches_sources_and_rejects_ranges_over_730_days():
    columns = pd.MultiIndex.from_tuples(
        [
            ("Close", "SPY"),
            ("Close", "QQQ"),
            ("Volume", "SPY"),
            ("Volume", "QQQ"),
        ]
    )
    frame = pd.DataFrame(
        [[500.0, 450.0, 1_000_000, 2_000_000]],
        columns=columns,
        index=pd.DatetimeIndex(["2026-01-05 09:30:00-05:00"]),
    )
    calls = []

    def download(symbols, **kwargs):
        calls.append(symbols)
        return frame

    sources = _request_payload()["strategy"]["signal"]["sources"]
    result = load_yahoo_intraday_signals(
        sources, "2026-01-05", "2026-01-06", download=download
    )
    assert calls == [["SPY", "QQQ"]]
    assert result == {
        "market": [{"date": "2026-01-05T15:30:00Z", "value": 500.0}],
        "technology": [{"date": "2026-01-05T15:30:00Z", "value": 2_000_000}],
    }

    with pytest.raises(DataSourceError, match="730 calendar days"):
        load_yahoo_intraday_prices(
            ["FICO"], "2024-01-01", "2026-01-01", download=download
        )


def test_hourly_backtest_holds_across_night_using_only_regular_session_bars():
    result = run_ticker_backtest(
        ticker="FICO",
        signals=[
            {
                "ticker": "FICO",
                "signal_date": "2026-01-05T15:30:00Z",
                "direction": "long",
            }
        ],
        price_rows=_normalized_data()["prices"]["FICO"],
        initial_capital=10_000,
        allocation_percent=20,
        holding_period_days=None,
        holding_period_bars=7,
        periods_per_year=252 * 6.5,
        direction="long",
    )

    trade = result["trades"][0]
    assert trade["entry_date"] == "2026-01-05T16:30:00Z"
    assert trade["exit_date"] == "2026-01-06T16:30:00Z"
    assert result["metrics"]["trade_count"] == 1
    assert all("T" in point["date"] for point in result["equity_curve"])


def test_intraday_prompt_and_next_check_exclude_night_trading():
    instructions = _instructions_for_strategy(_request_payload()["strategy"])
    assert "regular US trading-session bars" in instructions
    assert "never synthesize pre-market, after-hours, overnight" in instructions.lower()
    assert "holding_period_bars" in instructions

    friday_after_close = datetime(2026, 1, 2, 22, 0, tzinfo=timezone.utc)
    assert main._next_intraday_check(friday_after_close).isoformat() == (
        "2026-01-05T15:30:00+00:00"
    )

    thanksgiving = datetime(2026, 11, 26, 17, 0, tzinfo=timezone.utc)
    assert main._next_intraday_check(thanksgiving).isoformat() == (
        "2026-11-27T15:30:00+00:00"
    )

    before_early_close = datetime(2026, 11, 27, 17, 45, tzinfo=timezone.utc)
    assert main._next_intraday_check(before_early_close).isoformat() == (
        "2026-11-27T18:00:00+00:00"
    )


def test_intraday_request_runs_end_to_end_with_mocked_market_data(monkeypatch, tmp_path):
    repository = StrategyRepository(tmp_path / "test.db")
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    monkeypatch.delenv("API_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("API_OPENAI_MODEL", raising=False)
    monkeypatch.setattr(main, "_load_data", lambda request: _normalized_data())
    try:
        with TestClient(main.app) as client:
            response = client.post("/backtest", json=_request_payload())
            body = response.json()
            saved = client.get(f"/strategies/{body['strategy_id']}")
            deployed = client.post(f"/strategies/{body['strategy_id']}/deploy")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200
    assert body["status"] == "complete"
    assert body["results"][0]["metrics"]["trade_count"] == 1
    trade = body["results"][0]["trades"][0]
    assert trade["entry_date"] == "2026-01-05T17:30:00Z"
    assert trade["exit_date"] == "2026-01-06T17:30:00Z"
    assert repository.fetch(body["strategy_id"]).strategy["version"] == "1.2"
    assert saved.status_code == 200
    assert saved.json() == body
    assert deployed.status_code == 200
    assert deployed.json()["status"] == "active"
