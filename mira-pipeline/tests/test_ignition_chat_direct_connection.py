"""Phase-6: the Ignition cloud-chat endpoint marks turns as direct-connection.

An Ignition turn arriving with an asset identifier is UNS-certified by
construction, so ignition_chat must pass ``uns_source="direct_connection"`` to
``engine.process`` (the engine then stamps state["uns_context"]["source"], which
the decision trace records). A turn with no asset id stays a plain chat turn
(uns_source=None). See .claude/rules/direct-connection-uns-certified.md.

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
    monkeypatch.setattr(
        ignition_chat, "_verify_hmac", lambda headers, body, key: "t-1"
    )
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
            "asset_context": {"site": "lake_wales", "area": "conveyor_lab", "equipment": "gs10_vfd"},
        },
    )
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("uns_source") == "direct_connection"


def test_no_asset_id_is_plain_chat_turn(client):
    tc, engine = client
    resp = _post(tc, {"query": "what is a VFD?"})
    assert resp.status_code == 200
    # No asset identifier → not a direct connection; chat gate territory.
    assert engine.process.await_args.kwargs.get("uns_source") is None
