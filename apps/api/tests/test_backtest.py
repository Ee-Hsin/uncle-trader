import pytest

from app.backtest import run_independent_backtests, run_ticker_backtest


def _prices(ticker_offset: float = 0.0):
    closes = [100, 101, 102, 104, 103, 106, 108, 107]
    return [
        {"date": f"2024-01-{day:02d}", "close": close + ticker_offset, "volume": 1000}
        for day, close in zip([2, 3, 4, 5, 8, 9, 10, 11], closes)
    ]


def test_enters_next_trading_day_and_ignores_overlapping_signal():
    result = run_ticker_backtest(
        ticker="FICO",
        signals=[
            {"ticker": "FICO", "signal_date": "2024-01-05", "direction": "long"},
            {"ticker": "FICO", "signal_date": "2024-01-08", "direction": "long"},
        ],
        price_rows=_prices(),
        initial_capital=10_000,
        allocation_percent=20,
        holding_period_days=2,
        direction="long",
    )

    assert result["metrics"]["trade_count"] == 1
    trade = result["trades"][0]
    assert trade["entry_date"] == "2024-01-08"
    assert trade["exit_date"] == "2024-01-10"
    assert trade["entry_price"] == 103
    assert trade["exit_price"] == 108


def test_target_tickers_have_independent_starting_capital():
    signals = [
        {"ticker": ticker, "signal_date": "2024-01-02", "direction": "long"}
        for ticker in ["FICO", "AAPL"]
    ]
    results = run_independent_backtests(
        target_tickers=["FICO", "AAPL"],
        signals=signals,
        prices={"FICO": _prices(), "AAPL": _prices(100)},
        initial_capital=10_000,
        allocation_percent=100,
        holding_period_days=1,
        direction="long",
    )

    assert [result["ticker"] for result in results] == ["FICO", "AAPL"]
    assert all(result["equity_curve"][0]["equity"] == 10_000 for result in results)
    assert results[0]["metrics"]["total_pnl"] != results[1]["metrics"]["total_pnl"]


def test_zero_trades_has_null_sharpe_and_zero_trade_metrics():
    result = run_ticker_backtest(
        ticker="FICO",
        signals=[],
        price_rows=_prices(),
        initial_capital=10_000,
        allocation_percent=20,
        holding_period_days=5,
        direction="long",
    )

    assert result["metrics"]["trade_count"] == 0
    assert result["metrics"]["sharpe_ratio"] is None
    assert result["metrics"]["average_pnl_per_trade"] == 0
    assert result["metrics"]["max_drawdown_percent"] == 0
    assert result["trades"] == []


def test_short_loss_is_capped_at_allocated_capital():
    rows = [
        {"date": "2024-01-02", "close": 100, "volume": 1},
        {"date": "2024-01-03", "close": 100, "volume": 1},
        {"date": "2024-01-04", "close": 500, "volume": 1},
    ]
    result = run_ticker_backtest(
        ticker="FICO",
        signals=[{"ticker": "FICO", "signal_date": "2024-01-02", "direction": "short"}],
        price_rows=rows,
        initial_capital=10_000,
        allocation_percent=20,
        holding_period_days=1,
        direction="short",
    )

    assert result["trades"][0]["pnl"] == -2_000
    assert result["equity_curve"][-1]["equity"] == 8_000


def test_loss_metrics_use_percentage_points_and_nonpositive_drawdown():
    rows = [
        {"date": "2024-01-02", "close": 100, "volume": 1},
        {"date": "2024-01-03", "close": 100, "volume": 1},
        {"date": "2024-01-04", "close": 90, "volume": 1},
        {"date": "2024-01-05", "close": 80, "volume": 1},
    ]
    result = run_ticker_backtest(
        ticker="FICO",
        signals=[{"ticker": "FICO", "signal_date": "2024-01-02", "direction": "long"}],
        price_rows=rows,
        initial_capital=10_000,
        allocation_percent=100,
        holding_period_days=2,
        direction="long",
    )

    metrics = result["metrics"]
    assert metrics["total_pnl"] == -2_000
    assert metrics["total_return_percent"] == -20
    assert metrics["average_pnl_per_trade"] == -2_000
    assert metrics["expected_value_per_trade"] == -2_000
    assert metrics["win_rate_percent"] == 0
    assert metrics["max_drawdown_percent"] == pytest.approx(-20)
    assert metrics["buy_and_hold_return_percent"] == pytest.approx(-20)
