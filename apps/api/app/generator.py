from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
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

_MAX_STRATEGY_INPUT_CHARS = 40_000
_MAX_OUTPUT_TOKENS = 16_000

_DATA_SOURCE_CATALOG_INSTRUCTIONS = """

Available historical data sources are strictly limited to this catalog:
- Yahoo Finance (`source`: `yahoo`) accepts any valid Yahoo Finance symbol and
  only the normalized daily fields `close` and `volume`. Common examples include
  equities and ETFs such as `FICO`, `SPY`, and `QQQ`, and Yahoo indexes such as
  `^TNX` and `^VIX`; examples are not an exhaustive symbol allowlist.
- Open-Meteo historical weather (`source`: `open_meteo`) requires a confirmed
  location with name, latitude, longitude, and IANA timezone, and accepts only
  `precipitation_sum`, `temperature_2m_max`, and `temperature_2m_min`.
Version 1.0 has exactly one signal and may use Yahoo Finance or Open-Meteo.
Version 1.1 has 2-10 keyed signals, all of which must use Yahoo Finance, and
exactly one traded target ticker. Do not request or invent FRED, BLS, inflation,
unemployment, macroeconomic, fundamental, news, or any other provider or field.
The backend fetches the confirmed data; generated code must never download data.
"""

_FALLBACK_INSTRUCTIONS = """You generate a deliberately constrained Python trading strategy.
Return exactly the requested structured object with code and explanation.
The code must contain exactly one top-level, import-free class named Strategy.
Strategy must define required_data(self), returning data-request dictionaries, and
generate_signals(self, data), returning dictionaries with ticker, signal_date, and
direction. Use only built-in Python operations and normalized rows from
data["signal"] and data["prices"]. Do not fetch data, access files or networks,
call models, calculate backtest metrics, or use open, eval, exec, compile,
__import__, or any double-underscore name or attribute. Use only information known
through each signal date. The backend handles execution and backtesting."""


def _load_instructions() -> str:
    configured_path = os.getenv("API_STRATEGY_PROMPT_PATH")
    module_path = Path(__file__).resolve()
    candidates = [
        Path(configured_path) if configured_path else None,
        module_path.parents[3] / "prompts" / "strategy-codegen.md"
        if len(module_path.parents) > 3
        else None,
        module_path.parents[1] / "prompts" / "strategy-codegen.md",
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            instructions = candidate.read_text(encoding="utf-8").strip()
            if instructions:
                return instructions
    return _FALLBACK_INSTRUCTIONS


def _instructions_for_strategy(strategy_payload: Any) -> str:
    instructions = _load_instructions() + _DATA_SOURCE_CATALOG_INSTRUCTIONS
    if isinstance(strategy_payload, dict) and strategy_payload.get("version") == "1.1":
        instructions += """

For a version 1.1 strategy, required_data() must return every confirmed
signal.sources item as a dictionary containing exactly key, source, symbol, and
field. generate_signals(data) must combine only the keyed normalized series in
data["signals"][key]. Emit signals only for the single confirmed target ticker.
Do not expect data["signal"] for version 1.1 strategies.
"""
    return instructions


def generate_strategy(strategy: Any) -> GeneratedStrategy:
    api_key = os.getenv("API_OPENAI_API_KEY")
    model = os.getenv("API_OPENAI_MODEL")
    if not api_key or not model:
        raise GenerationError("OpenAI strategy generation is not configured.")

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, timeout=30.0, max_retries=2)
        strategy_payload = (
            strategy.model_dump(mode="json")
            if hasattr(strategy, "model_dump")
            else strategy
        )
        strategy_json = json.dumps(
            strategy_payload, separators=(",", ":"), sort_keys=True
        )
        if len(strategy_json) > _MAX_STRATEGY_INPUT_CHARS:
            raise ValueError("The confirmed strategy is too large for generation.")
        response = client.responses.create(
            model=model,
            instructions=_instructions_for_strategy(strategy_payload),
            input=(
                "Generate the Strategy class for this confirmed strategy:\n"
                + strategy_json
            ),
            text={
                "format": {
                    "type": "json_schema",
                    "name": "generated_strategy",
                    "strict": True,
                    "schema": _OUTPUT_SCHEMA,
                }
            },
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            truncation="disabled",
            store=False,
        )
        if getattr(response, "status", None) != "completed":
            raise ValueError("OpenAI returned an incomplete strategy response.")
        output_text = getattr(response, "output_text", "")
        if not isinstance(output_text, str) or not output_text.strip():
            raise ValueError("OpenAI returned no strategy output.")
        payload = json.loads(output_text)
        if not isinstance(payload, dict) or set(payload) != {"code", "explanation"}:
            raise ValueError("OpenAI returned an invalid strategy object.")
        code = payload["code"]
        explanation = payload["explanation"]
        if not isinstance(code, str) or not code.strip():
            raise ValueError("Generated code was empty.")
        if not isinstance(explanation, str) or not explanation.strip():
            raise ValueError("Generated explanation was empty.")
        return GeneratedStrategy(code=code, explanation=explanation)
    except Exception as exc:
        raise GenerationError("OpenAI strategy generation failed.") from exc
