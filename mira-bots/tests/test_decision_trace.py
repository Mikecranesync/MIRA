"""Tests for the Phase-9 decision-trace writer + its engine wiring.

Two layers:
  - Pure unit tests on decision_trace.build_trace_row / citations_present_in /
    write_trace fail-open (no live NeonDB needed).
  - An engine-integration test that a real Supervisor.process() SCHEDULES a
    trace with the turn's data, and that a trace-write failure never blocks or
    fails the user reply.

Covered (PLAN.md P9):
  - engine response generates a trace record
  - trace includes tag evidence when available
  - trace includes RAG citations when present
  - failed trace write doesn't block the response
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.decision_trace import (  # noqa: E402
    build_trace_row,
    citations_present_in,
    write_trace,
)


# ── citations_present_in ─────────────────────────────────────────────────────


def test_citations_present_detected():
    assert citations_present_in("Replace the fuse. [Source: PowerFlex 525 manual p.42]")
    assert citations_present_in("[source: x]")  # case-insensitive


def test_citations_absent():
    assert not citations_present_in("Just check the wiring.")
    assert not citations_present_in("")
    assert not citations_present_in(None)


# ── build_trace_row ──────────────────────────────────────────────────────────


def test_build_row_pulls_uns_context():
    row = build_trace_row(
        tenant_id="t-1",
        user_question="why is CV-101 stopped?",
        recommendation="Check the VFD. [Source: GS10 manual p.7]",
        platform="ignition",
        uns_context={
            "uns_path": "enterprise.home_garage.site.lake_wales.area.conveyor_lab"
            ".line.line_1.equipment.conveyor_1",
            "source": "direct_connection",
            "confidence": 0.9,
        },
    )
    assert row["tenant_id"] == "t-1"
    assert row["platform"] == "ignition"
    assert row["uns_path"].startswith("enterprise.")
    assert row["citations_present"] is True
    assert row["_uns_source"] == "direct_connection"
    assert row["_uns_confidence"] == 0.9


def test_build_row_includes_tag_evidence_when_available():
    tag_ev = [{"tag_path": "Motor_Current_A", "value": "11.2", "event_id": "e9"}]
    row = build_trace_row(
        tenant_id="t-1",
        user_question="q",
        recommendation="r",
        tag_evidence=tag_ev,
    )
    import json

    assert json.loads(row["tag_evidence"]) == tag_ev


def test_build_row_shapes_manual_evidence_from_sources():
    import json

    row = build_trace_row(
        tenant_id="t-1",
        user_question="q",
        recommendation="r [Source: doc]",
        manual_sources=["Register 8192 is the command word.", "Reg 8193 = freq ref."],
    )
    manual = json.loads(row["manual_evidence"])
    assert len(manual) == 2
    assert "excerpt" in manual[0]
    assert row["citations_present"] is True


def test_build_row_no_tag_or_kg_evidence_defaults_empty():
    import json

    row = build_trace_row(tenant_id="t-1", user_question="q", recommendation="r")
    assert json.loads(row["tag_evidence"]) == []
    assert json.loads(row["kg_evidence"]) == []
    assert json.loads(row["manual_evidence"]) == []
    assert row["citations_present"] is False


def test_build_row_sanitizes_pii():
    # An IP in the question should be scrubbed by the sanitizer.
    row = build_trace_row(
        tenant_id="t-1",
        user_question="the PLC at 192.168.1.100 is faulted",
        recommendation="ping it",
    )
    assert "192.168.1.100" not in row["user_question"]


# ── write_trace fail-open ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_write_trace_noop_without_db(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    # No DB configured → silent no-op, never raises.
    await write_trace(tenant_id="t-1", user_question="q", recommendation="r")


@pytest.mark.asyncio
async def test_write_trace_failopen_on_insert_error(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://stub/db")

    async def boom(_row):
        raise RuntimeError("neon down")

    with patch("shared.decision_trace._insert", new=boom):
        # Must swallow the error — never raises to the caller.
        await write_trace(tenant_id="t-1", user_question="q", recommendation="r")


# ── engine integration: process() schedules a trace, never blocks ────────────


@pytest.mark.asyncio
async def test_engine_process_schedules_trace(tmp_db):
    import asyncio

    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="default_t",
    )

    recorded = {}

    async def fake_write_trace(**kwargs):
        recorded.update(kwargs)

    with (
        patch.object(
            sup, "process_full", new=AsyncMock(return_value={"reply": "Check the VFD."})
        ),
        patch("shared.decision_trace.write_trace", new=fake_write_trace),
    ):
        reply = await sup.process(chat_id="c1", message="why stopped?", tenant_id="per_call_t")
        # Let the fire-and-forget task run.
        await asyncio.sleep(0)
        await asyncio.gather(*list(sup._decision_trace_tasks), return_exceptions=True)

    assert reply == "Check the VFD."
    assert recorded.get("tenant_id") == "per_call_t"
    assert recorded.get("user_question") == "why stopped?"
    assert recorded.get("recommendation") == "Check the VFD."


@pytest.mark.asyncio
async def test_engine_process_forwards_tag_evidence(tmp_db):
    import asyncio

    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=tmp_db, openwebui_url="http://stub", api_key="", collection_id="", tenant_id="t"
    )
    recorded = {}

    async def fake_write_trace(**kwargs):
        recorded.update(kwargs)

    tags = [{"tag_path": "Motor_Current_A", "value": "11.2", "quality": "good"}]
    with (
        patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})),
        patch("shared.decision_trace.write_trace", new=fake_write_trace),
    ):
        await sup.process(chat_id="c1", message="q", tag_evidence=tags)
        await asyncio.gather(*list(sup._decision_trace_tasks), return_exceptions=True)

    assert recorded.get("tag_evidence") == tags


# ── direct_connection gate carve-out (P6 honored at the chat gate) ───────────


def test_gate_suppressed_for_direct_connection(tmp_db):
    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=tmp_db, openwebui_url="http://stub", api_key="", collection_id="", tenant_id="t"
    )
    # A diagnose turn with NO asset that WOULD normally fire the gate...
    chat_state = {"state": "IDLE", "asset_identified": "", "context": {}}
    assert sup._should_fire_uns_gate("diagnose_equipment", chat_state, "conveyor down", {}) is True

    # ...does NOT fire once the connection certified the UNS path.
    direct_state = {
        "state": "IDLE",
        "asset_identified": "",
        "context": {"uns_context": {"source": "direct_connection"}},
    }
    assert sup._should_fire_uns_gate("diagnose_equipment", direct_state, "conveyor down", {}) is False


@pytest.mark.asyncio
async def test_engine_reply_survives_trace_failure(tmp_db):
    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="default_t",
    )

    def explode(**kwargs):
        raise RuntimeError("scheduling blew up")

    with (
        patch.object(
            sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})
        ),
        patch("shared.decision_trace.write_trace", new=explode),
    ):
        # Even though trace scheduling raises, the reply must come through.
        reply = await sup.process(chat_id="c1", message="hi")

    assert reply == "ok"
