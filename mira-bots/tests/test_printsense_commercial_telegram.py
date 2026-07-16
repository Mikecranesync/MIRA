"""Telegram commercial concierge — gating, consent, review-gated delivery."""

from __future__ import annotations

import pathlib
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("pydantic")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "telegram"))

import printsense_commercial as pc  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"synthetic"


@pytest.fixture(autouse=True)
def _root(tmp_path, monkeypatch):
    monkeypatch.setattr(pc, "ROOT", str(tmp_path))
    monkeypatch.setattr(pc, "TENANT", "t-test")
    monkeypatch.setattr(pc, "_ADMIN_IDS", {"999"})
    pc._chat_map_store._m = {}
    yield


def _update(chat_id=1, user_id=7, text=None):
    u = MagicMock()
    u.effective_chat.id = chat_id
    u.effective_user.id = user_id
    u.message.text = text
    u.message.reply_text = AsyncMock()
    return u


def _ctx(args=None):
    c = MagicMock()
    c.chat_data = {}
    c.args = args or []
    c.bot.send_message = MagicMock()
    c.bot.send_document = MagicMock()
    return c


@pytest.mark.asyncio
async def test_ordinary_photo_falls_through():
    u, c = _update(), _ctx()
    assert await pc.try_printsense_commercial_reply(
        PNG, "what's this motor?", u, c) is False
    u.message.reply_text.assert_not_called()


@pytest.mark.asyncio
async def test_explicit_intent_asks_question_then_consent_then_submits():
    u, c = _update(), _ctx()
    # caption is pure intent, no question -> asks what they want to know
    assert await pc.try_printsense_commercial_reply(
        PNG, "analyze this print", u, c) is True
    assert c.chat_data["ps_state"] == "awaiting_question"
    # supply the question -> consent prompt
    assert await pc.try_printsense_text_reply("Why does K01 trip?", u, c)
    assert c.chat_data["ps_state"] == "awaiting_consent"
    # decline -> cancelled, nothing stored
    assert await pc.try_printsense_text_reply("no thanks", u, c)
    assert c.chat_data["ps_state"] is None
    assert c.chat_data.get("ps_last_intake") is None


@pytest.mark.asyncio
async def test_consent_yes_submits_and_reaches_needs_review():
    u, c = _update(), _ctx()
    await pc.try_printsense_commercial_reply(
        PNG, "analyze print: why does K01 trip?", u, c)
    assert c.chat_data["ps_state"] == "awaiting_consent"
    assert await pc.try_printsense_text_reply("YES", u, c)
    iid = c.chat_data["ps_last_intake"]
    st = pc._service().get_status(iid)
    assert st["status"] == "needs_review"  # never delivered pre-review


@pytest.mark.asyncio
async def test_reviewer_gate_and_delivery(monkeypatch):
    u, c = _update(), _ctx()
    await pc.try_printsense_commercial_reply(PNG, "analyze print: K01?", u, c)
    await pc.try_printsense_text_reply("YES", u, c)
    iid = c.chat_data["ps_last_intake"]
    # non-admin refused
    ru, rc = _update(chat_id=123), _ctx(args=["approve", iid[:8]])
    await pc.ps_review_command(ru, rc)
    ru.message.reply_text.assert_awaited_with("Not authorized.")
    # admin approves -> delivery via bot (message + document)
    au, ac = _update(chat_id=999), _ctx(args=["approve", iid[:8], "pilot"])
    await pc.ps_review_command(au, ac)
    assert pc._service().get_status(iid)["status"] == "delivered"
    ac.bot.send_message.assert_called_once()
    ac.bot.send_document.assert_called_once()


@pytest.mark.asyncio
async def test_survey_and_pilot_cta():
    u, c = _update(), _ctx()
    await pc.try_printsense_commercial_reply(PNG, "analyze print: K01?", u, c)
    await pc.try_printsense_text_reply("YES", u, c)
    iid = c.chat_data["ps_last_intake"]
    au, ac = _update(chat_id=999), _ctx(args=["approve", iid[:8], "pilot"])
    await pc.ps_review_command(au, ac)
    sc = _ctx(args=["y", "y", "y", "y", "y"])
    sc.chat_data = c.chat_data
    await pc.ps_survey_command(u, sc)
    counts = pc._service().funnel.counts()
    assert counts.get("pilot_qualified") == 1
