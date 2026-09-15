import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource


CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"


def _schemas():
    registry = Registry()
    schemas = {}
    for path in CONTRACTS.glob("*.schema.json"):
        schema = json.loads(path.read_text())
        schema["$id"] = path.resolve().as_uri()
        schemas[path.name] = schema
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    return schemas, registry


def _validate(example_name: str, schema_name: str) -> None:
    schemas, registry = _schemas()
    instance = json.loads((CONTRACTS / example_name).read_text())
    validator = Draft202012Validator(
        schemas[schema_name],
        registry=registry,
        format_checker=FormatChecker(),
    )
    validator.validate(instance)


def test_frozen_examples_validate_against_frozen_schemas():
    _validate("backtest-request.example.json", "backtest-request.schema.json")
    _validate("backtest-response.example.json", "backtest-response.schema.json")
    _validate("backtest-error.example.json", "backtest-response.schema.json")
    _validate("deploy-response.example.json", "deploy-response.schema.json")


def test_schema_rejects_partial_success_as_error_substitute():
    schemas, registry = _schemas()
    response = json.loads((CONTRACTS / "backtest-response.example.json").read_text())
    invalid = copy.deepcopy(response)
    invalid["status"] = "error"
    validator = Draft202012Validator(schemas["backtest-response.schema.json"], registry=registry)
    assert not validator.is_valid(invalid)
