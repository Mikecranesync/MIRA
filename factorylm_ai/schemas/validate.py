"""Minimal JSON-Schema-subset validator for factorylm_ai's flywheel records.

ZTA role: every JSONL record the model lab writes (model runs, interaction
records, feedback events, training records, eval cases, promotion decisions,
ZTA artifacts, and the per-task ``task_outputs/*`` model responses) is
validated against a checked-in ``<name>.schema.json`` file before it is
trusted or persisted. This module is the ONLY schema-shape gate in the
package — deliberately NOT the ``jsonschema`` package (repo law: no new
dependencies), just a small, explicit subset of JSON Schema draft-07 that
every schema file under ``factorylm_ai/schemas/`` is written to use.

Supported keywords: ``type`` (including ``["x", "null"]`` unions),
``properties``, ``required``, ``enum``, ``items``, ``minItems``,
``additionalProperties`` (bool only), ``minimum``/``maximum``, ``minLength``,
and best-effort ``pattern`` (via :mod:`re`) — plus ordinary nesting of
objects and arrays. Anything else in a schema file is inert (ignored), not
enforced — keep schema files within this subset if you need it checked.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger("factorylm-ai")

_SCHEMAS_DIR = Path(__file__).resolve().parent
_SCHEMA_CACHE: dict[str, dict[str, Any]] = {}

_TYPE_NAMES = ("object", "array", "string", "number", "integer", "boolean", "null")


class SchemaError(Exception):
    """Raised by validate_or_raise() on an invalid instance, or by
    load_schema() when ``name`` is malformed or the schema file is missing.
    """


def load_schema(name: str) -> dict:
    """Load and cache ``factorylm_ai/schemas/<name>.schema.json``.

    ``name`` may include a subpath, e.g. ``"task_outputs/m01_output"``.
    Results are cached in-process by ``name``. Raises SchemaError if
    ``name`` is empty, escapes the schemas directory, or the file does not
    exist / does not contain a JSON object.
    """
    if name in _SCHEMA_CACHE:
        return _SCHEMA_CACHE[name]
    parts = name.split("/") if name else []
    if not name or "\\" in name or any(p in ("", ".", "..") for p in parts):
        raise SchemaError(f"invalid schema name: {name!r}")
    path = _SCHEMAS_DIR.joinpath(*parts[:-1], f"{parts[-1]}.schema.json")
    if not path.is_file():
        raise SchemaError(f"schema not found: {name!r} (looked for {path})")
    with path.open("r", encoding="utf-8") as f:
        schema = json.load(f)
    if not isinstance(schema, dict):
        raise SchemaError(f"schema {name!r} does not contain a JSON object")
    _SCHEMA_CACHE[name] = schema
    return schema


def validate(instance: object, schema: dict) -> list[str]:
    """Validate ``instance`` against ``schema``.

    Returns an empty list when valid, else a list of ``"path: problem"``
    strings — one per violation found (validation does not stop at the
    first error, except that a type mismatch on a node suppresses the
    deeper checks for that same node, since they would just be noise).
    """
    errors: list[str] = []
    _validate_node(instance, schema, "$", errors)
    return errors


def validate_or_raise(instance: object, schema: dict) -> None:
    """Like validate(), but raises SchemaError (joining all problems) on failure."""
    errors = validate(instance, schema)
    if errors:
        raise SchemaError("; ".join(errors))


def _validate_node(instance: Any, schema: dict[str, Any], path: str, errors: list[str]) -> None:
    if not isinstance(schema, dict):
        errors.append(f"{path}: schema fragment is not an object")
        return
    if not schema:
        return  # empty schema {} always validates (JSON Schema semantics)

    schema_type = schema.get("type")
    if schema_type is not None:
        types = schema_type if isinstance(schema_type, list) else [schema_type]
        if not _matches_any_type(instance, types):
            errors.append(f"{path}: expected type {types}, got {_type_name(instance)}")
            return  # further checks on a type-mismatched node would be noise

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: value {instance!r} not in enum {schema['enum']!r}")

    if isinstance(instance, str):
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append(f"{path}: length {len(instance)} < minLength {schema['minLength']}")
        if "pattern" in schema:
            try:
                matched = re.search(schema["pattern"], instance) is not None
            except re.error as exc:
                errors.append(f"{path}: invalid pattern {schema['pattern']!r} ({exc})")
            else:
                if not matched:
                    errors.append(
                        f"{path}: value {instance!r} does not match pattern {schema['pattern']!r}"
                    )

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            errors.append(f"{path}: value {instance} < minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            errors.append(f"{path}: value {instance} > maximum {schema['maximum']}")

    if isinstance(instance, dict):
        properties = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in instance:
                errors.append(f"{path}.{req}: required property missing")
        additional = schema.get("additionalProperties", True)
        for key, value in instance.items():
            if key in properties:
                _validate_node(value, properties[key], f"{path}.{key}", errors)
            elif additional is False:
                errors.append(f"{path}.{key}: additional property not allowed")

    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(f"{path}: {len(instance)} items < minItems {schema['minItems']}")
        item_schema = schema.get("items")
        if item_schema is not None:
            for i, item in enumerate(instance):
                _validate_node(item, item_schema, f"{path}[{i}]", errors)


def _matches_any_type(instance: Any, types: list[Any]) -> bool:
    for t in types:
        if t not in _TYPE_NAMES:
            continue  # unsupported/unknown type keyword — not our job to enforce
        if t == "null":
            if instance is None:
                return True
            continue
        if t == "boolean":
            if isinstance(instance, bool):
                return True
            continue
        if t in ("number", "integer") and isinstance(instance, bool):
            continue  # bool is not numeric in JSON Schema semantics
        if t == "object" and isinstance(instance, dict):
            return True
        if t == "array" and isinstance(instance, list):
            return True
        if t == "string" and isinstance(instance, str):
            return True
        if t == "number" and isinstance(instance, (int, float)):
            return True
        if t == "integer" and isinstance(instance, int):
            return True
    return False


def _type_name(instance: Any) -> str:
    if instance is None:
        return "null"
    if isinstance(instance, bool):
        return "boolean"
    if isinstance(instance, int):
        return "integer"
    if isinstance(instance, float):
        return "number"
    if isinstance(instance, str):
        return "string"
    if isinstance(instance, list):
        return "array"
    if isinstance(instance, dict):
        return "object"
    return type(instance).__name__
