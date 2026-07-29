"""Tests for shared.visual.session_service.VisualSessionService.

Entirely hermetic: an InMemoryVisualStore (no DB) plus fake vision/print
workers and a fake schematic extractor (no network, no LLM) are injected
throughout. Proves:
  - ingest_image records observations from OCR (VISIBLE) and the holistic
    vision description (LIKELY), routes electrical prints through the
    schematic + print-theory extractors (LIKELY), and never touches the
    vision worker for a too-low-quality photo.
  - ask() composes a grounded envelope from the ledger and persists the turn.
  - A second ingest on the SAME session accumulates onto the ledger rather
    than replacing it, and a follow-up question can resolve using evidence
    from either ingest (the session-continuity proof the Phase-1 spec asks
    for) -- including a question asked BEFORE the second ingest still being
    answerable the same way afterward (earlier evidence is not lost).
  - A worker error degrades to a NEEDS_CONTEXT observation + "error" status,
    never a raised exception.
"""

from __future__ import annotations

import io
import os
import sys
import uuid
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from PIL import Image, ImageDraw  # noqa: E402

from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.session_service import VisualSessionService  # noqa: E402
from shared.visual.store import InMemoryVisualStore  # noqa: E402

import pytest  # noqa: E402


# ── fixtures / fakes ─────────────────────────────────────────────────────────


def _sharp_image_bytes() -> bytes:
    """A synthetic image that reliably passes the quality gate (see
    test_visual_quality_gate.py for the calibration -- this mirrors the
    "sharp" fixture there)."""
    img = Image.new("L", (1600, 1200), color=0)
    draw = ImageDraw.Draw(img)
    cell = 12
    for y in range(0, 1200, cell):
        for x in range(0, 1600, cell):
            if ((x // cell) + (y // cell)) % 2 == 0:
                draw.rectangle([x, y, x + cell, y + cell], fill=255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _blurry_image_bytes() -> bytes:
    """A tiny, flat-gray image that reliably fails the quality gate."""
    img = Image.new("L", (60, 45), color=128)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class _FakeVision:
    """Deterministic stand-in for VisionWorker.process()."""

    def __init__(self, classification: dict):
        self._classification = classification
        self.calls = 0

    async def process(self, photo_b64: str, message: str) -> dict:
        self.calls += 1
        assert isinstance(photo_b64, str) and photo_b64
        return dict(self._classification)


class _PoisonVision:
    """Fails the test loudly if ever called -- used to prove the low-quality
    short-circuit never reaches the vision worker."""

    async def process(self, photo_b64: str, message: str) -> dict:
        raise AssertionError("vision worker must not be called for a too-low-quality photo")


class _RaisingVision:
    async def process(self, photo_b64: str, message: str) -> dict:
        raise RuntimeError("vision provider down")


class _FakePrint:
    def __init__(self, summary: str = "Fake theory-of-operation summary."):
        self._summary = summary
        self.calls = 0

    async def process(self, message: str, state: dict) -> str:
        self.calls += 1
        assert "context" in state
        return self._summary


def _fake_schematic(image_bytes: bytes) -> SimpleNamespace:
    symbol = SimpleNamespace(ref="K1", type="contactor")
    connection = SimpleNamespace(from_ref="K1:A1", to_ref="CR3:13", wire_number="100")
    return SimpleNamespace(symbols=[symbol], connections=[connection])


_ELECTRICAL_PRINT_CLASSIFICATION = {
    "classification": "ELECTRICAL_PRINT",
    "classification_confidence": 0.82,
    "vision_result": "A control-circuit ladder diagram showing a motor starter rung.",
    "ocr_items": ["contact CR3 normally open", "K1 contactor coil"],
    "tesseract_text": "",
    "drawing_type": "ladder logic diagram",
    "drawing_type_confidence": 0.7,
}


def _service() -> VisualSessionService:
    return VisualSessionService(store=InMemoryVisualStore())


TENANT = str(uuid.uuid4())


# ── ingest_image ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ingest_records_ocr_as_visible_and_vision_result_as_likely():
    service = _service()
    session_id = await service.create_session(TENANT, title="test session")
    assert session_id

    vision = _FakeVision(_ELECTRICAL_PRINT_CLASSIFICATION)
    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=vision,
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
    )

    assert result.status == "ok"
    assert vision.calls == 1
    assert result.quality.ok is True

    ocr_obs = [o for o in result.observations if o.extractor == "ocr"]
    assert {o.raw_value for o in ocr_obs} == {"contact CR3 normally open", "K1 contactor coil"}
    assert all(o.evidence_state == EvidenceState.VISIBLE for o in ocr_obs)

    vision_obs = [o for o in result.observations if o.extractor == "vision_worker"]
    assert len(vision_obs) == 1
    assert vision_obs[0].evidence_state == EvidenceState.LIKELY

    # Electrical print -> schematic + print-theory extraction also ran.
    schematic_obs = [o for o in result.observations if o.extractor == "schematic_intelligence"]
    assert any(o.obs_kind == "entity" and o.raw_value == "K1" for o in schematic_obs)
    assert any(o.obs_kind == "relation" for o in schematic_obs)
    print_obs = [o for o in result.observations if o.extractor == "print_worker"]
    assert len(print_obs) == 1
    assert print_obs[0].evidence_state == EvidenceState.LIKELY

    # Never auto-verified -- nothing Phase-1 ingest writes should ever be
    # MACHINE_VERIFIED or DOCUMENTED (those require the KG/manual pathway).
    assert all(
        o.evidence_state in (EvidenceState.VISIBLE, EvidenceState.LIKELY)
        for o in result.observations
    )


@pytest.mark.asyncio
async def test_low_quality_photo_never_reaches_vision_worker():
    service = _service()
    session_id = await service.create_session(TENANT, title="test session")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _blurry_image_bytes(),
        vision=_PoisonVision(),
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
    )

    assert result.status == "needs_better_photo"
    assert result.hint
    assert result.quality.ok is False
    assert len(result.observations) == 1
    assert result.observations[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert result.observations[0].extractor == "quality_gate"


@pytest.mark.asyncio
async def test_vision_worker_failure_degrades_to_needs_context():
    service = _service()
    session_id = await service.create_session(TENANT, title="test session")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_RaisingVision(),
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
    )

    assert result.status == "error"
    assert result.hint
    assert any(o.evidence_state == EvidenceState.NEEDS_CONTEXT for o in result.observations)


@pytest.mark.asyncio
async def test_schematic_extractor_failure_does_not_lose_ocr_observations():
    service = _service()
    session_id = await service.create_session(TENANT, title="test session")

    def _raising_schematic(image_bytes: bytes):
        raise RuntimeError("mira-mcp unreachable")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_ELECTRICAL_PRINT_CLASSIFICATION),
        print_worker=_FakePrint(),
        schematic=_raising_schematic,
    )

    assert result.status == "ok"
    ocr_obs = [o for o in result.observations if o.extractor == "ocr"]
    assert len(ocr_obs) == 2
    assert not any(o.extractor == "schematic_intelligence" for o in result.observations)


# ── ask() ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ask_composes_grounded_envelope_from_ingested_observations():
    service = _service()
    session_id = await service.create_session(TENANT, title="test session")
    await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_ELECTRICAL_PRINT_CLASSIFICATION),
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
    )

    envelope = await service.ask(session_id, TENANT, "What does CR3 do?")

    assert envelope.answer
    assert any(
        c.evidence_state == EvidenceState.VISIBLE and "CR3" in c.text for c in envelope.claims
    )


# ── session continuity across ingests (the persistence proof) ──────────────


@pytest.mark.asyncio
async def test_followup_question_uses_accumulated_ledger_across_two_ingests():
    service = _service()
    session_id = await service.create_session(TENANT, title="continuity test")

    # First photo: CR3 contact.
    first = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_ELECTRICAL_PRINT_CLASSIFICATION),
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
    )
    assert first.status == "ok"

    envelope_1 = await service.ask(session_id, TENANT, "What does CR3 do?")
    assert any("CR3" in c.text for c in envelope_1.claims)

    # Second photo (SAME session): a different label, establishing a
    # destination this time.
    second_classification = {
        "classification": "ELECTRICAL_PRINT",
        "classification_confidence": 0.75,
        "vision_result": "A terminal strip photo showing a landing point.",
        "ocr_items": ["wire number 200 lands on terminal TB2-1"],
        "tesseract_text": "",
        "drawing_type": "wiring diagram",
        "drawing_type_confidence": 0.6,
    }
    second = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(second_classification),
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
    )
    assert second.status == "ok"

    # The ledger GREW -- second ingest did not replace the first.
    assert len(second.observations) > len(first.observations)
    assert any(o.raw_value == "contact CR3 normally open" for o in second.observations)
    assert any("TB2-1" in (o.raw_value or "") for o in second.observations)

    # A follow-up question about the NEW evidence resolves correctly...
    envelope_2 = await service.ask(session_id, TENANT, "Where does wire number 200 go?")
    assert any(
        c.evidence_state == EvidenceState.VISIBLE and "TB2-1" in c.text for c in envelope_2.claims
    )

    # ...and the ORIGINAL evidence is still answerable, proving accumulation
    # rather than replacement.
    envelope_3 = await service.ask(session_id, TENANT, "What does CR3 do?")
    assert any("CR3" in c.text for c in envelope_3.claims)


@pytest.mark.asyncio
async def test_second_session_does_not_see_first_sessions_observations():
    service = _service()
    session_a = await service.create_session(TENANT, title="session A")
    session_b = await service.create_session(TENANT, title="session B")
    assert session_a != session_b

    await service.ingest_image(
        session_a,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_ELECTRICAL_PRINT_CLASSIFICATION),
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
    )

    envelope_b = await service.ask(session_b, TENANT, "What does CR3 do?")
    assert envelope_b.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT


@pytest.mark.asyncio
async def test_in_memory_store_enforces_tenant_isolation_directly():
    # Lightweight, always-runs guard alongside the (Docker-gated) migration
    # test -- proves the in-memory degrade path honors the same tenant
    # scoping semantics RLS enforces in Neon, so the "work in-memory"
    # fallback is not a tenancy loophole.
    store = InMemoryVisualStore()
    tenant_a, tenant_b = str(uuid.uuid4()), str(uuid.uuid4())

    session_id = await store.create_session(tenant_a, title="A's session")
    assert session_id

    assert await store.get_session(session_id, tenant_a) is not None
    assert await store.get_session(session_id, tenant_b) is None
    assert await store.load_observations(session_id, tenant_b) == []
    assert await store.append_observation(
        session_id, tenant_b, obs_kind="entity", evidence_state=EvidenceState.VISIBLE, raw_value="x"
    ) is None
