from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main
from app.data_sources import load_yahoo_signals
from app.generator import _instructions_for_strategy
from app.models import BacktestRequest
from app.repository import StrategyRepository
from app.strategy_runtime import build_fallback_source, execute_strategy


def _request_payload() -> dict:
    return {
        "strategy": {
            "version": "1.1",
            "name": "FICO multi-source confirmation",
            "thesis": "Falling yields and market prices confirm the entry.",
            "target_tickers": ["FICO"],
            "direction": "long",
            "signal": {
                "sources": [
                    {
                        "key": "treasury_yield",
                        "source": "yahoo",
                        "symbol": "^TNX",
                        "field": "close",
                    },
                    {
                        "key": "market",
                        "source": "yahoo",
                        "symbol": "SPY",
                        "field": "close",
                    },
                ],
                "rule": "Enter when both series decline for two observations.",
                "parameters": {"consecutive_observations": 2},
            },
            "execution": {
                "entry_timing": "next_trading_day_close",
                "holding_period_days": 2,
                "allocation_percent": 20,
                "ignore_overlapping_signals": True,
            },
        },
        "backtest": {
            "start_date": "2024-01-02",
            "end_date": "2024-01-10",
            "initial_capital": 10_000,
        },
    }


def _normalized_data() -> dict:
    dates = [
        "2024-01-02",
        "2024-01-03",
        "2024-01-04",
        "2024-01-05",
        "2024-01-08",
        "2024-01-09",
        "2024-01-10",
    ]
    return {
        "signals": {
            "treasury_yield": [
                {"date": item_date, "value": value}
                for item_date, value in zip(dates, [4.5, 4.4, 4.3, 4.2, 4.4, 4.5, 4.6])
            ],
            "market": [
                {"date": item_date, "value": value}
                for item_date, value in zip(dates, [500, 499, 498, 497, 501, 502, 503])
            ],
        },
        "prices": {
            "FICO": [
                {"date": item_date, "close": close, "volume": 1000}
                for item_date, close in zip(dates, [100, 101, 102, 103, 104, 105, 108])
            ]
        },
    }


def test_version_11_accepts_multiple_sources_and_one_target():
    request = BacktestRequest.model_validate(_request_payload())
    assert request.strategy.version == "1.1"
    assert [source.key for source in request.strategy.signal.sources] == [
        "treasury_yield",
        "market",
    ]


def test_generation_instructions_include_exact_data_source_catalog():
    instructions = _instructions_for_strategy(_request_payload()["strategy"])

    assert "Yahoo Finance (`source`: `yahoo`)" in instructions
    assert "`close` and `volume`" in instructions
    assert "Open-Meteo historical weather (`source`: `open_meteo`)" in instructions
    assert "`precipitation_sum`" in instructions
    assert "`temperature_2m_max`" in instructions
    assert "`temperature_2m_min`" in instructions
    assert "Version 1.1 has 2-10 keyed signals" in instructions
    assert "Do not request or invent FRED, BLS, inflation" in instructions


def test_version_11_rejects_multiple_targets_or_duplicate_source_keys():
    multiple_targets = _request_payload()
    multiple_targets["strategy"]["target_tickers"] = ["FICO", "AAPL"]
    with pytest.raises(ValidationError, match="exactly one target ticker"):
        BacktestRequest.model_validate(multiple_targets)

    duplicate_keys = _request_payload()
    duplicate_keys["strategy"]["signal"]["sources"][1]["key"] = "treasury_yield"
    with pytest.raises(ValidationError, match="keys must be unique"):
        BacktestRequest.model_validate(duplicate_keys)


def test_multi_source_yahoo_loader_matches_real_multi_index_shape():
    columns = pd.MultiIndex.from_tuples(
        [
            ("Close", "^TNX"),
            ("Close", "SPY"),
            ("Volume", "^TNX"),
            ("Volume", "SPY"),
        ],
        names=["Price", "Ticker"],
    )
    frame = pd.DataFrame(
        [[4.25, 500.0, 0, 50_000_000], [4.20, 498.0, 0, 51_000_000]],
        columns=columns,
        index=pd.DatetimeIndex(["2024-01-02", "2024-01-03"], name="Date"),
    )
    calls = []

    def download(symbols, **kwargs):
        calls.append(symbols)
        return frame

    sources = _request_payload()["strategy"]["signal"]["sources"]
    result = load_yahoo_signals(
        sources, "2024-01-02", "2024-01-03", download=download
    )

    assert calls == [["^TNX", "SPY"]]
    assert result == {
        "treasury_yield": [
            {"date": "2024-01-02", "value": 4.25},
            {"date": "2024-01-03", "value": 4.20},
        ],
        "market": [
            {"date": "2024-01-02", "value": 500.0},
            {"date": "2024-01-03", "value": 498.0},
        ],
    }


def test_multi_source_fallback_requests_and_combines_all_sources():
    request = BacktestRequest.model_validate(_request_payload())
    source = build_fallback_source(request.strategy)
    output = execute_strategy(source, _normalized_data())

    assert output.required_data == [
        {
            "key": "treasury_yield",
            "source": "yahoo",
            "symbol": "^TNX",
            "field": "close",
        },
        {"key": "market", "source": "yahoo", "symbol": "SPY", "field": "close"},
    ]
    assert [signal["signal_date"] for signal in output.signals] == [
        "2024-01-04",
        "2024-01-05",
    ]
    main._validate_required_data_matches(list(reversed(output.required_data)), request)


def test_main_loads_all_confirmed_yahoo_sources(monkeypatch):
    request = BacktestRequest.model_validate(_request_payload())
    seen = {}

    def prices(tickers, start, end):
        seen["targets"] = list(tickers)
        return _normalized_data()["prices"]

    def signals(sources, start, end):
        seen["sources"] = [source.symbol for source in sources]
        return _normalized_data()["signals"]

    monkeypatch.setattr(main, "load_yahoo_prices", prices)
    monkeypatch.setattr(main, "load_yahoo_signals", signals)

    data = main._load_data(request)

    assert seen == {"targets": ["FICO"], "sources": ["^TNX", "SPY"]}
    assert data == _normalized_data()


def test_multi_source_request_runs_through_backtest_endpoint(monkeypatch, tmp_path):
    repository = StrategyRepository(tmp_path / "test.db")
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    monkeypatch.delenv("API_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("API_OPENAI_MODEL", raising=False)
    monkeypatch.setattr(main, "_load_data", lambda request: _normalized_data())
    try:
        with TestClient(main.app) as client:
            response = client.post("/backtest", json=_request_payload())
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert len(body["results"]) == 1
    assert body["results"][0]["ticker"] == "FICO"
    assert body["results"][0]["metrics"]["trade_count"] == 1
    assert 'data["signals"]' in body["generated_code"]
