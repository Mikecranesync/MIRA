"""Print workspace — durable per-chat "print workspace" persistence (Package A).

Makes the VisualSession spine (``shared/visual/``) the system of record for
the Telegram print path: every print photo turn lands as an evidence item +
VISIBLE OCR observations (with bboxes when the vision layer provides tokens),
every reply lands as a recorded Q&A turn, close-up re-reads supersede stale
observations by tag overlap, and each evidence change bumps the session's
``current_revision``.

Design rules (hard):

  - **Model-free.** Never calls vision/LLM workers — the bot already ran the
    classifier; ``PrecomputedVision`` replays that result into
    ``VisualSessionService.ingest_image`` and ``NullPrintWorker`` /
    ``_no_schematic`` keep the ingest path inert beyond OCR recording.
  - **Fail-open.** No public function in this module may ever raise into a
    bot turn: every one catches, ``logger.warning``s, and returns
    ``None``/``False``/empty.
  - **Zero new env vars required.** Reuses ``MIRA_DB_PATH`` (chat→session
    mapping table, same mira.db as ``telegram_drive_context``) and
    ``NEON_DATABASE_URL`` (via ``visual.store.default_store``). The optional
    ``MIRA_PRINT_CAS_DIR`` override only relocates the graph CAS directory,
    which otherwise defaults next to mira.db.
  - **chat_id is the bare** ``str(update.effective_chat.id)`` **form.**
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sqlite3
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .visual.evidence_state import EvidenceState
from .visual.models import AnswerClaim, AnswerEnvelope, Observation
from .visual.question_resolution import resolve_question_focus
from .visual.session_service import VisualSessionService
from .visual.store import InMemoryVisualStore

logger = logging.getLogger("mira-gsd.print_workspace")

# A workspace older than this is considered a finished conversation; the next
# print photo starts a fresh session rather than resurrecting a week-old one.
PRINT_WORKSPACE_TTL_S = 7 * 24 * 3600

# Versioned derivation stage for CAS-cached PrintSynth graphs. Bump when the
# persisted graph payload shape changes so stale cache entries never collide.
GRAPH_STAGE_VERSION = "graph_interpret_v1"
_GRAPH_STAGE = "graph_interpret"

_DEFAULT_TITLE = "Telegram print workspace"


@dataclass(frozen=True)
class WorkspaceRef:
    """One row of the chat→session mapping table."""

    chat_id: str
    session_id: str
    tenant_id: str
    last_entity: str | None


@dataclass(frozen=True)
class IngestOutcome:
    """Result of one print-photo ingest into the workspace ledger.

    ``status`` is one of:
      - ``"ingested"`` — the spine accepted the image (quality ok).
      - ``"degraded"`` — evidence recorded but the spine flagged the image
        (low quality / vision unavailable); the ledger still moved forward.
      - ``"skipped"`` — nothing could be written (store unavailable).
    """

    session_id: str
    evidence_id: str | None
    new_observation_ids: list[str] = field(default_factory=list)
    superseded_ids: list[str] = field(default_factory=list)
    overlap_tags: list[str] = field(default_factory=list)
    revision: str | None = None
    status: str = "ingested"


# ── service singleton ───────────────────────────────────────────────────────
# One store per process so the InMemory degrade path accumulates state across
# turns (a fresh ``default_store()`` per call would forget every session).

_service: VisualSessionService | None = None


def _get_service() -> VisualSessionService:
    global _service
    if _service is None:
        _service = VisualSessionService()
    return _service


def _reset_for_tests() -> None:
    """Drop the cached service so tests get a fresh (env-driven) store."""
    global _service
    _service = None


# ── chat → session mapping (SQLite, same mira.db as telegram_drive_context) ─


def _workspace_db() -> sqlite3.Connection:
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "CREATE TABLE IF NOT EXISTS telegram_print_workspace ("
        "chat_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, "
        "tenant_id TEXT NOT NULL, last_entity TEXT, updated_at REAL NOT NULL)"
    )
    return db


def get_workspace(chat_id: str, max_age_s: int | None = None) -> WorkspaceRef | None:
    """The print workspace mapped to this chat, or ``None``.

    ``max_age_s`` (when given) rejects rows older than that many seconds —
    callers that want TTL semantics pass ``PRINT_WORKSPACE_TTL_S``.
    """
    if not chat_id:
        return None
    try:
        db = _workspace_db()
        try:
            row = db.execute(
                "SELECT session_id, tenant_id, last_entity, updated_at "
                "FROM telegram_print_workspace WHERE chat_id = ?",
                (chat_id,),
            ).fetchone()
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 — mapping read must never raise
        logger.warning("print_workspace: get_workspace failed (fail-open): %s", exc)
        return None
    if not row:
        return None
    session_id, tenant_id, last_entity, updated_at = row
    if max_age_s is not None and (time.time() - float(updated_at)) > max_age_s:
        return None
    return WorkspaceRef(
        chat_id=chat_id,
        session_id=str(session_id),
        tenant_id=str(tenant_id),
        last_entity=last_entity,
    )


def set_workspace(
    chat_id: str,
    session_id: str,
    tenant_id: str,
    *,
    last_entity: str | None = None,
) -> None:
    """Upsert the chat→session mapping. ``last_entity=None`` preserves any
    previously stored value (COALESCE) so a plain refresh never erases it."""
    if not chat_id or not session_id or not tenant_id:
        return
    try:
        db = _workspace_db()
        try:
            db.execute(
                "INSERT INTO telegram_print_workspace "
                "(chat_id, session_id, tenant_id, last_entity, updated_at) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET "
                "session_id = excluded.session_id, tenant_id = excluded.tenant_id, "
                "last_entity = COALESCE(excluded.last_entity, "
                "telegram_print_workspace.last_entity), "
                "updated_at = excluded.updated_at",
                (chat_id, session_id, tenant_id, last_entity, time.time()),
            )
            db.commit()
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 — mapping write must never raise
        logger.warning("print_workspace: set_workspace failed (fail-open): %s", exc)


# ── ingest adapters (model-free) ────────────────────────────────────────────


class PrecomputedVision:
    """Ingest adapter that replays the bot's already-computed vision result,
    so ``ingest_image`` never triggers a second vision call."""

    def __init__(self, vision_data: dict[str, Any] | None):
        self._vision_data = dict(vision_data or {})

    async def process(self, photo_b64: str, message: str) -> dict[str, Any]:
        return self._vision_data


class NullPrintWorker:
    """Print-worker adapter that declines the theory summary (returning
    ``None`` cleanly skips the LIKELY theory observation in the spine)."""

    async def process(self, prompt: str, state: dict[str, Any]) -> None:
        return None


async def _no_schematic(image_bytes: bytes) -> None:
    """Schematic adapter that skips symbol/connection extraction."""
    return None


# ── workspace lifecycle ─────────────────────────────────────────────────────


async def ensure_workspace(chat_id: str, *, tenant_id: str, title: str) -> str | None:
    """Return this chat's workspace session id, creating one if needed.

    A mapped session is reused within ``PRINT_WORKSPACE_TTL_S``. On the
    InMemory degrade path a mapping row can outlive the process that created
    its session — that stale mapping is self-healed with a fresh session
    (Neon-backed sessions persist, so no such check is applied there)."""
    if not chat_id or not tenant_id:
        return None
    try:
        service = _get_service()
        ref = get_workspace(chat_id, max_age_s=PRINT_WORKSPACE_TTL_S)
        if ref is not None:
            if not isinstance(service.store, InMemoryVisualStore):
                return ref.session_id
            if await service.store.get_session(ref.session_id, ref.tenant_id) is not None:
                return ref.session_id
        session_id = await service.create_session(
            tenant_id,
            title=(title or _DEFAULT_TITLE)[:80],
            created_by=chat_id,
            metadata={"source": "telegram", "chat_id": chat_id},
        )
        if session_id:
            set_workspace(chat_id, session_id, tenant_id)
        return session_id
    except Exception as exc:  # noqa: BLE001 — never raise into a bot turn
        logger.warning("print_workspace: ensure_workspace failed (fail-open): %s", exc)
        return None


# ── the core ingest ─────────────────────────────────────────────────────────


async def ingest_print_photo(
    chat_id: str,
    raw_bytes: bytes,
    vision_data: dict[str, Any] | None,
    caption: str,
    *,
    tenant_id: str = "default",
    page_ref: str | None = None,
) -> IngestOutcome | None:
    """Persist one print photo into the chat's workspace ledger.

    Flow: ensure workspace → ingest via the spine (model-free adapters) →
    write VISIBLE OCR observations (single-writer: when ``ocr_tokens`` with
    bboxes exist, THIS function writes the OCR rows and the spine writes
    none) → supersede stale observations whose tags this photo re-read →
    bump ``current_revision``. Fail-open: returns ``None`` on any failure.
    """
    try:
        if not raw_bytes:
            return None
        vision_data = dict(vision_data or {})
        title = (caption or "").strip() or _DEFAULT_TITLE
        session_id = await ensure_workspace(chat_id, tenant_id=tenant_id, title=title)
        if not session_id:
            return None
        ref = get_workspace(chat_id)
        eff_tenant = ref.tenant_id if ref is not None else tenant_id
        service = _get_service()
        store = service.store

        # bbox single-writer strategy: when the vision layer provides
        # positioned tokens, suppress the spine's bare ocr_items writes and
        # write one VISIBLE observation per token (carrying the bbox) here.
        tokens = [
            t
            for t in (vision_data.get("ocr_tokens") or [])
            if isinstance(t, dict) and str(t.get("text") or "").strip()
        ]
        ingest_payload = dict(vision_data)
        if tokens:
            ingest_payload["ocr_items"] = []

        result = await service.ingest_image(
            session_id,
            eff_tenant,
            raw_bytes,
            message=caption or "",
            vision=PrecomputedVision(ingest_payload),
            print_worker=NullPrintWorker(),
            schematic=_no_schematic,
        )
        evidence_id = result.evidence_id
        page = page_ref if page_ref is not None else vision_data.get("page")
        page_value = str(page) if page is not None else None

        new_ocr: list[tuple[str, str]] = []  # (observation_id, raw_value)
        if tokens and evidence_id:
            for token in tokens:
                text = str(token.get("text") or "").strip()
                obs_id = await store.append_observation(
                    session_id,
                    eff_tenant,
                    obs_kind="entity",
                    evidence_state=EvidenceState.VISIBLE,
                    evidence_id=evidence_id,
                    raw_value=text,
                    extractor="ocr",
                    metadata={"bbox": token.get("bbox"), "page": page_value},
                )
                if obs_id:
                    new_ocr.append((obs_id, text))
        elif evidence_id:
            new_ocr = [
                (o.observation_id, o.raw_value)
                for o in result.observations
                if o.evidence_id == evidence_id and o.extractor == "ocr" and o.raw_value
            ]

        # Supersede pass: tags this photo re-read replace the stale rows from
        # OTHER evidence items (a close-up refines the earlier wide shot).
        superseded_ids: list[str] = []
        overlap_tags: list[str] = []
        try:
            if new_ocr and evidence_id:
                new_by_value: dict[str, str] = {}
                for obs_id, value in new_ocr:
                    new_by_value.setdefault(value, obs_id)
                ledger = await store.load_observations(session_id, eff_tenant, active_only=True)
                for obs in ledger:
                    if obs.extractor != "ocr" or obs.evidence_id == evidence_id:
                        continue
                    if not obs.raw_value or obs.raw_value not in new_by_value:
                        continue
                    ok = await store.supersede_observation(
                        session_id,
                        eff_tenant,
                        obs.observation_id,
                        superseded_by=new_by_value[obs.raw_value],
                    )
                    if ok:
                        superseded_ids.append(obs.observation_id)
                        if obs.raw_value not in overlap_tags:
                            overlap_tags.append(obs.raw_value)
        except Exception as exc:  # noqa: BLE001 — enrichment failure keeps the ingest
            logger.warning("print_workspace: supersede pass failed (fail-open): %s", exc)

        # Every evidence change bumps the session revision so downstream
        # consumers can cheaply detect "the print model moved".
        revision: str | None = str(uuid.uuid4())
        try:
            if not await store.set_current_revision(session_id, eff_tenant, revision):
                revision = None
        except Exception as exc:  # noqa: BLE001 — revision failure keeps the ingest
            logger.warning("print_workspace: revision bump failed (fail-open): %s", exc)
            revision = None

        # Caption continuity (Package C): when the photo's caption names a tag
        # this photo actually read ("What would energize K17?"), that tag
        # becomes the workspace's last_entity — so the very next follow-up can
        # say "its seal-in" / "why would it drop out?" without re-naming the
        # tag. A caption that names nothing changes nothing (COALESCE).
        try:
            if new_ocr:
                focus = resolve_question_focus(
                    caption or "", None, [value for _, value in new_ocr]
                ).focus_tag
                if focus:
                    set_workspace(chat_id, session_id, eff_tenant, last_entity=focus)
        except Exception as exc:  # noqa: BLE001 — continuity is enrichment, never fatal
            logger.warning("print_workspace: caption focus failed (fail-open): %s", exc)

        if result.status == "ok":
            status = "ingested"
        elif evidence_id is None:
            status = "skipped"
        else:
            status = "degraded"

        return IngestOutcome(
            session_id=session_id,
            evidence_id=evidence_id,
            new_observation_ids=[obs_id for obs_id, _ in new_ocr],
            superseded_ids=superseded_ids,
            overlap_tags=overlap_tags,
            revision=revision,
            status=status,
        )
    except Exception as exc:  # noqa: BLE001 — never raise into a bot turn
        logger.warning("print_workspace: ingest_print_photo failed (fail-open): %s", exc)
        return None


# ── Q&A + technician observations ───────────────────────────────────────────


async def record_photo_turn_answer(
    session_id: str,
    tenant_id: str,
    question: str,
    answer_text: str,
    *,
    claims: list[AnswerClaim] | None = None,
) -> None:
    """Record one Q&A turn against the workspace session (thin
    ``store.record_answer`` wrapper). Empty answers are skipped."""
    try:
        if not session_id or not tenant_id or not (answer_text or "").strip():
            return
        envelope = AnswerEnvelope(answer=answer_text, claims=list(claims or []))
        await _get_service().store.record_answer(
            session_id, tenant_id, question or "", envelope, asked_by=None
        )
    except Exception as exc:  # noqa: BLE001 — never raise into a bot turn
        logger.warning("print_workspace: record_photo_turn_answer failed (fail-open): %s", exc)


async def append_technician_observation(
    session_id: str,
    tenant_id: str,
    verbatim: str,
    parsed: dict[str, Any],
) -> str | None:
    """Record a technician-reported measurement/statement as a DOCUMENTED
    observation. Does NOT bump the session revision — technician input is
    context, not print evidence."""
    try:
        if not session_id or not tenant_id or not verbatim:
            return None
        parsed = dict(parsed or {})
        store = _get_service().store
        current: str | None = None
        session = await store.get_session(session_id, tenant_id)
        if session is not None:
            current = session.current_revision
        summary = "; ".join(f"{k}={v}" for k, v in parsed.items())[:200] or None
        return await store.append_observation(
            session_id,
            tenant_id,
            obs_kind="property",
            evidence_state=EvidenceState.DOCUMENTED,
            raw_value=verbatim,
            normalized_value=summary,
            extractor="technician",
            metadata={
                "measurement": parsed,
                "reported_at": datetime.now(timezone.utc).isoformat(),
                "at_revision": current,
            },
        )
    except Exception as exc:  # noqa: BLE001 — never raise into a bot turn
        logger.warning("print_workspace: append_technician_observation failed (fail-open): %s", exc)
        return None


# ── PrintSynth graph capture (CAS + LIKELY observation) ─────────────────────


def _cas_dir() -> Path:
    override = os.environ.get("MIRA_PRINT_CAS_DIR")
    if override:
        return Path(override)
    return Path(os.environ.get("MIRA_DB_PATH", "/data/mira.db")).parent / "print_cas"


def _schedule_graph_observation(chat_id: str, cas_key: str) -> None:
    """Best-effort LIKELY observation pointing at the cached graph. Skipped
    (never an error) when no workspace or no running event loop exists."""
    try:
        ref = get_workspace(chat_id)
        if ref is None:
            return
        loop = asyncio.get_running_loop()
    except Exception:  # noqa: BLE001 — no loop / no mapping → skip silently
        return

    async def _append() -> None:
        try:
            await _get_service().store.append_observation(
                ref.session_id,
                ref.tenant_id,
                obs_kind="relation",
                evidence_state=EvidenceState.LIKELY,
                raw_value="printsynth graph captured",
                extractor="graph",
                metadata={"graph_cas_key": cas_key, "trust": "proposed"},
            )
        except Exception as exc:  # noqa: BLE001 — observability only
            logger.warning("print_workspace: graph observation failed (fail-open): %s", exc)

    loop.create_task(_append())


def graph_sink_for(chat_id: str) -> Callable[[Any], None]:
    """A sink the engine calls with the typed PrintSynthGraph right after it
    is built (before rendering discards it). Caches the graph JSON in the
    CAS under a versioned derivation key and appends a LIKELY observation
    referencing it. The entire closure is try/except-swallowed."""

    def _sink(graph: Any) -> None:
        try:
            payload_json = graph.model_dump_json()
            payload = json.loads(payload_json)
            if not isinstance(payload, dict):
                payload = {"graph": payload}
            source_sha = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
            from printsense.cas import CAS  # lazy: bot images may not ship printsense

            key = CAS(_cas_dir()).cache_put(source_sha, _GRAPH_STAGE, GRAPH_STAGE_VERSION, payload)
            logger.info("PRINT_GRAPH_CAPTURED chat=%s cas_key=%s", chat_id, key)
            _schedule_graph_observation(chat_id, key)
        except Exception as exc:  # noqa: BLE001 — the sink never touches the reply
            logger.warning("print_workspace: graph sink failed (fail-open): %s", exc)

    return _sink


# ── ledger → vision_data reconstruction ─────────────────────────────────────


def rebuild_vision_data(observations: list[Observation]) -> dict[str, Any]:
    """Rebuild a vision_data-shaped dict from the workspace's active OCR
    ledger — ``ocr_items`` for every active OCR value, ``ocr_tokens`` for
    those that carry a bbox."""
    items: list[str] = []
    tokens: list[dict[str, Any]] = []
    try:
        for obs in observations or []:
            if getattr(obs, "extractor", None) != "ocr":
                continue
            raw = getattr(obs, "raw_value", None)
            if not raw:
                continue
            state = getattr(obs, "evidence_state", None)
            if state is not None and hasattr(state, "is_active") and not state.is_active():
                continue
            items.append(raw)
            bbox = (getattr(obs, "metadata", None) or {}).get("bbox")
            if bbox is not None:
                tokens.append({"text": raw, "bbox": bbox})
    except Exception as exc:  # noqa: BLE001 — reconstruction is best-effort
        logger.warning("print_workspace: rebuild_vision_data failed (fail-open): %s", exc)
    return {"ocr_items": items, "ocr_tokens": tokens}


# ── the one-call wrapper for bot turns ──────────────────────────────────────


async def persist_print_turn(
    chat_id: str,
    tenant_id: str,
    raw_bytes: bytes,
    vision_data: dict[str, Any] | None,
    caption: str,
    answer: str,
    *,
    page_ref: str | None = None,
) -> IngestOutcome | None:
    """Ingest the photo AND record the Q&A turn — the single call bot.py
    makes after a print reply is delivered. Returns the ingest outcome so
    the caller can send an enrichment ack when ``superseded_ids`` is
    non-empty. Fail-open: returns ``None`` on any failure."""
    try:
        outcome = await ingest_print_photo(
            chat_id,
            raw_bytes,
            vision_data,
            caption,
            tenant_id=tenant_id,
            page_ref=page_ref,
        )
        if outcome is None:
            return None
        ref = get_workspace(chat_id)
        eff_tenant = ref.tenant_id if ref is not None else tenant_id
        await record_photo_turn_answer(outcome.session_id, eff_tenant, caption or "", answer or "")
        return outcome
    except Exception as exc:  # noqa: BLE001 — never raise into a bot turn
        logger.warning("print_workspace: persist_print_turn failed (fail-open): %s", exc)
        return None
