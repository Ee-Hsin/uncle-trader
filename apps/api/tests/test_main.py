from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app import main
from app.data_sources import DataSourceError
from app.repository import StrategyRepository


def _request_payload() -> dict:
    contract_path = Path(__file__).parents[3] / "contracts" / "backtest-request.example.json"
    payload = json.loads(contract_path.read_text())
    payload["strategy"]["execution"]["holding_period_days"] = 2
    return payload


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
        "signal": [
            {"date": item_date, "value": value}
            for item_date, value in zip(dates, [4.5, 4.4, 4.3, 4.2, 4.4, 4.5, 4.6])
        ],
        "prices": {
            "FICO": [
                {"date": item_date, "close": close, "volume": 1000}
                for item_date, close in zip(dates, [100, 101, 102, 103, 104, 105, 108])
            ]
        },
    }


def test_backtest_and_deploy_smoke_without_openai(monkeypatch, tmp_path):
    repository = StrategyRepository(tmp_path / "test.db")
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    monkeypatch.delenv("API_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("API_OPENAI_MODEL", raising=False)
    monkeypatch.setattr(main, "_load_data", lambda request: _normalized_data())

    try:
        with TestClient(main.app) as client:
            health = client.get("/health")
            backtest = client.post("/backtest", json=_request_payload())
            assert health.json() == {"status": "ok"}
            assert backtest.status_code == 200
            body = backtest.json()
            assert body["status"] == "complete"
            assert body["results"][0]["ticker"] == "FICO"
            assert body["results"][0]["metrics"]["trade_count"] == 1
            assert any("fallback" in warning for warning in body["warnings"])

            deployed = client.post(f"/strategies/{body['strategy_id']}/deploy")
            assert deployed.status_code == 200
            assert deployed.json()["status"] == "active"
            assert deployed.json()["next_check_at"].endswith("Z")
    finally:
        main.app.dependency_overrides.clear()


def test_data_failure_returns_contract_error(monkeypatch, tmp_path):
    repository = StrategyRepository(tmp_path / "test.db")
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    monkeypatch.delenv("API_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("API_OPENAI_MODEL", raising=False)

    def unavailable(request):
        raise DataSourceError("Yahoo Finance returned no historical data.")

    monkeypatch.setattr(main, "_load_data", unavailable)
    try:
        with TestClient(main.app) as client:
            response = client.post("/backtest", json=_request_payload())
        assert response.status_code == 200
        assert response.json()["status"] == "error"
        assert response.json()["error"]["code"] == "data_unavailable"
        assert "results" not in response.json()
    finally:
        main.app.dependency_overrides.clear()


def test_invalid_request_and_unknown_deploy_are_contract_errors(tmp_path):
    repository = StrategyRepository(tmp_path / "test.db")
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    try:
        with TestClient(main.app) as client:
            invalid = client.post("/backtest", json={})
            missing = client.post("/strategies/not-found/deploy")
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "invalid_request"
        assert invalid.json()["generated_code"] == ""
        assert missing.status_code == 200
        assert missing.json() == {
            "status": "error",
            "error": {
                "code": "strategy_not_found",
                "message": "The strategy was not found.",
            },
        }
    finally:
        main.app.dependency_overrides.clear()
