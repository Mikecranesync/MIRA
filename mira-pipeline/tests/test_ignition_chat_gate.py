"""Train-before-deploy: the Ignition endpoint's asset-agent deployment gate.

When ENFORCE_ASSET_AGENT_GATE is on, only an 'approved'/'deployed' asset gets
answered; anything else gets a clean refusal (no engine call). Default-off keeps
the existing behavior. DB-lookup errors fail OPEN (engine answers) so a Neon blip
can't brick a working HMI.

Spec: docs/specs/asset-agent-validation-spec.md §7 · rule: train-before-deploy.md.
Engine is a recording mock; HMAC is bypassed (same approach as
test_ignition_chat_direct_connection.py).
"""

from __future__ import annotations

import json
import os
import sys
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# In the checkout, shared/ lives in mira-bots/ (prod mounts it into the pipeline
# image at build time). Put it on the path so ignition_chat's defensive
# `from shared.asset_agent_transition import ...` resolves and the gate is live.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mira-bots"))

import ignition_chat  # noqa: E402


@pytest.fixture
def recording_engine():
    engine = AsyncMock()
    engine.process = AsyncMock(return_value="Check VFD fault code F0004.")
    return engine


@pytest.fixture
def make_client(monkeypatch, recording_engine):
    """Build a TestClient with HMAC bypassed and gate knobs injectable."""

    def _build(*, enforce: bool, auto_deploy: bool = False):
        monkeypatch.setattr(ignition_chat, "MIRA_IGNITION_HMAC_KEY", "test-key")
        monkeypatch.setattr(ignition_chat, "_verify_hmac", lambda headers, body, key: "t-1")
        monkeypatch.setattr(ignition_chat, "_enforce_asset_agent_gate", lambda: enforce)
        monkeypatch.setattr(ignition_chat, "_asset_agent_auto_deploy", lambda: auto_deploy)
        # never touch a real DB in these tests
        monkeypatch.setattr(ignition_chat, "_mark_deployed", lambda t, a: True)
        app = FastAPI()
        app.include_router(ignition_chat.build_router(lambda: recording_engine))
        return TestClient(app, raise_server_exceptions=False), recording_engine

    return _build


def _post(tc, payload: dict):
    return tc.post(
        "/api/v1/ignition/chat",
        content=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )


def _ask(tc, **extra):
    return _post(tc, {"query": "why did the conveyor stop?", "asset_id": "[default]Conv/State", **extra})


def test_gate_off_is_unchanged(make_client, monkeypatch):
    tc, engine = make_client(enforce=False)
    # lookup must never be called when the gate is off
    monkeypatch.setattr(ignition_chat, "_lookup_agent_state", AsyncMock(side_effect=AssertionError))
    resp = _ask(tc)
    assert resp.status_code == 200
    engine.process.assert_awaited_once()
    assert "gate" not in resp.json()


@pytest.mark.parametrize("state", ["deployed", "approved"])
def test_gate_on_allows_ready_states(make_client, monkeypatch, state):
    tc, engine = make_client(enforce=True)
    monkeypatch.setattr(ignition_chat, "_lookup_agent_state", lambda t, a: state)
    resp = _ask(tc)
    assert resp.status_code == 200
    engine.process.assert_awaited_once()
    assert resp.json()["answer"] == "Check VFD fault code F0004."


@pytest.mark.parametrize("state", ["draft", "training", "validating", "rejected", None])
def test_gate_on_refuses_not_ready(make_client, monkeypatch, state):
    tc, engine = make_client(enforce=True)
    monkeypatch.setattr(ignition_chat, "_lookup_agent_state", lambda t, a: state)
    resp = _ask(tc)
    assert resp.status_code == 200
    engine.process.assert_not_awaited()
    body = resp.json()
    assert body["gate"].startswith("not_ready:")
    assert body["answer"] == ignition_chat.GATE_REFUSAL_MESSAGE


def test_gate_on_approved_auto_deploys(make_client, monkeypatch):
    calls = []
    tc, engine = make_client(enforce=True, auto_deploy=True)
    monkeypatch.setattr(ignition_chat, "_lookup_agent_state", lambda t, a: "approved")
    monkeypatch.setattr(ignition_chat, "_mark_deployed", lambda t, a: calls.append((t, a)) or True)
    resp = _ask(tc)
    assert resp.status_code == 200
    engine.process.assert_awaited_once()
    assert calls == [("t-1", "[default]Conv/State")]


def test_gate_db_error_fails_open(make_client, monkeypatch):
    tc, engine = make_client(enforce=True)

    def _boom(t, a):
        raise RuntimeError("neon down")

    monkeypatch.setattr(ignition_chat, "_lookup_agent_state", _boom)
    resp = _ask(tc)
    assert resp.status_code == 200
    engine.process.assert_awaited_once()  # failed open → answered


def test_gate_on_no_asset_id_is_plain_chat(make_client, monkeypatch):
    tc, engine = make_client(enforce=True)
    monkeypatch.setattr(ignition_chat, "_lookup_agent_state", lambda t, a: (_ for _ in ()).throw(AssertionError))
    resp = _post(tc, {"query": "what is a VFD?"})  # no asset_id
    assert resp.status_code == 200
    engine.process.assert_awaited_once()  # gate only applies to asset-bound turns
