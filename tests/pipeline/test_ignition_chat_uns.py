"""Direct-connection UNS contract on the Ignition endpoint (offline).

Rule (.claude/rules/direct-connection-uns-certified.md):
  * a turn WITH an asset identifier is UNS-certified by construction —
    the engine gets uns_source="direct_connection", no chat-gate question;
  * an asset-specific turn WITHOUT any identifier is REJECTED with
    422 {"error": "uns_required"} — never downgraded to a chat-gate;
  * general/educational questions pass through with no gate on any surface.

Engine is a recording mock; HMAC is bypassed the same way as the existing
mira-pipeline/tests/test_ignition_chat_*.py suites. No Neon, no LLM.
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
    engine.process = AsyncMock(return_value="Check VFD fault F0004 [manual p.42].")
    return engine


@pytest.fixture
def ignition_client(monkeypatch, recording_engine):
    monkeypatch.setattr(ignition_chat, "MIRA_IGNITION_HMAC_KEY", "test-key")
    monkeypatch.setattr(ignition_chat, "_verify_hmac", lambda headers, body, key: "tenant-1")
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.delenv("ENFORCE_ASSET_AGENT_GATE", raising=False)
    app = FastAPI()
    app.include_router(ignition_chat.build_router(lambda: recording_engine))
    return TestClient(app, raise_server_exceptions=False)


def _post(client, payload: dict):
    return client.post(
        "/api/v1/ignition/chat",
        content=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )


def _classifier(intent: str):
    async def _route(question, history):
        return {"intent": intent}

    return _route


def test_asset_specific_turn_without_uns_identifier_is_rejected_422(
    ignition_client, recording_engine, monkeypatch
):
    """No asset_id, no asset_context, troubleshooting intent → uns_required."""
    monkeypatch.setattr(ignition_chat, "_route_intent", _classifier("diagnose_equipment"))
    resp = _post(ignition_client, {"question": "why is the conveyor stopped?"})
    assert resp.status_code == 422
    assert resp.json() == {"error": "uns_required"}
    recording_engine.process.assert_not_awaited()


def test_general_question_without_identifier_passes(ignition_client, recording_engine, monkeypatch):
    """Educational questions need no gate on any surface — not rejected."""
    monkeypatch.setattr(ignition_chat, "_route_intent", _classifier("greeting"))
    resp = _post(ignition_client, {"question": "what is a VFD?"})
    assert resp.status_code == 200
    kwargs = recording_engine.process.await_args.kwargs
    assert kwargs["uns_source"] is None  # plain chat turn, no false certification


def test_turn_with_asset_id_is_uns_certified_direct_connection(
    ignition_client, recording_engine, monkeypatch
):
    """An asset identifier certifies the UNS path — engine skips the chat-gate."""

    # Classifier must NOT be consulted when an identifier is present.
    async def _explodes(question, history):
        raise AssertionError("classifier must not run for identified turns")

    monkeypatch.setattr(ignition_chat, "_route_intent", _explodes)
    resp = _post(
        ignition_client,
        {
            "question": "why is this conveyor stopped?",
            "asset_id": "cv_101",
            "tag_snapshot": {"[default]Conv/State": {"value": "FAULT", "quality": "Good"}},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == "Check VFD fault F0004 [manual p.42]."
    assert body["tenant_id"] == "tenant-1"
    assert body["asset_id"] == "cv_101"
    assert "latency_ms" in body

    kwargs = recording_engine.process.await_args.kwargs
    assert kwargs["uns_source"] == "direct_connection"
    assert kwargs["platform"] == "ignition"
    # per-asset FSM isolation: chat_id keys on (tenant, asset)
    assert kwargs["chat_id"] == "ignition:tenant-1:cv_101"
    # live tag snapshot surfaced as structured evidence rows
    assert kwargs["tag_evidence"] == [
        {
            "tag_path": "[default]Conv/State",
            "value": "FAULT",
            "quality": "Good",
            "source": "ignition",
        }
    ]


def test_classifier_failure_fails_open_to_plain_chat(
    ignition_client, recording_engine, monkeypatch
):
    """A classifier blip must never brick the HMI — turn passes as general chat."""

    async def _blip(question, history):
        raise RuntimeError("neon down")

    monkeypatch.setattr(ignition_chat, "_route_intent", _blip)
    resp = _post(ignition_client, {"question": "why is the conveyor stopped?"})
    assert resp.status_code == 200
    recording_engine.process.assert_awaited_once()


def test_missing_question_is_400(ignition_client, recording_engine):
    resp = _post(ignition_client, {"asset_id": "cv_101"})
    assert resp.status_code == 400
    recording_engine.process.assert_not_awaited()
