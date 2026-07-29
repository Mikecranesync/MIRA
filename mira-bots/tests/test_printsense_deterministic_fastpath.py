"""UNSEEN-1 rung-wiring tests — deterministic fast-path inside the REAL
`bot._try_print_translator_reply` (hermetic; no network, no paid provider).

Proves: a closed-form question is answered with ZERO model calls (router AND
paid interpreter untouched); an open question falls through to the cascade
WITH the deterministic evidence injected as grounding; the ack for the paid
interpreter never precedes a deterministic answer."""

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

NOVEL_OCR = [
    "-27/K44",
    "A1",
    "A2",
    "13",
    "14",
    "21",
    "22",
    "-X7:1",
    "-W7301",
    "18.4",
    "-X5.2",
    "-27/Q30",
]


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


def _ctx():
    c = MagicMock()
    c.bot.send_document = AsyncMock()
    return c


def _wire(monkeypatch, question_router):
    async def vision(photo_b64, message):
        return {
            "classification": "ELECTRICAL_PRINT",
            "classification_confidence": 0.9,
            "vision_result": "a schematic drawing",
            "ocr_items": list(NOVEL_OCR),
            "tesseract_text": "",
            "drawing_type": "control circuit",
            "drawing_type_confidence": 0.8,
        }

    monkeypatch.setattr(bot.engine.vision, "process", vision)
    monkeypatch.setattr(bot.engine.router, "complete", question_router)
    # Paid seam: returns "" (unconfigured behavior) so the fall-through path
    # proceeds to the cascade; the REAL paid call is separately guarded so any
    # attempt to spend is a hard test failure.
    paid_seam = AsyncMock(return_value="")
    monkeypatch.setattr(bot.engine, "_interpret_print_anthropic", paid_seam)
    from printsense import interpret as _interp

    monkeypatch.setattr(
        _interp,
        "interpret_print",
        MagicMock(side_effect=AssertionError("paid provider must never be called")),
    )
    monkeypatch.setattr(bot, "_print_interpreter_configured", lambda: False)
    monkeypatch.setattr(bot, "typing_action", _NullTyping)
    return paid_seam


async def test_closed_form_question_answered_with_zero_model_calls(monkeypatch):
    router = AsyncMock(side_effect=AssertionError("cascade must not be called"))
    paid = _wire(monkeypatch, router)
    update = _update()
    claimed = await bot._try_print_translator_reply(
        b"png",
        b"png",
        "Is contact 21/22 on -27/K44 normally open or normally closed?",
        update,
        _ctx(),
    )
    assert claimed is True
    router.assert_not_awaited()
    paid.assert_not_awaited()
    texts = [c.args[0] for c in update.message.reply_text.await_args_list]
    assert len(texts) == 1  # answer only — no interpreter ack preceded it
    low = texts[0].lower()
    assert "normally closed" in low and "normally open" not in low
    assert "verify" in low  # deterministic caveat shipped with the answer
    assert "iec" in low  # citation shipped with the answer


async def test_open_question_falls_through_with_evidence_grounding(monkeypatch):
    captured: dict = {}

    async def router(messages, **kwargs):
        captured["messages"] = messages
        return "scripted grounded theory answer", {"provider": "scripted", "model": "canned"}

    _wire(monkeypatch, AsyncMock(side_effect=router))
    update = _update()
    claimed = await bot._try_print_translator_reply(
        b"png", b"png", "What does this circuit appear to do?", update, _ctx()
    )
    assert claimed is True
    # the guarded interpret_print never fired (it raises on any call), so the
    # paid provider was untouched even though the seam itself was consulted
    user_text = next(
        block["text"] for block in captured["messages"][1]["content"] if block.get("type") == "text"
    )
    assert "Deterministic decoded evidence" in user_text
    assert "21-22 = NC" in user_text
    assert "18.4" in user_text and "-W7301" in user_text


async def test_deterministic_layer_error_never_eats_the_turn(monkeypatch):
    async def router(messages, **kwargs):
        return "cascade answer", {"provider": "scripted", "model": "canned"}

    _wire(monkeypatch, AsyncMock(side_effect=router))
    import printsense.deterministic_qa as dq

    monkeypatch.setattr(dq, "try_deterministic_answer", MagicMock(side_effect=RuntimeError("boom")))
    update = _update()
    claimed = await bot._try_print_translator_reply(
        b"png", b"png", "Is 21/22 normally closed?", update, _ctx()
    )
    assert claimed is True  # fell through to the cascade instead of crashing
