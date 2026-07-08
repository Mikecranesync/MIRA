"""Tests for Telegram drive-conversation continuity (text follow-up fast path).

After a nameplate photo or ``/drive`` identifies a drive, a plain-TEXT follow-up
("what is P09.03?") must continue in that pack's context and answer from the
pack — read-only, cited, and UN-GATED (no enrollment wall), the same public-OEM
contract as the photo fast path. Non-drive text must fall through unchanged to
the normal (enrollment-gated) engine dispatch.

Same harness as ``test_telegram_nameplate_ask.py``: import the bare ``bot``
module, mock the Update/context, and use a per-test temp SQLite DB for the
bot-local ``telegram_drive_context`` store. No engine/LLM/network calls.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)

import pytest  # noqa: E402

import bot  # noqa: E402


@pytest.fixture
def drive_db(tmp_path, monkeypatch):
    """Isolate each test's bot-local drive-context store in its own temp DB."""
    db = tmp_path / "mira_test.db"
    monkeypatch.setenv("MIRA_DB_PATH", str(db))
    return str(db)


def _mock_update_context(chat_id: int = 12345):
    update = MagicMock()
    update.effective_chat.id = chat_id
    update.message.reply_text = AsyncMock()
    update.message.reply_voice = AsyncMock()
    context = MagicMock()
    context.bot.send_chat_action = AsyncMock()
    return update, context


def test_context_roundtrip_and_ttl(drive_db):
    bot._set_drive_context("777", "durapulse_gs10")
    assert bot._get_drive_context("777") == "durapulse_gs10"
    # An expired context (max_age 0) must not resolve.
    assert bot._get_drive_context("777", max_age_s=0) is None
    # An unknown chat has no context.
    assert bot._get_drive_context("999") is None


@pytest.mark.asyncio
async def test_text_followup_answers_covered_parameter_from_pack(drive_db):
    """Established GS10 context + a covered parameter question → cited pack
    answer, un-gated (never reaches the enrollment gate)."""
    bot._set_drive_context("12345", "durapulse_gs10")
    update, context = _mock_update_context()

    handled = await bot._try_drive_pack_followup("what is P09.03?", "12345", update, context)

    assert handled is True
    text = update.message.reply_text.call_args[0][0]
    assert "P09.03" in text
    assert "[Source:" in text
    assert "source: drive_pack" in text
    assert "read_only: true" in text


@pytest.mark.asyncio
async def test_text_followup_answers_p0124_now_that_it_is_in_the_pack(drive_db):
    """The originally-reported turn: 'what is P01.24?' as a text follow-up. The
    GS10 pack now documents P01.24 (grounded from the manual), so it answers
    with real, cited content — never the invite-only wall."""
    bot._set_drive_context("12345", "durapulse_gs10")
    update, context = _mock_update_context()

    handled = await bot._try_drive_pack_followup(
        "What is p01.24? What is it used for?", "12345", update, context
    )

    assert handled is True
    text = update.message.reply_text.call_args[0][0]
    assert "invite-only" not in text.lower()
    assert "P01.24" in text
    assert "s-curve" in text.lower()  # the real, grounded meaning
    assert "[Source:" in text
    assert "source: drive_pack" in text


@pytest.mark.asyncio
async def test_text_followup_uncovered_parameter_stays_in_context_not_invite_wall(drive_db):
    """A still-uncovered parameter (P02.00 is not in the pack) must stay in the
    GS10 conversation with the pack's HONEST 'not documented' answer — never
    fabricate it, and never drop to the invite-only enrollment wall."""
    bot._set_drive_context("12345", "durapulse_gs10")
    update, context = _mock_update_context()

    handled = await bot._try_drive_pack_followup(
        "What is P02.00? What is it used for?", "12345", update, context
    )

    assert handled is True  # claimed the turn — did NOT fall through to the gate
    text = update.message.reply_text.call_args[0][0]
    assert "invite-only" not in text.lower()
    assert "won't guess" in text.lower()  # honest, no fabrication
    assert "durapulse gs10" in text.lower()  # still in the GS10 context


@pytest.mark.asyncio
async def test_non_drive_text_falls_through_to_gated_dispatch(drive_db):
    """A non-drive question, even with active drive context, must fall through
    (return False) so the normal engine/enrollment path handles it."""
    bot._set_drive_context("12345", "durapulse_gs10")
    update, context = _mock_update_context()

    handled = await bot._try_drive_pack_followup(
        "how is the weather today?", "12345", update, context
    )

    assert handled is False
    update.message.reply_text.assert_not_called()


@pytest.mark.asyncio
async def test_fsm_confirmation_yes_is_not_captured(drive_db):
    """A bare 'yes' (work-order FSM confirmation) must not be swallowed by the
    drive fast path even with active context."""
    bot._set_drive_context("12345", "durapulse_gs10")
    update, context = _mock_update_context()

    handled = await bot._try_drive_pack_followup("yes", "12345", update, context)

    assert handled is False
    update.message.reply_text.assert_not_called()


@pytest.mark.asyncio
async def test_no_context_falls_through(drive_db):
    """Without an established drive context, a drive-shaped question still falls
    through — continuity only applies after a drive was identified."""
    update, context = _mock_update_context()

    handled = await bot._try_drive_pack_followup("what is P09.03?", "12345", update, context)

    assert handled is False
    update.message.reply_text.assert_not_called()


@pytest.mark.asyncio
async def test_stale_context_falls_through(drive_db, monkeypatch):
    """A context older than the TTL must not hijack a new conversation."""
    bot._set_drive_context("12345", "durapulse_gs10")
    monkeypatch.setattr(bot, "_DRIVE_CONTEXT_TTL_S", 0)
    update, context = _mock_update_context()

    handled = await bot._try_drive_pack_followup("what is P09.03?", "12345", update, context)

    assert handled is False
