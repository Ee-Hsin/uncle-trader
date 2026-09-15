"""Pydantic representations of the frozen public API contracts."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    RootModel,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    StringConstraints,
    field_validator,
    model_validator,
)


_DATE_PATTERN = re.compile(r"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$")
_TIMEZONE_PATTERN = re.compile(r"^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9._+-]+)+)$")
_UTC_DATETIME_PATTERN = re.compile(
    r"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z$"
)


def _parse_contract_date(value: object) -> object:
    """Require the contract spelling and reject impossible calendar dates."""
    if type(value) is date:
        return value
    if not isinstance(value, str) or _DATE_PATTERN.fullmatch(value) is None:
        raise ValueError("date must use YYYY-MM-DD format")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("date must be a real calendar date") from exc


def _parse_utc_datetime(value: object) -> object:
    """Require a real UTC instant whose wire representation ends in ``Z``."""
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
            raise ValueError("datetime must be in UTC")
        return value.astimezone(timezone.utc)
    if not isinstance(value, str) or _UTC_DATETIME_PATTERN.fullmatch(value) is None:
        raise ValueError("datetime must be ISO 8601 UTC and end in Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError("datetime must be a real ISO 8601 UTC value") from exc
    return parsed.astimezone(timezone.utc)


ContractDate = Annotated[date, BeforeValidator(_parse_contract_date)]
UtcDateTime = Annotated[datetime, BeforeValidator(_parse_utc_datetime)]
ContractPointTime = ContractDate | UtcDateTime
NonBlankString = Annotated[
    StrictStr, StringConstraints(min_length=1, pattern=r"\S")
]
Ticker = Annotated[
    StrictStr, StringConstraints(pattern=r"^[A-Z]{1,5}(?:[.-][A-Z])?$")
]
SignalSymbol = Annotated[
    StrictStr, StringConstraints(min_length=1, max_length=32, pattern=r"\S")
]
SignalKey = Annotated[
    StrictStr,
    StringConstraints(min_length=1, max_length=32, pattern=r"^[a-z][a-z0-9_]*$"),
]
FiniteNumber = Annotated[float, Field(strict=True, allow_inf_nan=False)]
ParameterValue = StrictStr | StrictFloat | StrictInt | StrictBool
DetailValue = ParameterValue | None


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Location(ContractModel):
    name: NonBlankString
    latitude: Annotated[float, Field(ge=-90, le=90, strict=True, allow_inf_nan=False)]
    longitude: Annotated[float, Field(ge=-180, le=180, strict=True, allow_inf_nan=False)]
    timezone: Annotated[StrictStr, StringConstraints(min_length=1)]

    @field_validator("timezone")
    @classmethod
    def validate_iana_timezone(cls, value: str) -> str:
        if _TIMEZONE_PATTERN.fullmatch(value) is None:
            raise ValueError("timezone must be UTC or a slash-separated IANA name")
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a recognized IANA name") from exc
        return value


class Signal(ContractModel):
    source: Literal["yahoo", "open_meteo"]
    symbol: SignalSymbol | None = None
    field: Literal[
        "close",
        "volume",
        "precipitation_sum",
        "temperature_2m_max",
        "temperature_2m_min",
    ]
    location: Location | None = None
    rule: NonBlankString
    parameters: dict[StrictStr, ParameterValue]

    @field_validator("symbol", "location", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("optional signal fields must be omitted rather than null")
        return value

    @model_validator(mode="after")
    def validate_source_requirements(self) -> Signal:
        if self.source == "yahoo":
            if self.symbol is None:
                raise ValueError("a Yahoo signal requires symbol")
            if self.field not in {"close", "volume"}:
                raise ValueError("a Yahoo signal field must be close or volume")
        else:
            if self.location is None:
                raise ValueError("an Open-Meteo signal requires location")
            if self.field not in {
                "precipitation_sum",
                "temperature_2m_max",
                "temperature_2m_min",
            }:
                raise ValueError("an Open-Meteo signal requires a supported weather field")
        return self


class YahooSignalSource(ContractModel):
    """One keyed Yahoo series in the additive version 1.1 preview."""

    key: SignalKey
    source: Literal["yahoo"]
    symbol: SignalSymbol
    field: Literal["close", "volume"]


class BLSSignalSource(ContractModel):
    """One keyed U.S. Bureau of Labor Statistics series in the 1.1 preview."""

    key: SignalKey
    source: Literal["bls"]
    field: Literal["cpi", "inflation_yoy_percent", "unemployment_rate_percent"]


class MultiSignal(ContractModel):
    """A complex entry condition evaluated from multiple trusted series."""

    sources: Annotated[
        list[YahooSignalSource | BLSSignalSource], Field(min_length=1, max_length=10)
    ]
    rule: NonBlankString
    parameters: dict[StrictStr, ParameterValue]

    @field_validator("sources")
    @classmethod
    def require_unique_source_keys(
        cls, value: list[YahooSignalSource | BLSSignalSource]
    ) -> list[YahooSignalSource | BLSSignalSource]:
        keys = [source.key for source in value]
        if len(keys) != len(set(keys)):
            raise ValueError("signal source keys must be unique")
        return value


class Execution(ContractModel):
    entry_timing: Literal["next_trading_day_close"]
    holding_period_days: Annotated[int, Field(ge=1, le=252, strict=True)]
    allocation_percent: Annotated[
        float, Field(gt=0, le=100, strict=True, allow_inf_nan=False)
    ]
    ignore_overlapping_signals: Literal[True]


class IntradayExecution(ContractModel):
    """Regular-session hourly execution for the additive version 1.2 preview."""

    bar_interval: Literal["1h"]
    session: Literal["regular"]
    entry_timing: Literal["next_trading_bar_close"]
    holding_period_bars: Annotated[int, Field(ge=1, le=1764, strict=True)]
    allocation_percent: Annotated[
        float, Field(gt=0, le=100, strict=True, allow_inf_nan=False)
    ]
    ignore_overlapping_signals: Literal[True]


class ConfirmedStrategy(ContractModel):
    version: Literal["1.0", "1.1", "1.2"]
    name: NonBlankString
    thesis: NonBlankString
    target_tickers: Annotated[list[Ticker], Field(min_length=1, max_length=5)]
    direction: Literal["long", "short"]
    signal: Signal | MultiSignal
    execution: Execution | IntradayExecution

    @field_validator("target_tickers")
    @classmethod
    def require_unique_tickers(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("target_tickers must be unique")
        return value

    @model_validator(mode="after")
    def validate_version_shape(self) -> ConfirmedStrategy:
        if self.version == "1.0":
            if not isinstance(self.signal, Signal) or not isinstance(
                self.execution, Execution
            ):
                raise ValueError("version 1.0 requires the legacy daily shape")
        if self.version == "1.1":
            if (
                not isinstance(self.signal, MultiSignal)
                or not isinstance(self.execution, Execution)
            ):
                raise ValueError("version 1.1 requires 1-10 daily signal.sources")
            if len(self.target_tickers) != 1:
                raise ValueError("version 1.1 requires exactly one target ticker")
        if self.version == "1.2":
            if not isinstance(self.signal, MultiSignal) or not isinstance(
                self.execution, IntradayExecution
            ):
                raise ValueError("version 1.2 requires hourly signal.sources and execution")
            if any(
                not isinstance(source, YahooSignalSource)
                for source in self.signal.sources
            ):
                raise ValueError("version 1.2 requires Yahoo signal sources")
            if len(self.target_tickers) != 1:
                raise ValueError("version 1.2 requires exactly one target ticker")
        return self


class BacktestConfiguration(ContractModel):
    start_date: ContractDate
    end_date: ContractDate
    initial_capital: Annotated[float, Field(gt=0, strict=True, allow_inf_nan=False)]

    @model_validator(mode="after")
    def validate_date_order(self) -> BacktestConfiguration:
        if self.start_date > self.end_date:
            raise ValueError("start_date must not be after end_date")
        return self


class BacktestRequest(ContractModel):
    strategy: ConfirmedStrategy
    backtest: BacktestConfiguration


ErrorCode = Literal[
    "invalid_request",
    "generation_failed",
    "generated_code_rejected",
    "data_unavailable",
    "backtest_failed",
    "strategy_not_found",
]


class ErrorObject(ContractModel):
    code: ErrorCode
    message: NonBlankString
    details: dict[StrictStr, DetailValue] | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )

    @field_validator("details", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("details must be omitted rather than null")
        return value


class Metrics(ContractModel):
    total_pnl: FiniteNumber
    total_return_percent: FiniteNumber
    sharpe_ratio: FiniteNumber | None
    average_pnl_per_trade: FiniteNumber
    expected_value_per_trade: FiniteNumber
    win_rate_percent: Annotated[
        float, Field(ge=0, le=100, strict=True, allow_inf_nan=False)
    ]
    max_drawdown_percent: Annotated[
        float, Field(le=0, strict=True, allow_inf_nan=False)
    ]
    trade_count: Annotated[int, Field(ge=0, strict=True)]
    buy_and_hold_return_percent: FiniteNumber


class EquityPoint(ContractModel):
    date: ContractPointTime
    equity: Annotated[float, Field(ge=0, strict=True, allow_inf_nan=False)]


class Trade(ContractModel):
    entry_date: ContractPointTime
    exit_date: ContractPointTime
    direction: Literal["long", "short"]
    entry_price: Annotated[float, Field(gt=0, strict=True, allow_inf_nan=False)]
    exit_price: Annotated[float, Field(gt=0, strict=True, allow_inf_nan=False)]
    quantity: Annotated[float, Field(gt=0, strict=True, allow_inf_nan=False)]
    pnl: FiniteNumber
    return_percent: FiniteNumber

    @model_validator(mode="after")
    def validate_date_order(self) -> Trade:
        if _point_time_key(self.entry_date) > _point_time_key(self.exit_date):
            raise ValueError("entry_date must not be after exit_date")
        return self


class TickerResult(ContractModel):
    ticker: Ticker
    metrics: Metrics
    equity_curve: Annotated[list[EquityPoint], Field(min_length=1)]
    trades: list[Trade]

    @model_validator(mode="after")
    def validate_series_order(self) -> TickerResult:
        equity_dates = [point.date for point in self.equity_curve]
        if any(
            _point_time_key(current) >= _point_time_key(following)
            for current, following in zip(equity_dates, equity_dates[1:])
        ):
            raise ValueError("equity_curve dates must be in strictly ascending order")

        trade_dates = [trade.entry_date for trade in self.trades]
        if any(
            _point_time_key(current) > _point_time_key(following)
            for current, following in zip(trade_dates, trade_dates[1:])
        ):
            raise ValueError("trades must be ordered by entry_date")
        return self


class BacktestSuccessResponse(ContractModel):
    status: Literal["complete"]
    strategy_id: NonBlankString
    strategy_summary: NonBlankString
    generated_code: NonBlankString
    warnings: list[StrictStr]
    results: Annotated[list[TickerResult], Field(min_length=1, max_length=5)]


class BacktestErrorResponse(ContractModel):
    status: Literal["error"]
    generated_code: StrictStr
    error: ErrorObject


BacktestResponseVariant = Annotated[
    BacktestSuccessResponse | BacktestErrorResponse, Field(discriminator="status")
]


class BacktestResponse(RootModel[BacktestResponseVariant]):
    pass


class DeploySuccessResponse(ContractModel):
    status: Literal["active"]
    strategy_id: NonBlankString
    active: Literal[True]
    next_check_at: UtcDateTime


class DeployErrorResponse(ContractModel):
    status: Literal["error"]
    error: ErrorObject


DeployResponseVariant = Annotated[
    DeploySuccessResponse | DeployErrorResponse, Field(discriminator="status")
]


class DeployResponse(RootModel[DeployResponseVariant]):
    pass


class HealthResponse(ContractModel):
    status: Literal["ok"] = "ok"


def _point_time_key(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    return datetime.combine(value, time.min, tzinfo=timezone.utc)
