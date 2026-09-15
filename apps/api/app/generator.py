from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any


class GenerationError(RuntimeError):
    """Raised when strategy generation is unavailable or returns invalid output."""


@dataclass(frozen=True)
class GeneratedStrategy:
    code: str
    explanation: str


_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["code", "explanation"],
    "properties": {
        "code": {"type": "string", "minLength": 1},
        "explanation": {"type": "string", "minLength": 1},
    },
}

_INSTRUCTIONS = """You generate a deliberately constrained Python trading strategy.
Return exactly the requested structured object with code and explanation.
The code must contain exactly one top-level, import-free class named Strategy.
Strategy must define required_data(self), returning data-request dictionaries, and
generate_signals(self, data), returning dictionaries with ticker, signal_date, and
direction. Use only built-in Python operations and normalized rows from
data["signal"] and data["prices"]. Do not fetch data, access files or networks,
call models, calculate backtest metrics, or use open, eval, exec, compile,
__import__, or any double-underscore name or attribute. Use only information known
through each signal date. The backend handles execution and backtesting."""


def generate_strategy(strategy: Any) -> GeneratedStrategy:
    api_key = os.getenv("API_OPENAI_API_KEY")
    model = os.getenv("API_OPENAI_MODEL")
    if not api_key or not model:
        raise GenerationError("OpenAI strategy generation is not configured.")

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        strategy_payload = (
            strategy.model_dump(mode="json")
            if hasattr(strategy, "model_dump")
            else strategy
        )
        response = client.responses.create(
            model=model,
            instructions=_INSTRUCTIONS,
            input=(
                "Generate the Strategy class for this confirmed strategy:\n"
                + json.dumps(strategy_payload, separators=(",", ":"), sort_keys=True)
            ),
            text={
                "format": {
                    "type": "json_schema",
                    "name": "generated_strategy",
                    "strict": True,
                    "schema": _OUTPUT_SCHEMA,
                }
            },
            store=False,
        )
        payload = json.loads(response.output_text)
        code = payload["code"]
        explanation = payload["explanation"]
        if not isinstance(code, str) or not code.strip():
            raise ValueError("Generated code was empty.")
        if not isinstance(explanation, str) or not explanation.strip():
            raise ValueError("Generated explanation was empty.")
        return GeneratedStrategy(code=code, explanation=explanation)
    except Exception as exc:
        raise GenerationError("OpenAI strategy generation failed.") from exc
