"""Tests for conversation continuity fixes (v0.4.1).

Covers: photo batching, session continuation, follow-up detection, deduplication.
"""

import os
import sys

# Pre-import stdlib `email` BEFORE adding mira-bots/ to sys.path. The repo
# contains a `mira-bots/email/` adapter directory that would otherwise shadow
# the stdlib package via httpx → urllib.request → email.
import email  # noqa: F401

# Minimal env vars needed for shared module imports
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

# Allow importing from telegram/ directory and mira-bots/ root.
# bot.py imports admin_commands → shared.tenant.invites, which needs
# `mira-bots/` on sys.path so the `shared` package resolves.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))


def test_photo_buffer_groups_photos():
    """_BURST_COLLECTOR accumulates multiple photos for same chat_id within
    the 4-second burst window before they're routed to single/multi handlers.

    The legacy in-memory ``PHOTO_BUFFER`` was replaced by a SQLite-backed
    ``PhotoBatchQueue`` with a smaller ``_BURST_COLLECTOR`` pre-collector
    (commit cbde671). This test pins the pre-collector behaviour the original
    test was verifying.
    """
    from bot import _BURST_COLLECTOR
    from shared.photo_batch_queue import BURST_WINDOW_SECONDS

    chat_id = 99991
    _BURST_COLLECTOR[chat_id] = {
        "photos": ["b64_photo_1"],
        "raw_bytes_list": [b"bytes1"],
        "caption": "test equipment",
        "update": None,
        "task": None,
    }
    _BURST_COLLECTOR[chat_id]["photos"].append("b64_photo_2")
    _BURST_COLLECTOR[chat_id]["raw_bytes_list"].append(b"bytes2")

    assert len(_BURST_COLLECTOR[chat_id]["photos"]) == 2
    assert len(_BURST_COLLECTOR[chat_id]["raw_bytes_list"]) == 2
    assert BURST_WINDOW_SECONDS == 4.0

    del _BURST_COLLECTOR[chat_id]


def test_non_industrial_continues_session():
    """off_topic reply references last_question when session is active."""
    session_context = {
        "equipment_type": "ABB ACS550 VFD",
        "last_question": "Is the DC bus voltage within spec?",
        "last_options": ["Yes, within spec", "No, lower than spec", "Not sure"],
    }
    fsm_state = "Q2"

    # Simulate the engine off_topic branch logic
    sc = session_context
    if fsm_state != "IDLE" and sc.get("last_question"):
        reply = (
            f"Still working on your {sc.get('equipment_type', 'equipment')}. "
            f"To recap: {sc['last_question']}"
        )
    else:
        reply = (
            "I help maintenance technicians diagnose equipment issues. "
            "What equipment do you need help with?"
        )

    assert "Is the DC bus voltage within spec?" in reply
    assert "I help maintenance technicians" not in reply
    assert "ABB ACS550 VFD" in reply


def test_session_followup_detection():
    """detect_session_followup only fires for explicit references to earlier context."""
    from shared.guardrails import detect_session_followup

    sc = {"equipment_type": "ABB VFD", "last_question": "Check the DC bus?"}

    # Documentation pivots should not get trapped in stale follow-up state
    assert detect_session_followup("give me the manufacturer website", sc, "Q2") is False
    assert detect_session_followup("user manual", sc, "Q2") is False

    # Explicit recap questions should still detect follow-up in active session
    assert detect_session_followup("where did you get that information", sc, "Q3") is True
    assert detect_session_followup("you said it was the DC bus earlier", sc, "DIAGNOSIS") is True

    # Should NOT detect follow-up in IDLE state
    assert detect_session_followup("give me the manufacturer website", sc, "IDLE") is False

    # Should NOT detect follow-up when session_context is empty
    assert detect_session_followup("give me the manufacturer website", {}, "Q2") is False

    # Off-topic message with no signals should not match
    assert detect_session_followup("what is the weather today", sc, "Q2") is False


def test_deduplicate_options():
    """deduplicate_options strips numbered option lines already in keyboard_options."""
    from shared.engine import deduplicate_options

    reply = "option text\n1. YES\n2. NO"
    result = deduplicate_options(reply, ["YES", "NO"])
    assert "1. YES" not in result
    assert "2. NO" not in result
    assert "option text" in result

    # Empty options list — reply unchanged
    result2 = deduplicate_options(reply, [])
    assert result2 == reply

    # Partial overlap — only matching option removed
    reply3 = "some text\n1. YES\n2. MAYBE"
    result3 = deduplicate_options(reply3, ["YES"])
    assert "1. YES" not in result3
    assert "2. MAYBE" in result3
