"""Interlock context: recall approved PLC permissive edges and explain a block.

This is the CONSUME side of the interlock flywheel
(`docs/north-star/interlock-flywheel-audit.md`) — the wire that was missing:
MIRA's answer path grounds in `knowledge_entries` only and never reads
`kg_relationships`, so even a human-approved interlock edge was invisible.

Two layers, kept apart so the proof is not tautological:

* `recall_interlocks()` — reads **verified** `kg_relationships` (Hub column
  lineage: `source_id` / `target_id` / `relationship_type` / `approval_state`)
  for an asset's UNS subtree, with the `plc_rung` evidence. This is the
  load-bearing step: empty recall ⇒ no answer.
* `build_interlock_answer()` — a PURE function over the *recalled* edges plus a
  *live tag state*. It never sees the raw parsed program — the causal structure
  comes only from the store, the values come only from live state. If nothing
  was approved, it returns ``None``.

`evaluate_permissive()` is the faithful, deterministic live-state model of the
Conv_Simple run-permissive chain, driven by the independent photoeye input. It
stands in for a live PLC/Ignition read (read-only) in tests and demos.

Designed to be called from `engine._build_kg_context` (P1) — it is NOT a parallel
answer path; it returns a context/evidence structure the engine renders.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

# Relationship types that carry interlock causality (CHECK vocab, migration 018).
_CHAIN_REL = "USED_IN_LOGIC"   # structural dependency operand -> assigned signal
_BLOCK_REL = "CAUSES"          # NOT-ed permissive operand: TRUE inhibits motion


@dataclass(frozen=True)
class RecalledEdge:
    """A verified interlock edge as read back from the store."""

    source: str
    target: str
    relationship_type: str
    confidence: float = 1.0
    evidence_summary: Optional[str] = None
    evidence: list[dict] = field(default_factory=list)  # [{type, location, excerpt}]


# ---------------------------------------------------------------------------
# Live state — faithful deterministic model of the Conv_Simple permissive chain
# (plc/Prog_init_ConvSimple_v2.1.st:208-236). Read-only; no PLC writes.
# ---------------------------------------------------------------------------
def evaluate_permissive(
    *,
    photoeye_blocked: bool,
    e_stop_ok: bool = True,
    do_02: bool = True,
    dir_fwd: bool = True,
    dir_rev: bool = False,
) -> dict[str, bool]:
    """Compute the live conveyor tag state from the independent inputs.

    Mirrors the real Structured Text:
        IF beam_blocked THEN pe_latched := TRUE;
        vfd_run_permit := DO_02 AND e_stop_ok AND NOT pe_latched;
        motor_running  := vfd_run_permit AND (dir_fwd OR dir_rev);
    """
    pe_latched = bool(photoeye_blocked)  # latch on beam block
    vfd_run_permit = bool(do_02) and bool(e_stop_ok) and not pe_latched
    motor_running = vfd_run_permit and (bool(dir_fwd) or bool(dir_rev))
    return {
        "photoeye_blocked": bool(photoeye_blocked),
        "pe_latched": pe_latched,
        "e_stop_ok": bool(e_stop_ok),
        "vfd_run_permit": vfd_run_permit,
        "motor_running": motor_running,
    }


# ---------------------------------------------------------------------------
# Recall — verified interlock edges for an asset (the load-bearing store read)
# ---------------------------------------------------------------------------
_RECALL_SQL = """
SELECT se.name              AS source_name,
       te.name              AS target_name,
       r.relationship_type  AS relationship_type,
       r.confidence         AS confidence,
       r.evidence_summary   AS evidence_summary,
       ev.evidence_type     AS ev_type,
       ev.page_or_location  AS ev_location,
       ev.excerpt           AS ev_excerpt
  FROM kg_relationships r
  JOIN kg_entities se ON se.id = r.source_id
  JOIN kg_entities te ON te.id = r.target_id
  LEFT JOIN relationship_evidence ev
         ON ev.proposal_id = r.relationship_proposal_id
 WHERE r.tenant_id = %(tenant)s
   AND r.approval_state = 'verified'
   AND r.relationship_type IN ('USED_IN_LOGIC', 'CAUSES')
   AND (te.uns_path <@ %(subtree)s::ltree OR se.uns_path <@ %(subtree)s::ltree)
 ORDER BY se.name, te.name
"""


def recall_interlocks(
    cur, tenant_id: str, asset_subtree: str, *, include_unapproved: bool = False
) -> list[RecalledEdge]:
    """Read verified interlock edges under ``asset_subtree`` (a psycopg2 cursor).

    Groups the (edge, evidence) rows into one ``RecalledEdge`` per edge with its
    evidence list. Returns ``[]`` when nothing is verified — callers MUST treat
    an empty result as "no approved context" and refuse to answer.

    ``include_unapproved`` (dev/test only) relaxes the approval filter to also
    surface ``proposed`` edges — this is the ONLY way an unapproved edge reaches
    an answer, and it is off by default. Production must never set it.
    """
    sql = _RECALL_SQL
    if include_unapproved:
        sql = sql.replace("r.approval_state = 'verified'",
                          "r.approval_state IN ('verified', 'proposed')")
    cur.execute(sql, {"tenant": tenant_id, "subtree": asset_subtree})
    by_edge: dict[tuple[str, str, str], RecalledEdge] = {}
    for row in cur.fetchall():
        src, tgt, rel, conf, summary, ev_type, ev_loc, ev_excerpt = row
        key = (src, tgt, rel)
        edge = by_edge.get(key)
        if edge is None:
            edge = RecalledEdge(
                source=src, target=tgt, relationship_type=rel,
                confidence=conf if conf is not None else 1.0,
                evidence_summary=summary, evidence=[],
            )
            by_edge[key] = edge
        if ev_type:
            edge.evidence.append(
                {"type": ev_type, "location": ev_loc, "excerpt": ev_excerpt}
            )
    return list(by_edge.values())


def fetch_interlocks(tenant_id: str, asset_subtree: str) -> list[RecalledEdge]:
    """Connect to Neon and recall verified interlock edges under ``asset_subtree``.

    Thin psycopg2 wrapper over ``recall_interlocks`` for engine enrichment — called
    from ``engine._build_interlock_context`` via ``asyncio.to_thread`` (psycopg2 is
    sync). ``asset_subtree`` is dot-notation ltree (e.g. ``enterprise.site.line1``).
    Never raises → ``[]`` on any miss. Mirrors ``ctx_enrichment.fetch_ctx_approved_signals``.
    """
    db_url = os.getenv("NEON_DATABASE_URL", "")
    if not db_url or not tenant_id or not asset_subtree:
        return []
    try:
        import psycopg2  # noqa: PLC0415 -- lazy so the module imports without a DB driver
    except ImportError:
        return []
    try:
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                return recall_interlocks(cur, tenant_id, asset_subtree)
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 -- enrichment must never block diagnosis
        logging.getLogger("mira-gsd").debug(
            "interlock recall miss tenant=%r subtree=%r: %s", tenant_id, asset_subtree, exc
        )
        return []


# ---------------------------------------------------------------------------
# Answer assembly — PURE over (recalled edges, live state). No store, no parse.
# ---------------------------------------------------------------------------
def build_interlock_answer(
    recalled: list[RecalledEdge],
    live_state: dict[str, Any],
    asset: str,
) -> Optional[dict]:
    """Explain why a machine will not move, grounded ONLY in recalled edges.

    Returns a structured grounded answer, or ``None`` when ``recalled`` is empty
    (no approved context ⇒ no answer). The approval gate lives in
    ``recall_interlocks`` (it returns only verified edges unless explicitly told
    otherwise); this function never reaches the store, so it cannot bypass it.

    The causal STRUCTURE is taken only from ``recalled``; the VALUES only from
    ``live_state``. This is what keeps recall load-bearing.
    """
    if not recalled:
        return None  # no approved context -> no answer (the core guard)

    # Structural chain from the store.
    chain_edges = [e for e in recalled if e.relationship_type == _CHAIN_REL]
    block_edges = [e for e in recalled if e.relationship_type == _BLOCK_REL]

    # The motion signal: a chain target that is currently FALSE in live state and
    # is not itself an operand of a further permissive (the end of the chain).
    targets = {e.target for e in chain_edges}
    sources = {e.source for e in chain_edges}
    motion_candidates = [t for t in targets if t not in sources]
    motion = next(
        (m for m in motion_candidates if live_state.get(m) is False),
        next((t for t in targets if live_state.get(t) is False), None),
    )
    if motion is None:
        return None  # nothing is blocked per live state

    # The permissive feeding motion that is currently FALSE.
    permissive = next(
        (e.source for e in chain_edges
         if e.target == motion and live_state.get(e.source) is False),
        None,
    )

    # The active blocker: a CAUSES edge into the permissive whose blocking signal
    # is currently TRUE (the latched/active inhibiting condition).
    active_blocker = None
    for e in block_edges:
        if (permissive is None or e.target == permissive) and live_state.get(e.source) is True:
            active_blocker = e
            break
    if active_blocker is None and block_edges:
        active_blocker = block_edges[0]  # name the structural blocker even if not yet active

    # Assemble evidence from the edges actually used (chain + blocker).
    used = [e for e in chain_edges if e.target in (motion, permissive) or e.source == permissive]
    if active_blocker is not None:
        used.append(active_blocker)
    evidence: list[dict] = []
    for e in used:
        for ev in e.evidence:
            evidence.append({
                "kind": ev.get("type"),
                "location": ev.get("location"),
                "excerpt": ev.get("excerpt"),
                "edge": f"{e.source} -[{e.relationship_type}]-> {e.target}",
            })
        if not e.evidence and e.evidence_summary:
            evidence.append({"kind": "approved_edge", "edge":
                             f"{e.source} -[{e.relationship_type}]-> {e.target}",
                             "excerpt": e.evidence_summary})

    blocker_name = active_blocker.source if active_blocker else None
    blocker_val = live_state.get(blocker_name) if blocker_name else None

    why_parts = []
    if permissive:
        why_parts.append(f"the run permissive '{permissive}' is FALSE")
    if blocker_name:
        why_parts.append(
            f"because the blocking condition '{blocker_name}' is "
            f"{'TRUE' if blocker_val else 'asserted'}"
        )
    why = " ".join(why_parts) or f"'{motion}' is not enabled"

    next_checks = []
    if blocker_name:
        next_checks = [
            f"Inspect the device/condition that sets '{blocker_name}' "
            "(e.g. a blocked/misaligned photoeye, dirty lens, or damaged cable).",
            f"Confirm '{blocker_name}' clears (and the permissive re-asserts) "
            "before bypassing the drive.",
            "Verify the PLC input wiring for the blocking sensor.",
        ]

    return {
        "asset": asset,
        "blocking_tag": blocker_name,
        "blocking_value": blocker_val,
        "affected_signal": motion,
        "permissive": permissive,
        "why": f"The {asset} is not running: {why}.",
        "live_state": {k: live_state.get(k) for k in
                       filter(None, [motion, permissive, blocker_name])},
        "evidence": evidence,
        "next_checks": next_checks,
        "grounded": bool(evidence),
        "context_approved": True,
    }
