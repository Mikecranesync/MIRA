"""Read-only HTTP API: latest-diagnosis snapshot + auth.

The chat engine pulls GET /current_fault to inject live equipment status into
its prompt (see mira-bots Supervisor._build_live_data_context).
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

import engine


def _req(auth: str | None = None) -> SimpleNamespace:
    headers = {"Authorization": auth} if auth is not None else {}
    return SimpleNamespace(headers=headers)


def test_diagnosis_dict_ok_when_no_fault():
    d = engine._diagnosis_dict(None)
    assert d["fault"] == "ok"
    assert d["confidence"] == 1.0
    assert d["affected_components"] == []


@pytest.mark.asyncio
async def test_current_fault_serves_latest_snapshot(monkeypatch):
    monkeypatch.setattr(engine, "HTTP_TOKEN", "")  # no auth required
    monkeypatch.setattr(
        engine,
        "_LATEST_DIAGNOSIS",
        {
            "fault": "photoeye_blocked",
            "confidence": 0.82,
            "evidence": [],
            "affected_components": ["PE-101"],
            "recommended_first_check": "Inspect PE-101 lens",
            "safety_note": "",
            "ts": 123.0,
        },
    )
    resp = await engine._http_current_fault(_req())
    assert resp.status == 200
    body = json.loads(resp.body)
    assert body["fault"] == "photoeye_blocked"
    assert body["asset_prefix"] == engine.UNS_PREFIX
    assert body["affected_components"] == ["PE-101"]


@pytest.mark.asyncio
async def test_current_fault_requires_token_when_configured(monkeypatch):
    monkeypatch.setattr(engine, "HTTP_TOKEN", "s3cret")
    # missing / wrong token -> 401
    assert (await engine._http_current_fault(_req())).status == 401
    assert (await engine._http_current_fault(_req("Bearer nope"))).status == 401
    # correct token -> 200
    assert (await engine._http_current_fault(_req("Bearer s3cret"))).status == 200
