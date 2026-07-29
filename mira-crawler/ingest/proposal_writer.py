"""Create-path proposer — ingest edges land as *proposals*, never verified.

Doctrine (`.claude/CLAUDE.md` § "Knowledge graph proposals", ADR-0017):
MIRA proposes, a human confirms. An ingested relationship must NOT be
written straight into `kg_relationships` as a verified fact. Instead it
lands as:

    relationship_proposals (status='proposed')
        + relationship_evidence (what we cite)
        + ai_suggestions (suggestion_type='kg_edge', status='pending')
          whose extracted_data carries {"relationship_proposal_id": <id>}

The Hub `/proposals` queue renders the `ai_suggestions` header; an admin
verify on `mira-hub/.../proposals/[id]/decide/route.ts` is the ONLY path
that writes the verified `kg_relationships` row (copying
`relationship_proposals.relationship_type` verbatim).

This module is the engine/ingest-side create helper that ADR-0017 calls
for. It lives in `mira-crawler` (not `mira_bots/shared`) because every
create-path caller is in this service/container — a cross-service runtime
import would break container isolation (root CLAUDE.md § Hard Constraints).
The ADR-0017 `mira_bots/shared/proposal_transition.py` engine-side
*transition* helper (status changes on `kg_*.approval_state`) is a
separate concern with no Python caller today; out of scope here.

## Relationship-type vocabulary

`kg_relationships` historically accepted lowercase ad-hoc edge types
(`has_manual`, `has_fault`, …). `relationship_proposals.relationship_type`
is CHECK-constrained to the UPPERCASE canonical vocabulary (migration
018). So every ingest edge type is mapped to its canonical equivalent
before it is proposed. The map is the documented contract — a new ingest
edge type MUST be added here (ADR-0017: "future PRs that introduce a new
type extend the mapping").
"""

from __future__ import annotations

import json
import logging
import os
from uuid import UUID

from sqlalchemy import text

logger = logging.getLogger("mira-crawler.proposal_writer")


# ---------------------------------------------------------------------------
# Ingest write-mode flag (issue #1662 / ADR-0017) — single source of truth.
# ---------------------------------------------------------------------------
# Default everywhere is the PROPOSAL path: ingest never silently verifies an
# edge. The legacy auto-verify path (direct kg_relationships insert at
# confidence 1.0) is available ONLY behind this explicit, deliberate opt-in
# for a one-time bulk migration / debug run. Both ingest paths read it
# (kg_writer.upsert_relationship and tasks/full_ingest_pipeline.py).
AUTOVERIFY_ENV = "MIRA_KG_INGEST_AUTOVERIFY"


def autoverify_enabled() -> bool:
    """True only when the legacy auto-verify path is deliberately enabled."""
    return os.getenv(AUTOVERIFY_ENV, "").strip().lower() in ("1", "true", "yes", "on")


# Lowercase ingest edge type -> UPPERCASE canonical relationship_proposals
# type (direction-preserving). Covers every type produced by the
# mira-crawler ingest paths (kg_writer + full_ingest_pipeline).
_CANONICAL_RELATION_TYPE: dict[str, str] = {
    # equipment -> manual (documentation)
    "has_manual": "HAS_DOCUMENT",
    "documented_in": "HAS_DOCUMENT",
    # equipment -> fault_code (failure mode)
    "has_fault": "HAS_FAILURE_MODE",
    "has_fault_code": "HAS_FAILURE_MODE",
}


def canonical_relation_type(relation_type: str) -> str | None:
    """Map a lowercase ingest edge type to its canonical proposal type.
    Returns None for an unmapped type — the caller must skip rather than
    emit a CHECK-violating or mis-typed proposal."""
    return _CANONICAL_RELATION_TYPE.get((relation_type or "").lower())


def _entity_type(c, entity_id: str | UUID) -> str:
    """Look up an entity's type so the proposal carries the NOT NULL
    source/target entity_type columns. Falls back to 'entity' if the row
    isn't found (entities are upserted before edges, so this is rare)."""
    row = c.execute(
        text(
            "SELECT entity_type FROM kg_entities "
            "WHERE id = cast(:eid AS uuid) LIMIT 1"
        ),
        {"eid": str(entity_id)},
    ).first()
    return row[0] if row and row[0] else "entity"


def propose_relationship(
    c,
    tenant_id: str,
    source_entity: str | UUID,
    target_entity: str | UUID,
    relation_type: str,
    confidence: float = 0.5,
    reasoning: str | None = None,
    proposed_by: str = "import:kg_writer",
    source_chunk_id: str | UUID | None = None,
    source_description: str | None = None,
    evidence_type: str = "oem_kb",
) -> str | None:
    """Propose an ingest-derived edge instead of verifying it.

    Writes `relationship_proposals` (+ `relationship_evidence` when a
    source is known) and a bridging `ai_suggestions(kg_edge)` row.
    Evidence rows are created for both chunk-level sources (source_chunk_id)
    and document-level sources (source_description without a chunk UUID).
    `evidence_type` is the `relationship_evidence.evidence_type` bucket for
    the document-level branch (default `oem_kb`; a conversation-sourced
    caller passes e.g. `technician_note`). Chunk-level sources are always
    `document_page`.
    Idempotent: if an open proposal OR an already-verified edge exists for
    the same (tenant, source, target, canonical_type), no new rows are
    written and the existing proposal id (or None) is returned.

    `c` is a live SQLAlchemy connection owned by the caller's transaction.
    Returns the relationship_proposals id, or None when nothing was
    proposed (self-edge, unmapped type, or already-present edge).
    """
    if not source_entity or not target_entity or not relation_type:
        return None
    if str(source_entity) == str(target_entity):
        logger.debug("propose_relationship skipped self-edge %s", source_entity)
        return None

    canonical = canonical_relation_type(relation_type)
    if canonical is None:
        logger.warning(
            "propose_relationship: no canonical mapping for ingest edge type "
            "%r — edge %s -> %s NOT proposed (add it to _CANONICAL_RELATION_TYPE)",
            relation_type,
            source_entity,
            target_entity,
        )
        return None

    params = {
        "tenant_id": tenant_id,
        "source": str(source_entity),
        "target": str(target_entity),
        "rel": canonical,
    }

    # Ensure the RLS tenant context is set for this transaction so the
    # proposal / evidence / suggestion inserts (and the idempotency reads)
    # land under the row-level-security policies on these tables (mirrors
    # tools/load_manifest_to_kg.py). Harmless when the ingest role bypasses
    # RLS (table owner, tables are ENABLE not FORCE); essential under the
    # factorylm_app role where the policies are enforced.
    if tenant_id:
        c.execute(
            text("SELECT set_config('app.current_tenant_id', :tid, true)"),
            {"tid": str(tenant_id)},
        )

    # Idempotency: skip if an open proposal already covers this edge ...
    existing = c.execute(
        text(
            """
            SELECT id FROM relationship_proposals
             WHERE tenant_id = cast(:tenant_id AS uuid)
               AND source_entity_id = cast(:source AS uuid)
               AND target_entity_id = cast(:target AS uuid)
               AND relationship_type = :rel
               AND status IN ('proposed', 'reviewed', 'verified')
             LIMIT 1
            """
        ),
        params,
    ).first()
    if existing:
        logger.debug(
            "propose_relationship: open proposal already exists for %s -[%s]-> %s",
            source_entity,
            canonical,
            target_entity,
        )
        return str(existing[0])

    # ... or if the edge is already verified in kg_relationships.
    already_verified = c.execute(
        text(
            """
            SELECT 1 FROM kg_relationships
             WHERE tenant_id = cast(:tenant_id AS uuid)
               AND source_id = cast(:source AS uuid)
               AND target_id = cast(:target AS uuid)
               AND relationship_type = :rel
             LIMIT 1
            """
        ),
        params,
    ).first()
    if already_verified:
        logger.debug(
            "propose_relationship: edge already verified, skipping proposal "
            "%s -[%s]-> %s",
            source_entity,
            canonical,
            target_entity,
        )
        return None

    src_type = _entity_type(c, source_entity)
    tgt_type = _entity_type(c, target_entity)

    prop_row = c.execute(
        text(
            """
            INSERT INTO relationship_proposals
                (tenant_id, source_entity_id, source_entity_type,
                 target_entity_id, target_entity_type, relationship_type,
                 confidence, created_by, risk_level,
                 requires_human_review, reasoning)
            VALUES
                (cast(:tenant_id AS uuid), cast(:source AS uuid), :source_type,
                 cast(:target AS uuid), :target_type, :rel,
                 :confidence, :created_by, 'low',
                 true, :reasoning)
            RETURNING id
            """
        ),
        {
            **params,
            "source_type": src_type,
            "target_type": tgt_type,
            "confidence": confidence,
            # relationship_proposals.created_by is CHECK-constrained to
            # ('llm','human','import','rule'); ingest is 'import' (matches
            # tools/load_manifest_to_kg.py). The descriptive actor label
            # lives on ai_suggestions.proposed_by below.
            "created_by": "import",
            "reasoning": reasoning,
        },
    ).first()
    if not prop_row:
        return None
    proposal_id = str(prop_row[0])

    # Evidence: cite the source this edge was extracted from.
    # Chunk-level source (preferred): creates a document_page row with source_id.
    # Document-level fallback: creates an oem_kb row with a text description only
    # (source_id NULL, allowed by the schema) so the UI shows ≥1 evidence rather
    # than "0 evidence" for every document-sourced proposal.
    if source_chunk_id:
        c.execute(
            text(
                """
                INSERT INTO relationship_evidence
                    (proposal_id, evidence_type, source_id,
                     source_description, confidence_contribution)
                VALUES
                    (cast(:proposal_id AS uuid), 'document_page',
                     cast(:source_id AS uuid), :descr, :conf)
                """
            ),
            {
                "proposal_id": proposal_id,
                "source_id": str(source_chunk_id),
                "descr": f"Extracted from manual chunk {source_chunk_id}",
                "conf": confidence,
            },
        )
    elif source_description:
        c.execute(
            text(
                """
                INSERT INTO relationship_evidence
                    (proposal_id, evidence_type,
                     source_description, confidence_contribution)
                VALUES
                    (cast(:proposal_id AS uuid), :evidence_type,
                     :descr, :conf)
                """
            ),
            {
                "proposal_id": proposal_id,
                "evidence_type": evidence_type,
                "descr": source_description,
                "conf": confidence,
            },
        )

    # Bridge an ai_suggestions header so the Hub /proposals queue renders it.
    title, body, extracted_json = _kg_edge_suggestion_fields(
        proposal_id, source_entity, target_entity,
        canonical, relation_type, reasoning, src_type, tgt_type,
    )
    c.execute(
        text(
            """
            INSERT INTO ai_suggestions
                (tenant_id, suggestion_type, source_kind, source_id,
                 extracted_data, confidence, status, risk_level,
                 proposed_by, title, body)
            VALUES
                (cast(:tenant_id AS uuid), 'kg_edge', :source_kind, :source_id,
                 cast(:extracted AS jsonb), :confidence, 'pending', 'low',
                 :proposed_by, :title, :body)
            """
        ),
        {
            "tenant_id": tenant_id,
            "source_kind": "knowledge_entry" if source_chunk_id else None,
            "source_id": str(source_chunk_id) if source_chunk_id else None,
            "extracted": extracted_json,
            "confidence": confidence,
            "proposed_by": proposed_by,
            "title": title,
            "body": body,
        },
    )

    logger.info(
        "proposed edge %s -[%s]-> %s (proposal=%s, from %r)",
        source_entity,
        canonical,
        target_entity,
        proposal_id,
        relation_type,
    )
    return proposal_id


def _kg_edge_suggestion_fields(
    proposal_id: str,
    source_entity: str | UUID,
    target_entity: str | UUID,
    canonical: str,
    relation_type: str,
    reasoning: str | None,
    src_type: str,
    tgt_type: str,
) -> tuple[str, str, str]:
    """Build the (title, body, extracted_data JSON) for the bridging
    ai_suggestions(kg_edge) row. Shared by both the SQLAlchemy and
    psycopg2-cursor proposers so they can't drift."""
    title = f"Propose edge: {src_type} —[{canonical}]→ {tgt_type}"
    body = reasoning or (
        f"Manual ingest proposes a {canonical} relationship "
        f"({src_type} → {tgt_type}). Review and verify or reject."
    )
    extracted = {
        "relationship_proposal_id": proposal_id,
        "source_entity_id": str(source_entity),
        "target_entity_id": str(target_entity),
        "relationship_type": canonical,
        "original_relation_type": relation_type,
    }
    return title, body, json.dumps(extracted)


def _entity_type_cursor(cur, entity_id: str | UUID) -> str:
    """psycopg2-cursor variant of `_entity_type`."""
    cur.execute(
        "SELECT entity_type FROM kg_entities WHERE id = %s::uuid LIMIT 1",
        (str(entity_id),),
    )
    row = cur.fetchone()
    return row[0] if row and row[0] else "entity"


def propose_relationship_cursor(
    cur,
    tenant_id: str,
    source_entity: str | UUID,
    target_entity: str | UUID,
    relation_type: str,
    confidence: float = 0.5,
    reasoning: str | None = None,
    proposed_by: str = "import:full_ingest",
    source_chunk_id: str | UUID | None = None,
    source_description: str | None = None,
    evidence_type: str = "oem_kb",
) -> str | None:
    """psycopg2-cursor variant of `propose_relationship` for callers that run
    inside a raw psycopg2 transaction (`tasks/full_ingest_pipeline.py`).

    Same contract and invariants as `propose_relationship` (including the
    `evidence_type` bucket for the document-level evidence branch), but uses
    `%s` paramstyle and the caller's `cur` — so it reads the entities created
    (uncommitted) earlier in the same transaction. Returns the
    relationship_proposals id, or None when nothing was proposed (self-edge,
    unmapped type, or already-present edge)."""
    if not source_entity or not target_entity or not relation_type:
        return None
    if str(source_entity) == str(target_entity):
        return None

    canonical = canonical_relation_type(relation_type)
    if canonical is None:
        logger.warning(
            "propose_relationship_cursor: no canonical mapping for ingest edge "
            "type %r — edge %s -> %s NOT proposed",
            relation_type, source_entity, target_entity,
        )
        return None

    if tenant_id:
        cur.execute(
            "SELECT set_config('app.current_tenant_id', %s, true)",
            (str(tenant_id),),
        )

    # Idempotency: open proposal already covering this edge?
    cur.execute(
        """
        SELECT id FROM relationship_proposals
         WHERE tenant_id = %s::uuid AND source_entity_id = %s::uuid
           AND target_entity_id = %s::uuid AND relationship_type = %s
           AND status IN ('proposed', 'reviewed', 'verified')
         LIMIT 1
        """,
        (tenant_id, str(source_entity), str(target_entity), canonical),
    )
    row = cur.fetchone()
    if row:
        return str(row[0])

    # ... or the edge is already verified in kg_relationships?
    cur.execute(
        """
        SELECT 1 FROM kg_relationships
         WHERE tenant_id = %s::uuid AND source_id = %s::uuid
           AND target_id = %s::uuid AND relationship_type = %s
         LIMIT 1
        """,
        (tenant_id, str(source_entity), str(target_entity), canonical),
    )
    if cur.fetchone():
        return None

    src_type = _entity_type_cursor(cur, source_entity)
    tgt_type = _entity_type_cursor(cur, target_entity)

    cur.execute(
        """
        INSERT INTO relationship_proposals
            (tenant_id, source_entity_id, source_entity_type,
             target_entity_id, target_entity_type, relationship_type,
             confidence, created_by, risk_level,
             requires_human_review, reasoning)
        VALUES
            (%s::uuid, %s::uuid, %s, %s::uuid, %s, %s,
             %s, 'import', 'low', true, %s)
        RETURNING id
        """,
        (tenant_id, str(source_entity), src_type, str(target_entity),
         tgt_type, canonical, confidence, reasoning),
    )
    prow = cur.fetchone()
    if not prow:
        return None
    proposal_id = str(prow[0])

    if source_chunk_id:
        cur.execute(
            """
            INSERT INTO relationship_evidence
                (proposal_id, evidence_type, source_id,
                 source_description, confidence_contribution)
            VALUES
                (%s::uuid, 'document_page', %s::uuid, %s, %s)
            """,
            (proposal_id, str(source_chunk_id),
             f"Extracted from manual chunk {source_chunk_id}", confidence),
        )
    elif source_description:
        cur.execute(
            """
            INSERT INTO relationship_evidence
                (proposal_id, evidence_type,
                 source_description, confidence_contribution)
            VALUES
                (%s::uuid, %s, %s, %s)
            """,
            (proposal_id, evidence_type, source_description, confidence),
        )

    title, body, extracted_json = _kg_edge_suggestion_fields(
        proposal_id, source_entity, target_entity,
        canonical, relation_type, reasoning, src_type, tgt_type,
    )
    cur.execute(
        """
        INSERT INTO ai_suggestions
            (tenant_id, suggestion_type, source_kind, source_id,
             extracted_data, confidence, status, risk_level,
             proposed_by, title, body)
        VALUES
            (%s::uuid, 'kg_edge', %s, %s, %s::jsonb, %s, 'pending', 'low',
             %s, %s, %s)
        """,
        (
            tenant_id,
            "knowledge_entry" if source_chunk_id else None,
            str(source_chunk_id) if source_chunk_id else None,
            extracted_json,
            confidence,
            proposed_by,
            title,
            body,
        ),
    )

    logger.info(
        "proposed edge (cursor) %s -[%s]-> %s (proposal=%s, from %r)",
        source_entity, canonical, target_entity, proposal_id, relation_type,
    )
    return proposal_id
