"""Tests for drive-pack Q&A capture into conversation_eval (Phase 1 flywheel).

Every drive-pack answer (matched AND unmatched) must be captured with the
labels the distillation flywheel mines — surface, pack_id, matched,
matched_kind — so knowledge gaps (e.g. an undocumented parameter) surface
automatically. Capture is fail-open and must not change the reply.

Same harness as test_telegram_nameplate_ask.py: import the bare ``bot`` module,
mock Update/context, and mock ``log_turn`` so no DB/network is touched.
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
from shared.drive_packs import answer_question, resolve_service_pack  # noqa: E402


def _mock_update(chat_id: int = 12345):
    update = MagicMock()
    update.effective_chat.id = chat_id
    update.message.reply_text = AsyncMock()
    return update


# ── _drive_pack_meta ─────────────────────────────────────────────────────────


def test_meta_labels_a_matched_parameter_turn():
    result = answer_question("durapulse_gs10", "what is P09.03?")
    meta = bot._drive_pack_meta("command", result)
    assert meta["surface"] == "drive_pack"
    assert meta["entry"] == "command"
    assert meta["pack_id"] == "durapulse_gs10"
    assert meta["matched"] is True
    assert meta["matched_kind"] == "parameter"
    assert meta["answer_source"] == "drive_pack"


def test_meta_flags_an_unmatched_gap_turn():
    """The knowledge-gap signal: an undocumented parameter → matched=False."""
    result = answer_question("durapulse_gs10", "what is P02.00?")
    meta = bot._drive_pack_meta("followup", result)
    assert meta["matched"] is False
    assert meta["answer_source"] == "none"
    assert meta["matched_kind"] is None


def test_meta_includes_resolution_for_nameplate_turns():
    resolution = resolve_service_pack(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-20P2"}
    )
    result = answer_question(resolution.pack_id, "what does CE10 mean?")
    meta = bot._drive_pack_meta("nameplate", result, resolution)
    assert meta["resolution"]["source"] == "nameplate"
    assert meta["resolution"]["confidence"] in {"high", "medium"}
    assert meta["resolution"]["ambiguous"] is False


# ── _capture_drive_pack_turn ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_capture_calls_log_turn_with_drive_pack_meta(monkeypatch):
    calls = {}

    async def fake_log_turn(**kwargs):
        calls.update(kwargs)

    monkeypatch.setattr(bot, "log_turn", fake_log_turn)
    result = answer_question("durapulse_gs10", "what is P09.03?")
    await bot._capture_drive_pack_turn(
        question="what is P09.03?", result=result, update=_mock_update(), entry="command"
    )
    assert calls["source"] == "telegram"
    assert calls["intent"] == "drive_pack"
    assert calls["chat_id"] == "12345"
    assert calls["has_citations"] is True
    assert calls["meta"]["surface"] == "drive_pack"
    assert calls["meta"]["pack_id"] == "durapulse_gs10"
    assert calls["meta"]["matched"] is True


@pytest.mark.asyncio
async def test_capture_never_raises_on_bad_update(monkeypatch):
    """Fail-open: a malformed update must not break the turn."""

    async def fake_log_turn(**kwargs):
        pass

    monkeypatch.setattr(bot, "log_turn", fake_log_turn)
    result = answer_question("durapulse_gs10", "what is P09.03?")
    broken = MagicMock()
    broken.effective_chat.id = 1
    # _intake_meta may blow up on a bare mock — capture must swallow it.
    await bot._capture_drive_pack_turn(question="q", result=result, update=broken, entry="command")


@pytest.mark.asyncio
async def test_followup_captures_the_turn(monkeypatch, tmp_path):
    """End-to-end: a text follow-up answer is captured (matched meta)."""
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira_test.db"))
    captured = {}

    async def fake_log_turn(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(bot, "log_turn", fake_log_turn)
    bot._set_drive_context("12345", "durapulse_gs10")
    update = _mock_update()
    context = MagicMock()
    context.bot.send_chat_action = AsyncMock()

    handled = await bot._try_drive_pack_followup("what is P09.03?", "12345", update, context)

    assert handled is True
    assert captured["meta"]["surface"] == "drive_pack"
    assert captured["meta"]["entry"] == "followup"
    assert captured["meta"]["matched"] is True
