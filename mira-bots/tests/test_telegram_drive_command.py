"""Tests for the /drive Telegram command — read-only, drive-pack-grounded only.

The handler (``telegram/bot.py::drive_command``) must NEVER call the engine or
an LLM: the only answer source is ``shared.drive_packs.answer_question``
(deterministic pack JSON). An unmatched question still renders the pack's own
honest "I won't guess" text, never a generic fallback.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

# Minimal env vars needed for shared module imports (mirrors test_start_command.py).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

# bot.py lives in telegram/ and does `from telegram import Update` (the real
# python-telegram-bot package) — importing it as `telegram.bot` from mira-bots/
# would shadow that package with this local directory. Instead, put telegram/
# directly on sys.path and import the bare `bot` module, same as
# test_typing_indicator.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

import pytest  # noqa: E402

from bot import drive_command  # noqa: E402


def _mock_update_context(args: list[str]):
    update = MagicMock()
    update.effective_chat.id = 12345
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    context.bot.send_chat_action = AsyncMock()
    return update, context


@pytest.mark.asyncio
async def test_drive_gs10_ce10_answers_from_pack():
    update, context = _mock_update_context(["gs10", "what", "does", "CE10", "mean?"])
    await drive_command(update, context)
    update.message.reply_text.assert_called_once()
    text = update.message.reply_text.call_args[0][0]
    assert "CE10" in text
    assert "P09.03" in text
    assert "[Source:" in text
    assert "source: drive_pack" in text
    assert "pack: durapulse_gs10" in text
    assert "fallback_used: false" in text
    assert "live_telemetry: false" in text
    assert "read_only: true" in text


@pytest.mark.asyncio
async def test_drive_gs10_p0903_cited():
    update, context = _mock_update_context(["gs10", "Where", "is", "P09.03", "documented?"])
    await drive_command(update, context)
    text = update.message.reply_text.call_args[0][0]
    assert "P09.03" in text
    assert "4-188" in text


@pytest.mark.asyncio
async def test_drive_unknown_pack_no_fallback():
    update, context = _mock_update_context(["nope", "hello"])
    await drive_command(update, context)
    text = update.message.reply_text.call_args[0][0]
    assert "nope" in text
    assert "no" in text.lower() or "don't have" in text.lower()
    # Never routes through the engine/LLM.
    assert "source: drive_pack" not in text


@pytest.mark.asyncio
async def test_drive_no_args_usage():
    update, context = _mock_update_context([])
    await drive_command(update, context)
    text = update.message.reply_text.call_args[0][0]
    assert "Usage:" in text


@pytest.mark.asyncio
async def test_drive_unmatched_question_is_honest():
    update, context = _mock_update_context(["gs10", "what", "is", "the", "weather"])
    await drive_command(update, context)
    text = update.message.reply_text.call_args[0][0]
    assert "won't guess" in text.lower()
    assert "source: none" in text
    assert "fallback_used: false" in text
