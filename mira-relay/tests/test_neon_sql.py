"""Regression guards for neon.py SQL binding bugs caught by the staging
integration test (2026-06-02).

The unit tests for diff_logger mock the DB, so they never exercised the real
SQLAlchemy text() binding. Two bugs slipped through and broke every insert:
  1. `:uns_path::ltree` — SQLAlchemy can't bind a param immediately followed by
     a `::` cast; the param was left unbound -> Postgres syntax error.
  2. prev_value/new_value (JSONB columns) received raw Python floats/bools,
     which psycopg2 cannot adapt to jsonb.

These tests assert the fixed forms without needing a live DB.
"""
from __future__ import annotations

import importlib.util
import pathlib

_RELAY = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("neon", _RELAY / "neon.py")
neon = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(neon)  # type: ignore[union-attr]


def test_insert_sql_uses_cast_not_double_colon():
    sql = neon.insert_sql
    assert "CAST(:uns_path AS ltree)" in sql
    assert ":uns_path::ltree" not in sql, "regression: '::ltree' breaks SQLAlchemy bind"


def test_insert_sql_casts_jsonb_columns():
    sql = neon.insert_sql
    assert "CAST(:prev_value AS jsonb)" in sql
    assert "CAST(:new_value AS jsonb)" in sql


def test_normalise_row_json_serialises_values():
    row = neon._normalise_row({
        "tenant_id": "11111111-1111-1111-1111-111111111111",
        "uns_path": "enterprise.site.area.line.machine.tag",
        "tag_id": "EQ.tag",
        "event_type": "value_changed",
        "prev_value": 12.5,
        "new_value": 13.0,
    })
    # JSONB columns must be JSON text, not raw floats.
    assert row["prev_value"] == "12.5"
    assert row["new_value"] == "13.0"


def test_normalise_row_json_serialises_none_and_bool():
    row = neon._normalise_row({
        "tenant_id": "11111111-1111-1111-1111-111111111111",
        "uns_path": "enterprise.site.area.line.machine.pe101",
        "tag_id": "EQ.pe101",
        "event_type": "rising_edge",
        "prev_value": False,
        "new_value": True,
    })
    assert row["prev_value"] == "false"
    assert row["new_value"] == "true"
