"""Tests for ISA-95 + data_type extensions on knowledge_entries (issue #312)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from db import data_types
from db import neon


# ---------------------------------------------------------------------------
# data_types module
# ---------------------------------------------------------------------------


def test_data_types_validate_accepts_known():
    for value in data_types.ALL:
        assert data_types.validate(value) == value


def test_data_types_validate_rejects_unknown():
    with pytest.raises(ValueError):
        data_types.validate("bogus")


def test_data_types_is_valid():
    assert data_types.is_valid(data_types.MANUAL)
    assert not data_types.is_valid("bogus")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_conn() -> MagicMock:
    """Build a MagicMock mimicking the sqlalchemy connection surface neon.py uses."""
    conn = MagicMock()
    result = MagicMock()
    result.mappings.return_value.fetchall.return_value = []
    conn.execute.return_value = result
    return conn


def _install_engine_mock(engine_patch: MagicMock) -> MagicMock:
    """Wire the _engine() patch target so `with _engine().connect() as conn:` yields our mock."""
    conn = _make_conn()
    engine = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = conn
    cm.__exit__.return_value = False
    engine.connect.return_value = cm
    engine_patch.return_value = engine
    return conn


def _sql_and_params(conn: MagicMock) -> tuple[str, dict]:
    """Extract (sql_text, params_dict) from the last execute() call."""
    args = conn.execute.call_args
    sql_arg = args[0][0]
    sql_text = str(sql_arg) if not isinstance(sql_arg, str) else sql_arg
    params = args[0][1] if len(args[0]) > 1 else {}
    return sql_text, params


# ---------------------------------------------------------------------------
# ensure_knowledge_hierarchy_columns
# ---------------------------------------------------------------------------


@patch.object(neon, "_engine")
def test_ensure_migration_runs_five_statements(engine_patch):
    conn = _install_engine_mock(engine_patch)
    neon.ensure_knowledge_hierarchy_columns()
    assert conn.execute.call_count == 5
    assert conn.commit.call_count == 1


@patch.object(neon, "_engine")
def test_ensure_migration_swallows_errors(engine_patch):
    engine_patch.side_effect = RuntimeError("connection refused")
    # Must not raise — migration failures are non-fatal by design.
    neon.ensure_knowledge_hierarchy_columns()


# ---------------------------------------------------------------------------
# insert_knowledge_entry
# ---------------------------------------------------------------------------


@patch.object(neon, "_engine")
def test_insert_includes_new_columns_in_sql_and_params(engine_patch):
    conn = _install_engine_mock(engine_patch)
    neon.insert_knowledge_entry(
        tenant_id="t1",
        content="c",
        embedding=[0.1, 0.2],
        manufacturer="Pilz",
        model_number="PNOZ X3",
        source_url="s",
        chunk_index=0,
        page_num=1,
        section=None,
        isa95_path="AcmePlant/Line2/Oven1",
        equipment_id="Oven1",
        data_type=data_types.FAULT_EVENT,
    )
    sql_text, params = _sql_and_params(conn)
    assert "isa95_path" in sql_text
    assert "equipment_id" in sql_text
    assert "data_type" in sql_text
    assert params["isa95_path"] == "AcmePlant/Line2/Oven1"
    assert params["equipment_id"] == "Oven1"
    assert params["data_type"] == data_types.FAULT_EVENT


@patch.object(neon, "_engine")
def test_insert_defaults_data_type_to_manual(engine_patch):
    conn = _install_engine_mock(engine_patch)
    neon.insert_knowledge_entry(
        tenant_id="t1",
        content="c",
        embedding=[0.1],
        manufacturer=None,
        model_number=None,
        source_url="s",
        chunk_index=0,
        page_num=None,
        section=None,
    )
    _, params = _sql_and_params(conn)
    assert params["data_type"] == "manual"
    assert params["isa95_path"] is None
    assert params["equipment_id"] is None


@patch.object(neon, "_engine")
def test_insert_rejects_invalid_data_type(engine_patch):
    _install_engine_mock(engine_patch)
    with pytest.raises(ValueError):
        neon.insert_knowledge_entry(
            tenant_id="t1",
            content="c",
            embedding=[0.1],
            manufacturer=None,
            model_number=None,
            source_url="s",
            chunk_index=0,
            page_num=None,
            section=None,
            data_type="bogus",
        )


# ---------------------------------------------------------------------------
# insert_knowledge_entries_batch
# ---------------------------------------------------------------------------


@patch.object(neon, "_engine")
def test_batch_insert_validates_each_data_type(engine_patch):
    _install_engine_mock(engine_patch)
    with pytest.raises(ValueError):
        neon.insert_knowledge_entries_batch(
            [
                {
                    "id": "x",
                    "tenant_id": "t1",
                    "source_type": "manual",
                    "manufacturer": None,
                    "model_number": None,
                    "content": "c",
                    "embedding": "[0.1]",
                    "source_url": "s",
                    "source_page": 0,
                    "metadata": "{}",
                    "chunk_type": "text",
                    "data_type": "bogus",
                }
            ]
        )


@patch.object(neon, "_engine")
def test_batch_insert_defaults_missing_optionals(engine_patch):
    conn = _install_engine_mock(engine_patch)
    count = neon.insert_knowledge_entries_batch(
        [
            {
                "id": "x",
                "tenant_id": "t1",
                "source_type": "manual",
                "manufacturer": None,
                "model_number": None,
                "content": "c",
                "embedding": "[0.1]",
                "source_url": "s",
                "source_page": 0,
                "metadata": "{}",
                "chunk_type": "text",
            }
        ]
    )
    assert count == 1
    _, params = _sql_and_params(conn)
    assert params["data_type"] == "manual"
    assert params["isa95_path"] is None
    assert params["equipment_id"] is None


# ---------------------------------------------------------------------------
# recall_knowledge
# ---------------------------------------------------------------------------


@patch.object(neon, "_engine")
def test_recall_no_filters_uses_base_where(engine_patch):
    conn = _install_engine_mock(engine_patch)
    neon.recall_knowledge([0.1, 0.2], "t1", limit=5)
    sql_text, params = _sql_and_params(conn)
    assert "LIKE" not in sql_text
    assert "ANY" not in sql_text
    assert "prefix" not in params
    assert "dtypes" not in params
    assert params["tid"] == "t1"
    assert params["lim"] == 5


@patch.object(neon, "_engine")
def test_recall_with_isa95_prefix_adds_like_clause(engine_patch):
    conn = _install_engine_mock(engine_patch)
    neon.recall_knowledge(
        [0.1], "t1", isa95_prefix="AcmePlant/Line2/"
    )
    sql_text, params = _sql_and_params(conn)
    assert "isa95_path LIKE" in sql_text
    assert params["prefix"] == "AcmePlant/Line2/"


@patch.object(neon, "_engine")
def test_recall_with_data_types_adds_any_clause(engine_patch):
    conn = _install_engine_mock(engine_patch)
    neon.recall_knowledge(
        [0.1],
        "t1",
        data_types=[data_types.FAULT_EVENT, data_types.TRIBAL_KNOWLEDGE],
    )
    sql_text, params = _sql_and_params(conn)
    assert "data_type = ANY" in sql_text
    assert params["dtypes"] == [
        data_types.FAULT_EVENT,
        data_types.TRIBAL_KNOWLEDGE,
    ]


@patch.object(neon, "_engine")
def test_recall_with_both_filters(engine_patch):
    conn = _install_engine_mock(engine_patch)
    neon.recall_knowledge(
        [0.1],
        "t1",
        isa95_prefix="Plant/",
        data_types=[data_types.TELEMETRY],
    )
    sql_text, params = _sql_and_params(conn)
    assert "isa95_path LIKE" in sql_text
    assert "data_type = ANY" in sql_text
    assert params["prefix"] == "Plant/"
    assert params["dtypes"] == [data_types.TELEMETRY]


@patch.object(neon, "_engine")
def test_recall_select_exposes_new_columns(engine_patch):
    conn = _install_engine_mock(engine_patch)
    neon.recall_knowledge([0.1], "t1")
    sql_text, _ = _sql_and_params(conn)
    assert "isa95_path" in sql_text
    assert "equipment_id" in sql_text
    assert "data_type" in sql_text
