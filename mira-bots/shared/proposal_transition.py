"""proposal_transition.py — engine-side writer for KG approval state (ADR-0017).

ADR-0017 ("Proposal state-machine mapping — one logical machine, three table
projections") keeps three enums distinct and centralizes the writes. This module
owns the ENGINE-SIDE projection — ``kg_entities.approval_state`` /
``kg_relationships.approval_state`` (and the engine-triggered transitions on
``relationship_proposals``). The Hub-side projections (``ai_suggestions`` /
``relationship_proposals`` from admin actions) are owned by the TypeScript
counterpart ``mira-hub/lib/proposal-transition.ts``.

Per .claude/CLAUDE.md § "Knowledge graph proposals": once this helper exists, a
direct ``UPDATE … SET approval_state = …`` that bypasses it is a bug.

The mapping table below is the load-bearing artifact (ADR-0017 §Decision). It is
intentionally pure/data-only so it can be imported and unit-tested without a DB.
"""

from __future__ import annotations

from typing import Optional

# Triggers shared with the TS helper (mira-hub/lib/proposal-transition.ts).
TRIGGERS = ("new", "accept", "reject", "defer", "supersede", "contradict", "flag_review")

# Canonical ADR-0017 mapping, ENGINE-SIDE columns only.
#   kg_approval_state          → kg_entities / kg_relationships approval_state
#   relationship_proposal      → engine-triggered relationship_proposals.status
# None means "leave unchanged".
PROPOSAL_TRANSITIONS: dict[str, dict[str, Optional[str]]] = {
    "new": {"kg_approval_state": "proposed", "relationship_proposal": "proposed"},
    "accept": {"kg_approval_state": "verified", "relationship_proposal": "verified"},
    "reject": {"kg_approval_state": "rejected", "relationship_proposal": "rejected"},
    "defer": {"kg_approval_state": None, "relationship_proposal": None},
    "supersede": {"kg_approval_state": None, "relationship_proposal": "deprecated"},
    # Engine job finds contradicting evidence: a verified edge goes back to review.
    "contradict": {"kg_approval_state": "needs_review", "relationship_proposal": "contradicted"},
    # Engine flags an edge for a human re-look.
    "flag_review": {"kg_approval_state": "needs_review", "relationship_proposal": "reviewed"},
}

# Valid target values per column (defense: never emit a value a reader rejects).
KG_APPROVAL_STATES = frozenset({"proposed", "verified", "rejected", "needs_review"})
RELATIONSHIP_PROPOSAL_STATES = frozenset(
    {"proposed", "reviewed", "verified", "rejected", "deprecated", "contradicted"}
)


def kg_approval_for(trigger: str) -> Optional[str]:
    """The kg_*.approval_state value for a trigger (None = unchanged)."""
    if trigger not in PROPOSAL_TRANSITIONS:
        raise ValueError(f"unknown proposal trigger: {trigger!r}")
    return PROPOSAL_TRANSITIONS[trigger]["kg_approval_state"]


def relationship_proposal_status_for(trigger: str) -> Optional[str]:
    """The engine-triggered relationship_proposals.status (None = unchanged)."""
    if trigger not in PROPOSAL_TRANSITIONS:
        raise ValueError(f"unknown proposal trigger: {trigger!r}")
    return PROPOSAL_TRANSITIONS[trigger]["relationship_proposal"]


def apply_kg_approval(cur, *, table: str, row_id: str, trigger: str, tenant_id: str) -> bool:
    """Set ``approval_state`` on a kg_entities / kg_relationships row per the
    ADR-0017 mapping, using the caller's DB cursor (psycopg/SQLAlchemy-style
    ``cur.execute(sql, params)``). Returns True if a write was issued.

    ``table`` must be 'kg_entities' or 'kg_relationships' (validated — the value
    is interpolated into the statement, so it is NOT free-form user input)."""
    if table not in ("kg_entities", "kg_relationships"):
        raise ValueError(f"table must be kg_entities|kg_relationships, got {table!r}")
    target = kg_approval_for(trigger)
    if target is None:
        return False
    if target not in KG_APPROVAL_STATES:  # pragma: no cover - guarded by mapping
        raise ValueError(f"refusing to write unknown approval_state {target!r}")
    cur.execute(
        f"UPDATE {table} SET approval_state = %s WHERE id = %s AND tenant_id = %s",
        (target, row_id, tenant_id),
    )
    return True
