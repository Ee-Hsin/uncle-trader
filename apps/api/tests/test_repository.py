from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from app.repository import (
    RepositoryError,
    StrategyNotDeployableError,
    StrategyNotFoundError,
    StrategyRepository,
)


CREATED_AT = datetime(2026, 9, 15, 14, 30, tzinfo=timezone.utc)
NEXT_CHECK_AT = datetime(2026, 9, 16, 20, 0, tzinfo=timezone.utc)


def request_fixture() -> dict:
    return {
        "strategy": {
            "version": "1.0",
            "name": "FICO after falling yields",
            "thesis": "Falling yields can support valuation.",
            "target_tickers": ["FICO"],
            "direction": "long",
            "signal": {
                "source": "yahoo",
                "symbol": "^TNX",
                "field": "close",
                "rule": "Enter after three falling closes.",
                "parameters": {"observations": 3},
            },
            "execution": {
                "entry_timing": "next_trading_day_close",
                "holding_period_days": 5,
                "allocation_percent": 20,
                "ignore_overlapping_signals": True,
            },
        },
        "backtest": {
            "start_date": date(2025, 1, 1),
            "end_date": date(2025, 12, 31),
            "initial_capital": 10_000,
        },
    }


def response_fixture(strategy_id: str = "fico-yields") -> dict:
    return {
        "status": "complete",
        "strategy_id": strategy_id,
        "strategy_summary": "Buy FICO after falling yields.",
        "generated_code": "class Strategy:\n    pass",
        "warnings": ["Paper trading only."],
        "results": [
            {
                "ticker": "FICO",
                "metrics": {"total_pnl": 0},
                "equity_curve": [{"date": "2025-01-02", "equity": 10_000}],
                "trades": [],
            }
        ],
    }


class JsonModel:
    """Small Pydantic-shaped stand-in, keeping repository tests decoupled."""

    def __init__(self, value: dict) -> None:
        self.value = value
        self.mode = None

    def model_dump(self, *, mode: str) -> dict:
        self.mode = mode
        return self.value


class StrategyRepositoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "data" / "strategies.db"
        self.repository = StrategyRepository(
            self.database_path, clock=lambda: CREATED_AT
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_initializes_schema_at_configured_environment_path(self) -> None:
        environment_path = Path(self.temp_dir.name) / "env" / "api.db"
        with patch.dict(os.environ, {"API_DATABASE_PATH": str(environment_path)}):
            repository = StrategyRepository(clock=lambda: CREATED_AT)

        self.assertEqual(repository.database_path, str(environment_path))
        with sqlite3.connect(environment_path) as connection:
            columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(strategies)").fetchall()
            }
        self.assertEqual(
            columns,
            {
                "strategy_id",
                "strategy_json",
                "backtest_json",
                "generated_code",
                "response_json",
                "status",
                "created_at",
                "next_check_at",
            },
        )

    def test_save_and_fetch_round_trip_survives_repository_restart(self) -> None:
        request = request_fixture()
        response = response_fixture()

        saved = self.repository.save_completed(request, response)
        fetched = StrategyRepository(self.database_path).fetch("fico-yields")

        self.assertEqual(saved, fetched)
        self.assertEqual(fetched.strategy, request["strategy"])
        self.assertEqual(
            fetched.backtest,
            {
                "start_date": "2025-01-01",
                "end_date": "2025-12-31",
                "initial_capital": 10_000,
            },
        )
        self.assertEqual(fetched.response, response)
        self.assertEqual(fetched.generated_code, response["generated_code"])
        self.assertEqual(fetched.status, "complete")
        self.assertEqual(fetched.created_at, CREATED_AT)
        self.assertIsNone(fetched.next_check_at)

    def test_accepts_pydantic_shaped_values_and_json_strings(self) -> None:
        request_model = JsonModel(request_fixture())
        response_json = json.dumps(response_fixture())

        stored = self.repository.save_completed(request_model, response_json)

        self.assertEqual(request_model.mode, "json")
        self.assertEqual(stored.strategy_id, "fico-yields")

    def test_unknown_strategy_fetch_returns_none(self) -> None:
        self.assertIsNone(self.repository.fetch("unknown"))

    def test_rejects_error_response_and_duplicate_id(self) -> None:
        error_response = {
            "status": "error",
            "generated_code": "",
            "error": {"code": "backtest_failed", "message": "Failed."},
        }
        with self.assertRaisesRegex(RepositoryError, "Only complete"):
            self.repository.save_completed(request_fixture(), error_response)

        self.repository.save_completed(request_fixture(), response_fixture())
        with self.assertRaisesRegex(RepositoryError, "already saved"):
            self.repository.save_completed(request_fixture(), response_fixture())

    def test_activation_sets_utc_next_check_and_preserves_payload(self) -> None:
        self.repository.save_completed(request_fixture(), response_fixture())
        eastern = timezone(timedelta(hours=-4))

        active = self.repository.activate(
            "fico-yields", NEXT_CHECK_AT.astimezone(eastern)
        )

        self.assertEqual(active.status, "active")
        self.assertEqual(active.next_check_at, NEXT_CHECK_AT)
        self.assertEqual(active.created_at, CREATED_AT)
        self.assertEqual(active.response, response_fixture())
        with sqlite3.connect(self.database_path) as connection:
            stored_time = connection.execute(
                "SELECT next_check_at FROM strategies WHERE strategy_id = ?",
                ("fico-yields",),
            ).fetchone()[0]
        self.assertEqual(stored_time, "2026-09-16T20:00:00Z")

    def test_activation_rejects_unknown_or_non_complete_strategy(self) -> None:
        with self.assertRaisesRegex(StrategyNotFoundError, "not found"):
            self.repository.activate("unknown", NEXT_CHECK_AT)

        self.repository.save_completed(request_fixture(), response_fixture())
        self.repository.activate("fico-yields", NEXT_CHECK_AT)
        with self.assertRaisesRegex(StrategyNotDeployableError, "completed"):
            self.repository.activate("fico-yields", NEXT_CHECK_AT)

    def test_activation_requires_timezone_aware_timestamp(self) -> None:
        self.repository.save_completed(request_fixture(), response_fixture())
        with self.assertRaisesRegex(RepositoryError, "timezone-aware"):
            self.repository.activate("fico-yields", datetime(2026, 9, 16, 20))

    def test_only_one_concurrent_activation_can_transition_state(self) -> None:
        self.repository.save_completed(request_fixture(), response_fixture())

        def activate() -> str:
            try:
                self.repository.activate("fico-yields", NEXT_CHECK_AT)
            except StrategyNotDeployableError:
                return "rejected"
            return "active"

        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(lambda _: activate(), range(2)))

        self.assertCountEqual(outcomes, ["active", "rejected"])


if __name__ == "__main__":
    unittest.main()
