"""Tests for factorylm_ai.schemas.validate — the minimal JSON-Schema-subset validator.

Exercises the validator's supported-keyword subset directly against inline
schemas, then walks every ``*.schema.json`` checked into
``factorylm_ai/schemas/`` (recursively — so ``task_outputs/*`` is picked up
whenever B3's files exist) and confirms every embedded ``examples`` instance
validates clean against its own schema. No network; nothing outside
``factorylm_ai.*`` + stdlib is imported.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from factorylm_ai.schemas.validate import SchemaError, load_schema, validate, validate_or_raise

SCHEMAS_DIR = Path(__file__).resolve().parents[2] / "factorylm_ai" / "schemas"

REQUIRED_ROOT_SCHEMAS = {
    "model_run",
    "interaction_record",
    "feedback_event",
    "training_record",
    "eval_case",
    "promotion_decision",
    "zta_artifact",
}


# ---------------------------------------------------------------------------
# type (incl. null unions)
# ---------------------------------------------------------------------------


def test_type_ok():
    assert validate("hi", {"type": "string"}) == []


def test_type_mismatch_reports_path_and_problem():
    errors = validate(5, {"type": "string"})
    assert len(errors) == 1
    assert errors[0].startswith("$:")


def test_type_null_union_accepts_null_and_matching_type():
    schema = {"type": ["string", "null"]}
    assert validate(None, schema) == []
    assert validate("x", schema) == []
    assert validate(5, schema) != []


def test_type_boolean_not_confused_with_integer():
    # JSON Schema semantics: bool is not a "number"/"integer", even though
    # Python's bool is an int subclass.
    assert validate(True, {"type": "integer"}) != []
    assert validate(1, {"type": "boolean"}) != []
    assert validate(True, {"type": "boolean"}) == []


# ---------------------------------------------------------------------------
# properties / required
# ---------------------------------------------------------------------------


def test_required_missing_reports_field_name():
    schema = {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"]}
    errors = validate({}, schema)
    assert len(errors) == 1
    assert "a" in errors[0]
    assert "required" in errors[0]


def test_required_present_ok():
    schema = {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"]}
    assert validate({"a": "x"}, schema) == []


def test_nested_object_and_array_reports_deep_path():
    schema = {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"n": {"type": "integer"}},
                    "required": ["n"],
                },
            }
        },
        "required": ["items"],
    }
    assert validate({"items": [{"n": 1}, {"n": 2}]}, schema) == []
    errors = validate({"items": [{"n": 1}, {}]}, schema)
    assert len(errors) == 1
    assert "[1].n" in errors[0]


# ---------------------------------------------------------------------------
# enum
# ---------------------------------------------------------------------------


def test_enum_ok_and_violation():
    schema = {"type": "string", "enum": ["a", "b"]}
    assert validate("a", schema) == []
    errors = validate("c", schema)
    assert len(errors) == 1
    assert "enum" in errors[0]


# ---------------------------------------------------------------------------
# items / minItems
# ---------------------------------------------------------------------------


def test_items_validates_each_element_and_reports_index():
    schema = {"type": "array", "items": {"type": "string"}}
    assert validate(["a", "b"], schema) == []
    errors = validate(["a", 1, "c"], schema)
    assert len(errors) == 1
    assert "[1]" in errors[0]


def test_min_items():
    schema = {"type": "array", "items": {"type": "string"}, "minItems": 1}
    assert validate(["a"], schema) == []
    errors = validate([], schema)
    assert len(errors) == 1
    assert "minItems" in errors[0]


# ---------------------------------------------------------------------------
# additionalProperties (bool)
# ---------------------------------------------------------------------------


def test_additional_properties_false_rejects_extra_key():
    schema = {
        "type": "object",
        "properties": {"a": {"type": "string"}},
        "required": ["a"],
        "additionalProperties": False,
    }
    assert validate({"a": "x"}, schema) == []
    errors = validate({"a": "x", "b": "y"}, schema)
    assert len(errors) == 1
    assert "b" in errors[0]


def test_additional_properties_default_true_allows_extra_key():
    schema = {"type": "object", "properties": {"a": {"type": "string"}}}
    assert validate({"a": "x", "b": "y"}, schema) == []


# ---------------------------------------------------------------------------
# minimum / maximum / minLength
# ---------------------------------------------------------------------------


def test_minimum_and_maximum():
    schema = {"type": "number", "minimum": 0, "maximum": 1}
    assert validate(0.5, schema) == []
    assert validate(0, schema) == []
    assert validate(1, schema) == []
    assert len(validate(-0.1, schema)) == 1
    assert len(validate(1.1, schema)) == 1


def test_min_length():
    schema = {"type": "string", "minLength": 3}
    assert validate("abc", schema) == []
    assert len(validate("ab", schema)) == 1


# ---------------------------------------------------------------------------
# pattern (best-effort re)
# ---------------------------------------------------------------------------


def test_pattern_match_and_violation():
    schema = {"type": "string", "pattern": r"^[0-9a-f]{8}$"}
    assert validate("deadbeef", schema) == []
    errors = validate("not-hex!", schema)
    assert len(errors) == 1
    assert "pattern" in errors[0]


def test_pattern_invalid_regex_is_reported_not_raised():
    schema = {"type": "string", "pattern": "("}  # unbalanced group
    errors = validate("anything", schema)
    assert len(errors) == 1
    assert "invalid pattern" in errors[0]


# ---------------------------------------------------------------------------
# empty schema / validate_or_raise
# ---------------------------------------------------------------------------


def test_empty_schema_accepts_anything():
    assert validate("x", {}) == []
    assert validate(1, {}) == []
    assert validate(None, {}) == []
    assert validate({"anything": "goes"}, {}) == []


def test_validate_or_raise_raises_on_invalid():
    with pytest.raises(SchemaError):
        validate_or_raise(5, {"type": "string"})


def test_validate_or_raise_silent_on_valid():
    validate_or_raise("ok", {"type": "string"})  # must not raise


# ---------------------------------------------------------------------------
# load_schema()
# ---------------------------------------------------------------------------


def test_load_schema_resolves_root_name():
    schema = load_schema("model_run")
    assert schema["title"] == "ModelRun"


def test_load_schema_resolves_task_outputs_subpath_when_present():
    subpath_dir = SCHEMAS_DIR / "task_outputs"
    candidates = sorted(subpath_dir.glob("*.schema.json")) if subpath_dir.is_dir() else []
    if not candidates:
        pytest.skip("task_outputs/*.schema.json not written yet (B3's assignment)")
    name = f"task_outputs/{candidates[0].name.removesuffix('.schema.json')}"
    schema = load_schema(name)
    assert isinstance(schema, dict)


def test_load_schema_missing_raises():
    with pytest.raises(SchemaError):
        load_schema("does_not_exist_anywhere")


def test_load_schema_rejects_traversal():
    with pytest.raises(SchemaError):
        load_schema("../pyproject")


def test_load_schema_rejects_empty_name():
    with pytest.raises(SchemaError):
        load_schema("")


def test_load_schema_caches_same_object():
    first = load_schema("model_run")
    second = load_schema("model_run")
    assert first is second


# ---------------------------------------------------------------------------
# Every schema file under factorylm_ai/schemas/ (recursive) loads and every
# embedded example validates against its own schema.
# ---------------------------------------------------------------------------


def _all_schema_files() -> list[Path]:
    return sorted(SCHEMAS_DIR.rglob("*.schema.json"))


def test_all_seven_root_schemas_exist():
    found = {p.name.removesuffix(".schema.json") for p in SCHEMAS_DIR.glob("*.schema.json")}
    missing = REQUIRED_ROOT_SCHEMAS - found
    assert not missing, f"missing root schema files: {missing}"


@pytest.mark.parametrize(
    "schema_path", _all_schema_files(), ids=lambda p: str(p.relative_to(SCHEMAS_DIR))
)
def test_schema_file_loads_and_examples_validate(schema_path: Path):
    with schema_path.open("r", encoding="utf-8") as f:
        schema = json.load(f)
    assert isinstance(schema, dict), f"{schema_path} is not a JSON object"
    examples = schema.get("examples")
    assert examples, f"{schema_path} has no non-empty 'examples' array"
    for i, example in enumerate(examples):
        errors = validate(example, schema)
        assert errors == [], f"{schema_path} examples[{i}] failed: {errors}"


def test_mutated_example_missing_required_field_fails():
    schema = load_schema("model_run")
    example = copy.deepcopy(schema["examples"][0])
    del example["ts"]
    errors = validate(example, schema)
    assert errors != []
    assert any("ts" in e for e in errors)


def test_mutated_example_bad_enum_value_fails():
    schema = load_schema("model_run")
    example = copy.deepcopy(schema["examples"][0])
    example["human_rating"] = "maybe"
    assert validate(example, schema) != []


def test_mutated_example_extra_property_fails():
    schema = load_schema("zta_artifact")
    example = copy.deepcopy(schema["examples"][0])
    example["not_a_real_field"] = True
    assert validate(example, schema) != []


def test_mutated_example_wrong_type_fails():
    schema = load_schema("promotion_decision")
    example = copy.deepcopy(schema["examples"][0])
    example["json_validity_rate"] = "not-a-number"
    assert validate(example, schema) != []
