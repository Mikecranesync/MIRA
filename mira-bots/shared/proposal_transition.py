"""Proposal-state-machine transitions — Python side (engine / ingest callers).

ADR: docs/adr/0017-proposal-state-machine-mapping.md

This module owns every status write on:
    ai_suggestions.status
    relationship_proposals.status
    kg_relationships.approval_state  (post-approval write)

It does NOT touch kg_entities.approval_state — that is set by
upsert_entity in mira-crawler/ingest/kg_writer.py and does not go
through the proposal cycle.

Public API
----------
propose_relationship(...)  → proposal_id: str | None
    Writes relationship_proposals + relationship_evidence rows.
    Bridges one ai_suggestions(kg_edge, status='pending') row.
    NO kg_relationships write.

review_proposal(...)       → dict | None
    Human decision (approve | reject).  The ONLY code path that
    writes 'verified' or 'rejected' into kg_relationships.

ADR-0017 state-transition table (implemented here)
---------------------------------------------------
| Trigger                  | ai_suggestions | relationship_proposals | kg_relationships |
|--------------------------|----------------|------------------------|------------------|
| New LLM proposal lands   | pending        | proposed               | — (no row)       |
| Admin accepts            | accepted       | verified               | verified (write) |
| Admin rejects            | rejected       | rejected               | — (no row)       |
| Engine re-queues         | pending        | reviewed               | needs_review     |
| Engine finds contradiction| pending (reason)| contradicted          | needs_review     |
| Superseded by newer      | superseded     | deprecated             | unchanged        |

Legal pre-states for review_proposal:
    proposed | reviewed | needs_review  (anything else → ValueError)

Vocab constraints
-----------------
RELATIONSHIP_TYPE_VOCAB is the CHECK constraint in migrations 018/028.
propose_relationship() enforces it in Python so a bad rel_type is caught
before touching Postgres (mocked tests can't see the DB CHECK).
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import contextmanager
from typing import Optional

logger = logging.getLogger("mira-bots.proposal_transition")

# ---------------------------------------------------------------------------
# Controlled vocabulary — mirrors migrations 018 + 028 CHECK constraints.
# ---------------------------------------------------------------------------

RELATIONSHIP_TYPE_VOCAB: frozenset[str] = frozenset(
    {
        # Hierarchy
        "HAS_COMPONENT",
        "INSTANCE_OF",
        "LOCATED_IN",
        "HAS_PART",
        # Documentation
        "HAS_DOCUMENT",
        "HAS_CHUNK",
        "REFERENCES",
        "HAS_PROCEDURE",
        # Wiring & power
        "WIRED_TO",
        "POWERED_BY",
        "MAPS_TO",
        "PUBLISHED_AS",
        # Logic & control (DRIVES + IS_DRIVEN_BY added migration 028)
        "USED_IN_LOGIC",
        "TRIGGERS",
        "CAUSES",
        "DRIVES",
        "IS_DRIVEN_BY",
        # Faults & resolution
        "OCCURS_ON",
        "RESOLVED_BY",
        "HAS_FAILURE_MODE",
        # Signals
        "HAS_SIGNAL",
        "HAS_ALIAS",
        # Topology
        "DEPENDS_ON",
        "UPSTREAM_OF",
        "DOWNSTREAM_OF",
        "REPLACES",
        # Evidence meta
        "CONFIRMED_BY",
        "CONTRADICTED_BY",
    }
)

# Legal pre-states a human reviewer can act on.
_REVIEWABLE_STATES: frozenset[str] = frozenset({"proposed", "reviewed", "needs_review"})

# ---------------------------------------------------------------------------
# DB connection
# ---------------------------------------------------------------------------

_ENGINE = None


def _engine():
    """Lazy SQLAlchemy engine — NullPool per Python standards.

    Importable without NEON_DATABASE_URL (tests mock at the SQL layer).
    """
    global _ENGINE  # noqa: PLW0603
    if _ENGINE is not None:
        return _ENGINE

    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")

    _ENGINE = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return _ENGINE


@contextmanager
def _get_conn(conn=None):
    """Yield a connection — reuse caller's if provided, else own transaction."""
    if conn is not None:
        yield conn
        return
    with _engine().connect() as c:
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


# ---------------------------------------------------------------------------
# propose_relationship
# ---------------------------------------------------------------------------


def propose_relationship(
    source_id: str,
    target_id: str,
    rel_type: str,
    evidence: list[dict],
    tenant_id: str,
    *,
    confidence: float = 0.5,
    reasoning: Optional[str] = None,
    risk_level: str = "low",
    source_chunk_id: Optional[str] = None,
    proposed_by: str = "llm:unknown",
    title: Optional[str] = None,
    body: Optional[str] = None,
    conn=None,
) -> Optional[str]:
    """Write a relationship_proposals row + evidence + ai_suggestions bridge.

    Returns the proposal_id (UUID str) on success, or None on failure.

    Parameters
    ----------
    source_id / target_id : kg_entities.id (UUIDs).
    rel_type              : Must be in RELATIONSHIP_TYPE_VOCAB.
    evidence              : List of evidence dicts; each may contain:
                              evidence_type (required), source_id, source_description,
                              page_or_location, excerpt, confidence_contribution.
                            At least one row is written; an empty list is OK
                            (the proposal lands with no evidence rows — it will
                            be stuck at 'proposed' until evidence is added).
    tenant_id             : NOT NULL in ai_suggestions. If None, ai_suggestions
                            bridge is skipped (relationship_proposals.tenant_id
                            is nullable for catalog-level proposals).
    source_chunk_id       : Stored as an evidence row of type 'knowledge_entry'
                            if provided and not already in the evidence list.
    """
    from sqlalchemy import text

    # --- vocab guard (catches what a mocked DB cannot) ---
    if rel_type not in RELATIONSHIP_TYPE_VOCAB:
        logger.error(
            "propose_relationship rejected unknown rel_type=%r; "
            "must be one of RELATIONSHIP_TYPE_VOCAB",
            rel_type,
        )
        return None

    if str(source_id) == str(target_id):
        logger.debug("propose_relationship skipped self-edge %s", source_id)
        return None

    try:
        with _get_conn(conn) as c:
            # --- look up entity types for the NOT NULL columns ---
            src_type = _entity_type(c, source_id, tenant_id)
            tgt_type = _entity_type(c, target_id, tenant_id)

            # --- de-dup: one proposal per (tenant, source, target, type) ---
            existing = c.execute(
                text(
                    """
                    SELECT id FROM relationship_proposals
                     WHERE source_entity_id = :src
                       AND target_entity_id = :tgt
                       AND relationship_type = :rel
                       AND (tenant_id = :tid OR (tenant_id IS NULL AND :tid IS NULL))
                     LIMIT 1
                    """
                ),
                {"src": str(source_id), "tgt": str(target_id), "rel": rel_type, "tid": tenant_id},
            ).first()

            if existing:
                proposal_id = str(existing[0])
                logger.debug(
                    "propose_relationship: existing proposal %s for %s→%s [%s]",
                    proposal_id,
                    source_id,
                    target_id,
                    rel_type,
                )
                # Still write any new evidence rows against the existing proposal.
                _write_evidence(c, proposal_id, evidence, source_chunk_id)
                return proposal_id

            proposal_id = str(uuid.uuid4())

            c.execute(
                text(
                    """
                    INSERT INTO relationship_proposals
                        (id, tenant_id,
                         source_entity_id, source_entity_type,
                         target_entity_id, target_entity_type,
                         relationship_type, confidence,
                         status, created_by,
                         risk_level, requires_human_review,
                         reasoning)
                    VALUES
                        (:id, :tid,
                         :src, :src_type,
                         :tgt, :tgt_type,
                         :rel, :conf,
                         'proposed', :created_by,
                         :risk, :requires_review,
                         :reasoning)
                    """
                ),
                {
                    "id": proposal_id,
                    "tid": tenant_id,
                    "src": str(source_id),
                    "src_type": src_type,
                    "tgt": str(target_id),
                    "tgt_type": tgt_type,
                    "rel": rel_type,
                    "conf": max(0.0, min(1.0, confidence)),
                    "created_by": "llm" if proposed_by.startswith("llm") else "import",
                    "risk": risk_level,
                    "requires_review": risk_level in ("high", "safety_critical"),
                    "reasoning": reasoning,
                },
            )

            # --- evidence rows ---
            _write_evidence(c, proposal_id, evidence, source_chunk_id)

            # --- ai_suggestions bridge (kg_edge) — only when tenant_id is set ---
            if tenant_id:
                suggestion_id = str(uuid.uuid4())
                payload = {
                    "relationship_proposal_id": proposal_id,
                    "relationship_type": rel_type,
                    "source_entity_id": str(source_id),
                    "target_entity_id": str(target_id),
                }
                c.execute(
                    text(
                        """
                        INSERT INTO ai_suggestions
                            (id, tenant_id, suggestion_type,
                             extracted_data, confidence,
                             status, risk_level,
                             proposed_by, title, body,
                             source_kind)
                        VALUES
                            (:id, :tid, 'kg_edge',
                             cast(:payload AS jsonb), :conf,
                             'pending', :risk,
                             :proposed_by, :title, :body,
                             'knowledge_entry')
                        """
                    ),
                    {
                        "id": suggestion_id,
                        "tid": tenant_id,
                        "payload": json.dumps(payload),
                        "conf": max(0.0, min(1.0, confidence)),
                        "risk": risk_level,
                        "proposed_by": proposed_by,
                        "title": title or f"{rel_type}: {source_id} → {target_id}",
                        "body": body or reasoning,
                    },
                )

        logger.info(
            "propose_relationship: created proposal %s (%s→%s [%s])",
            proposal_id,
            source_id,
            target_id,
            rel_type,
        )
        return proposal_id

    except Exception as exc:
        logger.error(
            "propose_relationship failed %s→%s [%s]: %s",
            source_id,
            target_id,
            rel_type,
            exc,
        )
        return None


# ---------------------------------------------------------------------------
# review_proposal (human action — ONLY path that writes to kg_relationships)
# ---------------------------------------------------------------------------


def review_proposal(
    proposal_id: str,
    decision: str,
    tenant_id: str,
    reviewed_by: str,
    *,
    edits: Optional[dict] = None,
    conn=None,
) -> Optional[dict]:
    """Apply a human verify|reject decision to a relationship proposal.

    On *approve*:
        1. relationship_proposals.status → 'verified'
        2. INSERT/UPDATE kg_relationships with approval_state='verified',
           relationship_proposal_id FK set.
        3. ai_suggestions (kg_edge, payload.relationship_proposal_id) → 'accepted'.

    On *reject*:
        1. relationship_proposals.status → 'rejected'
        2. NO kg_relationships write.
        3. ai_suggestions → 'rejected'.

    Returns a dict {proposal_id, decision, kg_relationship_id or None}
    on success, or None on failure.

    Raises ValueError for illegal pre-state or unknown decision.
    """
    from sqlalchemy import text

    decision = decision.lower()
    if decision not in ("approve", "reject"):
        raise ValueError(f"decision must be 'approve' or 'reject', got {decision!r}")

    try:
        with _get_conn(conn) as c:
            row = c.execute(
                text(
                    """
                    SELECT id, tenant_id,
                           source_entity_id, source_entity_type,
                           target_entity_id, target_entity_type,
                           relationship_type, confidence,
                           status, created_by, reasoning
                      FROM relationship_proposals
                     WHERE id = :pid
                       AND (tenant_id = :tid OR tenant_id IS NULL)
                     FOR UPDATE
                    """
                ),
                {"pid": proposal_id, "tid": tenant_id},
            ).first()

            if not row:
                logger.warning("review_proposal: proposal %s not found", proposal_id)
                return None

            current_status = row[8]  # status column
            if current_status not in _REVIEWABLE_STATES:
                raise ValueError(
                    f"Illegal transition: proposal {proposal_id} is in state "
                    f"'{current_status}'; can only decide proposals in "
                    f"{sorted(_REVIEWABLE_STATES)}"
                )

            new_rel_status = "verified" if decision == "approve" else "rejected"
            review_note = (edits or {}).get("reason", "")

            # 1. Update relationship_proposals
            c.execute(
                text(
                    """
                    UPDATE relationship_proposals
                       SET status = :status,
                           reviewed_at = now(),
                           reviewed_by = :reviewer,
                           reasoning = COALESCE(NULLIF(:note, ''), reasoning)
                     WHERE id = :pid
                    """
                ),
                {
                    "status": new_rel_status,
                    "reviewer": reviewed_by,
                    "note": review_note,
                    "pid": proposal_id,
                },
            )

            kg_rel_id: Optional[str] = None

            if decision == "approve":
                # 2. Insert/update kg_relationships — ONLY path that writes 'verified'
                (
                    _src_id, _src_type, _tgt_id, _tgt_type,
                    _rel_type, _conf, _created_by, _reasoning
                ) = (
                    str(row[2]), row[3], str(row[4]), row[5],
                    row[6], row[7], row[9], row[10],
                )

                existing_rel = c.execute(
                    text(
                        """
                        SELECT id FROM kg_relationships
                         WHERE tenant_id = :tid
                           AND source_id = :src
                           AND target_id = :tgt
                           AND relationship_type = :rel
                        """
                    ),
                    {
                        "tid": tenant_id,
                        "src": _src_id,
                        "tgt": _tgt_id,
                        "rel": _rel_type,
                    },
                ).first()

                if existing_rel:
                    kg_rel_id = str(existing_rel[0])
                    c.execute(
                        text(
                            """
                            UPDATE kg_relationships
                               SET approval_state = 'verified',
                                   confidence = GREATEST(confidence, :conf),
                                   proposed_by = COALESCE(proposed_by, :proposed_by),
                                   evidence_summary = COALESCE(evidence_summary, :ev_summary),
                                   relationship_proposal_id = :prop_id
                             WHERE id = :rid
                            """
                        ),
                        {
                            "conf": _conf,
                            "proposed_by": _created_by,
                            "ev_summary": _reasoning,
                            "prop_id": proposal_id,
                            "rid": kg_rel_id,
                        },
                    )
                else:
                    kg_rel_id = str(uuid.uuid4())
                    c.execute(
                        text(
                            """
                            INSERT INTO kg_relationships
                                (id, tenant_id, source_id, target_id,
                                 relationship_type, confidence,
                                 approval_state, proposed_by, evidence_summary,
                                 relationship_proposal_id)
                            VALUES
                                (:id, :tid, :src, :tgt,
                                 :rel, :conf,
                                 'verified', :proposed_by, :ev_summary,
                                 :prop_id)
                            """
                        ),
                        {
                            "id": kg_rel_id,
                            "tid": tenant_id,
                            "src": _src_id,
                            "tgt": _tgt_id,
                            "rel": _rel_type,
                            "conf": _conf,
                            "proposed_by": _created_by,
                            "ev_summary": _reasoning,
                            "prop_id": proposal_id,
                        },
                    )

            # 3. Sync ai_suggestions bridge row
            _sync_ai_suggestion(c, proposal_id, "accepted" if decision == "approve" else "rejected", reviewed_by, review_note)

        logger.info(
            "review_proposal: %s → %s (kg_rel=%s)",
            proposal_id,
            new_rel_status,
            kg_rel_id,
        )
        return {
            "proposal_id": proposal_id,
            "decision": decision,
            "proposal_status": new_rel_status,
            "kg_relationship_id": kg_rel_id,
        }

    except ValueError:
        raise
    except Exception as exc:
        logger.error("review_proposal failed %s: %s", proposal_id, exc)
        return None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _entity_type(conn, entity_id: str, tenant_id: Optional[str]) -> str:
    """Return kg_entities.entity_type for entity_id, or 'unknown' if absent."""
    from sqlalchemy import text

    try:
        row = conn.execute(
            text(
                """
                SELECT entity_type FROM kg_entities
                 WHERE id = :eid
                   AND (tenant_id = :tid OR :tid IS NULL)
                 LIMIT 1
                """
            ),
            {"eid": str(entity_id), "tid": tenant_id},
        ).first()
        return row[0] if row else "unknown"
    except Exception:
        return "unknown"


def _write_evidence(
    conn,
    proposal_id: str,
    evidence: list[dict],
    source_chunk_id: Optional[str],
) -> None:
    """Write relationship_evidence rows; fail-soft per row."""
    from sqlalchemy import text

    rows = list(evidence)

    # Append a synthetic evidence row for the ingest chunk if provided and
    # not already in the supplied evidence list.
    if source_chunk_id:
        already = any(
            str(r.get("source_id")) == str(source_chunk_id) and r.get("evidence_type") == "knowledge_entry"
            for r in rows
        )
        if not already:
            rows.append(
                {
                    "evidence_type": "knowledge_entry",
                    "source_id": source_chunk_id,
                    "source_description": "ingest chunk",
                    "confidence_contribution": 0.0,
                }
            )

    for ev in rows:
        ev_type = ev.get("evidence_type", "technician_note")
        try:
            conn.execute(
                text(
                    """
                    INSERT INTO relationship_evidence
                        (proposal_id, evidence_type, source_id,
                         source_description, page_or_location,
                         excerpt, confidence_contribution)
                    VALUES
                        (:pid, :etype, cast(:sid AS uuid),
                         :sdesc, :ploc,
                         :excerpt, :cc)
                    """
                ),
                {
                    "pid": proposal_id,
                    "etype": ev_type,
                    "sid": str(ev["source_id"]) if ev.get("source_id") else None,
                    "sdesc": ev.get("source_description"),
                    "ploc": ev.get("page_or_location"),
                    "excerpt": ev.get("excerpt"),
                    "cc": float(ev.get("confidence_contribution", 0.0)),
                },
            )
        except Exception as exc:
            logger.warning("_write_evidence row failed (proposal %s): %s", proposal_id, exc)


def _sync_ai_suggestion(
    conn,
    proposal_id: str,
    new_status: str,
    reviewed_by: str,
    review_note: str,
) -> None:
    """Update the ai_suggestions(kg_edge) row that bridges this proposal.

    Fail-soft — a missing suggestion row is not a hard error (the suggestion
    may have been superseded or the bridge row may not exist for catalog-level
    proposals with no tenant_id).
    """
    from sqlalchemy import text

    try:
        conn.execute(
            text(
                """
                UPDATE ai_suggestions
                   SET status = :status,
                       reviewed_by = :reviewer,
                       reviewed_at = now(),
                       review_note = :note,
                       updated_at = now()
                 WHERE suggestion_type = 'kg_edge'
                   AND extracted_data->>'relationship_proposal_id' = :pid
                   AND status = 'pending'
                """
            ),
            {
                "status": new_status,
                "reviewer": reviewed_by,
                "note": review_note,
                "pid": proposal_id,
            },
        )
    except Exception as exc:
        logger.warning("_sync_ai_suggestion failed for proposal %s: %s", proposal_id, exc)
