"""Tests for the engine-side proposal transition helper (ADR-0017).

Pure-logic + fake-cursor tests — no DB, no network. Covers
docs/adr/0017-proposal-state-machine-mapping.md §Decision (the mapping) and
§Enforcement (the single engine-side writer for kg_*.approval_state).
"""

from __future__ import annotations

import pytest

from shared.proposal_transition import (
    KG_APPROVAL_STATES,
    PROPOSAL_TRANSITIONS,
    apply_kg_approval,
    kg_approval_for,
    relationship_proposal_status_for,
)


# ── Mapping (ADR-0017 §Decision) ─────────────────────────────────────────────


def test_accept_maps_to_verified():
    assert kg_approval_for("accept") == "verified"
    assert relationship_proposal_status_for("accept") == "verified"


def test_reject_maps_to_rejected():
    assert kg_approval_for("reject") == "rejected"
    assert relationship_proposal_status_for("reject") == "rejected"


def test_contradict_sends_verified_edge_back_to_needs_review():
    assert kg_approval_for("contradict") == "needs_review"
    assert relationship_proposal_status_for("contradict") == "contradicted"


def test_defer_leaves_kg_unchanged():
    assert kg_approval_for("defer") is None


def test_every_mapped_kg_state_is_a_legal_reader_value():
    for trig in PROPOSAL_TRANSITIONS:
        v = kg_approval_for(trig)
        assert v is None or v in KG_APPROVAL_STATES


def test_unknown_trigger_raises():
    with pytest.raises(ValueError):
        kg_approval_for("bogus")


# ── apply_kg_approval against a fake cursor ──────────────────────────────────


class FakeCursor:
    def __init__(self):
        self.executed: list[tuple] = []

    def execute(self, sql, params):
        self.executed.append((sql, params))


def test_apply_writes_verified_with_tenant_scope():
    cur = FakeCursor()
    wrote = apply_kg_approval(
        cur, table="kg_relationships", row_id="r1", trigger="accept", tenant_id="t1"
    )
    assert wrote is True
    sql, params = cur.executed[0]
    assert "UPDATE kg_relationships SET approval_state" in sql
    assert "tenant_id = %s" in sql  # never an unscoped write
    assert params == ("verified", "r1", "t1")


def test_apply_noop_on_unchanged_mapping():
    cur = FakeCursor()
    wrote = apply_kg_approval(
        cur, table="kg_entities", row_id="e1", trigger="defer", tenant_id="t1"
    )
    assert wrote is False
    assert cur.executed == []


def test_apply_rejects_unknown_table():
    cur = FakeCursor()
    with pytest.raises(ValueError):
        apply_kg_approval(cur, table="users", row_id="x", trigger="accept", tenant_id="t1")
