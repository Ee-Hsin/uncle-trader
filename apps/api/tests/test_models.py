import copy
import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from app.models import (
    BacktestRequest,
    BacktestResponse,
    BacktestSuccessResponse,
    DeployErrorResponse,
    DeployResponse,
    DeploySuccessResponse,
    HealthResponse,
)


CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"


def load_example(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text())


class ContractExampleTests(unittest.TestCase):
    def test_backtest_request_example_is_accepted_and_round_trips(self) -> None:
        payload = load_example("backtest-request.example.json")
        model = BacktestRequest.model_validate(payload)
        self.assertEqual(model.model_dump(mode="json", exclude_none=True), payload)

    def test_complete_backtest_example_is_accepted_and_round_trips(self) -> None:
        payload = load_example("backtest-response.example.json")
        model = BacktestResponse.model_validate(payload)
        self.assertIsInstance(model.root, BacktestSuccessResponse)
        self.assertEqual(model.model_dump(mode="json"), payload)

    def test_error_backtest_example_is_accepted_and_round_trips(self) -> None:
        payload = load_example("backtest-error.example.json")
        model = BacktestResponse.model_validate(payload)
        self.assertEqual(model.root.status, "error")
        self.assertEqual(model.model_dump(mode="json"), payload)

    def test_active_deploy_example_is_accepted(self) -> None:
        payload = load_example("deploy-response.example.json")
        model = DeployResponse.model_validate(payload)
        self.assertIsInstance(model.root, DeploySuccessResponse)
        self.assertEqual(model.model_dump(mode="json"), payload)

    def test_error_deploy_variant_is_accepted(self) -> None:
        payload = {
            "status": "error",
            "error": {
                "code": "strategy_not_found",
                "message": "The requested strategy was not found.",
            },
        }
        model = DeployResponse.model_validate(payload)
        self.assertIsInstance(model.root, DeployErrorResponse)
        self.assertEqual(model.model_dump(mode="json", exclude_none=True), payload)

    def test_health_model_forbids_extra_fields(self) -> None:
        self.assertEqual(HealthResponse().model_dump(), {"status": "ok"})
        with self.assertRaises(ValidationError):
            HealthResponse.model_validate({"status": "ok", "message": "extra"})


class RequestValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.payload = load_example("backtest-request.example.json")

    def assert_invalid(self, payload: dict) -> None:
        with self.assertRaises(ValidationError):
            BacktestRequest.model_validate(payload)

    def test_additional_fields_are_forbidden_at_each_level(self) -> None:
        paths = [
            (),
            ("strategy",),
            ("strategy", "signal"),
            ("strategy", "execution"),
            ("backtest",),
        ]
        for path in paths:
            with self.subTest(path=path):
                payload = copy.deepcopy(self.payload)
                target = payload
                for key in path:
                    target = target[key]
                target["unexpected"] = True
                self.assert_invalid(payload)

    def test_rejects_impossible_and_non_contract_dates(self) -> None:
        for invalid_date in ["2025-02-29", "2025-2-01", "01-02-2025"]:
            with self.subTest(date=invalid_date):
                payload = copy.deepcopy(self.payload)
                payload["backtest"]["start_date"] = invalid_date
                self.assert_invalid(payload)

    def test_rejects_reversed_backtest_dates(self) -> None:
        payload = copy.deepcopy(self.payload)
        payload["backtest"]["start_date"] = "2025-01-02"
        payload["backtest"]["end_date"] = "2025-01-01"
        self.assert_invalid(payload)

    def test_rejects_duplicate_tickers(self) -> None:
        payload = copy.deepcopy(self.payload)
        payload["strategy"]["target_tickers"] = ["FICO", "FICO"]
        self.assert_invalid(payload)

    def test_yahoo_requires_symbol_and_market_field(self) -> None:
        missing_symbol = copy.deepcopy(self.payload)
        del missing_symbol["strategy"]["signal"]["symbol"]
        self.assert_invalid(missing_symbol)

        weather_field = copy.deepcopy(self.payload)
        weather_field["strategy"]["signal"]["field"] = "precipitation_sum"
        self.assert_invalid(weather_field)

        null_location = copy.deepcopy(self.payload)
        null_location["strategy"]["signal"]["location"] = None
        self.assert_invalid(null_location)

    def test_open_meteo_requires_location_and_weather_field(self) -> None:
        payload = copy.deepcopy(self.payload)
        payload["strategy"]["signal"] = {
            "source": "open_meteo",
            "field": "temperature_2m_max",
            "location": {
                "name": "Toronto",
                "latitude": 43.6532,
                "longitude": -79.3832,
                "timezone": "America/Toronto",
            },
            "rule": "Enter after a hot day.",
            "parameters": {"threshold": 30},
        }
        BacktestRequest.model_validate(payload)

        missing_location = copy.deepcopy(payload)
        del missing_location["strategy"]["signal"]["location"]
        self.assert_invalid(missing_location)

        market_field = copy.deepcopy(payload)
        market_field["strategy"]["signal"]["field"] = "close"
        self.assert_invalid(market_field)

    def test_timezone_must_be_a_real_iana_name(self) -> None:
        for invalid_timezone in ["Mars/Olympus_Mons", "America", "UTC+4"]:
            with self.subTest(timezone=invalid_timezone):
                payload = copy.deepcopy(self.payload)
                signal = payload["strategy"]["signal"]
                signal.update(
                    {
                        "source": "open_meteo",
                        "field": "precipitation_sum",
                        "location": {
                            "name": "Toronto",
                            "latitude": 43.6532,
                            "longitude": -79.3832,
                            "timezone": invalid_timezone,
                        },
                    }
                )
                self.assert_invalid(payload)


class ResponseValidationTests(unittest.TestCase):
    def test_rejects_invalid_error_details_and_unknown_error_code(self) -> None:
        nested_details = load_example("backtest-error.example.json")
        nested_details["error"]["details"]["nested"] = {"secret": "value"}
        with self.assertRaises(ValidationError):
            BacktestResponse.model_validate(nested_details)

        unknown_code = load_example("backtest-error.example.json")
        unknown_code["error"]["code"] = "unknown"
        with self.assertRaises(ValidationError):
            BacktestResponse.model_validate(unknown_code)

        null_details = load_example("backtest-error.example.json")
        null_details["error"]["details"] = None
        with self.assertRaises(ValidationError):
            BacktestResponse.model_validate(null_details)

    def test_rejects_unordered_equity_dates(self) -> None:
        payload = load_example("backtest-response.example.json")
        payload["results"][0]["equity_curve"].reverse()
        with self.assertRaises(ValidationError):
            BacktestResponse.model_validate(payload)

    def test_rejects_trade_with_exit_before_entry(self) -> None:
        payload = load_example("backtest-response.example.json")
        payload["results"][0]["trades"][0]["exit_date"] = "2024-04-03"
        with self.assertRaises(ValidationError):
            BacktestResponse.model_validate(payload)

    def test_rejects_non_utc_or_impossible_deploy_time(self) -> None:
        base = load_example("deploy-response.example.json")
        for invalid_time in [
            "2026-09-16T20:00:00+01:00",
            "2026-09-16 20:00:00Z",
            "2026-02-30T20:00:00Z",
        ]:
            with self.subTest(time=invalid_time):
                payload = copy.deepcopy(base)
                payload["next_check_at"] = invalid_time
                with self.assertRaises(ValidationError):
                    DeployResponse.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
