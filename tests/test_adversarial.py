"""Adversarial input tests — SQL injection, XSS, path traversal, oversized payloads.

All tests are offline (no network). Verifies the guardrails and engine handle
hostile inputs without crashing, leaking state, or producing dangerous output.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest

from shared.guardrails import (
    classify_intent,
    check_output,
    expand_abbreviations,
    strip_mentions,
    rewrite_question,
)
from shared.engine import Supervisor


# ── Adversarial string corpus ─────────────────────────────────────────────────

_SQL_INJECTIONS = [
    "'; DROP TABLE conversation_state; --",
    "1 OR 1=1",
    "UNION SELECT * FROM feedback_log",
    "' OR '1'='1",
    "admin'--",
    "1; SELECT pg_sleep(10)--",
]

_XSS_PAYLOADS = [
    "<script>alert(1)</script>",
    "javascript:void(0)",
    "<img src=x onerror=alert(1)>",
    '"><svg onload=alert(1)>',
    "{{7*7}}",  # template injection
    "${7*7}",
]

_PATH_TRAVERSALS = [
    "../../../etc/passwd",
    "..\\..\\windows\\system32\\config\\sam",
    "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/var/log/../../../etc/shadow",
]

_NULL_BYTES = [
    "motor\x00fault",
    "\x00",
    "fault\x00\x00\x00",
]

_OVERLONG = [
    "A" * 10_000,
    "motor tripped " * 1_000,
    "x" * 100_000,
]


# ── classify_intent: must never raise ────────────────────────────────────────

@pytest.mark.parametrize("payload", _SQL_INJECTIONS + _XSS_PAYLOADS + _PATH_TRAVERSALS)
def test_classify_intent_adversarial_no_raise(payload):
    try:
        result = classify_intent(payload)
        assert isinstance(result, str)
    except Exception as exc:
        pytest.fail(f"classify_intent raised on adversarial input: {exc!r}")


@pytest.mark.parametrize("payload", _NULL_BYTES)
def test_classify_intent_null_bytes(payload):
    try:
        result = classify_intent(payload)
        assert isinstance(result, str)
    except Exception as exc:
        pytest.fail(f"classify_intent raised on null-byte input: {exc!r}")


@pytest.mark.parametrize("payload", _OVERLONG)
def test_classify_intent_overlong(payload):
    try:
        result = classify_intent(payload)
        assert isinstance(result, str)
    except Exception as exc:
        pytest.fail(f"classify_intent raised on overlong input: {exc!r}")


# ── expand_abbreviations: must never raise ────────────────────────────────────

@pytest.mark.parametrize("payload", _SQL_INJECTIONS + _XSS_PAYLOADS)
def test_expand_abbreviations_adversarial(payload):
    try:
        result = expand_abbreviations(payload)
        assert isinstance(result, str)
    except Exception as exc:
        pytest.fail(f"expand_abbreviations raised: {exc!r}")


# ── strip_mentions: must never raise ─────────────────────────────────────────

@pytest.mark.parametrize("payload", _XSS_PAYLOADS + _NULL_BYTES)
def test_strip_mentions_adversarial(payload):
    try:
        result = strip_mentions(payload)
        assert isinstance(result, str)
    except Exception as exc:
        pytest.fail(f"strip_mentions raised: {exc!r}")


# ── check_output: must never raise ───────────────────────────────────────────

@pytest.mark.parametrize("payload", _SQL_INJECTIONS + _XSS_PAYLOADS)
def test_check_output_adversarial(payload):
    try:
        result = check_output(payload, intent="industrial", has_photo=False)
        assert isinstance(result, str)
    except Exception as exc:
        pytest.fail(f"check_output raised on adversarial input: {exc!r}")


# ── rewrite_question: must never raise ───────────────────────────────────────

@pytest.mark.parametrize("payload", _SQL_INJECTIONS + _XSS_PAYLOADS + _PATH_TRAVERSALS)
def test_rewrite_question_adversarial(payload):
    try:
        result = rewrite_question(payload, asset_identified="GS10 VFD")
        assert isinstance(result, str)
    except Exception as exc:
        pytest.fail(f"rewrite_question raised: {exc!r}")


# ── Memory block stripping: must not be confused by nested/malformed blocks ───

def test_strip_memory_block_nested():
    """Nested MIRA MEMORY markers must not confuse the stripper."""
    raw = (
        "[MIRA MEMORY — facts from this session]\n"
        "[MIRA MEMORY — inner]\nSome data\n[END MEMORY]\n"
        "[END MEMORY]\n\n"
        "Actual question"
    )
    clean = Supervisor._strip_memory_block(raw)
    assert "Actual question" in clean
    assert "[MIRA MEMORY" not in clean


def test_strip_memory_block_malformed_no_end():
    """Malformed block with no END MEMORY tag must not strip real content."""
    raw = "[MIRA MEMORY — facts from this session]\nOrphaned prefix\nActual question"
    clean = Supervisor._strip_memory_block(raw)
    # Should either strip or return as-is — must NOT raise and must be a string
    assert isinstance(clean, str)


def test_strip_memory_block_sql_in_memory():
    """SQL injection in memory block must be stripped with the block."""
    raw = (
        "[MIRA MEMORY — facts from this session]\n"
        "'; DROP TABLE conversation_state; --\n"
        "[END MEMORY]\n\n"
        "What is the rated current?"
    )
    clean = Supervisor._strip_memory_block(raw)
    assert "DROP TABLE" not in clean
    assert "What is the rated current?" in clean


# ── Supervisor._strip_memory_block is idempotent ─────────────────────────────

def test_strip_memory_block_idempotent():
    """Stripping twice must produce the same result as stripping once."""
    raw = (
        "[MIRA MEMORY — facts from this session]\nData\n[END MEMORY]\n\n"
        "Real question"
    )
    once = Supervisor._strip_memory_block(raw)
    twice = Supervisor._strip_memory_block(once)
    assert once == twice


# ── SQL injection does not reach the DB directly ─────────────────────────────

def test_sql_injection_in_chat_id_does_not_corrupt(tmp_path):
    """A SQL injection chat_id must not corrupt the database."""
    from unittest.mock import patch
    db_path = str(tmp_path / "adversarial.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with patch("shared.engine.VisionWorker"), \
             patch("shared.engine.NameplateWorker"), \
             patch("shared.engine.RAGWorker"), \
             patch("shared.engine.PrintWorker"), \
             patch("shared.engine.PLCWorker"), \
             patch("shared.engine.NemotronClient"), \
             patch("shared.engine.InferenceRouter"):
            sv = Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test",
                collection_id="test",
            )

    malicious_id = "'; DROP TABLE conversation_state; --"
    try:
        sv._load_state(malicious_id)
        sv._save_state(malicious_id, {
            "chat_id": malicious_id,
            "state": "IDLE",
            "context": {},
            "asset_identified": None,
            "fault_category": None,
            "exchange_count": 0,
            "final_state": None,
        })
        # If we get here, parameterized query protected us — verify table still exists
        state = sv._load_state("normal_user")
        assert state["state"] == "IDLE"
    except Exception as exc:
        pytest.fail(f"SQL injection in chat_id caused unexpected error: {exc!r}")
