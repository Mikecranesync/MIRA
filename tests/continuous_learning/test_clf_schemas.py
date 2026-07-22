"""Conformance tests for the Continuous Learning Factory (CLF) schema set.

PR 0 is docs/schema-only. These tests are the *validation* deliverable: they
prove the seven `factorylm.clf.*.v1` JSON Schemas are well-formed draft-2020-12
schemas, that every shipped example validates against its schema, and that the
schema set honours the PR 0 invariants (region geometry is linked to
`factorylm.visual-region.v1`, never redefined; every schema pins its identity
with a `schema` const; the example set is 1:1 with the schema set).

The heavy validation uses `jsonschema` and is skipped where that optional
dependency is absent. A dependency-free structural layer runs unconditionally so
the suite still catches drift (bad JSON, missing/duplicate examples, an inlined
geometry definition) in any environment.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# <repo-root>/docs/specs/continuous-learning-factory/{schemas,examples}
# __file__ is tests/continuous_learning/test_clf_schemas.py -> parents[2] is the repo root.
_SPEC_DIR = Path(__file__).resolve().parents[2] / "docs" / "specs" / "continuous-learning-factory"
SCHEMA_DIR = _SPEC_DIR / "schemas"
EXAMPLE_DIR = _SPEC_DIR / "examples"

# The identity of the visual-region contract that CLF *links to* and must never
# redefine (owned by mira-bots/shared/visual, PRs #2843/#2846).
VISUAL_REGION_ID = "factorylm.visual-region.v1"
# Property names that would mean a CLF schema inlined region geometry instead of
# referencing it by region_id. Requirement 1: linked, never inlined.
_GEOMETRY_PROPERTY_NAMES = {"geometry", "bbox", "polygon", "points", "quad"}


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _schema_paths() -> list[Path]:
    return sorted(SCHEMA_DIR.glob("*.v1.schema.json"))


def _example_paths() -> list[Path]:
    return sorted(EXAMPLE_DIR.glob("*.example.json"))


def _schema_const(schema: dict) -> str | None:
    """The `schema` const that stamps instance identity (e.g. factorylm.clf.eval-result.v1)."""
    node = schema.get("properties", {}).get("schema", {})
    return node.get("const")


# --- structural layer: always runs, no third-party dependency ----------------


def test_schema_and_example_dirs_are_populated() -> None:
    # Guard against a no-op suite that "passes" only because a glob found nothing.
    assert len(_schema_paths()) == 7, [p.name for p in _schema_paths()]
    assert len(_example_paths()) == 7, [p.name for p in _example_paths()]


@pytest.mark.parametrize("path", _schema_paths(), ids=lambda p: p.name)
def test_schema_is_wellformed_json_with_identity(path: Path) -> None:
    schema = _load(path)
    assert schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema"
    assert isinstance(schema.get("$id"), str) and schema["$id"].startswith("factorylm.clf.")
    # Every CLF schema pins instance identity with a `schema` const.
    const = _schema_const(schema)
    assert const == schema["$id"], f"{path.name}: schema-const {const!r} != $id {schema['$id']!r}"


@pytest.mark.parametrize("path", _schema_paths(), ids=lambda p: p.name)
def test_schema_does_not_redefine_region_geometry(path: Path) -> None:
    """Requirement 1: regions are referenced by region_id, geometry is never inlined."""
    blob = path.read_text(encoding="utf-8")
    schema = json.loads(blob)

    def _walk_property_names(node: object) -> set[str]:
        found: set[str] = set()
        if isinstance(node, dict):
            for key, value in node.items():
                if key == "properties" and isinstance(value, dict):
                    found.update(value.keys())
                found.update(_walk_property_names(value))
        elif isinstance(node, list):
            for item in node:
                found.update(_walk_property_names(item))
        return found

    inlined = _walk_property_names(schema) & _GEOMETRY_PROPERTY_NAMES
    assert not inlined, f"{path.name} inlines region geometry {inlined}; link via region_refs instead"


def test_examples_are_one_to_one_with_schemas() -> None:
    schema_consts = {_schema_const(_load(p)) for p in _schema_paths()}
    example_consts = {_load(p).get("schema") for p in _example_paths()}
    assert None not in example_consts, "an example is missing its `schema` identity field"
    assert schema_consts == example_consts, (
        f"schema/example mismatch: only-in-schemas={schema_consts - example_consts}, "
        f"only-in-examples={example_consts - schema_consts}"
    )


# --- full validation layer: needs the optional `jsonschema` dependency --------


def test_all_schemas_compile_as_draft2020() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    for path in _schema_paths():
        jsonschema.Draft202012Validator.check_schema(_load(path))


def test_every_example_validates_against_its_schema() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    by_const = {_schema_const(_load(p)): _load(p) for p in _schema_paths()}
    for path in _example_paths():
        instance = _load(path)
        schema = by_const.get(instance.get("schema"))
        assert schema is not None, f"{path.name}: no schema for {instance.get('schema')!r}"
        jsonschema.Draft202012Validator(schema).validate(instance)


def test_rights_fail_closed_example_is_not_over_permissive() -> None:
    """The public-eval-only corpus example must not claim training/export rights."""
    example = _load(EXAMPLE_DIR / "corpus-source.example.json")
    rights = example["rights"]
    assert rights["evaluation_allowed"] is True
    assert rights["training_allowed"] is False
    assert rights["public_export_allowed"] is False
    assert rights["cross_tenant_reuse_allowed"] is False


def test_self_consistency_judge_is_not_gold_eligible() -> None:
    """A SELF_CONSISTENCY_ONLY judge can never mark its own answer gold-eligible."""
    example = _load(EXAMPLE_DIR / "judge-independence.example.json")
    assert example["independence_class"] == "SELF_CONSISTENCY_ONLY"
    assert example["gold_eligible"] is False
