from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class PlannedTrade:
    entry_index: int
    exit_index: int
    entry_date: str
    exit_date: str
    direction: Literal["long", "short"]
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float
    return_percent: float


def run_independent_backtests(
    *,
    target_tickers: list[str],
    signals: list[dict[str, str]],
    prices: dict[str, list[dict[str, Any]]],
    initial_capital: float,
    allocation_percent: float,
    holding_period_days: int | None,
    direction: Literal["long", "short"],
    holding_period_bars: int | None = None,
    periods_per_year: float = 252.0,
) -> list[dict[str, Any]]:
    return [
        run_ticker_backtest(
            ticker=ticker,
            signals=[signal for signal in signals if signal["ticker"] == ticker],
            price_rows=prices[ticker],
            initial_capital=initial_capital,
            allocation_percent=allocation_percent,
            holding_period_days=holding_period_days,
            direction=direction,
            holding_period_bars=holding_period_bars,
            periods_per_year=periods_per_year,
        )
        for ticker in target_tickers
    ]


def run_ticker_backtest(
    *,
    ticker: str,
    signals: list[dict[str, str]],
    price_rows: list[dict[str, Any]],
    initial_capital: float,
    allocation_percent: float,
    holding_period_days: int | None,
    direction: Literal["long", "short"],
    holding_period_bars: int | None = None,
    periods_per_year: float = 252.0,
) -> dict[str, Any]:
    rows = _validated_prices(price_rows)
    dates = [row["date"] for row in rows]
    holding_period = _resolve_holding_period(
        holding_period_days, holding_period_bars
    )
    completed: list[PlannedTrade] = []
    available_equity = float(initial_capital)
    previous_exit_date: str | None = None

    for signal in sorted(signals, key=lambda item: item["signal_date"]):
        signal_date = signal["signal_date"]
        if previous_exit_date is not None and signal_date <= previous_exit_date:
            continue
        entry_index = _first_index_after(dates, signal_date)
        if entry_index is None:
            continue
        exit_index = entry_index + holding_period
        if exit_index >= len(rows):
            continue
        entry_price = rows[entry_index]["close"]
        exit_price = rows[exit_index]["close"]
        allocation = available_equity * allocation_percent / 100.0
        quantity = allocation / entry_price
        raw_pnl = (
            (exit_price - entry_price) * quantity
            if direction == "long"
            else (entry_price - exit_price) * quantity
        )
        pnl = max(raw_pnl, -allocation) if direction == "short" else raw_pnl
        trade_return = pnl / allocation * 100.0 if allocation else 0.0
        trade = PlannedTrade(
            entry_index=entry_index,
            exit_index=exit_index,
            entry_date=dates[entry_index],
            exit_date=dates[exit_index],
            direction=direction,
            entry_price=entry_price,
            exit_price=exit_price,
            quantity=quantity,
            pnl=pnl,
            return_percent=trade_return,
        )
        completed.append(trade)
        available_equity += pnl
        previous_exit_date = trade.exit_date

    equity_curve = _equity_curve(rows, completed, initial_capital)
    trades = [
        {
            "entry_date": trade.entry_date,
            "exit_date": trade.exit_date,
            "direction": trade.direction,
            "entry_price": trade.entry_price,
            "exit_price": trade.exit_price,
            "quantity": trade.quantity,
            "pnl": trade.pnl,
            "return_percent": trade.return_percent,
        }
        for trade in completed
    ]
    metrics = _metrics(
        rows, equity_curve, trades, initial_capital, periods_per_year
    )
    return {
        "ticker": ticker,
        "metrics": metrics,
        "equity_curve": equity_curve,
        "trades": trades,
    }


def _validated_prices(price_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not price_rows:
        raise ValueError("Price history is empty.")
    rows = sorted(price_rows, key=lambda item: item["date"])
    if len({row["date"] for row in rows}) != len(rows):
        raise ValueError("Price history contains duplicate dates.")
    normalized = []
    for row in rows:
        close = float(row["close"])
        volume = float(row["volume"])
        if not math.isfinite(close) or close <= 0 or not math.isfinite(volume) or volume < 0:
            raise ValueError("Price history contains invalid values.")
        normalized.append({"date": row["date"], "close": close, "volume": volume})
    return normalized


def _first_index_after(dates: list[str], signal_date: str) -> int | None:
    for index, current_date in enumerate(dates):
        if current_date > signal_date:
            return index
    return None


def _resolve_holding_period(
    holding_period_days: int | None, holding_period_bars: int | None
) -> int:
    configured = [
        value
        for value in (holding_period_days, holding_period_bars)
        if value is not None
    ]
    if len(configured) != 1 or isinstance(configured[0], bool) or configured[0] < 1:
        raise ValueError("Exactly one positive holding period must be provided.")
    return configured[0]


def _equity_curve(
    rows: list[dict[str, Any]], trades: list[PlannedTrade], initial_capital: float
) -> list[dict[str, float | str]]:
    curve: list[dict[str, float | str]] = []
    for index, row in enumerate(rows):
        equity = float(initial_capital)
        for trade in trades:
            if index >= trade.exit_index:
                equity += trade.pnl
            elif trade.entry_index <= index < trade.exit_index:
                move = (
                    row["close"] - trade.entry_price
                    if trade.direction == "long"
                    else trade.entry_price - row["close"]
                )
                unrealized = move * trade.quantity
                if trade.direction == "short":
                    allocation = trade.entry_price * trade.quantity
                    unrealized = max(unrealized, -allocation)
                equity += unrealized
        curve.append({"date": row["date"], "equity": max(0.0, equity)})
    return curve


def _metrics(
    rows: list[dict[str, Any]],
    equity_curve: list[dict[str, float | str]],
    trades: list[dict[str, Any]],
    initial_capital: float,
    periods_per_year: float,
) -> dict[str, Any]:
    if not math.isfinite(periods_per_year) or periods_per_year <= 0:
        raise ValueError("periods_per_year must be positive and finite.")
    ending_equity = float(equity_curve[-1]["equity"])
    total_pnl = ending_equity - initial_capital
    total_return = total_pnl / initial_capital * 100.0
    pnls = [float(trade["pnl"]) for trade in trades]
    count = len(pnls)
    average_pnl = sum(pnls) / count if count else 0.0
    win_rate = sum(pnl > 0 for pnl in pnls) / count * 100.0 if count else 0.0
    equities = [float(point["equity"]) for point in equity_curve]
    returns = [
        current / previous - 1.0
        for previous, current in zip(equities, equities[1:])
        if previous > 0
    ]
    sharpe: float | None = None
    if len(returns) >= 2:
        deviation = statistics.stdev(returns)
        if deviation > 0:
            sharpe = math.sqrt(periods_per_year) * statistics.mean(returns) / deviation
    peak = equities[0]
    max_drawdown = 0.0
    for equity in equities:
        peak = max(peak, equity)
        drawdown = (equity / peak - 1.0) * 100.0 if peak else 0.0
        max_drawdown = min(max_drawdown, drawdown)
    buy_hold = (rows[-1]["close"] / rows[0]["close"] - 1.0) * 100.0
    return {
        "total_pnl": total_pnl,
        "total_return_percent": total_return,
        "sharpe_ratio": sharpe,
        "average_pnl_per_trade": average_pnl,
        "expected_value_per_trade": average_pnl,
        "win_rate_percent": win_rate,
        "max_drawdown_percent": max_drawdown,
        "trade_count": count,
        "buy_and_hold_return_percent": buy_hold,
    }
