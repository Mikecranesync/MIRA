"""Static SQL safety contract for the machine-memory preflight snapshotter."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location(
        "machine_memory_preflight_snapshot_sql",
        ROOT / "tools/qa/machine_memory_preflight_snapshot.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


snapshotter = _load()


def test_every_shipped_query_is_one_tenant_scoped_bounded_select_cte():
    """Would catch adding a write, multi-statement, or unbounded history scan."""
    assert snapshotter.SHIPPED_QUERIES
    for name, query in snapshotter.SHIPPED_QUERIES.items():
        snapshotter.assert_safe_select_query(name, query)
        assert "tenant_id = %s::uuid" in query
        assert "replay_from" not in name or "%s" in query


@pytest.mark.parametrize(
    "query",
    [
        "SELECT 1; DELETE FROM tag_events",
        "WITH changed AS (UPDATE tag_events SET value = 'x' RETURNING *) SELECT * FROM changed",
        "SELECT * FROM tag_events WHERE tenant_id = %s::uuid",
        "SET app.current_tenant_id = %s",
    ],
)
def test_sql_contract_rejects_non_select_writes_session_state_and_unbounded_scans(query):
    """Would catch weakening the SQL parser's read-only safety boundary."""
    with pytest.raises(snapshotter.SqlContractError):
        snapshotter.assert_safe_select_query("mutant", query)
