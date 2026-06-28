"""HubV3 Phase 6 — Telegram thin evidence client → Hub import pipeline.

Gating test = PRD §6 test 9: a Telegram/photo source enters the SAME
contextualization import pipeline as an offline/direct upload, and lands
``proposed``.

Scope is the CLIENT half (the Hub endpoint accepting the JSON contract is
Phase 2 — not exercised here). These tests assert that the shared
envelope-builder produces the canonical §2 intake contract and that the
Telegram submit path POSTs it to the Hub import endpoint (not mira-ingest),
with raw bytes carried and PII scrubbed from free text.
"""

from __future__ import annotations

import hashlib
import json

from shared import contextualization_intake as ci

# §2 "Shared Contextualization Intake Contract" — required envelope keys.
_REQUIRED_KEYS = {
    "project_hint",
    "asset_hints",
    "source_metadata",
    "source_sha256",
    "evidence",
    "entities",
    "proposed_uns",
    "proposed_i3x",
    "proposed_faults",
    "proposed_parameters",
    "proposed_signals",
    "proposed_relationships",
    "provenance",
    "confidence",
    "review_status",
    "ingest_route",
}


def _build_telegram_photo_envelope() -> tuple[dict, bytes]:
    raw = b"\xff\xd8\xff telegram nameplate jpeg; ctrl at 10.1.2.3"
    env = ci.build_intake_envelope(
        raw_bytes=raw,
        filename="photo.jpg",
        mime="image/jpeg",
        uploader="789",  # numeric Telegram id (pseudonymous), not a name
        captured_at="2026-06-20T12:00:00+00:00",
        caption="conveyor-1 nameplate controller at 10.1.2.3",
        location=None,
        project_hint="garage-demo",
        asset_hints={
            "name": "conveyor-1",
            "serial": "SN-ABC123456",
            "controller_ip": "10.1.2.3",
        },
        ingest_route=ci.INGEST_ROUTE_TELEGRAM,
        review_status="approved",  # a caller MUST NOT be able to self-approve
    )
    return env, raw


def test_envelope_has_full_section2_contract_shape():
    env, _ = _build_telegram_photo_envelope()
    assert set(env) == _REQUIRED_KEYS, "envelope must match §2 contract exactly"
    sm = env["source_metadata"]
    for field in ("filename", "mime", "size", "captured_at", "uploader", "location"):
        assert field in sm, f"source_metadata missing {field}"


def test_source_sha256_is_content_fingerprint():
    env, raw = _build_telegram_photo_envelope()
    assert env["source_sha256"] == hashlib.sha256(raw).hexdigest()


def test_review_status_forced_proposed_even_when_caller_overrides():
    env, _ = _build_telegram_photo_envelope()
    # Caller passed review_status="approved"; Telegram owns NO truth.
    assert env["review_status"] == "proposed"


def test_ingest_route_is_telegram():
    env, _ = _build_telegram_photo_envelope()
    assert env["ingest_route"] == "telegram"


def test_client_owns_no_truth_domain_proposals_empty():
    env, _ = _build_telegram_photo_envelope()
    for key in (
        "proposed_uns",
        "proposed_i3x",
        "proposed_faults",
        "proposed_parameters",
        "proposed_signals",
        "proposed_relationships",
        "entities",
    ):
        assert env[key] == [], f"{key} must be empty — client collects evidence only"


def test_free_text_pii_scrubbed_but_asset_hints_preserved():
    env, _ = _build_telegram_photo_envelope()
    evidence_text = " ".join(b.get("text", "") for b in env["evidence"])
    # Free-text evidence is PII-scrubbed (security-boundaries.md).
    assert "10.1.2.3" not in evidence_text
    assert "[IP]" in evidence_text
    # But structured asset hints are deliberate matching evidence — preserved.
    assert env["asset_hints"]["controller_ip"] == "10.1.2.3"
    assert env["asset_hints"]["serial"] == "SN-ABC123456"


def test_uploader_is_pseudonymous_id_not_a_name():
    env, _ = _build_telegram_photo_envelope()
    assert env["source_metadata"]["uploader"] == "789"


async def test_telegram_source_enters_same_import_pipeline_as_offline(monkeypatch):
    """PRD §6 test 9 (gating).

    The Telegram-built envelope is the canonical §2 intake contract and is
    POSTed to the Hub import endpoint — the same pipeline an offline/direct
    upload uses — carrying the raw bytes, landing ``proposed``.
    """
    env, raw = _build_telegram_photo_envelope()

    seen: dict = {}

    class _Resp:
        status_code = 201

        def json(self):  # pragma: no cover - not asserted
            return {"ok": True}

        @property
        def text(self):  # pragma: no cover
            return ""

    class _Client:
        def __init__(self, *a, **k):
            seen["client_kwargs"] = k

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kwargs):
            seen["url"] = url
            seen["kwargs"] = kwargs
            return _Resp()

    monkeypatch.setattr(ci.httpx, "AsyncClient", _Client)

    ok = await ci.submit_intake_to_hub(
        env,
        raw_bytes=raw,
        filename="photo.jpg",
        mime="image/jpeg",
        tenant_id="11111111-2222-3333-4444-555555555555",
        hub_url="https://hub.example.com",
        token="svc-token",
    )

    assert ok is True
    # Routed to the Hub import pipeline — NOT mira-ingest.
    assert "/api/contextualization/import" in seen["url"]
    assert "/ingest/" not in seen["url"]
    assert seen["url"].startswith("https://hub.example.com")

    # Multipart: the §2 contract travels as JSON; raw bytes travel as `file`.
    data = seen["kwargs"]["data"]
    files = seen["kwargs"]["files"]
    posted = json.loads(data["contract"])
    assert posted["ingest_route"] == "telegram"
    assert posted["review_status"] == "proposed"
    assert posted["source_sha256"] == hashlib.sha256(raw).hexdigest()
    assert files["file"][1] == raw  # bytes are carried, not dropped
    # Tenant scoping travels at transport level.
    assert data["tenant_id"] == "11111111-2222-3333-4444-555555555555"
    # Forward-looking service-token auth (Phase-2 server support).
    headers = seen["kwargs"].get("headers", {})
    assert headers.get("Authorization") == "Bearer svc-token"


async def test_submit_never_raises_on_transport_error(monkeypatch):
    """Background-safe: a failing Hub POST must not break the chat reply."""
    env, raw = _build_telegram_photo_envelope()

    class _BoomClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            raise RuntimeError("network down")

    monkeypatch.setattr(ci.httpx, "AsyncClient", _BoomClient)

    ok = await ci.submit_intake_to_hub(
        env,
        raw_bytes=raw,
        filename="photo.jpg",
        mime="image/jpeg",
        tenant_id="t",
        hub_url="https://hub.example.com",
    )
    assert ok is False  # swallowed, reported as failure, not raised
