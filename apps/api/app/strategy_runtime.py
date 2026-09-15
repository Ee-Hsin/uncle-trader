from __future__ import annotations

import ast
import multiprocessing
from dataclasses import dataclass
from datetime import date
from queue import Empty
from typing import Any


class StrategyValidationError(ValueError):
    """Raised when generated strategy source or output violates the boundary."""


class StrategyExecutionTimeout(TimeoutError):
    """Raised when a generated strategy exceeds its execution time limit."""


@dataclass(frozen=True)
class StrategyOutput:
    required_data: list[dict[str, Any]]
    signals: list[dict[str, str]]


_BLOCKED_CALLS = {"open", "eval", "exec", "compile", "__import__"}
_SAFE_BUILTINS = {
    "__build_class__": __build_class__,
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "object": object,
    "range": range,
    "round": round,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}


def validate_strategy_source(source: str) -> None:
    if not source.strip():
        raise StrategyValidationError("Generated strategy source is empty.")

    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        raise StrategyValidationError("Generated strategy source is not valid Python.") from exc

    if len(tree.body) != 1 or not isinstance(tree.body[0], ast.ClassDef):
        raise StrategyValidationError(
            "Generated source must contain exactly one top-level Strategy class."
        )

    strategy_class = tree.body[0]
    if strategy_class.name != "Strategy" or strategy_class.bases or strategy_class.keywords:
        raise StrategyValidationError("The top-level class must be named Strategy and have no bases.")
    if strategy_class.decorator_list:
        raise StrategyValidationError("Strategy decorators are not allowed.")
    if any(not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) for node in strategy_class.body):
        raise StrategyValidationError("Strategy may contain methods only.")

    methods = {node.name: node for node in strategy_class.body}
    if "required_data" not in methods or "generate_signals" not in methods:
        raise StrategyValidationError(
            "Strategy must define required_data() and generate_signals(data)."
        )
    if any(isinstance(node, ast.AsyncFunctionDef) for node in strategy_class.body):
        raise StrategyValidationError("Async strategy methods are not allowed.")

    required_args = methods["required_data"].args
    signal_args = methods["generate_signals"].args
    if _argument_count(required_args) != 1 or _argument_count(signal_args) != 2:
        raise StrategyValidationError("Strategy methods must use the required signatures.")
    if required_args.vararg or required_args.kwarg or signal_args.vararg or signal_args.kwarg:
        raise StrategyValidationError("Variable strategy method arguments are not allowed.")

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise StrategyValidationError("Imports are not allowed in generated strategies.")
        if isinstance(node, ast.Name):
            if node.id in _BLOCKED_CALLS:
                raise StrategyValidationError(f"Use of {node.id} is not allowed.")
            if "__" in node.id:
                raise StrategyValidationError("Double-underscore names are not allowed.")
        if isinstance(node, ast.Attribute):
            if node.attr in _BLOCKED_CALLS or "__" in node.attr:
                raise StrategyValidationError("Unsafe attribute access is not allowed.")
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in _BLOCKED_CALLS:
                raise StrategyValidationError(f"Calls to {node.func.id} are not allowed.")
            if isinstance(node.func, ast.Attribute) and node.func.attr in _BLOCKED_CALLS:
                raise StrategyValidationError(f"Calls to {node.func.attr} are not allowed.")

    try:
        compile(tree, "<generated-strategy>", "exec")
    except (SyntaxError, ValueError) as exc:
        raise StrategyValidationError("Generated strategy source could not be compiled.") from exc


def _argument_count(arguments: ast.arguments) -> int:
    return len(arguments.posonlyargs) + len(arguments.args) + len(arguments.kwonlyargs)


def execute_strategy(
    source: str,
    data: dict[str, Any],
    *,
    timeout_seconds: float = 1.0,
) -> StrategyOutput:
    validate_strategy_source(source)
    context = multiprocessing.get_context("spawn")
    queue = context.Queue(maxsize=1)
    process = context.Process(target=_strategy_worker, args=(source, data, queue))
    process.start()
    process.join(timeout_seconds)
    if process.is_alive():
        process.terminate()
        process.join()
        raise StrategyExecutionTimeout("Generated strategy execution timed out.")
    try:
        payload = queue.get(timeout=0.2)
    except Empty as exc:
        raise StrategyValidationError("Generated strategy did not return a result.")
    finally:
        queue.close()
    if payload[0] == "error":
        raise StrategyValidationError(payload[1])
    required_data, signals = payload[1], payload[2]
    return StrategyOutput(
        required_data=_validate_required_data(required_data),
        signals=_validate_signals(signals),
    )


def _strategy_worker(source: str, data: dict[str, Any], queue: Any) -> None:
    namespace: dict[str, Any] = {
        "__builtins__": _SAFE_BUILTINS,
        "__name__": "generated_strategy",
    }
    try:
        exec(compile(source, "<generated-strategy>", "exec"), namespace, namespace)
        strategy = namespace["Strategy"]()
        required_data = strategy.required_data()
        signals = strategy.generate_signals(data)
        queue.put(("ok", required_data, signals))
    except BaseException:
        queue.put(("error", "Generated strategy failed its fixture run."))


def _validate_required_data(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise StrategyValidationError("required_data() must return a nonempty list.")
    keys: set[str] = set()
    for request in value:
        if not isinstance(request, dict):
            raise StrategyValidationError("Each required-data request must be a dictionary.")
        key = request.get("key")
        source = request.get("source")
        if not isinstance(key, str) or not key or key in keys:
            raise StrategyValidationError("Required-data keys must be unique and nonempty.")
        if source not in {"yahoo", "open_meteo"}:
            raise StrategyValidationError("The required-data request is invalid.")
        if source == "yahoo" and (
            not isinstance(request.get("symbol"), str)
            or request.get("field") not in {"close", "volume"}
        ):
            raise StrategyValidationError("The Yahoo required-data request is invalid.")
        keys.add(key)
    return value


def _validate_signals(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        raise StrategyValidationError("generate_signals(data) must return a list.")
    normalized: list[dict[str, str]] = []
    for signal in value:
        if not isinstance(signal, dict) or set(signal) != {"ticker", "signal_date", "direction"}:
            raise StrategyValidationError("Each signal must have ticker, signal_date, and direction.")
        try:
            date.fromisoformat(signal["signal_date"])
        except (TypeError, ValueError) as exc:
            raise StrategyValidationError("Signal dates must use YYYY-MM-DD.") from exc
        if signal["direction"] not in {"long", "short"}:
            raise StrategyValidationError("Signal direction must be long or short.")
        if not isinstance(signal["ticker"], str) or not signal["ticker"]:
            raise StrategyValidationError("Signal ticker must be nonempty.")
        normalized.append(signal)
    normalized.sort(key=lambda item: (item["signal_date"], item["ticker"]))
    return normalized


def build_fallback_source(strategy: Any) -> str:
    signal = strategy.signal
    if hasattr(signal, "sources"):
        requests = [
            {
                "key": source.key,
                "source": "yahoo",
                "symbol": source.symbol,
                "field": source.field,
            }
            for source in signal.sources
        ]
        keys = [source.key for source in signal.sources]
        ticker = strategy.target_tickers[0]
        direction = strategy.direction
        observations = int(signal.parameters.get("consecutive_observations", 1))
        observations = max(1, observations)
        return f'''class Strategy:
    def required_data(self):
        return {requests!r}

    def generate_signals(self, data):
        signals = []
        keys = {keys!r}
        series = data["signals"]
        by_date = {{}}
        for key in keys:
            by_date[key] = {{row["date"]: row["value"] for row in series[key]}}
        previous = {{}}
        streak = 0
        for row in series[keys[0]]:
            current_date = row["date"]
            values = {{}}
            complete = True
            for key in keys:
                if current_date not in by_date[key]:
                    complete = False
                else:
                    values[key] = by_date[key][current_date]
            if not complete:
                continue
            falling = len(previous) == len(keys)
            for key in keys:
                if key not in previous or values[key] >= previous[key]:
                    falling = False
            if falling:
                streak += 1
            else:
                streak = 0
            if streak >= {observations!r}:
                signals.append({{"ticker": {ticker!r}, "signal_date": current_date, "direction": {direction!r}}})
            previous = values
        return signals
'''

    source = signal.source
    request: dict[str, Any] = {
        "key": "signal",
        "source": source,
        "field": signal.field,
    }
    if source == "yahoo":
        request["symbol"] = signal.symbol
    else:
        location = signal.location
        request["location"] = {
            "name": location.name,
            "latitude": location.latitude,
            "longitude": location.longitude,
            "timezone": location.timezone,
        }
    tickers = list(strategy.target_tickers)
    direction = strategy.direction
    observations = int(signal.parameters.get("consecutive_observations", 1))
    observations = max(1, observations)
    return f'''class Strategy:
    def required_data(self):
        return [{request!r}]

    def generate_signals(self, data):
        signals = []
        rows = data["signal"]
        streak = 0
        previous = None
        for row in rows:
            value = row["value"]
            if previous is not None and value < previous:
                streak += 1
            else:
                streak = 0
            if streak >= {observations!r}:
                for ticker in {tickers!r}:
                    signals.append({{"ticker": ticker, "signal_date": row["date"], "direction": {direction!r}}})
            previous = value
        return signals
'''
