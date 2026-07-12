"""Real-Postgres tenant-isolation proof for Phase 2 (ADR-0027) equipment
observations -- the ONE Phase 2 test that is not hermetic by nature, since
RLS enforcement can only be proven against a real Postgres, not asserted in
Python (same rationale as test_visual_session_migration.py's Phase 1 gate).

Reuses (imports, per the Phase 2 spec's "import or mirror it") the Phase 1
ephemeral-postgres harness from test_visual_session_migration.py: the
``pg_container`` / ``app_role_url`` fixtures and the Docker-availability
skipif. No new migration exists for Phase 2 -- this drives the REAL
VisualSessionStore + VisualSessionService against migration 063 (unchanged),
proving equipment/nameplate observations get the SAME RLS tenant isolation
Phase 1 already proved for print/OCR observations.

Skips cleanly (never fails the suite) when Docker is unavailable, exactly
like the Phase 1 test it imports from.
"""

from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import pytest  # noqa: E402

from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.session_service import VisualSessionService  # noqa: E402
from shared.visual.store import VisualSessionStore  # noqa: E402

# Import (not duplicate) the Phase 1 harness: pg_container / app_role_url
# fixtures and the module-level Docker skipif. Both test files live in the
# same directory with no package __init__.py, so pytest's default import
# mode puts this directory on sys.path and a plain top-level import resolves
# the sibling module -- verified by running this file directly (see PR body).
from test_visual_session_migration import (  # noqa: E402
    _docker_available,
    app_role_url,  # noqa: F401 -- re-exported as a fixture via this import
    pg_container,  # noqa: F401 -- re-exported as a fixture via this import
)

_SKIP_REASON = "Docker not installed/reachable -- skipping the ephemeral-Postgres equipment test"
pytestmark = pytest.mark.skipif(not _docker_available(), reason=_SKIP_REASON)


class _FakeVision:
    def __init__(self, classification: dict):
        self._classification = classification

    async def process(self, photo_b64: str, message: str) -> dict:
        return dict(self._classification)


class _FakeNameplateWorker:
    def __init__(self, fields: dict):
        self._fields = fields

    async def extract(self, photo_b64: str) -> dict:
        return dict(self._fields)


_NAMEPLATE_CLASSIFICATION = {
    "classification": "NAMEPLATE",
    "classification_confidence": 0.9,
    "vision_result": "A drive nameplate.",
    "ocr_items": ["AutomationDirect", "GS11N-10P2"],
    "tesseract_text": "",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
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
    "raw_text": "AutomationDirect GS11N-10P2 serial AD2026-00042",
}


def _sharp_image_bytes() -> bytes:
    import io

    from PIL import Image, ImageDraw

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


@pytest.mark.asyncio
async def test_tenant_a_equipment_observations_round_trip_through_real_postgres(
    app_role_url,  # noqa: F811 -- pytest fixture param; ruff doesn't know it isn't the import
    monkeypatch,
):
    """Positive control (debugging-conventions.md: a missing result against an
    unverified path is inconclusive) -- tenant A's own nameplate ingest must
    round-trip correctly BEFORE the negative (isolation) assertions mean
    anything."""
    monkeypatch.setenv("NEON_DATABASE_URL", app_role_url)
    service = VisualSessionService(store=VisualSessionStore())
    tenant_a = str(uuid.uuid4())

    session_id = await service.create_session(tenant_a, title="tenant A equipment session")
    assert session_id is not None

    result = await service.ingest_image(
        session_id,
        tenant_a,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )
    assert result.status == "ok"
    assert result.equipment_resolution is not None
    assert result.equipment_resolution.status == "RESOLVED"
    assert result.equipment_resolution.pack_id == "durapulse_gs10"

    observations = await service.store.load_observations(session_id, tenant_a)
    identity_obs = [o for o in observations if o.extractor == "equipment_resolver"]
    assert len(identity_obs) == 1
    assert identity_obs[0].evidence_state == EvidenceState.DOCUMENTED

    field_obs = [o for o in observations if o.extractor == "nameplate_worker"]
    assert field_obs, "nameplate field observations must have persisted for tenant A"

    envelope = await service.ask_equipment(
        session_id, tenant_a, "what does CE10 mean?", retriever=lambda q, t, m: []
    )
    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented


@pytest.mark.asyncio
async def test_tenant_b_sees_zero_of_tenant_as_equipment_observations(
    app_role_url,  # noqa: F811 -- pytest fixture param; ruff doesn't know it isn't the import
    monkeypatch,
):
    """The hard gate for Phase 2: RLS-enforced tenant isolation on equipment/
    nameplate observations specifically (Phase 1's own migration test already
    proves this generically for the observation table; this proves it holds
    for the NEW extractor="nameplate_worker"/"equipment_resolver" rows this
    phase writes, driven through the real VisualSessionService, not a raw
    store call)."""
    monkeypatch.setenv("NEON_DATABASE_URL", app_role_url)
    service = VisualSessionService(store=VisualSessionStore())
    tenant_a, tenant_b = str(uuid.uuid4()), str(uuid.uuid4())

    session_id = await service.create_session(tenant_a, title="tenant A private equipment session")
    assert session_id is not None

    result = await service.ingest_image(
        session_id,
        tenant_a,
        _sharp_image_bytes(),
        vision=_FakeVision(_NAMEPLATE_CLASSIFICATION),
        nameplate_worker=_FakeNameplateWorker(_GS11_NAMEPLATE_FIELDS),
    )
    assert result.status == "ok"
    assert result.equipment_resolution.status == "RESOLVED"

    # Positive control first.
    assert await service.store.get_session(session_id, tenant_a) is not None
    own_observations = await service.store.load_observations(session_id, tenant_a)
    assert any(o.extractor == "equipment_resolver" for o in own_observations)
    assert any(o.extractor == "nameplate_worker" for o in own_observations)

    # The hard gate: tenant B, given the EXACT session_id tenant A owns, sees
    # neither the session nor any of its equipment observations.
    assert await service.store.get_session(session_id, tenant_b) is None
    assert await service.store.load_observations(session_id, tenant_b) == []

    tenant_b_envelope = await service.ask_equipment(
        session_id, tenant_b, "what does CE10 mean?", retriever=lambda q, t, m: []
    )
    assert tenant_b_envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    documented = [
        c for c in tenant_b_envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED
    ]
    assert not documented, (
        "tenant B must never see a DOCUMENTED claim sourced from tenant A's drive"
    )
