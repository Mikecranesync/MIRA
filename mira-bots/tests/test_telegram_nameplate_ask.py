"""Tests for the Telegram nameplate-photo -> drive-pack fast path.

Mirrors ``test_telegram_drive_command.py``'s harness: import the bare ``bot``
module (not ``telegram.bot`` — that would shadow the real ``python-telegram-bot``
package), mock the Update/context, and mock ``engine.nameplate.extract`` so no
vision/network call happens. The path under test
(``bot._try_nameplate_drive_pack_reply``) must NEVER call the engine/LLM — the
only answer source is ``shared.drive_packs.answer_question`` (deterministic
pack JSON), same contract as the ``/drive`` command.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

# Minimal env vars needed for shared module imports (mirrors test_telegram_drive_command.py).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

import pytest  # noqa: E402

from bot import _try_nameplate_drive_pack_reply, engine  # noqa: E402


def _mock_photo_update_context():
    update = MagicMock()
    update.effective_chat.id = 12345
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.bot.send_chat_action = AsyncMock()
    return update, context


def _mock_nameplate_extract(fields: dict):
    return patch.object(engine.nameplate, "extract", AsyncMock(return_value=fields))


@pytest.mark.asyncio
async def test_gs10_nameplate_with_fault_question_answers_from_pack():
    update, context = _mock_photo_update_context()
    fields = {"manufacturer": "AutomationDirect", "model": "GS10", "serial": None}
    with _mock_nameplate_extract(fields):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", "what does CE10 mean?", update, context
        )

    assert handled is True
    update.message.reply_text.assert_called_once()
    text = update.message.reply_text.call_args[0][0]
    assert "CE10" in text
    assert "[Source:" in text
    assert "source: drive_pack" in text
    assert "fallback_used: false" in text
    assert "read_only: true" in text
    # Never routes through the engine/LLM.
    engine_process = getattr(engine, "process", None)
    if isinstance(engine_process, AsyncMock):
        engine_process.assert_not_called()


@pytest.mark.asyncio
async def test_gs10_nameplate_with_unmatched_question_is_honest_not_a_guess():
    update, context = _mock_photo_update_context()
    fields = {"manufacturer": "AutomationDirect", "model": "GS10", "serial": None}
    with _mock_nameplate_extract(fields):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", "what is the weather", update, context
        )

    assert handled is True
    text = update.message.reply_text.call_args[0][0]
    assert "won't guess" in text.lower()
    assert "source: none" in text
    assert "fallback_used: false" in text


@pytest.mark.asyncio
async def test_manufacturer_only_nameplate_with_question_asks_for_model():
    update, context = _mock_photo_update_context()
    fields = {"manufacturer": "AutomationDirect", "model": None, "serial": None}
    with _mock_nameplate_extract(fields):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", "what's wrong with this drive?", update, context
        )

    assert handled is True
    text = update.message.reply_text.call_args[0][0]
    assert "automationdirect" in text.lower()
    assert "model" in text.lower() or "series" in text.lower()
    # Honest refusal, not a generic/LLM guess.
    assert "source:" not in text


@pytest.mark.asyncio
async def test_gs10_nameplate_no_caption_confirms_identification_without_engine():
    """No question caption yet: confirm the identified drive and invite a
    question. The drive is also remembered for the chat (bot-local
    ``telegram_drive_context``) so a LATER text turn continues in this pack's
    context — see ``test_telegram_drive_followup.py`` for that continuity path.
    This test covers the single-message (caption-on-the-photo) confirmation."""
    update, context = _mock_photo_update_context()
    fields = {"manufacturer": "AutomationDirect", "model": "GS10", "serial": None}
    with _mock_nameplate_extract(fields):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", "Analyze this equipment photo", update, context
        )

    assert handled is True
    text = update.message.reply_text.call_args[0][0]
    assert "AutomationDirect" in text
    assert "DURApulse GS10" in text
    assert "CE10" in text  # example-question hint, not an answer


@pytest.mark.asyncio
async def test_unrelated_nameplate_falls_through_to_existing_engine_flow():
    """A nameplate that identifies no known drive family must NOT be claimed
    by this fast path — it falls through unchanged to the existing
    engine-dispatched photo flow."""
    update, context = _mock_photo_update_context()
    fields = {"manufacturer": "Yaskawa", "model": "GA800", "serial": None}
    with _mock_nameplate_extract(fields):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", "what is wrong?", update, context
        )

    assert handled is False
    update.message.reply_text.assert_not_called()


@pytest.mark.asyncio
async def test_nameplate_extract_parse_error_falls_through():
    update, context = _mock_photo_update_context()
    with _mock_nameplate_extract({"parse_error": "unparseable response"}):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", "what does CE10 mean?", update, context
        )

    assert handled is False
    update.message.reply_text.assert_not_called()
