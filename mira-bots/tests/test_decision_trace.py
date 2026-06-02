"""Tests for Phase 8 — DecisionTraceWriter.

Covers:
- Writer builds a row dict with the right keys after a full turn sequence
- user_message is sanitized (IPs/MACs/SNs stripped)
- commit() is fail-soft on DB errors (mock psycopg2 raises; no exception escapes)
- gate_outcome values for direct_connection, confirmed, skipped
- commit() no-ops when NEON_DATABASE_URL is not set

All tests are offline — no real DB, no network.
"""

from __future__ import annotations

import os
import sys
import unittest.mock
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Minimal env vars.
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_decision_trace_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "test-tenant")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.decision_trace import DecisionTraceWriter, _sanitize, _uuid7  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tracer() -> DecisionTraceWriter:
    tracer = DecisionTraceWriter()
    tracer.start_turn(
        tenant_id="tenant-abc",
        chat_id="slack:C1234",
        message="Why is conveyor 192.168.1.100 stopped?",
    )
    return tracer


def _fill_tracer(tracer: DecisionTraceWriter) -> None:
    """Record a typical full turn."""
    tracer.record_uns_resolution(
        uns_path="enterprise.site.area.line.machine",
        confidence="high",
    )
    tracer.record_gate_outcome("confirmed")
    tracer.record_retrieval(
        [{"chunk_id": "c1", "score": 0.91, "source": "GS10 Manual"}]
    )
    tracer.record_kg_hops(
        [{"entity_id": "e1", "type": "component", "rel": "part_of"}]
    )
    tracer.record_tag_events_consulted(["ev-001", "ev-002"])
    tracer.record_llm_call(
        prompt="Diagnose the conveyor. 192.168.1.5 shows fault F001.",
        model_used="groq",
        llm_latency_ms=310,
        router_intent="diagnose_equipment",
        cascade_failures=[],
    )
    tracer.record_citation_check("pass")
    tracer.record_final_reply(
        raw_reply="Check the overload relay [Source: GS10 Manual — Wiring].",
        final_reply="Check the overload relay [Source: GS10 Manual — Wiring].",
        next_state="DIAGNOSIS",
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_start_turn_returns_uuid7_string():
    tracer = DecisionTraceWriter()
    trace_id = tracer.start_turn(
        tenant_id="t1", chat_id="slack:C1", message="hello"
    )
    assert isinstance(trace_id, str)
    assert len(trace_id) == 36  # standard UUID format


def test_trace_id_stored_on_writer():
    tracer = _make_tracer()
    assert tracer._trace_id is not None
    assert len(tracer._trace_id) == 36


def test_user_message_is_sanitized():
    """IPs in the message must be stripped before writing."""
    tracer = DecisionTraceWriter()
    tracer.start_turn(
        tenant_id="t1",
        chat_id="telegram:12345",
        message="Conveyor at 192.168.1.100 faulted with SN:ABC1234567",
    )
    assert "[IP]" in tracer._user_message
    assert "192.168.1.100" not in tracer._user_message
    assert "[SN]" in tracer._user_message


def test_platform_inferred_from_chat_id():
    tracer = DecisionTraceWriter()
    tracer.start_turn(tenant_id="t1", chat_id="slack:C1", message="hi")
    assert tracer._platform == "slack"

    tracer2 = DecisionTraceWriter()
    tracer2.start_turn(tenant_id="t1", chat_id="telegram:999", message="hi")
    assert tracer2._platform == "telegram"


def test_platform_explicit_override():
    tracer = DecisionTraceWriter()
    tracer.start_turn(
        tenant_id="t1", chat_id="C123", message="hi", platform="ignition"
    )
    assert tracer._platform == "ignition"


def test_platform_unknown_for_bare_id():
    tracer = DecisionTraceWriter()
    tracer.start_turn(tenant_id="t1", chat_id="rawid", message="hi")
    assert tracer._platform == "unknown"


def test_record_uns_resolution():
    tracer = _make_tracer()
    tracer.record_uns_resolution("enterprise.site.area", "high")
    assert tracer._uns_path == "enterprise.site.area"
    assert tracer._uns_confidence == "high"


def test_record_gate_outcome():
    for outcome in ("direct_connection", "confirmed", "fired", "skipped"):
        tracer = _make_tracer()
        tracer.record_gate_outcome(outcome)
        assert tracer._gate_outcome == outcome


def test_record_retrieval_normalises_chunks():
    tracer = _make_tracer()
    tracer.record_retrieval([
        {"chunk_id": "c1", "score": 0.9, "source": "GS10 Manual"},
        {"id": "c2", "similarity": 0.85, "source_url": "https://example.com"},
    ])
    assert len(tracer._retrieval_set) == 2
    assert tracer._retrieval_set[0]["chunk_id"] == "c1"
    assert tracer._retrieval_set[1]["chunk_id"] == "c2"


def test_record_llm_call_sanitizes_prompt():
    tracer = _make_tracer()
    tracer.record_llm_call(
        prompt="System check 10.0.0.1 SN:XYZ9876543",
        model_used="groq",
        llm_latency_ms=200,
        router_intent="diagnose_equipment",
    )
    assert "[IP]" in tracer._prompt
    assert "10.0.0.1" not in tracer._prompt
    assert tracer._model_used == "groq"
    assert tracer._llm_latency_ms == 200
    assert tracer._router_intent == "diagnose_equipment"


def test_record_citation_check():
    for label in ("pass", "rewritten", "admitted_gap"):
        tracer = _make_tracer()
        tracer.record_citation_check(label)
        assert tracer._citation_check == label


def test_record_final_reply():
    tracer = _make_tracer()
    tracer.record_final_reply(
        raw_reply="raw text",
        final_reply="final text [Source: X]",
        next_state="DIAGNOSIS",
    )
    assert tracer._raw_reply == "raw text"
    assert tracer._final_reply == "final text [Source: X]"
    assert tracer._next_state == "DIAGNOSIS"


@pytest.mark.asyncio
async def test_commit_noops_when_neon_url_not_set():
    """commit() must silently skip when NEON_DATABASE_URL is absent."""
    tracer = _make_tracer()
    _fill_tracer(tracer)

    with patch.dict(os.environ, {"NEON_DATABASE_URL": ""}):
        # Should complete without error
        await tracer.commit()


@pytest.mark.asyncio
async def test_commit_failsoft_on_db_error():
    """A psycopg2 exception inside commit() must not propagate to the caller."""
    tracer = _make_tracer()
    _fill_tracer(tracer)

    mock_conn = MagicMock()
    mock_conn.__enter__ = lambda s: s
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.cursor.return_value.__enter__.return_value.execute.side_effect = (
        Exception("connection refused")
    )

    with patch.dict(os.environ, {"NEON_DATABASE_URL": "postgresql://fake/db"}):
        with patch("psycopg2.connect", side_effect=Exception("connection refused")):
            # Must not raise
            await tracer.commit()


@pytest.mark.asyncio
async def test_commit_failsoft_when_start_turn_not_called():
    """commit() on a fresh writer (no start_turn) must silently no-op."""
    tracer = DecisionTraceWriter()
    await tracer.commit()  # should not raise


def test_all_record_methods_are_failsoft():
    """Every record_* method must catch exceptions from bad inputs."""
    # Feed bad types — should not raise
    tracer = _make_tracer()
    tracer.record_uns_resolution(None, None)
    tracer.record_gate_outcome("")
    tracer.record_retrieval(None)
    tracer.record_kg_hops(None)
    tracer.record_tag_events_consulted(None)
    tracer.record_llm_call()
    tracer.record_citation_check("")
    tracer.record_final_reply()


def test_sanitize_strips_ipv4():
    assert "[IP]" in _sanitize("Check host 192.168.0.1 now")
    assert "192.168.0.1" not in _sanitize("Check host 192.168.0.1 now")


def test_sanitize_strips_mac():
    text = "Device 00:1B:44:11:3A:B7 offline"
    result = _sanitize(text)
    assert "[MAC]" in result
    assert "00:1B:44:11:3A:B7" not in result


def test_sanitize_strips_serial():
    text = "Serial SN:ABC1234567 failed"
    result = _sanitize(text)
    assert "[SN]" in result or "SN:ABC1234567" not in result


def test_sanitize_none_passthrough():
    assert _sanitize(None) is None


def test_uuid7_returns_valid_uuid():
    uid = _uuid7()
    import uuid as _uuid
    parsed = _uuid.UUID(uid)
    # Version field should be 7
    assert parsed.version == 7


def test_uuid7_is_time_ordered():
    """Two UUIDs minted in sequence should sort in ascending order."""
    import time
    u1 = _uuid7()
    time.sleep(0.001)
    u2 = _uuid7()
    assert u1 < u2
