"""Tests for the lightweight structured agent-trace layer (agent_trace.py).

Proves a single AgentTrace captures, for one diagnostic turn:
  - the user question (PII-sanitised)
  - the asset / UNS context
  - the live PLC/VFD tag snapshot AND its freshness (quality + age)
  - the retrieved KB documents
  - the final answer
  - citations
  - the safety / refusal flag

Plus: JSON round-trip, both export sinks no-op by default (no DB, no cloud, no
running service), JSONL writes when a destination is given, and — per the
audit's honesty rule — a trace built from the *actual* engine-hook evidence
shape leaves the not-yet-wired fields explicitly empty (tool_calls,
groundedness_score, model_used) rather than faking coverage.
"""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.agent_trace import (  # noqa: E402
    AgentTrace,
    build_agent_trace,
    export_jsonl,
    export_otel,
)
from shared.live_snapshot import normalize as normalize_live_tags  # noqa: E402

# A representative confirmed UNS context (shape of state["context"]["uns_context"]).
UNS_CTX = {
    "uns_path": "enterprise.garage.demo_cell.cv_101",
    "source": "direct_connection",
    "confidence": "certified",
    "manufacturer": "Allen-Bradley",
    "model": "PowerFlex 525",
    "fault_code": "F0004",
}

# Raw live tags as the Ignition/relay/bench bridge sends them. vfd_comm_ok=False
# is the master trust gate → every other vfd_* reading is marked STALE.
RAW_TAGS = {
    "vfd_comm_ok": False,
    "vfd_frequency": 1234,
    "vfd_fault_code": 58,
}

SNAP_TS = "2026-06-11T10:00:00+00:00"
NOW_TS = "2026-06-11T10:00:30+00:00"  # 30s after the snapshot

REPLY_WITH_CITATION = (
    "Check the DC bus voltage. [Source: PowerFlex 525 User Manual p.4-12]"
)


def _snapshots():
    return normalize_live_tags(
        RAW_TAGS, UNS_CTX["uns_path"], source="ignition", ts=SNAP_TS
    )


def _full_trace():
    return build_agent_trace(
        user_question="why is conveyor CV-101 faulted? IP 10.0.0.5",
        final_answer=REPLY_WITH_CITATION,
        ts=NOW_TS,
        now=NOW_TS,
        trace_id="trace-abc",
        session_id="chat-1",
        tenant_id="tenant-1",
        platform="ignition",
        fsm_state="DIAGNOSIS",
        uns_context=UNS_CTX,
        live_snapshots=_snapshots(),
        manual_sources=["DC bus undervoltage indicates input power loss ..."],
        confidence="high",
        latency_ms=842,
    )


# --- Capture of the seven required fields ------------------------------------


def test_captures_user_question_sanitised():
    t = _full_trace()
    assert "conveyor CV-101" in t.user_question
    # PII (IPv4) is scrubbed by the shared sanitiser.
    assert "10.0.0.5" not in t.user_question
    assert "[IP]" in t.user_question


def test_captures_asset_context():
    t = _full_trace()
    assert t.asset["uns_path"] == "enterprise.garage.demo_cell.cv_101"
    assert t.asset["uns_source"] == "direct_connection"
    assert t.asset["uns_confidence"] == "certified"
    assert t.asset["model"] == "PowerFlex 525"


def test_captures_live_tag_snapshot_and_age():
    t = _full_trace()
    # The snapshot itself is captured...
    assert t.live_tag_count == 3
    assert t.live_tag_snapshot_ts == SNAP_TS
    # ...and its freshness is derived: now - snapshot_ts = 30s.
    assert t.live_tag_age_seconds == pytest.approx(30.0)
    # vfd_comm_ok=False marks the two vfd_* readings stale → worst quality stale.
    assert t.stale_tag_count == 2
    assert t.live_tag_quality == "stale"


def test_age_is_none_when_no_snapshot():
    t = build_agent_trace(
        user_question="q", final_answer="a", ts=NOW_TS, live_snapshots=None
    )
    assert t.live_tag_count == 0
    assert t.live_tag_age_seconds is None
    assert t.live_tag_quality is None


def test_captures_retrieved_documents():
    t = _full_trace()
    assert len(t.retrieved_documents) == 1
    assert "excerpt" in t.retrieved_documents[0]


def test_captures_final_answer():
    t = _full_trace()
    assert t.final_answer.startswith("Check the DC bus voltage.")


def test_captures_citations():
    t = _full_trace()
    assert t.citations_present is True
    assert t.citation_count == 1

    no_cite = build_agent_trace(
        user_question="q", final_answer="just turn it off and on", ts=NOW_TS
    )
    assert no_cite.citations_present is False
    assert no_cite.citation_count == 0


def test_captures_safety_refusal_flag():
    safe = build_agent_trace(
        user_question="there is smoke and arc flash",
        final_answer="STOP. De-energize and follow LOTO before continuing.",
        ts=NOW_TS,
        safety_triggered=True,
    )
    assert safe.safety_triggered is True
    # Default is False when the turn was not a safety stop.
    assert _full_trace().safety_triggered is False


# --- Serialisation -----------------------------------------------------------


def test_json_round_trip():
    t = _full_trace()
    blob = t.to_json()
    parsed = json.loads(blob)
    assert parsed["asset"]["uns_path"] == "enterprise.garage.demo_cell.cv_101"
    assert parsed["live_tag_age_seconds"] == pytest.approx(30.0)
    assert parsed["citation_count"] == 1
    # Re-hydrating the dataclass from the parsed dict yields an equal record.
    assert AgentTrace(**parsed).to_dict() == t.to_dict()


# --- Export sinks are OFF by default (no DB, no cloud, no running service) ----


def test_otel_export_noop_without_endpoint(monkeypatch):
    monkeypatch.delenv("MIRA_OTEL_ENDPOINT", raising=False)
    assert export_otel(_full_trace()) is False


def test_jsonl_export_noop_without_destination(monkeypatch):
    monkeypatch.delenv("MIRA_AGENT_TRACE_FILE", raising=False)
    assert export_jsonl(_full_trace()) is False


def test_jsonl_export_writes_when_path_given(tmp_path):
    dest = str(tmp_path / "traces" / "agent_traces.jsonl")
    assert export_jsonl(_full_trace(), path=dest) is True
    with open(dest, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    assert len(lines) == 1
    rec = json.loads(lines[0])
    assert rec["trace_id"] == "trace-abc"
    assert rec["stale_tag_count"] == 2


# --- Honesty: not-yet-wired fields stay explicitly empty ---------------------


def test_engine_hook_evidence_shape_leaves_unwired_fields_empty():
    """Mirror exactly what engine._emit_agent_trace passes (no tool_calls,
    no groundedness, no model). Those must be empty/None, not faked."""
    t = build_agent_trace(
        user_question="why is it faulted?",
        final_answer=REPLY_WITH_CITATION,
        ts=NOW_TS,
        trace_id="t1",
        session_id="chat-1",
        tenant_id="tenant-1",
        platform="ignition",
        fsm_state="DIAGNOSIS",
        uns_context=UNS_CTX,
        live_snapshots=_snapshots(),
        manual_sources=["..."],
        confidence="high",
        outcome="resolved",
        latency_ms=500,
        # NOT passed by the engine hook today:
        #   tool_calls, groundedness_score, model_used
    )
    assert t.tool_calls == []
    assert t.groundedness_score is None
    assert t.model_used is None
    # But the wired fields ARE populated.
    assert t.outcome == "resolved"
    assert t.live_tag_count == 3


# --- Engine integration: a real process() turn actually emits a trace --------


async def test_process_emits_agent_trace_with_session_id(tmp_db, tmp_path, monkeypatch):
    """End-to-end guard: a real Supervisor.process() writes exactly one
    AgentTrace line, and session_id == chat_id.

    This catches the wiring (the build-only unit tests above can't): session_id
    must come from chat_id, not a never-assigned self._current_session_id.
    """
    from unittest.mock import AsyncMock, patch

    from shared.engine import Supervisor

    dest = str(tmp_path / "traces.jsonl")
    monkeypatch.setenv("MIRA_AGENT_TRACE_FILE", dest)

    sup = Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="t",
    )
    with patch.object(
        sup,
        "process_full",
        new=AsyncMock(
            return_value={
                "reply": "check the breaker",
                "confidence": "high",
                "next_state": "DIAGNOSIS",
            }
        ),
    ):
        reply = await sup.process(
            chat_id="c-42", message="motor wont start", platform="telegram"
        )

    assert reply == "check the breaker"
    with open(dest, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    assert len(lines) == 1
    rec = json.loads(lines[0])
    assert rec["session_id"] == "c-42"  # the wiring fix — was silently None
    assert rec["tenant_id"] == "t"
    assert rec["platform"] == "telegram"
    assert "motor wont start" in rec["user_question"]
    assert rec["fsm_state"] == "DIAGNOSIS"
    # trace_id is always populated (uuid fallback when Langfuse id is empty).
    assert rec["trace_id"]


async def test_process_emits_safety_flag_on_safety_alert(tmp_db, tmp_path, monkeypatch):
    """A SAFETY_ALERT turn flows through the trace hook and sets
    safety_triggered=True.

    process() has no safety short-circuit — it always reaches
    _schedule_decision_trace — and process_full returns next_state="SAFETY_ALERT"
    for a safety turn (engine.py ~L1885). This proves the most important refusal
    case is actually captured in production, not just in a synthetic unit test.
    """
    from unittest.mock import AsyncMock, patch

    from shared.engine import Supervisor

    dest = str(tmp_path / "traces.jsonl")
    monkeypatch.setenv("MIRA_AGENT_TRACE_FILE", dest)

    sup = Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="t",
    )
    with patch.object(
        sup,
        "process_full",
        new=AsyncMock(
            return_value={
                "reply": "STOP. De-energize and follow LOTO before continuing.",
                "confidence": "high",
                "next_state": "SAFETY_ALERT",
            }
        ),
    ):
        await sup.process(chat_id="c-99", message="arc flash on the panel")

    with open(dest, encoding="utf-8") as fh:
        rec = json.loads(fh.read().splitlines()[0])
    assert rec["safety_triggered"] is True
    assert rec["fsm_state"] == "SAFETY_ALERT"
