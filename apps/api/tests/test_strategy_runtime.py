import pytest

from app.strategy_runtime import (
    StrategyExecutionTimeout,
    StrategyValidationError,
    execute_strategy,
    validate_strategy_source,
)


VALID_SOURCE = '''class Strategy:
    def required_data(self):
        return [{"key": "signal", "source": "yahoo", "symbol": "^TNX", "field": "close"}]

    def generate_signals(self, data):
        return [{"ticker": "FICO", "signal_date": data["signal"][0]["date"], "direction": "long"}]
'''


def test_valid_strategy_runs_in_isolated_process():
    output = execute_strategy(
        VALID_SOURCE,
        {"signal": [{"date": "2024-01-02", "value": 4.0}], "prices": {}},
    )
    assert output.required_data[0]["symbol"] == "^TNX"
    assert output.signals[0]["signal_date"] == "2024-01-02"


@pytest.mark.parametrize(
    "source",
    [
        "import os\nclass Strategy:\n    pass\n",
        "class Other:\n    pass\n",
        "class Strategy:\n    value = 1\n",
        "class Strategy:\n    def required_data(self):\n        return open('x')\n    def generate_signals(self, data):\n        return []\n",
        "class Strategy:\n    def required_data(self):\n        return self.__dict__\n    def generate_signals(self, data):\n        return []\n",
    ],
)
def test_rejects_unsafe_or_invalid_source(source):
    with pytest.raises(StrategyValidationError):
        validate_strategy_source(source)


def test_times_out_infinite_strategy():
    source = '''class Strategy:
    def required_data(self):
        return [{"key": "signal", "source": "yahoo"}]

    def generate_signals(self, data):
        while True:
            pass
'''
    with pytest.raises(StrategyExecutionTimeout):
        execute_strategy(source, {"signal": [], "prices": {}}, timeout_seconds=0.1)
