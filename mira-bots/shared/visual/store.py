"""VisualSession store — Neon read/write for the VisualSession spine (ADR-0027
Phase 1), plus an in-memory implementation used as the graceful degrade path
and as a fast, hermetic test double.

``VisualSessionStore`` mirrors ``mira-bots/shared/decision_trace.py``'s
connection shape EXACTLY:

  - ``create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"},
    pool_pre_ping=True)`` — same args, same NullPool choice (Neon's PgBouncer
    handles pooling; see python-standards.md).
  - The SAME module-level env var decision_trace reads (``NEON_DATABASE_URL``),
    re-read on every call (not cached) so tests can monkeypatch it freely.
  - Every write/read executes ``SET LOCAL app.current_tenant_id = :tid`` on the
    connection BEFORE the statement — the RLS tenant binding migration 063's
    dual-setting policy reads.
  - Sync SQLAlchemy work is wrapped in ``loop.run_in_executor`` with a timeout.
  - Fail-open: EVERY public method catches all exceptions, logs a warning, and
    returns ``None``/``[]`` — it NEVER raises into the caller. No configured
    URL is not an error, it is "storage disabled" (like decision_trace).
  - sqlalchemy is imported lazily inside the executor closure so importing
    this module (and callers that never touch the store) stays cheap.

``InMemoryVisualStore`` implements the identical async method surface without
any DB — it is what ``session_service.default_store()`` returns when
``NEON_DATABASE_URL`` is unset (the "work in-memory" graceful degrade the
Phase-1 spec requires), and what tests inject to prove session continuity
without a live database.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from .evidence_state import EvidenceState
from .models import (
    AnswerClaim,
    AnswerEnvelope,
    EvidenceItem,
    Observation,
    RegionOfInterest,
    VisualSession,
)

logger = logging.getLogger("mira-gsd.visual_store")

# Same env var decision_trace.py reads at module scope (`_insert`). Reused,
# not reinvented, per the Phase-1 spec.
_NEON_URL_VAR = "NEON_DATABASE_URL"
_TIMEOUT_SECONDS = 5


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Neon-backed store (production) ──────────────────────────────────────────


def _engine(url: str):
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


async def _fail_open(op_name: str, fn, *, default: Any):
    """Run a sync DB closure in an executor with a timeout; NEVER raises.

    Mirrors decision_trace.write_trace's fail-open contract exactly: any
    exception (including a timeout) is logged and swallowed, returning
    ``default`` — a store failure must never crash the engine.
    """
    try:
        loop = asyncio.get_running_loop()
        return await asyncio.wait_for(loop.run_in_executor(None, fn), timeout=_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001
        logger.warning("visual_store: %s failed (fail-open): %s", op_name, exc)
        return default


_INSERT_SESSION_SQL = """
INSERT INTO visual_session (tenant_id, asset_id, uns_path, title, created_by, metadata)
VALUES (
    CAST(:tenant_id AS UUID), CAST(:asset_id AS UUID), CAST(:uns_path AS LTREE),
    :title, :created_by, CAST(:metadata AS JSONB)
)
RETURNING session_id
"""

_SELECT_SESSION_SQL = """
SELECT session_id, tenant_id, asset_id, uns_path::text AS uns_path, title, status,
       current_revision, created_by, created_at, updated_at, metadata
FROM visual_session
WHERE session_id = CAST(:session_id AS UUID) AND tenant_id = CAST(:tenant_id AS UUID)
"""

_INSERT_EVIDENCE_SQL = """
INSERT INTO evidence_item (
    session_id, tenant_id, source_type, drawing_type, original_uri, original_hash,
    derived_uri, derived_hash, capture_meta, quality_score, page_ref, metadata
) VALUES (
    CAST(:session_id AS UUID), CAST(:tenant_id AS UUID), :source_type, :drawing_type,
    :original_uri, :original_hash, :derived_uri, :derived_hash, CAST(:capture_meta AS JSONB),
    :quality_score, :page_ref, CAST(:metadata AS JSONB)
)
RETURNING evidence_id
"""

_INSERT_REGION_SQL = """
INSERT INTO region_of_interest (evidence_id, tenant_id, geometry, label, origin, transform_to_original)
VALUES (
    CAST(:evidence_id AS UUID), CAST(:tenant_id AS UUID), CAST(:geometry AS JSONB), :label,
    :origin, CAST(:transform_to_original AS JSONB)
)
RETURNING region_id
"""

_INSERT_OBSERVATION_SQL = """
INSERT INTO observation (
    session_id, tenant_id, evidence_id, region_id, obs_kind, raw_value, normalized_value,
    evidence_state, confidence, extractor, metadata
) VALUES (
    CAST(:session_id AS UUID), CAST(:tenant_id AS UUID), CAST(:evidence_id AS UUID),
    CAST(:region_id AS UUID), :obs_kind, :raw_value, :normalized_value, :evidence_state,
    :confidence, :extractor, CAST(:metadata AS JSONB)
)
RETURNING observation_id
"""

_SELECT_OBSERVATIONS_SQL = """
SELECT observation_id, session_id, tenant_id, evidence_id, region_id, obs_kind, raw_value,
       normalized_value, evidence_state, confidence, extractor, review_state, superseded_by,
       created_at, metadata
FROM observation
WHERE session_id = CAST(:session_id AS UUID) AND tenant_id = CAST(:tenant_id AS UUID)
{active_filter}
ORDER BY created_at ASC
"""
_ACTIVE_FILTER = "  AND evidence_state NOT IN ('REJECTED', 'SUPERSEDED')\n"

# Narrow UPDATEs sanctioned by migration 063 ("Append + narrow UPDATE
# (review_state / superseded_by / normalized_value). No DELETE." and
# visual_session's current_revision); UPDATE is granted to factorylm_app.
_SUPERSEDE_OBSERVATION_SQL = """
UPDATE observation
SET evidence_state = 'SUPERSEDED', superseded_by = CAST(:superseded_by AS UUID)
WHERE observation_id = CAST(:observation_id AS UUID)
  AND session_id = CAST(:session_id AS UUID)
  AND tenant_id = CAST(:tenant_id AS UUID)
"""

_SET_CURRENT_REVISION_SQL = """
UPDATE visual_session
SET current_revision = CAST(:revision AS UUID), updated_at = now()
WHERE session_id = CAST(:session_id AS UUID) AND tenant_id = CAST(:tenant_id AS UUID)
"""

_INSERT_QUESTION_SQL = """
INSERT INTO visual_question (session_id, tenant_id, text, answer, next_best_evidence, safety_notes, asked_by)
VALUES (
    CAST(:session_id AS UUID), CAST(:tenant_id AS UUID), :text, :answer, :next_best_evidence,
    CAST(:safety_notes AS JSONB), :asked_by
)
RETURNING question_id
"""

_INSERT_CLAIM_SQL = """
INSERT INTO answer_claim (
    question_id, session_id, tenant_id, text, claim_type, evidence_state,
    supporting_observation_ids, doc_citations, uncertainty, safety_flag
) VALUES (
    CAST(:question_id AS UUID), CAST(:session_id AS UUID), CAST(:tenant_id AS UUID), :text,
    :claim_type, :evidence_state, CAST(:supporting_observation_ids AS UUID[]),
    CAST(:doc_citations AS JSONB), :uncertainty, :safety_flag
)
"""


def _uuid_array_literal(ids: list[str]) -> str:
    """Postgres array literal for a UUID[] bind param, e.g. ``{id1,id2}``.

    Built as a plain string rather than relying on DBAPI list-adaptation so
    the value is unambiguous to read/reason about; it is still a bound
    parameter (not string-interpolated SQL), so this carries no injection
    risk — the ids are always prior observation_id values, never raw user
    text.
    """
    return "{" + ",".join(ids) + "}"


class VisualSessionStore:
    """Neon-backed store. Stateless (no cached engine/connection) — reads
    ``NEON_DATABASE_URL`` fresh on every call, exactly like decision_trace.
    """

    async def create_session(
        self,
        tenant_id: str,
        *,
        asset_id: str | None = None,
        uns_path: str | None = None,
        title: str | None = None,
        created_by: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        if not tenant_id:
            logger.debug("visual_store: create_session skipped: no tenant_id")
            return None
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return None
        params = {
            "tenant_id": tenant_id,
            "asset_id": asset_id,
            "uns_path": uns_path,
            "title": title,
            "created_by": created_by,
            "metadata": json.dumps(metadata or {}),
        }

        def _run() -> str | None:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                row = conn.execute(sql_text(_INSERT_SESSION_SQL), params).first()
                conn.commit()
                return str(row.session_id) if row is not None else None

        return await _fail_open("create_session", _run, default=None)

    async def get_session(self, session_id: str, tenant_id: str) -> VisualSession | None:
        if not session_id or not tenant_id:
            return None
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return None
        params = {"session_id": session_id, "tenant_id": tenant_id}

        def _run() -> VisualSession | None:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                row = conn.execute(sql_text(_SELECT_SESSION_SQL), params).mappings().first()
                conn.commit()
                return VisualSession.from_row(row) if row is not None else None

        return await _fail_open("get_session", _run, default=None)

    async def add_evidence_item(
        self,
        session_id: str,
        tenant_id: str,
        *,
        source_type: str = "unknown",
        drawing_type: str | None = None,
        original_uri: str | None = None,
        original_hash: str | None = None,
        derived_uri: str | None = None,
        derived_hash: str | None = None,
        capture_meta: dict[str, Any] | None = None,
        quality_score: float | None = None,
        page_ref: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        if not session_id or not tenant_id:
            return None
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return None
        params = {
            "session_id": session_id,
            "tenant_id": tenant_id,
            "source_type": source_type,
            "drawing_type": drawing_type,
            "original_uri": original_uri,
            "original_hash": original_hash,
            "derived_uri": derived_uri,
            "derived_hash": derived_hash,
            "capture_meta": json.dumps(capture_meta or {}),
            "quality_score": quality_score,
            "page_ref": page_ref,
            "metadata": json.dumps(metadata or {}),
        }

        def _run() -> str | None:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                row = conn.execute(sql_text(_INSERT_EVIDENCE_SQL), params).first()
                conn.commit()
                return str(row.evidence_id) if row is not None else None

        return await _fail_open("add_evidence_item", _run, default=None)

    async def add_region(
        self,
        evidence_id: str,
        tenant_id: str,
        *,
        geometry: dict[str, Any],
        label: str | None = None,
        origin: str = "system",
        transform_to_original: dict[str, Any] | None = None,
    ) -> str | None:
        if not evidence_id or not tenant_id:
            return None
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return None
        params = {
            "evidence_id": evidence_id,
            "tenant_id": tenant_id,
            "geometry": json.dumps(geometry or {}),
            "label": label,
            "origin": origin,
            "transform_to_original": json.dumps(transform_to_original)
            if transform_to_original is not None
            else None,
        }

        def _run() -> str | None:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                row = conn.execute(sql_text(_INSERT_REGION_SQL), params).first()
                conn.commit()
                return str(row.region_id) if row is not None else None

        return await _fail_open("add_region", _run, default=None)

    async def append_observation(
        self,
        session_id: str,
        tenant_id: str,
        *,
        obs_kind: str,
        evidence_state: EvidenceState | str,
        evidence_id: str | None = None,
        region_id: str | None = None,
        raw_value: str | None = None,
        normalized_value: str | None = None,
        confidence: float | None = None,
        extractor: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        if not session_id or not tenant_id:
            return None
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return None
        state = (
            evidence_state
            if isinstance(evidence_state, EvidenceState)
            else EvidenceState(evidence_state)
        )
        params = {
            "session_id": session_id,
            "tenant_id": tenant_id,
            "evidence_id": evidence_id,
            "region_id": region_id,
            "obs_kind": obs_kind,
            "raw_value": raw_value,
            "normalized_value": normalized_value,
            "evidence_state": state.value,
            "confidence": confidence,
            "extractor": extractor,
            "metadata": json.dumps(metadata or {}),
        }

        def _run() -> str | None:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                row = conn.execute(sql_text(_INSERT_OBSERVATION_SQL), params).first()
                conn.commit()
                return str(row.observation_id) if row is not None else None

        return await _fail_open("append_observation", _run, default=None)

    async def load_observations(
        self, session_id: str, tenant_id: str, *, active_only: bool = True
    ) -> list[Observation]:
        if not session_id or not tenant_id:
            return []
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return []
        params = {"session_id": session_id, "tenant_id": tenant_id}
        sql = _SELECT_OBSERVATIONS_SQL.format(active_filter=_ACTIVE_FILTER if active_only else "")

        def _run() -> list[Observation]:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                rows = conn.execute(sql_text(sql), params).mappings().all()
                conn.commit()
                return [Observation.from_row(r) for r in rows]

        return await _fail_open("load_observations", _run, default=[])

    async def supersede_observation(
        self,
        session_id: str,
        tenant_id: str,
        observation_id: str,
        *,
        superseded_by: str,
    ) -> bool:
        if not session_id or not tenant_id or not observation_id or not superseded_by:
            return False
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return False
        params = {
            "session_id": session_id,
            "tenant_id": tenant_id,
            "observation_id": observation_id,
            "superseded_by": superseded_by,
        }

        def _run() -> bool:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                result = conn.execute(sql_text(_SUPERSEDE_OBSERVATION_SQL), params)
                conn.commit()
                return bool(result.rowcount)

        return await _fail_open("supersede_observation", _run, default=False)

    async def set_current_revision(self, session_id: str, tenant_id: str, revision: str) -> bool:
        if not session_id or not tenant_id or not revision:
            return False
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return False
        params = {"session_id": session_id, "tenant_id": tenant_id, "revision": revision}

        def _run() -> bool:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                result = conn.execute(sql_text(_SET_CURRENT_REVISION_SQL), params)
                conn.commit()
                return bool(result.rowcount)

        return await _fail_open("set_current_revision", _run, default=False)

    async def record_answer(
        self,
        session_id: str,
        tenant_id: str,
        question: str,
        envelope: AnswerEnvelope,
        *,
        asked_by: str | None = None,
    ) -> str | None:
        if not session_id or not tenant_id:
            return None
        url = os.environ.get(_NEON_URL_VAR)
        if not url:
            return None
        q_params = {
            "session_id": session_id,
            "tenant_id": tenant_id,
            "text": question,
            "answer": envelope.answer,
            "next_best_evidence": envelope.next_best_evidence,
            "safety_notes": json.dumps(list(envelope.safety_notes)),
            "asked_by": asked_by,
        }

        def _run() -> str | None:
            engine = _engine(url)
            from sqlalchemy import text as sql_text

            with engine.connect() as conn:
                conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
                q_row = conn.execute(sql_text(_INSERT_QUESTION_SQL), q_params).first()
                question_id = str(q_row.question_id)
                for claim in envelope.claims:
                    c_params = {
                        "question_id": question_id,
                        "session_id": session_id,
                        "tenant_id": tenant_id,
                        "text": claim.text,
                        "claim_type": claim.claim_type,
                        "evidence_state": claim.evidence_state.value,
                        "supporting_observation_ids": _uuid_array_literal(
                            list(claim.supporting_observation_ids)
                        ),
                        "doc_citations": json.dumps(list(claim.doc_citations)),
                        "uncertainty": claim.uncertainty,
                        "safety_flag": claim.safety_flag,
                    }
                    conn.execute(sql_text(_INSERT_CLAIM_SQL), c_params)
                conn.commit()
                return question_id

        return await _fail_open("record_answer", _run, default=None)


# ── In-memory store (graceful degrade path + hermetic test double) ─────────


class InMemoryVisualStore:
    """In-process fallback store. NOT persisted across process restarts.

    Implements the identical async method surface as ``VisualSessionStore``
    so ``VisualSessionService`` can hold either interchangeably. Enforces the
    same tenant-scoping semantics (a lookup for the wrong tenant behaves like
    RLS would — it sees nothing) so tests exercising this double are honest
    about isolation, not just a happy-path stub.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, VisualSession] = {}
        self._evidence: dict[str, EvidenceItem] = {}
        self._regions: dict[str, RegionOfInterest] = {}
        self._observations: dict[str, Observation] = {}
        self._questions: dict[str, dict[str, Any]] = {}
        self._claims: dict[str, list[AnswerClaim]] = {}

    async def create_session(
        self,
        tenant_id: str,
        *,
        asset_id: str | None = None,
        uns_path: str | None = None,
        title: str | None = None,
        created_by: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        if not tenant_id:
            return None
        session_id = str(uuid.uuid4())
        now = _now_iso()
        self._sessions[session_id] = VisualSession(
            session_id=session_id,
            tenant_id=tenant_id,
            asset_id=asset_id,
            uns_path=uns_path,
            title=title,
            status="active",
            current_revision=None,
            created_by=created_by,
            created_at=now,
            updated_at=now,
            metadata=metadata or {},
        )
        return session_id

    async def get_session(self, session_id: str, tenant_id: str) -> VisualSession | None:
        session = self._sessions.get(session_id)
        if session is None or session.tenant_id != tenant_id:
            return None
        return session

    async def add_evidence_item(
        self,
        session_id: str,
        tenant_id: str,
        *,
        source_type: str = "unknown",
        drawing_type: str | None = None,
        original_uri: str | None = None,
        original_hash: str | None = None,
        derived_uri: str | None = None,
        derived_hash: str | None = None,
        capture_meta: dict[str, Any] | None = None,
        quality_score: float | None = None,
        page_ref: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        session = self._sessions.get(session_id)
        if session is None or session.tenant_id != tenant_id:
            return None
        evidence_id = str(uuid.uuid4())
        self._evidence[evidence_id] = EvidenceItem(
            evidence_id=evidence_id,
            session_id=session_id,
            tenant_id=tenant_id,
            source_type=source_type,
            drawing_type=drawing_type,
            original_uri=original_uri,
            original_hash=original_hash,
            derived_uri=derived_uri,
            derived_hash=derived_hash,
            capture_meta=capture_meta or {},
            quality_score=quality_score,
            page_ref=page_ref,
            created_at=_now_iso(),
            metadata=metadata or {},
        )
        return evidence_id

    async def add_region(
        self,
        evidence_id: str,
        tenant_id: str,
        *,
        geometry: dict[str, Any],
        label: str | None = None,
        origin: str = "system",
        transform_to_original: dict[str, Any] | None = None,
    ) -> str | None:
        evidence = self._evidence.get(evidence_id)
        if evidence is None or evidence.tenant_id != tenant_id:
            return None
        region_id = str(uuid.uuid4())
        self._regions[region_id] = RegionOfInterest(
            region_id=region_id,
            evidence_id=evidence_id,
            tenant_id=tenant_id,
            geometry=geometry or {},
            label=label,
            origin=origin,
            transform_to_original=transform_to_original,
            created_at=_now_iso(),
        )
        return region_id

    async def append_observation(
        self,
        session_id: str,
        tenant_id: str,
        *,
        obs_kind: str,
        evidence_state: EvidenceState | str,
        evidence_id: str | None = None,
        region_id: str | None = None,
        raw_value: str | None = None,
        normalized_value: str | None = None,
        confidence: float | None = None,
        extractor: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        session = self._sessions.get(session_id)
        if session is None or session.tenant_id != tenant_id:
            return None
        state = (
            evidence_state
            if isinstance(evidence_state, EvidenceState)
            else EvidenceState(evidence_state)
        )
        observation_id = str(uuid.uuid4())
        self._observations[observation_id] = Observation(
            observation_id=observation_id,
            session_id=session_id,
            tenant_id=tenant_id,
            evidence_id=evidence_id,
            region_id=region_id,
            obs_kind=obs_kind,
            raw_value=raw_value,
            normalized_value=normalized_value,
            evidence_state=state,
            confidence=confidence,
            extractor=extractor,
            review_state="unreviewed",
            superseded_by=None,
            created_at=_now_iso(),
            metadata=metadata or {},
        )
        return observation_id

    async def load_observations(
        self, session_id: str, tenant_id: str, *, active_only: bool = True
    ) -> list[Observation]:
        out = [
            o
            for o in self._observations.values()
            if o.session_id == session_id
            and o.tenant_id == tenant_id
            and (not active_only or o.evidence_state.is_active())
        ]
        out.sort(key=lambda o: o.created_at or "")
        return out

    async def supersede_observation(
        self,
        session_id: str,
        tenant_id: str,
        observation_id: str,
        *,
        superseded_by: str,
    ) -> bool:
        obs = self._observations.get(observation_id)
        if (
            obs is None
            or obs.session_id != session_id
            or obs.tenant_id != tenant_id
            or not superseded_by
        ):
            return False
        self._observations[observation_id] = dataclasses.replace(
            obs, evidence_state=EvidenceState.SUPERSEDED, superseded_by=superseded_by
        )
        return True

    async def set_current_revision(self, session_id: str, tenant_id: str, revision: str) -> bool:
        session = self._sessions.get(session_id)
        if session is None or session.tenant_id != tenant_id or not revision:
            return False
        self._sessions[session_id] = dataclasses.replace(
            session, current_revision=revision, updated_at=_now_iso()
        )
        return True

    async def record_answer(
        self,
        session_id: str,
        tenant_id: str,
        question: str,
        envelope: AnswerEnvelope,
        *,
        asked_by: str | None = None,
    ) -> str | None:
        session = self._sessions.get(session_id)
        if session is None or session.tenant_id != tenant_id:
            return None
        question_id = str(uuid.uuid4())
        self._questions[question_id] = {
            "question_id": question_id,
            "session_id": session_id,
            "tenant_id": tenant_id,
            "text": question,
            "answer": envelope.answer,
            "next_best_evidence": envelope.next_best_evidence,
            "safety_notes": list(envelope.safety_notes),
            "asked_by": asked_by,
            "created_at": _now_iso(),
        }
        self._claims[question_id] = list(envelope.claims)
        return question_id


def default_store() -> VisualSessionStore | InMemoryVisualStore:
    """The graceful-degrade factory: Neon-backed when configured, otherwise
    an in-process store so a no-DB dev/demo environment still works within
    the lifetime of the process (ADR-0027 Phase-1 spec: "Degrade gracefully
    if the store URL is absent (work in-memory)").
    """
    if os.environ.get(_NEON_URL_VAR):
        return VisualSessionStore()
    return InMemoryVisualStore()
