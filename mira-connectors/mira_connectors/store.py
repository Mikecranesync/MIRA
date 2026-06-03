"""Persistence layer for the connector confirmation gate.

The gate writes to MIRA's **existing** tables — no new tables (ADR-0014, ADR-0017):

- ``ai_suggestions``         — the Hub ``/proposals`` work queue (one row per pending decision)
- ``relationship_proposals`` + ``relationship_evidence`` — edge proposals + evidence (Hub 018)
- ``kg_relationships``       — the verified graph (written on confirm, mirroring the Hub
                               ``/api/proposals/[id]/decide`` route)
- ``kg_entities``            — verified entities (written on confirm of a kg_entity suggestion)

Two implementations:

- ``InMemoryProposalStore`` — deterministic, dependency-free; backs the gate tests and
  any offline/dev run ("offline mode is the floor", `.claude/rules/uns-compliance.md` §8).
- ``PostgresProposalStore`` — SQLAlchemy + ``NullPool`` + ``sslmode=require``, mirroring
  ``mira-bots/shared/neon_recall.py``. Sets the RLS tenant GUC per transaction the way the
  Hub ``withTenantContext`` does. **Its SQL is schema-verified against the live migrations**
  (ai_suggestions mig 027, relationship_proposals/evidence mig 018, kg_entities mig
  001/010/024/025/029, kg_relationships per the Hub decide route) **but is NOT executed by
  the offline test suite** — the tests run entirely on ``InMemoryProposalStore``. Exercise it
  against a staging NeonDB before relying on it in production (master-plan migration gate).

Status transitions follow ADR-0017 exactly. When the ADR-0017 helpers
(``mira_bots/shared/proposal_transition.py`` / ``mira-hub/lib/proposal-transition.ts``)
land, ``PostgresProposalStore`` should delegate its status writes to them. Until then the
transition logic is connector-local (see ``confirmation_gate.py``).
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Optional, Protocol


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Row shapes (mirror the live table columns) ──────────────────────────────


@dataclass
class SuggestionRow:
    """A row in ``ai_suggestions`` (Hub mig 027)."""

    tenant_id: str
    suggestion_type: str  # kg_edge|kg_entity|tag_mapping|component_profile|uns_confirmation|namespace_move
    extracted_data: dict[str, Any]
    proposed_by: str = "import:unknown"
    confidence: float = 0.5
    status: str = "pending"  # pending|accepted|rejected|deferred|superseded
    risk_level: str = "low"
    source_kind: Optional[str] = None
    source_id: Optional[str] = None
    source_document_id: Optional[str] = None
    source_page: Optional[int] = None
    title: Optional[str] = None
    body: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    review_note: Optional[str] = None
    id: str = field(default_factory=_uuid)
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)


@dataclass
class ProposalRow:
    """A row in ``relationship_proposals`` (Hub mig 018)."""

    tenant_id: Optional[str]
    source_entity_id: str
    source_entity_type: str
    target_entity_id: str
    target_entity_type: str
    relationship_type: str
    confidence: float = 0.5
    status: str = "proposed"  # proposed|reviewed|verified|rejected|deprecated|contradicted
    created_by: str = "import"  # llm|human|import|rule
    risk_level: str = "low"
    requires_human_review: bool = True
    reasoning: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    id: str = field(default_factory=_uuid)
    created_at: str = field(default_factory=_now)


@dataclass
class EvidenceRow:
    """A row in ``relationship_evidence`` (Hub mig 018)."""

    proposal_id: str
    evidence_type: str
    source_description: str
    page_or_location: Optional[str] = None
    excerpt: Optional[str] = None
    confidence_contribution: float = 0.0
    source_id: Optional[str] = None
    id: str = field(default_factory=_uuid)


@dataclass
class KgEntityRow:
    tenant_id: str
    uns_path: Optional[str]
    entity_type: str
    name: str
    properties: dict[str, Any] = field(default_factory=dict)
    approval_state: str = "verified"
    proposed_by: str = "import"
    id: str = field(default_factory=_uuid)


@dataclass
class KgRelationshipRow:
    tenant_id: str
    source_id: str
    target_id: str
    relationship_type: str
    confidence: float
    approval_state: str = "verified"
    proposed_by: str = "import"
    evidence_summary: Optional[str] = None
    id: str = field(default_factory=_uuid)


# ── Store protocol ──────────────────────────────────────────────────────────


class ProposalStore(Protocol):
    """Everything the gate needs to persist. All ops are tenant-scoped."""

    def insert_suggestion(self, row: SuggestionRow) -> str: ...
    def get_suggestion(self, tenant_id: str, suggestion_id: str) -> Optional[SuggestionRow]: ...
    def update_suggestion(self, suggestion_id: str, **fields: Any) -> None: ...
    def list_suggestions(
        self, tenant_id: str, *, status: Optional[str] = None, suggestion_type: Optional[str] = None
    ) -> list[SuggestionRow]: ...

    def insert_proposal(self, row: ProposalRow) -> str: ...
    def get_proposal(self, proposal_id: str) -> Optional[ProposalRow]: ...
    def update_proposal(self, proposal_id: str, **fields: Any) -> None: ...
    def insert_evidence(self, row: EvidenceRow) -> str: ...

    # entity resolution + writes
    def resolve_entity(self, tenant_id: str, ref: str, ref_kind: str) -> Optional[str]: ...
    def create_entity(self, row: KgEntityRow) -> str: ...
    def upsert_relationship(self, row: KgRelationshipRow) -> str: ...


# ── In-memory implementation (tests + offline) ──────────────────────────────


class InMemoryProposalStore:
    """Deterministic in-memory store. No DB, no network."""

    def __init__(self) -> None:
        self.suggestions: dict[str, SuggestionRow] = {}
        self.proposals: dict[str, ProposalRow] = {}
        self.evidence: dict[str, EvidenceRow] = {}
        self.entities: dict[str, KgEntityRow] = {}
        self.relationships: dict[str, KgRelationshipRow] = {}
        # natural-key index for resolve_entity: (tenant, kind, ref) -> entity_id
        self._entity_index: dict[tuple[str, str, str], str] = {}

    # suggestions
    def insert_suggestion(self, row: SuggestionRow) -> str:
        self.suggestions[row.id] = row
        return row.id

    def get_suggestion(self, tenant_id: str, suggestion_id: str) -> Optional[SuggestionRow]:
        row = self.suggestions.get(suggestion_id)
        return row if row and row.tenant_id == tenant_id else None

    def update_suggestion(self, suggestion_id: str, **fields: Any) -> None:
        row = self.suggestions.get(suggestion_id)
        if row is None:
            return
        for k, v in fields.items():
            if k.startswith("_"):  # transport hints like _tenant_id (Postgres-only)
                continue
            setattr(row, k, v)
        row.updated_at = _now()

    def list_suggestions(
        self, tenant_id: str, *, status: Optional[str] = None, suggestion_type: Optional[str] = None
    ) -> list[SuggestionRow]:
        out = [r for r in self.suggestions.values() if r.tenant_id == tenant_id]
        if status is not None:
            out = [r for r in out if r.status == status]
        if suggestion_type is not None:
            out = [r for r in out if r.suggestion_type == suggestion_type]
        return sorted(out, key=lambda r: r.created_at)

    # proposals + evidence
    def insert_proposal(self, row: ProposalRow) -> str:
        self.proposals[row.id] = row
        return row.id

    def get_proposal(self, proposal_id: str) -> Optional[ProposalRow]:
        return self.proposals.get(proposal_id)

    def update_proposal(self, proposal_id: str, **fields: Any) -> None:
        row = self.proposals.get(proposal_id)
        if row is None:
            return
        for k, v in fields.items():
            if k.startswith("_"):
                continue
            setattr(row, k, v)

    def insert_evidence(self, row: EvidenceRow) -> str:
        self.evidence[row.id] = row
        return row.id

    # entities
    def register_entity_key(self, tenant_id: str, kind: str, ref: str, entity_id: str) -> None:
        """Seed the resolver — used by tests and by create_entity."""
        self._entity_index[(tenant_id, kind, ref)] = entity_id

    def resolve_entity(self, tenant_id: str, ref: str, ref_kind: str) -> Optional[str]:
        return self._entity_index.get((tenant_id, ref_kind, ref))

    def create_entity(self, row: KgEntityRow) -> str:
        self.entities[row.id] = row
        # make the new entity resolvable by uns_path and by its natural key, so edges
        # referencing it (by source_record_id + kind) resolve once it's confirmed.
        if row.uns_path:
            self._entity_index[(row.tenant_id, "uns_path", row.uns_path)] = row.id
        nat_ref = row.properties.get("source_record_id")
        nat_kind = row.properties.get("ref_kind")
        if nat_ref and nat_kind:
            self._entity_index[(row.tenant_id, str(nat_kind), str(nat_ref))] = row.id
        return row.id

    def upsert_relationship(self, row: KgRelationshipRow) -> str:
        # dedupe on (tenant, source, target, type) — mirrors the Hub decide route
        for existing in self.relationships.values():
            if (
                existing.tenant_id == row.tenant_id
                and existing.source_id == row.source_id
                and existing.target_id == row.target_id
                and existing.relationship_type == row.relationship_type
            ):
                existing.approval_state = "verified"
                existing.confidence = max(existing.confidence, row.confidence)
                existing.evidence_summary = existing.evidence_summary or row.evidence_summary
                return existing.id
        self.relationships[row.id] = row
        return row.id


# ── Postgres implementation (production; not exercised by offline tests) ─────


class PostgresProposalStore:
    """SQLAlchemy + NullPool store. Mirrors mira-bots/shared/neon_recall.py connection.

    Every write runs inside ``engine.begin()`` with the RLS tenant GUC set
    (``SET LOCAL app.current_tenant_id``), exactly as the Hub ``withTenantContext`` does.
    Imported lazily so the offline tests never need SQLAlchemy installed.
    """

    def __init__(self, database_url: Optional[str] = None) -> None:
        self._url = database_url or os.environ.get("NEON_DATABASE_URL")
        self._engine = None

    def _eng(self):  # noqa: ANN202 - SQLAlchemy Engine, imported lazily
        if self._engine is None:
            if not self._url:
                raise RuntimeError("NEON_DATABASE_URL not set")
            from sqlalchemy import create_engine  # noqa: PLC0415
            from sqlalchemy.pool import NullPool  # noqa: PLC0415

            self._engine = create_engine(
                self._url,
                poolclass=NullPool,
                connect_args={"sslmode": "require"},
                pool_pre_ping=True,
            )
        return self._engine

    def _tx(self, tenant_id: str):  # noqa: ANN202 - context manager over a tenant-scoped tx
        from contextlib import contextmanager  # noqa: PLC0415

        from sqlalchemy import text  # noqa: PLC0415

        @contextmanager
        def _ctx():  # noqa: ANN202
            with self._eng().begin() as conn:
                # RLS scoping — same GUC the Hub sets via withTenantContext.
                conn.execute(
                    text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                    {"tid": tenant_id},
                )
                yield conn

        return _ctx()

    def insert_suggestion(self, row: SuggestionRow) -> str:
        import json  # noqa: PLC0415

        from sqlalchemy import text  # noqa: PLC0415

        with self._tx(row.tenant_id) as conn:
            res = conn.execute(
                text(
                    """
                    INSERT INTO ai_suggestions
                      (id, tenant_id, suggestion_type, source_kind, source_id,
                       source_document_id, source_page, extracted_data, confidence,
                       status, risk_level, proposed_by, title, body)
                    VALUES
                      (:id, :tenant_id, :suggestion_type, :source_kind, :source_id,
                       :source_document_id, :source_page, CAST(:extracted_data AS JSONB),
                       :confidence, :status, :risk_level, :proposed_by, :title, :body)
                    RETURNING id
                    """
                ),
                {
                    "id": row.id, "tenant_id": row.tenant_id, "suggestion_type": row.suggestion_type,
                    "source_kind": row.source_kind, "source_id": row.source_id,
                    "source_document_id": row.source_document_id, "source_page": row.source_page,
                    "extracted_data": json.dumps(row.extracted_data), "confidence": row.confidence,
                    "status": row.status, "risk_level": row.risk_level, "proposed_by": row.proposed_by,
                    "title": row.title, "body": row.body,
                },
            )
            return str(res.scalar_one())

    def get_suggestion(self, tenant_id: str, suggestion_id: str) -> Optional[SuggestionRow]:
        from sqlalchemy import text  # noqa: PLC0415

        with self._tx(tenant_id) as conn:
            res = conn.execute(
                text("SELECT * FROM ai_suggestions WHERE id = :id AND tenant_id = :tid"),
                {"id": suggestion_id, "tid": tenant_id},
            ).mappings().first()
        if not res:
            return None
        return SuggestionRow(
            id=str(res["id"]), tenant_id=str(res["tenant_id"]),
            suggestion_type=res["suggestion_type"], extracted_data=res["extracted_data"] or {},
            proposed_by=res["proposed_by"], confidence=res["confidence"], status=res["status"],
            risk_level=res["risk_level"], source_kind=res["source_kind"],
            source_id=str(res["source_id"]) if res["source_id"] else None,
            title=res["title"], body=res["body"], reviewed_by=res["reviewed_by"],
            reviewed_at=str(res["reviewed_at"]) if res["reviewed_at"] else None,
            review_note=res["review_note"],
        )

    def update_suggestion(self, suggestion_id: str, **fields: Any) -> None:
        import json  # noqa: PLC0415

        from sqlalchemy import text  # noqa: PLC0415

        tenant_id = fields.pop("_tenant_id", None)
        if "extracted_data" in fields:
            fields["extracted_data"] = json.dumps(fields["extracted_data"])
        cols = ", ".join(
            f"{k} = CAST(:{k} AS JSONB)" if k == "extracted_data" else f"{k} = :{k}"
            for k in fields
        )
        params = {**fields, "id": suggestion_id}
        sql = f"UPDATE ai_suggestions SET {cols}, updated_at = now() WHERE id = :id"
        eng = self._eng()
        with eng.begin() as conn:
            if tenant_id:
                conn.execute(
                    text("SELECT set_config('app.current_tenant_id', :tid, true)"), {"tid": tenant_id}
                )
            conn.execute(text(sql), params)

    def list_suggestions(
        self, tenant_id: str, *, status: Optional[str] = None, suggestion_type: Optional[str] = None
    ) -> list[SuggestionRow]:
        from sqlalchemy import text  # noqa: PLC0415

        clauses = ["tenant_id = :tid"]
        params: dict[str, Any] = {"tid": tenant_id}
        if status:
            clauses.append("status = :status")
            params["status"] = status
        if suggestion_type:
            clauses.append("suggestion_type = :stype")
            params["stype"] = suggestion_type
        sql = f"SELECT * FROM ai_suggestions WHERE {' AND '.join(clauses)} ORDER BY created_at"
        with self._tx(tenant_id) as conn:
            rows = conn.execute(text(sql), params).mappings().all()
        return [
            SuggestionRow(
                id=str(r["id"]), tenant_id=str(r["tenant_id"]), suggestion_type=r["suggestion_type"],
                extracted_data=r["extracted_data"] or {}, proposed_by=r["proposed_by"],
                confidence=r["confidence"], status=r["status"], risk_level=r["risk_level"],
                source_kind=r["source_kind"], title=r["title"], body=r["body"],
            )
            for r in rows
        ]

    def insert_proposal(self, row: ProposalRow) -> str:
        from sqlalchemy import text  # noqa: PLC0415

        with self._tx(row.tenant_id or "") as conn:
            res = conn.execute(
                text(
                    """
                    INSERT INTO relationship_proposals
                      (id, tenant_id, source_entity_id, source_entity_type,
                       target_entity_id, target_entity_type, relationship_type,
                       confidence, status, created_by, risk_level, requires_human_review, reasoning)
                    VALUES
                      (:id, :tenant_id, :source_entity_id, :source_entity_type,
                       :target_entity_id, :target_entity_type, :relationship_type,
                       :confidence, :status, :created_by, :risk_level, :requires_human_review, :reasoning)
                    RETURNING id
                    """
                ),
                row.__dict__,
            )
            return str(res.scalar_one())

    def get_proposal(self, proposal_id: str) -> Optional[ProposalRow]:
        from sqlalchemy import text  # noqa: PLC0415

        eng = self._eng()
        with eng.connect() as conn:
            r = conn.execute(
                text("SELECT * FROM relationship_proposals WHERE id = :id"), {"id": proposal_id}
            ).mappings().first()
        if not r:
            return None
        return ProposalRow(
            id=str(r["id"]), tenant_id=str(r["tenant_id"]) if r["tenant_id"] else None,
            source_entity_id=str(r["source_entity_id"]), source_entity_type=r["source_entity_type"],
            target_entity_id=str(r["target_entity_id"]), target_entity_type=r["target_entity_type"],
            relationship_type=r["relationship_type"], confidence=r["confidence"], status=r["status"],
            created_by=r["created_by"], risk_level=r["risk_level"],
            requires_human_review=r["requires_human_review"], reasoning=r["reasoning"],
        )

    def update_proposal(self, proposal_id: str, **fields: Any) -> None:
        from sqlalchemy import text  # noqa: PLC0415

        tenant_id = fields.pop("_tenant_id", None)
        cols = ", ".join(f"{k} = :{k}" for k in fields)
        eng = self._eng()
        with eng.begin() as conn:
            if tenant_id:
                conn.execute(
                    text("SELECT set_config('app.current_tenant_id', :tid, true)"), {"tid": tenant_id}
                )
            conn.execute(
                text(f"UPDATE relationship_proposals SET {cols} WHERE id = :id"),
                {**fields, "id": proposal_id},
            )

    def insert_evidence(self, row: EvidenceRow) -> str:
        from sqlalchemy import text  # noqa: PLC0415

        eng = self._eng()
        with eng.begin() as conn:
            res = conn.execute(
                text(
                    """
                    INSERT INTO relationship_evidence
                      (id, proposal_id, evidence_type, source_id, source_description,
                       page_or_location, excerpt, confidence_contribution)
                    VALUES
                      (:id, :proposal_id, :evidence_type, :source_id, :source_description,
                       :page_or_location, :excerpt, :confidence_contribution)
                    RETURNING id
                    """
                ),
                row.__dict__,
            )
            return str(res.scalar_one())

    def resolve_entity(self, tenant_id: str, ref: str, ref_kind: str) -> Optional[str]:
        from sqlalchemy import text  # noqa: PLC0415

        # uns_path is the strong resolver; natural keys land in properties->>'source_record_id'.
        with self._tx(tenant_id) as conn:
            if ref_kind == "uns_path":
                r = conn.execute(
                    text("SELECT id FROM kg_entities WHERE tenant_id = :tid AND uns_path = :ref"),
                    {"tid": tenant_id, "ref": ref},
                ).first()
            else:
                # natural-key match: properties.natural_key == "<kind>:<ref>" disambiguates
                # an asset and a location that share a source id (e.g. CONV16).
                r = conn.execute(
                    text(
                        "SELECT id FROM kg_entities WHERE tenant_id = :tid "
                        "AND properties->>'natural_key' = :nk"
                    ),
                    {"tid": tenant_id, "nk": f"{ref_kind}:{ref}"},
                ).first()
        return str(r[0]) if r else None

    def create_entity(self, row: KgEntityRow) -> str:
        import json  # noqa: PLC0415

        from sqlalchemy import text  # noqa: PLC0415

        # Real kg_entities columns (Hub mig 001 + 010 uns_path + 024 source_chunk_id +
        # 029 approval_state). Natural key is UNIQUE(tenant_id, entity_type, name) per
        # mig 025/026 — upsert on it so confirming the same entity twice is idempotent
        # (entity_id is nullable post-025; we fill it with the source natural key, which
        # also satisfies the pre-025 NOT NULL).
        entity_id = str(row.properties.get("source_record_id") or row.name)
        with self._tx(row.tenant_id) as conn:
            res = conn.execute(
                text(
                    """
                    INSERT INTO kg_entities
                      (id, tenant_id, entity_type, entity_id, name, uns_path,
                       properties, approval_state)
                    VALUES
                      (:id, :tenant_id, :entity_type, :entity_id, :name, :uns_path,
                       CAST(:properties AS JSONB), :approval_state)
                    ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
                      SET uns_path = COALESCE(EXCLUDED.uns_path, kg_entities.uns_path),
                          approval_state = EXCLUDED.approval_state,
                          properties = kg_entities.properties || EXCLUDED.properties,
                          updated_at = now()
                    RETURNING id
                    """
                ),
                {
                    "id": row.id, "tenant_id": row.tenant_id, "entity_type": row.entity_type,
                    "entity_id": entity_id, "name": row.name, "uns_path": row.uns_path,
                    "properties": json.dumps(row.properties), "approval_state": row.approval_state,
                },
            )
            return str(res.scalar_one())

    def upsert_relationship(self, row: KgRelationshipRow) -> str:
        from sqlalchemy import text  # noqa: PLC0415

        # Mirrors mira-hub /api/proposals/[id]/decide: dedupe on tenant+source+target+type.
        with self._tx(row.tenant_id) as conn:
            existing = conn.execute(
                text(
                    """SELECT id FROM kg_relationships
                       WHERE tenant_id = :tid AND source_id = :s AND target_id = :t
                         AND relationship_type = :rt"""
                ),
                {"tid": row.tenant_id, "s": row.source_id, "t": row.target_id, "rt": row.relationship_type},
            ).first()
            if existing:
                conn.execute(
                    text(
                        """UPDATE kg_relationships
                             SET approval_state = 'verified',
                                 confidence = GREATEST(confidence, :c),
                                 proposed_by = COALESCE(proposed_by, :pb),
                                 evidence_summary = COALESCE(evidence_summary, :es)
                           WHERE id = :id"""
                    ),
                    {"c": row.confidence, "pb": row.proposed_by, "es": row.evidence_summary, "id": existing[0]},
                )
                return str(existing[0])
            res = conn.execute(
                text(
                    """INSERT INTO kg_relationships
                         (id, tenant_id, source_id, target_id, relationship_type,
                          confidence, approval_state, proposed_by, evidence_summary)
                       VALUES (:id, :tid, :s, :t, :rt, :c, 'verified', :pb, :es)
                       RETURNING id"""
                ),
                {
                    "id": row.id, "tid": row.tenant_id, "s": row.source_id, "t": row.target_id,
                    "rt": row.relationship_type, "c": row.confidence, "pb": row.proposed_by,
                    "es": row.evidence_summary,
                },
            )
            return str(res.scalar_one())


def replace_row(row: Any, **changes: Any) -> Any:
    """Dataclass ``replace`` re-export so the gate can clone rows for corrections."""
    return replace(row, **changes)
