from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class Asset(BaseModel):
    kind: Literal["stock", "etf", "treasury_yield", "weather"]
    symbol: str
    location: str | None = None


class ConfirmedStrategy(BaseModel):
    version: Literal["1.0"]
    name: str
    thesis: str
    asset: Asset
    entry_rules: list[str] = Field(min_length=1)
    exit_rules: list[str] = Field(min_length=1)
    parameters: dict[str, float | int | str] = Field(default_factory=dict)


class BacktestPeriod(BaseModel):
    start: date
    end: date


class BacktestRequest(BaseModel):
    strategy: ConfirmedStrategy
    period: BacktestPeriod
    initial_capital: float = Field(default=10_000, gt=0)


class BacktestResponse(BaseModel):
    status: Literal["placeholder"] = "placeholder"
    message: str
    strategy_id: str | None = None
    metrics: dict[str, float] | None = None


class DeployResponse(BaseModel):
    status: Literal["placeholder"] = "placeholder"
    message: str
    strategy_id: str
    active: Literal[False] = False


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"

