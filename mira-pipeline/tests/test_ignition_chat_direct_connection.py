"""Phase-6: the Ignition cloud-chat endpoint marks turns as direct-connection.

An Ignition turn arriving with an asset identifier is UNS-certified by
construction, so ignition_chat must pass ``uns_source="direct_connection"`` to
``engine.process`` (the engine then stamps state["uns_context"]["source"], which
the decision trace records).

Phase 6 reject-on-missing-identifier contract: a turn with NO asset identifier
is REJECTED (422 ``{"error":"uns_required"}``) when it's asset-specific
troubleshooting — the connection is the gate; a direct surface must not downgrade
to a chat-gate. General/educational questions carry no asset and are answered as
a plain chat turn (uns_source=None). The intent classifier fails open (→ plain
chat) so a blip never bricks the HMI. See
.claude/rules/direct-connection-uns-certified.md.

The engine is a recording mock — we assert on the kwargs ignition_chat forwards,
not on engine behaviour. HMAC is bypassed by monkeypatching the verifier so the
test stays focused on the provenance wiring.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import ignition_chat


@pytest.fixture
def recording_engine():
    engine = AsyncMock()
    engine.process = AsyncMock(return_value="Check VFD fault code F0004.")
    return engine


@pytest.fixture
def client(monkeypatch, recording_engine):
    # Bypass HMAC: pretend every request authenticates as tenant "t-1".
    monkeypatch.setattr(ignition_chat, "MIRA_IGNITION_HMAC_KEY", "test-key")
    monkeypatch.setattr(ignition_chat, "_verify_hmac", lambda headers, body, key: "t-1")
    app = FastAPI()
    app.include_router(ignition_chat.build_router(lambda: recording_engine))
    return TestClient(app, raise_server_exceptions=False), recording_engine


def _post(tc, payload: dict):
    return tc.post(
        "/api/v1/ignition/chat",
        content=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )


def test_asset_id_marks_direct_connection(client):
    tc, engine = client
    resp = _post(tc, {"query": "why did the conveyor stop?", "asset_id": "[default]Conv/State"})
    assert resp.status_code == 200
    engine.process.assert_awaited_once()
    assert engine.process.await_args.kwargs.get("uns_source") == "direct_connection"
    assert engine.process.await_args.kwargs.get("platform") == "ignition"


def test_asset_context_marks_direct_connection(client):
    tc, engine = client
    resp = _post(
        tc,
        {
            "query": "is the drive faulted?",
            "asset_context": {
                "site": "lake_wales",
                "area": "conveyor_lab",
                "equipment": "gs10_vfd",
            },
        },
    )
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("uns_source") == "direct_connection"


def test_no_asset_id_general_question_is_plain_chat(client, monkeypatch):
    """A general/educational question with no asset id is NOT rejected — the
    direct-connection rule carves out general questions on any surface."""
    tc, engine = client
    # Classifier says this is not asset-specific troubleshooting.
    monkeypatch.setattr(
        ignition_chat,
        "_route_intent",
        AsyncMock(return_value={"intent": "find_documentation"}),
    )
    resp = _post(tc, {"query": "what is a VFD?"})
    assert resp.status_code == 200
    engine.process.assert_awaited_once()
    assert engine.process.await_args.kwargs.get("uns_source") is None


def test_no_asset_id_asset_specific_is_rejected_422(client, monkeypatch):
    """An asset-specific troubleshooting turn with NO UNS identifier is REJECTED
    (422 uns_required) — NOT downgraded to a chat-gate. The connection is the
    gate; a direct surface that can't say which machine must reject."""
    tc, engine = client
    monkeypatch.setattr(
        ignition_chat,
        "_route_intent",
        AsyncMock(return_value={"intent": "diagnose_equipment"}),
    )
    resp = _post(tc, {"query": "why did the conveyor stop?"})
    assert resp.status_code == 422
    assert resp.json() == {"error": "uns_required"}
    engine.process.assert_not_awaited()  # rejected before reaching the engine


def test_no_asset_id_classifier_failure_fails_open(client, monkeypatch):
    """If the intent classifier errors, fail OPEN to a plain chat turn (200) —
    a Neon/LLM blip must never brick the HMI by rejecting good turns."""
    tc, engine = client
    monkeypatch.setattr(
        ignition_chat, "_route_intent", AsyncMock(side_effect=RuntimeError("router down"))
    )
    resp = _post(tc, {"query": "why did the conveyor stop?"})
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("uns_source") is None


def test_no_asset_id_classifier_unavailable_fails_open(client, monkeypatch):
    """If shared/ isn't mounted (_route_intent is None), fail open to plain chat."""
    tc, engine = client
    monkeypatch.setattr(ignition_chat, "_route_intent", None)
    resp = _post(tc, {"query": "why did the conveyor stop?"})
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("uns_source") is None


def test_tag_snapshot_forwarded_as_tag_evidence(client):
    tc, engine = client
    resp = _post(
        tc,
        {
            "query": "is the motor overloaded?",
            "asset_id": "[default]Conv/State",
            "tag_snapshot": {"Motor_Current_A": {"value": 11.2, "quality": "good"}},
        },
    )
    assert resp.status_code == 200
    ev = engine.process.await_args.kwargs.get("tag_evidence")
    assert ev and ev[0]["tag_path"] == "Motor_Current_A"
    assert ev[0]["value"] == 11.2 and ev[0]["quality"] == "good"


def test_no_tag_snapshot_means_no_tag_evidence(client):
    tc, engine = client
    resp = _post(tc, {"query": "status?", "asset_id": "[default]Conv/State"})
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("tag_evidence") is None


def test_tag_preamble_enriched_with_verified_entities(client, monkeypatch):
    """Verified tag_entities metadata (units, data_type) appears in the prompt preamble.

    _enrich_tag_snapshot_with_semantics is mocked so no live DB is required.
    This verifies the handler wires enrichment before _format_tag_preamble, and
    that _format_tag_preamble renders the merged fields.

    Join-key contract (enforced by Phase 1's tag_classifier): source_address in
    tag_entities must store the same path string that tag_snapshot uses as its key.
    """
    tc, engine = client

    async def _mock_enrich(tag_snapshot, tenant_id):
        return {
            k: ({**v, "units": "A", "data_type": "REAL"} if isinstance(v, dict) else v)
            for k, v in tag_snapshot.items()
        }

    monkeypatch.setattr(ignition_chat, "_enrich_tag_snapshot_with_semantics", _mock_enrich)

    resp = _post(
        tc,
        {
            "query": "is the motor overloaded?",
            "asset_id": "[default]Conv/State",
            "tag_snapshot": {"Motor_Current_A": {"value": 11.2, "quality": "good"}},
        },
    )
    assert resp.status_code == 200
    message = engine.process.await_args.kwargs.get("message", "")
    assert "11.2 A" in message
    assert "REAL" in message
