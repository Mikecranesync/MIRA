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


def test_sql_contract_rejects_decoy_predicates_and_union_branches():
    """Would catch a tenant/bounds-looking CTE with an unscoped second branch."""
    bypass = snapshotter.SHIPPED_QUERIES["replay"] + " UNION SELECT '{}'::json"
    with pytest.raises(snapshotter.SqlContractError):
        snapshotter.assert_safe_select_query("replay", bypass)


def test_sql_contract_rejects_a_mutated_shipped_registry_entry_with_unscoped_union(monkeypatch):
    """Would catch validating a mutable query registry against itself."""
    decoy_union = snapshotter.SHIPPED_QUERIES["replay"] + (
        " UNION SELECT json_build_object('fault_window_row_count', "
        "(SELECT count(*) FROM tag_events))"
    )
    monkeypatch.setitem(snapshotter.SHIPPED_QUERIES, "replay", decoy_union)

    with pytest.raises(snapshotter.SqlContractError):
        snapshotter.assert_safe_select_query("replay", snapshotter.SHIPPED_QUERIES["replay"])


def test_replay_query_requires_an_actual_fault_trigger_before_counting_evidence():
    """Would catch treating normal physical Ignition telemetry as a fault window."""
    replay = snapshotter.SHIPPED_QUERIES["replay"]
    assert "default_conveyor_fault_alarm" in replay
    assert "fault_trigger" in replay
    assert "lower(trim(coalesce(value, '')))" in replay
    trigger = replay.split("fault_trigger AS (", 1)[1].split("), scoped_events", 1)[0]
    for predicate in (
        "source_system = 'ignition'",
        "source_connection_id = 'cv101-bench-gw'",
        "simulated = false",
        "quality = 'good'",
    ):
        assert predicate in trigger


def test_replay_query_keeps_the_served_bounds_even_when_the_fault_trigger_is_later():
    """Would catch silently dropping pre-trigger evidence from the exact replay window."""
    replay = snapshotter.SHIPPED_QUERIES["replay"]
    scoped = replay.split("scoped_events AS (", 1)[1].split(")\nSELECT", 1)[0]
    assert "event_timestamp >= replay_from" in scoped
    assert "event_timestamp >= trigger_at" not in scoped
