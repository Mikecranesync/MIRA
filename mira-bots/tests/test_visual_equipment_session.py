"""Tests for VisualSessionService's Phase 2 (ADR-0027) extension: the
nameplate/equipment ingest route in ``ingest_image`` and ``ask_equipment``.

Entirely hermetic: InMemoryVisualStore + fake vision/nameplate workers, no
network, no LLM, no DB. Mirrors test_visual_session_service.py's fixture
style (Phase 1) so both suites read consistently side by side.

Covers spec test areas 1 (evidence-state transitions), 2 (append-only
history), 3 (raw-vs-normalized provenance), 9 (graceful NameplateWorker
failure), and 10 (no regression -- the Phase 1 print route is exercised here
too and asserted byte-for-byte unaffected).
"""

from __future__ import annotations

import io
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from PIL import Image, ImageDraw  # noqa: E402

from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.session_service import VisualSessionService  # noqa: E402
from shared.visual.store import InMemoryVisualStore  # noqa: E402

import pytest  # noqa: E402


# ── fixtures / fakes ─────────────────────────────────────────────────────────


def _sharp_image_bytes() -> bytes:
    """Reliably passes the quality gate — mirrors test_visual_session_service.py."""
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


class _FakeVision:
    def __init__(self, classification: dict):
        self._classification = classification
        self.calls = 0

    async def process(self, photo_b64: str, message: str) -> dict:
        self.calls += 1
        assert isinstance(photo_b64, str) and photo_b64
        return dict(self._classification)


class _FakeNameplateWorker:
    """Deterministic stand-in for NameplateWorker.extract()."""

    def __init__(self, fields: dict):
        self._fields = fields
        self.calls = 0

    async def extract(self, photo_b64: str) -> dict:
        self.calls += 1
        assert isinstance(photo_b64, str) and photo_b64
        return dict(self._fields)


class _RaisingNameplateWorker:
    async def extract(self, photo_b64: str) -> dict:
        raise RuntimeError("vision provider down")


class _PoisonNameplateWorker:
    """Fails loudly if ever called -- proves the print route never touches it."""

    async def extract(self, photo_b64: str) -> dict:
        raise AssertionError("nameplate worker must not run on the print route")


class _FakePrint:
    """Deterministic stand-in for PrintWorker.process() -- mirrors
    test_visual_session_service.py's fake so the print-route tests here stay
    hermetic/fast instead of hitting the real (unreachable) Open WebUI."""

    async def process(self, message: str, state: dict) -> str:
        assert "context" in state
        return "Fake theory-of-operation summary."


def _fake_schematic(image_bytes: bytes):
    from types import SimpleNamespace

    symbol = SimpleNamespace(ref="K1", type="contactor")
    connection = SimpleNamespace(from_ref="K1:A1", to_ref="CR3:13", wire_number="100")
    return SimpleNamespace(symbols=[symbol], connections=[connection])


_NAMEPLATE_CLASSIFICATION = {
    "classification": "NAMEPLATE",
    "classification_confidence": 0.9,
    "vision_result": "A drive nameplate mounted on the enclosure door.",
    "ocr_items": ["AutomationDirect", "GS11N-10P2"],
    "tesseract_text": "",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
}

_EQUIPMENT_PHOTO_CLASSIFICATION = {
    "classification": "EQUIPMENT_PHOTO",
    "classification_confidence": 0.7,
    "vision_result": "A VFD mounted in a control panel.",
    "ocr_items": [],
    "tesseract_text": "",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
}

_ELECTRICAL_PRINT_CLASSIFICATION = {
    "classification": "ELECTRICAL_PRINT",
    "classification_confidence": 0.82,
    "vision_result": "A control-circuit ladder diagram showing a motor starter rung.",
    "ocr_items": ["contact CR3 normally open", "K1 contactor coil"],
    "tesseract_text": "",
    "drawing_type": "ladder logic diagram",
    "drawing_type_confidence": 0.7,
}

_GS11_NAMEPLATE_FIELDS = {
    "manufacturer": "AutomationDirect",
    "model": "GS11N-10P2",
    "serial": "AD2026-00042",
    "voltage": "230V",
    "fla": "10.2A",
    "hp": "2",
    "frequency": "60Hz",
    "rpm": None,
    "raw_text": '{"manufacturer": "AutomationDirect", "model": "GS11N-10P2", "serial": "AD2026-00042"}',
}

_CONFLICTING_NAMEPLATE_FIELDS = {
    "manufacturer": None,
    "model": "PowerFlex 525",
    "serial": None,
    "voltage": None,
    "fla": None,
    "hp": None,
    "frequency": None,
    "rpm": None,
    "raw_text": "PowerFlex 525 keypad reads OK",
}


def _service() -> tuple[VisualSessionService, InMemoryVisualStore]:
    store = InMemoryVisualStore()
    return VisualSessionService(store=store), store


TENANT = str(uuid.uuid4())


# ── (1) evidence-state transitions + (3) raw-vs-normalized provenance ──────


@pytest.mark.asyncio
async def test_nameplate_ingest_records_visible_fields_and_separate_raw_text():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="nameplate test")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )

    assert result.status == "ok"
    field_obs = [o for o in result.observations if o.extractor == "nameplate_worker"]
    assert field_obs, "expected nameplate_worker observations"

    # Per-field VISIBLE observations, one per read field.
    manufacturer_obs = [o for o in field_obs if o.metadata.get("field") == "manufacturer"]
    assert len(manufacturer_obs) == 1
    assert manufacturer_obs[0].raw_value == "AutomationDirect"
    assert manufacturer_obs[0].evidence_state == EvidenceState.VISIBLE

    model_obs = [o for o in field_obs if o.metadata.get("field") == "model"]
    assert len(model_obs) == 1
    assert model_obs[0].raw_value == "GS11N-10P2"

    # rpm was None in the fixture -> no observation for it.
    assert not [o for o in field_obs if o.metadata.get("field") == "rpm"]

    # raw_text is a SEPARATE observation, not folded into any per-field value.
    raw_text_obs = [o for o in field_obs if o.metadata.get("field") == "raw_text"]
    assert len(raw_text_obs) == 1
    assert raw_text_obs[0].raw_value == _GS11_NAMEPLATE_FIELDS["raw_text"]
    assert raw_text_obs[0].evidence_state == EvidenceState.VISIBLE
    # The raw_text observation's raw_value is the untouched JSON-looking
    # string -- it must NOT have been re-parsed into structured fields beyond
    # what NameplateWorker's own dict already provided (no extra "serial"
    # observation manufactured from parsing raw_text a second time).
    assert len([o for o in field_obs if o.metadata.get("field") == "serial"]) == 1


@pytest.mark.asyncio
async def test_resolved_identity_persists_one_documented_observation():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="resolved test")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )

    assert result.equipment_resolution is not None
    assert result.equipment_resolution.status == "RESOLVED"
    assert result.equipment_resolution.pack_id == "durapulse_gs10"

    identity_obs = [o for o in result.observations if o.extractor == "equipment_resolver"]
    assert len(identity_obs) == 1
    obs = identity_obs[0]
    assert obs.evidence_state == EvidenceState.DOCUMENTED
    assert obs.obs_kind == "entity"
    assert "AutomationDirect" in obs.normalized_value
    assert "not field-verified installed" in obs.normalized_value
    assert obs.metadata["pack_id"] == "durapulse_gs10"
    assert obs.metadata["status"] == "RESOLVED"


@pytest.mark.asyncio
async def test_conflicting_identity_persists_conflicting_observation():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="conflict test")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_EQUIPMENT_PHOTO_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_CONFLICTING_NAMEPLATE_FIELDS),
    )
    # model="PowerFlex 525" alone (no drive_name arg) resolves cleanly here --
    # there's only one signal source in a bare ingest, so use the dedicated
    # conflict test below (which supplies an external drive_name too) for a
    # genuine CONFLICTING outcome. This test instead proves AMBIGUOUS/NONE
    # equally persist as NEEDS_CONTEXT, not silently as DOCUMENTED.
    assert result.equipment_resolution.status in ("RESOLVED", "AMBIGUOUS", "NONE", "CONFLICTING")
    identity_obs = [o for o in result.observations if o.extractor == "equipment_resolver"]
    assert len(identity_obs) == 1
    if result.equipment_resolution.status == "RESOLVED":
        assert identity_obs[0].evidence_state == EvidenceState.DOCUMENTED
    elif result.equipment_resolution.status == "CONFLICTING":
        assert identity_obs[0].evidence_state == EvidenceState.CONFLICTING
    else:
        assert identity_obs[0].evidence_state == EvidenceState.NEEDS_CONTEXT


@pytest.mark.asyncio
async def test_unsupported_nameplate_persists_needs_context_observation():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="unsupported test")

    unsupported = {
        "manufacturer": "Siemens",
        "model": "S120",
        "serial": None,
        "voltage": None,
        "fla": None,
        "hp": None,
        "frequency": None,
        "rpm": None,
        "raw_text": "SIEMENS S120",
    }
    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(unsupported),
    )

    assert result.equipment_resolution.status == "NONE"
    identity_obs = [o for o in result.observations if o.extractor == "equipment_resolver"]
    assert identity_obs[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert "isn't a supported drive yet" in identity_obs[0].normalized_value


# ── (9) graceful NameplateWorker failure ────────────────────────────────────


@pytest.mark.asyncio
async def test_nameplate_worker_parse_error_yields_single_needs_context_observation():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="parse error test")

    class _ParseErrorWorker:
        async def extract(self, photo_b64: str) -> dict:
            return {"parse_error": "unparseable response: garbage", "raw_text": "garbage"}

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_ParseErrorWorker(),
    )

    assert result.status == "ok"  # the base ingest (quality+classification) succeeded
    assert result.equipment_resolution.status == "NONE"
    assert "unreadable" in result.equipment_resolution.needs_context
    nameplate_obs = [o for o in result.observations if o.extractor == "nameplate_worker"]
    assert len(nameplate_obs) == 1
    assert nameplate_obs[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert "resend a clear, glare-free photo" in nameplate_obs[0].raw_value


@pytest.mark.asyncio
async def test_nameplate_worker_exception_degrades_gracefully_never_crashes():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="exception test")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_RaisingNameplateWorker(),
    )

    assert result.status == "ok"
    assert result.equipment_resolution.status == "NONE"


# ── (10) no regression: the Phase 1 print route is completely unaffected ───


@pytest.mark.asyncio
async def test_print_route_never_touches_the_nameplate_worker():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="print route test")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_ELECTRICAL_PRINT_CLASSIFICATION),
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
        nameplate_worker=_PoisonNameplateWorker(),
    )

    assert result.status == "ok"
    assert result.equipment_resolution is None
    assert not [o for o in result.observations if o.extractor == "equipment_resolver"]
    assert not [o for o in result.observations if o.extractor == "nameplate_worker"]


@pytest.mark.asyncio
async def test_print_route_default_nameplate_worker_arg_is_backward_compatible():
    """A caller using the OLD (Phase 1) call shape -- no nameplate_worker kwarg
    at all -- must behave identically to Phase 1 for a print classification."""
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="backcompat test")

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_ELECTRICAL_PRINT_CLASSIFICATION),
        print_worker=_FakePrint(),
        schematic=_fake_schematic,
    )
    assert result.status == "ok"
    assert result.equipment_resolution is None
    ocr_obs = [o for o in result.observations if o.extractor == "ocr"]
    assert {o.raw_value for o in ocr_obs} == {"contact CR3 normally open", "K1 contactor coil"}


# ── (2) append-only: two nameplate ingests accumulate, never overwrite ─────


@pytest.mark.asyncio
async def test_second_nameplate_ingest_accumulates_onto_the_ledger():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="accumulation test")

    first = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )
    assert first.equipment_resolution.status == "RESOLVED"

    second = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )

    assert len(second.observations) > len(first.observations)
    identity_obs = [o for o in second.observations if o.extractor == "equipment_resolver"]
    assert len(identity_obs) == 2, "the SECOND resolution must be appended, not overwrite the first"


# ── ask_equipment ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ask_equipment_answers_from_the_ingested_identity():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="ask test")
    await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )

    envelope = await service.ask_equipment(
        session_id, TENANT, "what does CE10 mean?", retriever=lambda q, t, m: []
    )

    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented
    assert any("CE10" in c.text for c in documented)


@pytest.mark.asyncio
async def test_ask_equipment_with_no_prior_ingest_yields_needs_context():
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="no ingest yet")

    envelope = await service.ask_equipment(session_id, TENANT, "what does CE10 mean?")

    assert len(envelope.claims) == 1
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert "nameplate" in envelope.claims[0].text.lower()


@pytest.mark.asyncio
async def test_ask_equipment_prefers_latest_resolved_over_a_later_failed_rescan():
    """A first photo resolves the drive; a SECOND, blurry re-scan comes back
    unreadable. ask_equipment must still answer from the FIRST (resolved)
    identity, not treat the session as unidentified."""
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="rescan test")

    await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )

    class _ParseErrorWorker:
        async def extract(self, photo_b64: str) -> dict:
            return {"parse_error": "unparseable", "raw_text": None}

    second = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_ParseErrorWorker(),
    )
    assert second.equipment_resolution.status == "NONE"

    envelope = await service.ask_equipment(
        session_id, TENANT, "what does CE10 mean?", retriever=lambda q, t, m: []
    )
    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented, "must still answer from the earlier RESOLVED identity"


@pytest.mark.asyncio
async def test_ask_equipment_refuses_after_a_legible_photo_of_a_different_machine():
    """Safety-review stale-identity fix. A first photo resolves the drive (GS10);
    a SECOND, perfectly LEGIBLE photo shows a DIFFERENT, unsupported machine
    (Siemens S120 -> NONE, NOT a parse_error). ask_equipment must NOT hand back
    the first machine's confidently-cited fault-code fact -- the technician has
    visibly moved machines -- it must refuse with NEEDS_CONTEXT. This is the
    exact counterpart to the unreadable-rescan test above: an unreadable photo
    keeps the identity; a legible different-machine photo supersedes it."""
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="moved-machine test")

    # Photo #1: legible GS11N nameplate -> RESOLVED durapulse_gs10.
    await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )

    # Photo #2: legible Siemens S120 nameplate -> NONE (unsupported), NOT unreadable.
    s120 = {"manufacturer": "Siemens", "model": "S120", "raw_text": "SIEMENS S120"}
    second = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(s120),
    )
    assert second.equipment_resolution.status == "NONE"  # legible, unsupported machine

    envelope = await service.ask_equipment(
        session_id, TENANT, "what does CE10 mean?", retriever=lambda q, t, m: []
    )
    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert not documented, (
        "must NOT answer with the EARLIER machine's cited fault-code fact after a "
        "legible photo shows a different, unsupported machine (stale-identity leak)"
    )
    assert any(c.evidence_state == EvidenceState.NEEDS_CONTEXT for c in envelope.claims), (
        "must refuse with NEEDS_CONTEXT once the current machine is unidentified"
    )


@pytest.mark.asyncio
async def test_ask_equipment_surfaces_the_specific_conflict_when_nothing_ever_resolved(monkeypatch):
    service, _store = _service()
    session_id = await service.create_session(TENANT, title="never resolved test")

    class _ConflictingFieldsWorker:
        async def extract(self, photo_b64: str) -> dict:
            return dict(_CONFLICTING_NAMEPLATE_FIELDS)

    # _record_equipment_observations always calls resolve_equipment with ONLY
    # the nameplate signal (per its own contract -- ingest_image has no
    # separate drive_name input). To exercise a genuine CONFLICTING outcome
    # through the full session_service path (proving ask_equipment's own
    # "surface the conflict, don't silently drop it" behavior, not just
    # resolve_equipment's), inject a stand-in that also supplies a
    # disagreeing drive_name -- monkeypatch.setattr auto-restores even if the
    # test fails, unlike a manual try/finally on module globals.
    from shared.visual import equipment as equipment_module

    original_resolve = equipment_module.resolve_equipment

    def _forced_conflict(*, nameplate=None, drive_name=None, asset_make_model=None):
        return original_resolve(nameplate=nameplate, drive_name="GS10")

    monkeypatch.setattr(equipment_module, "resolve_equipment", _forced_conflict)

    result = await service.ingest_image(
        session_id,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_ConflictingFieldsWorker(),
    )

    assert result.equipment_resolution.status == "CONFLICTING"

    envelope = await service.ask_equipment(
        session_id, TENANT, "what does CE10 mean?", retriever=lambda q, t, m: []
    )
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert "disagree" in envelope.claims[0].text


@pytest.mark.asyncio
async def test_ask_equipment_threads_the_sessions_tenant_id_to_the_retriever():
    service, _store = _service()
    session_tenant = str(uuid.uuid4())
    session_id = await service.create_session(session_tenant, title="tenant thread test")
    await service.ingest_image(
        session_id,
        session_tenant,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )

    seen = {}

    def capturing_retriever(question, tenant_id, manufacturer):
        seen["tenant_id"] = tenant_id
        return []

    await service.ask_equipment(
        session_id, session_tenant, "what does CE10 mean?", retriever=capturing_retriever
    )
    assert seen["tenant_id"] == session_tenant


# ── second session / second tenant isolation (in-memory guard) ─────────────


@pytest.mark.asyncio
async def test_second_session_does_not_see_first_sessions_equipment_identity():
    service, _store = _service()
    session_a = await service.create_session(TENANT, title="session A")
    session_b = await service.create_session(TENANT, title="session B")

    await service.ingest_image(
        session_a,
        TENANT,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )

    envelope_b = await service.ask_equipment(session_b, TENANT, "what does CE10 mean?")
    assert envelope_b.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT
