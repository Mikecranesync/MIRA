"""Print-reply chunked delivery — Telegram's 4096-char sendMessage cap.

Live-hit 2026-07-18: the theory path's gemma reply (1068 tokens ≈ >4096 chars)
400'd on sendMessage and the turn died silently after the ack. These pin the
fix: `_chunk_reply` never emits an over-limit chunk and never drops content;
`_reply_chunked` delivers every chunk in order and surfaces delivery failure
instead of eating it; the REAL `_try_print_translator_reply` delivers a long
theory reply in full. Hermetic — no network, no paid provider."""

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

import pytest  # noqa: E402

pytest.importorskip("pydantic")

import bot  # noqa: E402

TELEGRAM_CAP = 4096


class _NullTyping:
    def __init__(self, *a, **k): ...

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def _update():
    u = MagicMock()
    u.effective_chat.id = 999
    u.effective_user.id = 999
    u.message.reply_text = AsyncMock()
    return u


# ---------------------------------------------------------------------------
# _chunk_reply — pure splitting contract
# ---------------------------------------------------------------------------


class TestChunkReply:
    def test_short_text_is_one_chunk(self):
        assert bot._chunk_reply("short answer") == ["short answer"]

    def test_exact_limit_is_one_chunk(self):
        text = "x" * 4000
        assert bot._chunk_reply(text) == [text]

    def test_long_line_structured_text_splits_and_rejoins(self):
        text = "\n".join(f"section {i}: " + "detail " * 60 for i in range(24))
        assert len(text) > TELEGRAM_CAP
        chunks = bot._chunk_reply(text)
        assert len(chunks) > 1
        assert all(len(c) <= 4000 for c in chunks)
        assert "\n".join(chunks) == text  # nothing dropped, sections intact

    def test_pathological_single_line_hard_splits(self):
        line = "y" * 9001
        chunks = bot._chunk_reply(line)
        assert all(len(c) <= 4000 for c in chunks)
        assert "".join(chunks) == line  # no characters dropped

    def test_every_chunk_is_under_the_telegram_cap(self):
        text = ("A" * 120 + "\n") * 200
        assert all(len(c) <= TELEGRAM_CAP for c in bot._chunk_reply(text))


# ---------------------------------------------------------------------------
# _reply_chunked — delivery behavior
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestReplyChunked:
    async def test_long_reply_sent_in_order_and_complete(self):
        update = _update()
        text = "\n".join(f"line {i} " + "word " * 100 for i in range(20))
        assert len(text) > TELEGRAM_CAP
        await bot._reply_chunked(update, text)
        sent = [c.args[0] for c in update.message.reply_text.await_args_list]
        assert len(sent) > 1
        assert all(len(s) <= TELEGRAM_CAP for s in sent)
        assert "\n".join(sent) == text

    async def test_short_reply_is_a_single_send(self):
        update = _update()
        await bot._reply_chunked(update, "done")
        update.message.reply_text.assert_awaited_once_with("done")

    async def test_delivery_failure_is_visible_not_silent(self):
        """The live bug: sendMessage 400 → nothing logged, nothing delivered.
        Now: the failure is logged and a short fallback notice is attempted."""
        update = _update()
        update.message.reply_text = AsyncMock(side_effect=[Exception("400 Bad Request"), None])
        await bot._reply_chunked(update, "any reply")  # must not raise
        calls = update.message.reply_text.await_args_list
        assert len(calls) == 2
        assert "couldn't deliver" in calls[1].args[0]


# ---------------------------------------------------------------------------
# The REAL rung — a long theory reply is delivered in full
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_long_theory_reply_delivered_in_chunks(monkeypatch):
    async def vision(photo_b64, message):
        return {
            "classification": "ELECTRICAL_PRINT",
            "classification_confidence": 0.9,
            "vision_result": "a schematic drawing",
            "ocr_items": [],
            "tesseract_text": "",
            "drawing_type": "control circuit",
            "drawing_type_confidence": 0.8,
        }

    long_reply = "\n".join(f"§{i} " + "the K44 relay coil circuit " * 30 for i in range(12))
    assert len(long_reply) > TELEGRAM_CAP

    monkeypatch.setattr(bot.engine.vision, "process", vision)
    monkeypatch.setattr(bot.engine, "_grounded_print_reply", AsyncMock(return_value=long_reply))
    monkeypatch.setattr(bot, "_print_interpreter_configured", lambda: False)
    monkeypatch.setattr(bot, "typing_action", _NullTyping)

    update = _update()
    ctx = MagicMock()
    claimed = await bot._try_print_translator_reply(
        b"raw-bytes", b"vision-bytes", "explain this print to me", update, ctx
    )

    assert claimed is True
    sent = [c.args[0] for c in update.message.reply_text.await_args_list]
    assert len(sent) > 1  # the old single-send would have 400'd
    assert all(len(s) <= TELEGRAM_CAP for s in sent)
    assert "\n".join(sent) == long_reply  # complete, in order, nothing dropped
