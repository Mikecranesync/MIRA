"""Distil grounded KG relationships from real Q&A turns — flywheel Phase 4b.

The relational half of the distillation flywheel's Phase 4 (Phase 4a is the
golden-case harvester, ``tools/harvest_golden_cases.py``). Where Phase 3
mines the *unmatched* drive-pack turns as coverage gaps, this mines the
*matched fault* turns as **grounded relationship facts**:

    a matched drive-pack FAULT turn  →  "<drive family> HAS_FAILURE_MODE <fault>"

A matched drive-pack answer is grounded-by-construction (``fallback_used=False``,
cited — see ``mira-bots/shared/drive_packs/ask.py``). So a turn where a real
technician asked about fault ``CE10`` and the ``durapulse_gs10`` pack answered it
is evidence that the DURApulse GS10 drive family has that documented failure mode.
That is a legitimate knowledge-graph edge — surfaced from real usage, cited to the
source turn.

**MIRA proposes, a human verifies (the Iron Rule).** Every edge lands as a
``relationship_proposals`` row (``status='proposed'``) + ``relationship_evidence``
(``technician_note``, citing the source turn) + a bridging ``ai_suggestions(kg_edge)``
row for the Hub ``/proposals`` queue — via the existing
``mira-crawler/ingest/proposal_writer.py::propose_relationship_cursor``. The ONLY
path into a verified ``kg_relationships`` row is a human decide on
``/api/proposals/[id]/decide``. Nothing here auto-verifies (ADR-0017,
``.claude/rules`` / ``.claude/skills/managing-the-knowledge-graph``).

**Conservative / no-guess.** An edge is proposed only when BOTH endpoints already
exist as ``kg_entities`` for the tenant (the fault mnemonic and the drive family) —
we resolve-or-**skip**, never fabricate an entity. Deterministic extraction only —
no LLM, no fuzzy free-text parsing. (Extracting ``RESOLVED_BY`` from human
corrections needs a fuzzy step and is a deliberate future extension, not this PR.)
Idempotency + already-verified suppression are handled by ``propose_relationship_cursor``.

Read-mostly: aggregation is pure; the only writes are the gated proposal rows, and
``--dry-run`` prints without writing. It never touches ``conversation_eval`` or the
live packs.

Usage::

    NEON_DATABASE_URL=… python tools/relational_distill.py \
        --tenant-id <uuid> [--limit 5000] [--dry-run]

Design mirrors ``tools/drive-pack-extract/gap_suggestion.py``: a pure, injectable
core (unit-tested with seeded rows) + a thin psycopg2 ``main()``.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

# The stage cores + writer live in sibling trees; add them to the path (this is a
# standalone tool, like flywheel_benchmark.py — cross-imports are intentional).
_HERE = Path(__file__).resolve().parent  # tools/
_REPO = _HERE.parent
for _p in (
    str(_HERE / "drive-pack-extract"),  # gap_report, gap_suggestion
    str(_REPO / "mira-crawler"),  # ingest.proposal_writer
):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import gap_report  # noqa: E402  (extract_tokens, _DOTTED_PARAM_RE, capture_schema_ready)
import gap_suggestion  # noqa: E402  (load_pack_manual_index, registry helpers)

# The canonical ingest edge type for a drive→fault link. proposal_writer maps
# ``has_fault`` → the UPPERCASE ``HAS_FAILURE_MODE`` proposal type (mig 018 CHECK).
_RELATION_TYPE = "has_fault"
# relationship_evidence.evidence_type bucket for a conversation-sourced edge
# (mig 018 CHECK includes 'technician_note').
_EVIDENCE_TYPE = "technician_note"
_PROPOSED_BY = "import:relational_distill"
# A review item distilled from usage, not a graded claim — matches the drive-pack
# gap suggestion's review confidence. Determinism sets provenance, not verification.
_CONFIDENCE = 0.5


# ---------------------------------------------------------------------------
# Pure core — no DB, no filesystem side effects (unit-tested)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RelationAssertion:
    """A grounded relationship distilled from one captured turn.

    ``source_name`` / ``target_name`` are the entity NAMES to resolve against
    ``kg_entities`` at write time (resolve-or-skip). ``evidence`` is the
    human-readable citation of the source turn.
    """

    pack_id: str
    source_name: str  # drive family, e.g. "DURApulse GS10"
    target_name: str  # fault mnemonic, e.g. "CE10"
    relation_type: str  # "has_fault" → HAS_FAILURE_MODE
    evidence: str
    source_turn_id: str
    reasoning: str = field(default="")

    def key(self) -> tuple[str, str, str, str]:
        """Dedup identity: same (pack, source, fault, type) collapses to one."""
        return (
            self.pack_id,
            self.source_name.lower(),
            self.target_name.upper(),
            self.relation_type,
        )


def _is_matched_fault_turn(meta: dict[str, Any] | None) -> bool:
    """A drive-pack turn whose fault question the pack ANSWERED (grounded)."""
    if not isinstance(meta, dict):
        return False
    return (
        meta.get("surface") == "drive_pack"
        and meta.get("matched") is True
        and meta.get("matched_kind") == "fault"
    )


def fault_token(question: str, *, exclude: tuple[str, ...] = ()) -> Optional[str]:
    """The fault mnemonic in a matched fault question, e.g. ``"CE10"``.

    Conservative: drops dotted parameter ids (``P01.24`` — those are parameters,
    not faults) and any token that is a case-insensitive substring of an
    ``exclude`` string (the pack id / drive family — so ``"GS10"`` in
    ``"what does CE10 mean on the GS10?"`` is not mistaken for the fault). Returns
    the first surviving token, or ``None`` when nothing fault-shaped remains
    (then no edge is asserted — no-guess).
    """
    ex = [e.lower() for e in exclude if e]
    for tok in gap_report.extract_tokens(question):
        if gap_report._DOTTED_PARAM_RE.match(tok):
            continue  # a parameter id (P01.24), not a fault
        low = tok.lower()
        if any(low in e for e in ex):
            continue  # the model/family token (GS10), not the fault
        return tok
    return None


def _family_name(pack_id: str, pack_index: dict[str, dict[str, str]]) -> str:
    """The drive-family display name to resolve as the source entity.

    Prefers the registry ``product_family`` (a curated exact string, e.g.
    ``"DURApulse GS10"``); falls back to the raw ``pack_id``. Exact-name
    resolution only — never fuzzy.
    """
    ident = pack_index.get(pack_id)
    if ident and ident.get("product_family"):
        return ident["product_family"]
    return pack_id


def extract_relation_assertions(
    rows: list[dict[str, Any]], pack_index: dict[str, dict[str, str]]
) -> list[RelationAssertion]:
    """Captured turns → deduped grounded ``RelationAssertion`` list (pure, no I/O).

    Only matched drive-pack FAULT turns with an extractable fault mnemonic yield
    an assertion. Unmatched turns (gaps), parameter turns, and engine turns yield
    nothing. Deduped by ``RelationAssertion.key`` so the same drive→fault edge
    asserted across many turns is proposed once (the writer is idempotent too).
    """
    seen: set[tuple[str, str, str, str]] = set()
    out: list[RelationAssertion] = []
    for row in rows:
        meta = row.get("meta")
        if not _is_matched_fault_turn(meta):
            continue
        pack_id = str(meta.get("pack_id") or "").strip()
        if not pack_id:
            continue
        source_name = _family_name(pack_id, pack_index)
        question = row.get("user_message") or ""
        fault = fault_token(question, exclude=(pack_id, source_name))
        if not fault:
            continue

        turn_id = str(row.get("id") or "")
        reasoning = (
            f"A technician asked about fault {fault} and the {source_name} drive "
            f"pack answered it (cited). Proposes {source_name} HAS_FAILURE_MODE {fault}."
        )
        assertion = RelationAssertion(
            pack_id=pack_id,
            source_name=source_name,
            target_name=fault,
            relation_type=_RELATION_TYPE,
            evidence=(
                f"Distilled from technician question (conversation_eval {turn_id}): "
                f'"{question.strip()}" — answered by the {source_name} drive pack.'
            ),
            source_turn_id=turn_id,
            reasoning=reasoning,
        )
        if assertion.key() in seen:
            continue
        seen.add(assertion.key())
        out.append(assertion)
    return out


# ---------------------------------------------------------------------------
# DB glue — read matched fault turns, resolve entities, write gated proposals
# ---------------------------------------------------------------------------

_SELECT_SQL = """
    SELECT id, meta->>'pack_id' AS pack_id, user_message
      FROM conversation_eval
     WHERE meta->>'surface' = 'drive_pack'
       AND (meta->>'matched')::boolean = true
       AND meta->>'matched_kind' = 'fault'
       AND (%(tenant)s IS NULL OR meta->>'tenant_id' = %(tenant)s)
     ORDER BY created_at DESC
     LIMIT %(limit)s
"""

# Resolve an entity by exact (case-insensitive) name within the tenant. kg_entities'
# UNIQUE key is (tenant_id, entity_type, name) — we match on name only, taking the
# first row, since a fault/drive name is unambiguous within a tenant in practice.
_RESOLVE_SQL = """
    SELECT id FROM kg_entities
     WHERE tenant_id = %s::uuid AND lower(name) = lower(%s)
     LIMIT 1
"""


def _resolve_entity(cur, tenant_id: str, name: str) -> Optional[str]:
    """kg_entities id for ``name`` under ``tenant_id``, or None (→ skip, no fabricate)."""
    cur.execute(_RESOLVE_SQL, (tenant_id, name))
    row = cur.fetchone()
    return str(row[0]) if row else None


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - DB glue
    parser = argparse.ArgumentParser(description="Relational distillation (gated proposals).")
    parser.add_argument(
        "--tenant-id",
        default=os.getenv("MIRA_TENANT_ID"),
        help="tenant that owns the turns + proposals (defaults to MIRA_TENANT_ID)",
    )
    parser.add_argument(
        "--limit", type=int, default=5000, help="max conversation_eval rows to scan"
    )
    parser.add_argument(
        "--registry",
        default=str(gap_suggestion._DEFAULT_REGISTRY),
        help="path to the manual source registry JSON (for drive-family names)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="print what would be proposed; write nothing"
    )
    parser.add_argument("--database-url", default=None, help="override NEON_DATABASE_URL")
    args = parser.parse_args(argv)

    if not args.tenant_id:
        print("ERROR: set --tenant-id or MIRA_TENANT_ID", file=sys.stderr)
        return 2

    db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        print(
            "ERROR: set NEON_DATABASE_URL or DATABASE_URL (or pass --database-url)", file=sys.stderr
        )
        return 2

    gap_report._utf8_stdout()
    pack_index = gap_suggestion.load_pack_manual_index(
        gap_suggestion._load_registry(Path(args.registry))
    )

    import psycopg2  # local import: only main() needs the driver
    from ingest.proposal_writer import propose_relationship_cursor  # noqa: E402

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            if not gap_report.capture_schema_ready(cur):
                print(f"ERROR: {gap_report.META_MISSING_MSG}", file=sys.stderr)
                return 3
            cur.execute(_SELECT_SQL, {"tenant": args.tenant_id, "limit": args.limit})
            rows = [
                {
                    "id": r[0],
                    "meta": {
                        "surface": "drive_pack",
                        "matched": True,
                        "matched_kind": "fault",
                        "pack_id": r[1],
                    },
                    "user_message": r[2],
                }
                for r in cur.fetchall()
            ]

        assertions = extract_relation_assertions(rows, pack_index)

        proposed, skipped_unresolved, skipped_existing = 0, 0, 0
        for a in assertions:
            if args.dry_run:
                print(
                    f"[dry-run] would propose: {a.source_name} —[HAS_FAILURE_MODE]→ {a.target_name} (from turn {a.source_turn_id})"
                )
                continue
            with conn.cursor() as cur:
                # RLS: scope reads+writes to this tenant (mirrors proposal_writer.py).
                cur.execute(
                    "SELECT set_config('app.current_tenant_id', %s, true)", (args.tenant_id,)
                )
                src = _resolve_entity(cur, args.tenant_id, a.source_name)
                tgt = _resolve_entity(cur, args.tenant_id, a.target_name)
                if not src or not tgt:
                    skipped_unresolved += 1
                    continue
                pid = propose_relationship_cursor(
                    cur,
                    tenant_id=args.tenant_id,
                    source_entity=src,
                    target_entity=tgt,
                    relation_type=a.relation_type,
                    confidence=_CONFIDENCE,
                    reasoning=a.reasoning,
                    proposed_by=_PROPOSED_BY,
                    source_description=a.evidence,
                    evidence_type=_EVIDENCE_TYPE,
                )
                if pid is None:
                    skipped_existing += 1
                else:
                    proposed += 1
            conn.commit()
    finally:
        conn.close()

    if args.dry_run:
        print(f"[dry-run] {len(assertions)} grounded edge(s) extracted from matched fault turns.")
    else:
        print(
            f"Proposed {proposed} new HAS_FAILURE_MODE edge(s); "
            f"skipped {skipped_unresolved} unresolved (entity absent), "
            f"{skipped_existing} already-open/verified."
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
