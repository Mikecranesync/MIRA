"""Phase 4 — the asset-agent gate RESOLVER (`asset_id`/`asset_context` → asset_agent_status row).

The gate decision logic is covered by `test_ignition_chat_gate.py` (which monkeypatches
`_lookup_agent_state` wholesale). THIS file covers the resolver internals the gate was missing:
how an incoming Ignition token actually maps to a stored `asset_agent_status.state`.

No DB: we unit-test the pure slug helper and the `_agent_state_from_conn(conn, ...)` seam with a
fake connection that records the SQL + params and returns a canned row. The live `_lookup_agent_state`
just wraps this seam with engine setup, so testing the seam tests the resolution.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mira-bots"))

import ignition_chat  # noqa: E402


# ── the pure slug (local copy of uns.slug(); mira-pipeline can't import mira-crawler) ──


def test_slug_matches_uns_grammar():
    assert ignition_chat._slug("GS10-VFD") == "gs10_vfd"
    assert ignition_chat._slug("  Conveyor B16 ") == "conveyor_b16"
    assert ignition_chat._slug("[default]Conv/State") == "default_conv_state"
    assert ignition_chat._slug("") == ""
    assert ignition_chat._slug("already_slug") == "already_slug"


# ── the resolver seam ──


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConn:
    """Records the (sql_text, params) of each execute and returns a canned row."""

    def __init__(self, row=None):
        self._row = row
        self.calls: list[tuple[str, dict]] = []

    def execute(self, sql, params):
        self.calls.append((str(sql), params))
        return _FakeResult(self._row)


def test_resolver_passes_raw_token_and_slug_as_params():
    conn = _FakeConn(row=("approved",))
    state = ignition_chat._agent_state_from_conn(conn, "mike", "GS10-VFD")
    assert state == "approved"
    assert len(conn.calls) == 1
    _sql, params = conn.calls[0]
    # both the raw token (for canonical uns_path / UUID / plc_tag exact match) AND its slug
    # (for equipment_number fuzzy match) must be bound.
    assert params["tid"] == "mike"
    assert params["token"] == "GS10-VFD"
    assert params["slug"] == "gs10_vfd"


def test_resolver_query_covers_all_resolution_forms():
    conn = _FakeConn(row=("deployed",))
    ignition_chat._agent_state_from_conn(conn, "mike", "gs10_vfd")
    sql = conn.calls[0][0].lower()
    # joins the bridge tables and matches every supported incoming form
    assert "asset_agent_status" in sql
    assert "cmms_equipment" in sql                      # equipment_number slug match
    assert "installed_component_instances" in sql       # best-effort Ignition tag-path (plc_tag)
    assert "equipment_number" in sql
    assert "plc_tag" in sql
    assert "uns_path" in sql                             # canonical uns_path direct match
    assert ":slug" in sql                                # the slug-normalized comparison


def test_resolver_returns_none_on_miss():
    conn = _FakeConn(row=None)
    assert ignition_chat._agent_state_from_conn(conn, "mike", "nope") is None


@pytest.mark.parametrize("state", ["draft", "approved", "deployed", "rejected"])
def test_resolver_returns_whatever_state_the_row_carries(state):
    conn = _FakeConn(row=(state,))
    assert ignition_chat._agent_state_from_conn(conn, "mike", "tok") == state
