"""Tests for the gated live-tag snapshot wiring in Supervisor.process().

The safety-critical property: live machine data is attached to the message ONLY
after the UNS confirmation gate has passed (pre-turn FSM state is an active
diagnostic state AND an asset is confirmed). Before the gate, live data is
withheld so it can never drive a troubleshooting answer ahead of confirmation.

We monkeypatch ``_load_state`` (so no DB schema is needed) and patch
``process_full`` (so no LLM/network is needed), then assert what message
``process_full`` actually received.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

LIVE_TAGS = {"vfd_fault_code": 58, "vfd_comm_ok": True, "DI_02": True}


def _engine(tmp_db):
    from shared.engine import Supervisor

    return Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="t",
    )


def _confirmed_state():
    return {
        "state": "DIAGNOSIS",
        "asset_identified": "AutomationDirect GS10",
        "context": {"uns_context": {"uns_path": "enterprise.garage.line1.conveyor1"}},
    }


def _idle_state():
    return {"state": "IDLE", "asset_identified": None, "context": {}}


@pytest.mark.asyncio
async def test_snapshot_injected_after_gate(tmp_db):
    sup = _engine(tmp_db)
    sup._load_state = lambda chat_id: _confirmed_state()
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})) as pf:
        await sup.process("c1", "why won't it start?", live_tags=LIVE_TAGS)
    sent = pf.call_args[0][1]  # process_full(chat_id, message, photo_b64)
    # The engine now attaches the structured Live Machine Evidence section
    # (decoded values + assessment + separation instruction).
    assert sent.startswith("## Live Machine Evidence")
    assert "CE10 modbus timeout" in sent  # decoded fault label preserved
    assert "Assessment:" in sent
    assert "why won't it start?" in sent  # original question preserved


@pytest.mark.asyncio
async def test_snapshot_withheld_before_gate(tmp_db):
    sup = _engine(tmp_db)
    sup._load_state = lambda chat_id: _idle_state()
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})) as pf:
        await sup.process("c1", "why won't it start?", live_tags=LIVE_TAGS)
    sent = pf.call_args[0][1]
    assert "Live Machine Evidence" not in sent
    assert sent == "why won't it start?"  # message untouched before the gate


@pytest.mark.asyncio
async def test_no_live_tags_is_backward_compatible(tmp_db):
    sup = _engine(tmp_db)
    # _load_state must not even be needed when live_tags is omitted.
    sup._load_state = lambda chat_id: (_ for _ in ()).throw(AssertionError("should not load state"))
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})) as pf:
        result = await sup.process("c1", "hello")
    assert pf.call_args[0][1] == "hello"
    assert result == "ok"


@pytest.mark.asyncio
async def test_snapshot_failure_is_best_effort(tmp_db):
    sup = _engine(tmp_db)

    def _boom(chat_id):
        raise RuntimeError("state load failed")

    sup._load_state = _boom
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})) as pf:
        result = await sup.process("c1", "why won't it start?", live_tags=LIVE_TAGS)
    # A snapshot bug must never break chat: message passes through unchanged.
    assert pf.call_args[0][1] == "why won't it start?"
    assert result == "ok"


@pytest.mark.asyncio
async def test_stale_marker_when_comm_lost(tmp_db):
    sup = _engine(tmp_db)
    sup._load_state = lambda chat_id: _confirmed_state()
    tags = {"vfd_comm_ok": False, "vfd_frequency": 6000}
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})) as pf:
        await sup.process("c1", "status?", live_tags=tags)
    sent = pf.call_args[0][1]
    assert "[STALE]" in sent
    assert "VFD comms LOST" in sent
