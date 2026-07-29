"""VisualSessionService — the Phase-1 orchestrator (ADR-0027).

Wires the image-quality gate (``quality_gate.score_image``), the EXISTING
extraction workers (``VisionWorker``, ``PrintWorker``, the
``schematic_intelligence`` pipeline), and the ``VisualSession`` store
(``store.py``) into one call surface:

  - ``ingest_image`` — score quality; if too low, record a NEEDS_CONTEXT
    observation and return a "send a clearer photo" hint. Otherwise classify
    the image, record its OCR text as VISIBLE observations, its holistic
    vision description as a LIKELY observation, and — for electrical prints —
    run the schematic symbol/connection extractor and an optional
    plain-English theory-of-operation summary, both LIKELY (model
    inference, never auto-verified).
  - ``ask`` — load the accumulated observation ledger, compose a structured
    ``AnswerEnvelope`` (``answer_composer.compose_answer`` — deterministic;
    see that module for the safety-critical rules), persist the Q&A turn,
    and return the envelope.

Workers are call-injectable (``vision=``, ``print_worker=``, ``schematic=``);
the default is the real worker, constructed lazily so importing this module
never requires network config. A worker error is recorded as a
NEEDS_CONTEXT observation and surfaced in the result status — this service
NEVER raises a worker/store failure into the caller.

``PrintWorker`` and the ``schematic_intelligence`` pipeline have signatures
shaped for their original call sites (an FSM conversation turn; an MCP-side
script), not for "extract structured facts from these image bytes" — per the
Phase-1 spec these are wrapped behind the thin adapters below
(``_default_print_worker``, ``_default_schematic_extractor``) rather than
modified. See ``_default_schematic_extractor`` for a deployment-boundary note
(mira-mcp is a separate container in production; the adapter degrades to "no
schematic extraction" rather than crashing when it is not importable).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import equipment
from .answer_composer import compose_answer
from .equipment import NAMEPLATE_IDENTITY_FIELDS, EquipmentResolution, ManualRetriever
from .evidence_state import EvidenceState
from .models import AnswerEnvelope, Observation, QualityScore
from .quality_gate import score_image
from .store import InMemoryVisualStore, VisualSessionStore, default_store

logger = logging.getLogger("mira-gsd.visual_session_service")

LOW_QUALITY_HINT = (
    "That photo is too low quality to read reliably (blur, low contrast, or low "
    "resolution). Send a clearer, closer, well-lit photo of the same area."
)
VISION_UNAVAILABLE_HINT = "Could not analyze this image right now. Try again or send another photo."

_OPENWEBUI_URL_VAR = "OPENWEBUI_BASE_URL"
_OPENWEBUI_URL_DEFAULT = "http://mira-core:8080"
_OPENWEBUI_KEY_VAR = "OPENWEBUI_API_KEY"
_VISION_MODEL_VAR = "VISION_MODEL"
_VISION_MODEL_DEFAULT = "qwen2.5vl:7b"

_SOURCE_TYPE_BY_CLASSIFICATION = {
    "ELECTRICAL_PRINT": "print",
    "NAMEPLATE": "nameplate",
    "EQUIPMENT_PHOTO": "component",
}

# Phase 2 (ADR-0027) equipment/nameplate ingest route. Deliberately excludes
# the literal string "equipment" -- migration 063's evidence_item.source_type
# CHECK constraint does NOT list "equipment" as a valid value (it lists
# print/panel/component/nameplate/terminal/plc/drive/hmi/area/mixed/unknown);
# writing that value would violate the CHECK on a real Postgres. "component"
# (EQUIPMENT_PHOTO's mapped source_type, above) already covers the general
# "photo of equipment" case within the valid vocabulary.
_EQUIPMENT_SOURCE_TYPES = frozenset({"nameplate", "drive", "panel", "component"})

_NAMEPLATE_UNREADABLE_HINT = "nameplate unreadable — resend a clear, glare-free photo"

_PRINT_THEORY_PROMPT = (
    "Summarize this print's likely theory of operation in 1-2 sentences, "
    "grounded only in the OCR labels provided. If nothing is legible, say so."
)


@dataclass(frozen=True, slots=True)
class IngestResult:
    """Return value of ``VisualSessionService.ingest_image``.

    Not a DB table / not one of the ADR-0027 spine contracts — a plain
    call-result type for the orchestration layer. ``observations`` is the
    FULL accumulated ledger for the session after this ingest (not just the
    delta), so a caller always sees the whole picture without a second call.
    """

    session_id: str
    evidence_id: str | None
    quality: QualityScore
    observations: list[Observation] = field(default_factory=list)
    status: str = "ok"  # "ok" | "needs_better_photo" | "error"
    hint: str | None = None
    # Phase 2 (ADR-0027): populated only when this ingest ran the nameplate/
    # equipment route (source_type in _EQUIPMENT_SOURCE_TYPES). None for the
    # Phase 1 print/unclassified routes -- unchanged behavior for those.
    equipment_resolution: EquipmentResolution | None = None


def _source_type_for(classification_label: str | None) -> str:
    return _SOURCE_TYPE_BY_CLASSIFICATION.get(classification_label or "", "unknown")


def _default_vision_worker():
    from ..workers.vision_worker import VisionWorker

    return VisionWorker(
        os.environ.get(_OPENWEBUI_URL_VAR, _OPENWEBUI_URL_DEFAULT),
        os.environ.get(_OPENWEBUI_KEY_VAR, ""),
        os.environ.get(_VISION_MODEL_VAR, _VISION_MODEL_DEFAULT),
    )


def _default_print_worker():
    from ..workers.print_worker import PrintWorker

    return PrintWorker(
        os.environ.get(_OPENWEBUI_URL_VAR, _OPENWEBUI_URL_DEFAULT),
        os.environ.get(_OPENWEBUI_KEY_VAR, ""),
    )


def _default_nameplate_worker():
    from ..workers.nameplate_worker import NameplateWorker

    return NameplateWorker(
        os.environ.get(_OPENWEBUI_URL_VAR, _OPENWEBUI_URL_DEFAULT),
        os.environ.get(_OPENWEBUI_KEY_VAR, ""),
        os.environ.get(_VISION_MODEL_VAR, _VISION_MODEL_DEFAULT),
    )


_schematic_module_cache: Any = None
_schematic_import_failed = False


def _load_schematic_module():
    """Best-effort import of mira-mcp/schematic_intelligence.py.

    Deployment-boundary note: mira-mcp is a SEPARATE container from
    mira-bots in every shipped compose file (container map, root CLAUDE.md).
    In this dev worktree both live on one filesystem, so a sys.path append
    makes the import work; inside the deployed mira-bot-telegram/-slack/...
    image, mira-mcp's source is not present and this import fails. Both
    outcomes are handled: this function returns ``None`` on any failure and
    is cached (tried once per process) so a missing sibling package costs one
    failed import, not one per call.
    """
    global _schematic_module_cache, _schematic_import_failed
    if _schematic_module_cache is not None:
        return _schematic_module_cache
    if _schematic_import_failed:
        return None
    try:
        mira_mcp_dir = Path(__file__).resolve().parents[3] / "mira-mcp"
        if str(mira_mcp_dir) not in sys.path and mira_mcp_dir.is_dir():
            sys.path.append(str(mira_mcp_dir))
        import schematic_intelligence  # type: ignore[import-not-found]

        _schematic_module_cache = schematic_intelligence
        return schematic_intelligence
    except Exception as exc:  # noqa: BLE001 - genuinely optional, cross-package
        logger.info("visual session_service: schematic_intelligence unavailable (%s)", exc)
        _schematic_import_failed = True
        return None


async def _default_schematic_extractor(image_bytes: bytes):
    """Adapter over the real (synchronous, HTTP-calling) schematic pipeline.

    ``run_schematic_pipeline`` is a blocking function (plain ``httpx.post``
    calls, no asyncio) — it is run in an executor so it never blocks the
    event loop. Returns ``None`` (no schematic-derived observations, but
    OCR/vision observations still get recorded) when the module cannot be
    imported or the pipeline raises.
    """
    module = _load_schematic_module()
    if module is None:
        return None

    def _run():
        return module.run_schematic_pipeline(image_bytes)

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _run)


async def _maybe_await(value: Any) -> Any:
    """Call sites accept either a sync or async injected callable/worker."""
    if isinstance(value, Awaitable):
        return await value
    return value


class VisualSessionService:
    """The Phase-1 orchestrator. See module docstring."""

    def __init__(self, store: VisualSessionStore | InMemoryVisualStore | None = None) -> None:
        self.store = store if store is not None else default_store()

    # -- session lifecycle -------------------------------------------------

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
        return await self.store.create_session(
            tenant_id,
            asset_id=asset_id,
            uns_path=uns_path,
            title=title,
            created_by=created_by,
            metadata=metadata,
        )

    # -- ingest --------------------------------------------------------------

    async def ingest_image(
        self,
        session_id: str,
        tenant_id: str,
        image_bytes: bytes,
        *,
        message: str = "",
        vision: Any = None,
        print_worker: Any = None,
        schematic: Callable[[bytes], Any] | None = None,
        nameplate_worker: Any = None,
    ) -> IngestResult:
        quality = score_image(image_bytes)
        original_hash = hashlib.sha256(image_bytes).hexdigest()

        if not quality.ok:
            evidence_id = await self.store.add_evidence_item(
                session_id,
                tenant_id,
                source_type="unknown",
                original_hash=original_hash,
                quality_score=quality.score,
            )
            await self.store.append_observation(
                session_id,
                tenant_id,
                obs_kind="property",
                evidence_state=EvidenceState.NEEDS_CONTEXT,
                evidence_id=evidence_id,
                raw_value="image too low quality: " + "; ".join(quality.reasons),
                extractor="quality_gate",
            )
            observations = await self.store.load_observations(session_id, tenant_id)
            return IngestResult(
                session_id=session_id,
                evidence_id=evidence_id,
                quality=quality,
                observations=observations,
                status="needs_better_photo",
                hint=LOW_QUALITY_HINT,
            )

        vision_worker = vision if vision is not None else _default_vision_worker()
        try:
            photo_b64 = base64.b64encode(image_bytes).decode("ascii")
            classification = await vision_worker.process(photo_b64, message)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ingest_image: vision worker failed: %s", exc)
            evidence_id = await self.store.add_evidence_item(
                session_id,
                tenant_id,
                source_type="unknown",
                original_hash=original_hash,
                quality_score=quality.score,
            )
            await self.store.append_observation(
                session_id,
                tenant_id,
                obs_kind="property",
                evidence_state=EvidenceState.NEEDS_CONTEXT,
                evidence_id=evidence_id,
                raw_value="image classification unavailable",
                extractor="vision_worker",
            )
            observations = await self.store.load_observations(session_id, tenant_id)
            return IngestResult(
                session_id=session_id,
                evidence_id=evidence_id,
                quality=quality,
                observations=observations,
                status="error",
                hint=VISION_UNAVAILABLE_HINT,
            )

        source_type = _source_type_for(classification.get("classification"))
        evidence_id = await self.store.add_evidence_item(
            session_id,
            tenant_id,
            source_type=source_type,
            drawing_type=classification.get("drawing_type"),
            original_hash=original_hash,
            quality_score=quality.score,
        )

        await self._record_extraction_observations(
            session_id,
            tenant_id,
            evidence_id,
            classification,
            image_bytes,
            print_worker=print_worker,
            schematic=schematic,
        )

        # Phase 2 (ADR-0027): nameplate/equipment identity route. Purely
        # additive alongside the Phase 1 OCR/vision + print-structure recording
        # above (unchanged) -- gated on the SAME classification-derived
        # source_type, never on a "print" classification.
        equipment_resolution: EquipmentResolution | None = None
        if source_type in _EQUIPMENT_SOURCE_TYPES:
            equipment_resolution = await self._record_equipment_observations(
                session_id,
                tenant_id,
                evidence_id,
                image_bytes,
                nameplate_worker=nameplate_worker,
            )

        observations = await self.store.load_observations(session_id, tenant_id)
        return IngestResult(
            session_id=session_id,
            evidence_id=evidence_id,
            quality=quality,
            observations=observations,
            status="ok",
            hint=None,
            equipment_resolution=equipment_resolution,
        )

    async def _record_extraction_observations(
        self,
        session_id: str,
        tenant_id: str,
        evidence_id: str | None,
        classification: dict[str, Any],
        image_bytes: bytes,
        *,
        print_worker: Any,
        schematic: Callable[[bytes], Any] | None,
    ) -> None:
        vision_text = classification.get("vision_result")
        if vision_text:
            await self.store.append_observation(
                session_id,
                tenant_id,
                obs_kind="property",
                evidence_state=EvidenceState.LIKELY,
                evidence_id=evidence_id,
                raw_value=str(vision_text),
                confidence=classification.get("classification_confidence"),
                extractor="vision_worker",
            )

        for item in classification.get("ocr_items") or []:
            text = str(item).strip()
            if not text:
                continue
            await self.store.append_observation(
                session_id,
                tenant_id,
                obs_kind="entity",
                evidence_state=EvidenceState.VISIBLE,
                evidence_id=evidence_id,
                raw_value=text,
                extractor="ocr",
            )

        if classification.get("classification") != "ELECTRICAL_PRINT":
            return

        await self._extract_print_structure(
            session_id,
            tenant_id,
            evidence_id,
            classification,
            image_bytes,
            print_worker=print_worker,
            schematic=schematic,
        )

    async def _extract_print_structure(
        self,
        session_id: str,
        tenant_id: str,
        evidence_id: str | None,
        classification: dict[str, Any],
        image_bytes: bytes,
        *,
        print_worker: Any,
        schematic: Callable[[bytes], Any] | None,
    ) -> None:
        # Schematic symbol/connection extraction — LIKELY (model inference
        # beyond literal OCR transcription). Accepts either the real
        # SchematicResult dataclass or any duck-typed object exposing
        # .symbols / .connections (a fake test double, or demo.py --fake).
        schematic_fn = schematic if schematic is not None else _default_schematic_extractor
        try:
            result = await _maybe_await(schematic_fn(image_bytes))
        except Exception as exc:  # noqa: BLE001
            logger.warning("ingest_image: schematic extraction failed: %s", exc)
            result = None

        if result is not None:
            # normalized_value is a CANONICALIZED rendering of the SAME fact
            # raw_value names (migration 063: "canonicalized (may be
            # corrected on review)") -- never a different, narrower fact.
            # answer_composer prefers normalized_value for claim display
            # text, so e.g. stashing just a wire number there (discarding
            # which conductor it is) would render a claim as the bare
            # string "100" instead of a meaningful sentence.
            for symbol in getattr(result, "symbols", None) or []:
                ref = getattr(symbol, "ref", None)
                sym_type = getattr(symbol, "type", None)
                await self.store.append_observation(
                    session_id,
                    tenant_id,
                    obs_kind="entity",
                    evidence_state=EvidenceState.LIKELY,
                    evidence_id=evidence_id,
                    raw_value=ref,
                    normalized_value=f"{ref} ({sym_type})" if ref and sym_type else sym_type,
                    extractor="schematic_intelligence",
                )
            for conn in getattr(result, "connections", None) or []:
                from_ref = getattr(conn, "from_ref", None)
                to_ref = getattr(conn, "to_ref", None)
                wire_number = getattr(conn, "wire_number", None)
                raw_value = f"{from_ref} -> {to_ref}"
                normalized_value = f"{raw_value} (wire {wire_number})" if wire_number else None
                await self.store.append_observation(
                    session_id,
                    tenant_id,
                    obs_kind="relation",
                    evidence_state=EvidenceState.LIKELY,
                    evidence_id=evidence_id,
                    raw_value=raw_value,
                    normalized_value=normalized_value,
                    extractor="schematic_intelligence",
                )

        # Optional plain-English theory-of-operation summary — LIKELY (LLM
        # interpretation of the OCR ground truth, not a literal reading).
        worker = print_worker if print_worker is not None else _default_print_worker()
        try:
            state = {
                "context": {
                    "ocr_items": classification.get("ocr_items") or [],
                    "drawing_type": classification.get("drawing_type") or "electrical drawing",
                    "history": [],
                }
            }
            summary = await worker.process(_PRINT_THEORY_PROMPT, state)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ingest_image: print worker failed: %s", exc)
            summary = None

        if summary:
            await self.store.append_observation(
                session_id,
                tenant_id,
                obs_kind="property",
                evidence_state=EvidenceState.LIKELY,
                evidence_id=evidence_id,
                raw_value=str(summary),
                extractor="print_worker",
            )

    # -- equipment / nameplate route (ADR-0027 Phase 2) ---------------------

    async def _record_equipment_observations(
        self,
        session_id: str,
        tenant_id: str,
        evidence_id: str | None,
        image_bytes: bytes,
        *,
        nameplate_worker: Any,
    ) -> EquipmentResolution:
        """Extract nameplate fields, persist them, resolve equipment identity,
        persist the outcome. Graceful on any NameplateWorker failure -- a
        single NEEDS_CONTEXT observation, never a raised exception.
        """
        worker = nameplate_worker if nameplate_worker is not None else _default_nameplate_worker()
        try:
            photo_b64 = base64.b64encode(image_bytes).decode("ascii")
            fields = await _maybe_await(worker.extract(photo_b64))
        except Exception as exc:  # noqa: BLE001
            logger.warning("ingest_image: nameplate worker failed: %s", exc)
            fields = {"parse_error": str(exc), "raw_text": None}

        if not isinstance(fields, dict) or "parse_error" in fields:
            await self.store.append_observation(
                session_id,
                tenant_id,
                obs_kind="property",
                evidence_state=EvidenceState.NEEDS_CONTEXT,
                evidence_id=evidence_id,
                raw_value=_NAMEPLATE_UNREADABLE_HINT,
                extractor="nameplate_worker",
            )
            return EquipmentResolution(
                status="NONE",
                candidates=[],
                evidence=[],
                reason="nameplate image unreadable (parse_error)",
                needs_context=_NAMEPLATE_UNREADABLE_HINT,
            )

        # One VISIBLE observation per read field -- raw_text is recorded
        # SEPARATELY below, never folded into a per-field value (rule 3: raw
        # OCR kept apart from normalized/interpreted fields).
        for field_name in NAMEPLATE_IDENTITY_FIELDS:
            value = fields.get(field_name)
            if value in (None, ""):
                continue
            await self.store.append_observation(
                session_id,
                tenant_id,
                obs_kind="property",
                evidence_state=EvidenceState.VISIBLE,
                evidence_id=evidence_id,
                raw_value=str(value),
                normalized_value=f"{field_name}: {value}",
                extractor="nameplate_worker",
                metadata={"field": field_name},
            )

        raw_text = fields.get("raw_text")
        if raw_text:
            await self.store.append_observation(
                session_id,
                tenant_id,
                obs_kind="property",
                evidence_state=EvidenceState.VISIBLE,
                evidence_id=evidence_id,
                raw_value=str(raw_text),
                extractor="nameplate_worker",
                metadata={"field": "raw_text"},
            )

        resolution = equipment.resolve_equipment(nameplate=fields)
        await self._persist_equipment_resolution(session_id, tenant_id, evidence_id, resolution)
        return resolution

    async def _persist_equipment_resolution(
        self,
        session_id: str,
        tenant_id: str,
        evidence_id: str | None,
        resolution: EquipmentResolution,
    ) -> None:
        """Persist the resolve_equipment outcome as ONE observation whose
        evidence_state reflects the outcome (never RESOLVED-shaped unless the
        resolution genuinely is): RESOLVED -> DOCUMENTED, CONFLICTING ->
        CONFLICTING, AMBIGUOUS/NONE -> NEEDS_CONTEXT. The full resolution
        (including every candidate) round-trips through metadata so
        ask_equipment can reconstruct it later without re-resolving.
        """
        state_by_status = {
            "RESOLVED": EvidenceState.DOCUMENTED,
            "CONFLICTING": EvidenceState.CONFLICTING,
            "AMBIGUOUS": EvidenceState.NEEDS_CONTEXT,
            "NONE": EvidenceState.NEEDS_CONTEXT,
        }
        state = state_by_status.get(resolution.status, EvidenceState.NEEDS_CONTEXT)

        if resolution.status == "RESOLVED" and resolution.pack_id:
            try:
                pack = equipment.load_pack(resolution.pack_id)
                family_label = f"{pack.family.manufacturer} {pack.family.series}"
            except Exception as exc:  # noqa: BLE001 - pack removed/corrupted since resolving
                logger.warning(
                    "_persist_equipment_resolution: load_pack(%s) failed: %s",
                    resolution.pack_id,
                    exc,
                )
                family_label = resolution.pack_id
            normalized = (
                f"identified as {family_label} (from nameplate; not field-verified installed)"
            )
            raw_value = normalized
        else:
            normalized = resolution.needs_context or resolution.reason
            raw_value = resolution.reason or resolution.needs_context

        await self.store.append_observation(
            session_id,
            tenant_id,
            obs_kind="entity",
            evidence_state=state,
            evidence_id=evidence_id,
            raw_value=raw_value,
            normalized_value=normalized,
            extractor="equipment_resolver",
            metadata=resolution.to_dict(),
        )

    # -- ask -------------------------------------------------------------------

    async def ask(
        self,
        session_id: str,
        tenant_id: str,
        question: str,
        *,
        manual_citations: list[dict[str, Any]] | None = None,
        llm: Callable[[str], str] | None = None,
        asked_by: str | None = None,
    ) -> AnswerEnvelope:
        observations = await self.store.load_observations(session_id, tenant_id)
        envelope = compose_answer(
            question, observations, manual_citations=manual_citations, llm=llm
        )
        await self.store.record_answer(session_id, tenant_id, question, envelope, asked_by=asked_by)
        return envelope

    # -- ask_equipment (ADR-0027 Phase 2) ---------------------------------

    async def ask_equipment(
        self,
        session_id: str,
        tenant_id: str,
        question: str,
        *,
        retriever: ManualRetriever | None = None,
        llm: Callable[[str], str] | None = None,
    ) -> AnswerEnvelope:
        """Answer an equipment question grounded in this session's resolved
        pack identity (from the most recent nameplate/equipment ingest) plus
        tenant manuals. Loads the persisted identity/candidate/conflict
        observation ``_record_equipment_observations`` wrote (tagged
        ``extractor="equipment_resolver"``) rather than re-resolving.

        Uses the LATEST legible identity attempt -- NOT the latest one that
        happened to RESOLVE. This is the safety-critical distinction:

        - An *unreadable* re-scan (NameplateWorker parse_error, or a
          quality-gate reject) deliberately writes NO ``equipment_resolver``
          observation (``_record_equipment_observations`` early-returns a
          ``nameplate_worker`` NEEDS_CONTEXT instead), so a blurry photo does
          NOT erase a previously established identity -- the prior RESOLVED
          remains the latest ``equipment_resolver`` observation.
        - A *legible* photo of a DIFFERENT or unsupported machine resolves to
          NONE / CONFLICTING / AMBIGUOUS and IS persisted as an
          ``equipment_resolver`` observation, so it SUPERSEDES the earlier
          identity. We must not answer with the earlier pack's cited facts once
          the technician has visibly moved to a different machine -- doing so
          would hand back a confidently-cited fault-code/parameter fact for the
          WRONG equipment (safety-review stale-identity finding).

        So: the most recent ``equipment_resolver`` observation wins outright.
        If it did not resolve, ``answer_equipment`` refuses with NEEDS_CONTEXT.
        If no nameplate/equipment photo was ever ingested, NEEDS_CONTEXT.
        """
        observations = await self.store.load_observations(session_id, tenant_id)
        identity_obs = [o for o in observations if o.extractor == "equipment_resolver"]

        if identity_obs:
            resolution = EquipmentResolution.from_dict(identity_obs[-1].metadata)
        else:
            hint = "no equipment identified yet in this session — send a clear photo of the nameplate first"
            resolution = EquipmentResolution(
                status="NONE",
                candidates=[],
                evidence=[],
                reason=hint,
                needs_context=hint,
            )

        return await equipment.answer_equipment(
            session_id,
            tenant_id,
            question,
            resolution,
            store=self.store,
            retriever=retriever,
            llm=llm,
        )
