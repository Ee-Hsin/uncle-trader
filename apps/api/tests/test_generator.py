from __future__ import annotations

import json
from types import SimpleNamespace

import openai
import pytest

from app.generator import GenerationError, _load_instructions, generate_strategy


def test_generate_strategy_uses_responses_api_and_strict_output(monkeypatch):
    model_request = {}
    output = {
        "code": "class Strategy:\n    def required_data(self):\n        return []\n\n    def generate_signals(self, data):\n        return []",
        "explanation": "This test strategy emits no signals.",
    }

    class FakeResponses:
        def create(self, **request):
            model_request.update(request)
            return SimpleNamespace(status="completed", output_text=json.dumps(output))

    class FakeOpenAI:
        def __init__(self, api_key, timeout, max_retries):
            assert api_key == "test-key"
            assert timeout == 30.0
            assert max_retries == 2
            self.responses = FakeResponses()

    monkeypatch.setenv("API_OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("API_OPENAI_MODEL", "test-model")
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    generated = generate_strategy({"name": "Test"})

    assert generated.code == output["code"]
    assert model_request["model"] == "test-model"
    assert model_request["store"] is False
    assert model_request["max_output_tokens"] == 16_000
    assert model_request["truncation"] == "disabled"
    assert model_request["text"]["format"]["type"] == "json_schema"
    assert model_request["text"]["format"]["strict"] is True
    assert "exactly one import-free Python `Strategy` class" in model_request["instructions"]


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(status="incomplete", output_text=""),
        SimpleNamespace(status="completed", output_text=""),
        SimpleNamespace(status="completed", output_text='{"code":"x","explanation":"y","extra":true}'),
    ],
)
def test_generate_strategy_rejects_incomplete_or_invalid_output(monkeypatch, response):
    class FakeOpenAI:
        def __init__(self, api_key, timeout, max_retries):
            self.responses = SimpleNamespace(create=lambda **request: response)

    monkeypatch.setenv("API_OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("API_OPENAI_MODEL", "test-model")
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    with pytest.raises(GenerationError, match="generation failed"):
        generate_strategy({"name": "Test"})


def test_shared_strategy_prompt_is_available():
    assert _load_instructions().startswith("# Uncle Trading strategy code generation")


def test_generate_strategy_rejects_oversized_input_before_model_call(monkeypatch):
    called = False

    class FakeResponses:
        def create(self, **request):
            nonlocal called
            called = True

    class FakeOpenAI:
        def __init__(self, api_key, timeout, max_retries):
            self.responses = FakeResponses()

    monkeypatch.setenv("API_OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("API_OPENAI_MODEL", "test-model")
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    with pytest.raises(GenerationError, match="generation failed"):
        generate_strategy({"name": "x" * 40_001})

    assert called is False
