"""Hook integration — the REAL `bot._try_print_translator_reply` fires the
per-turn autoeval after both reply branches, fail-open, without touching the
reply or adding any model call (spend law). Hermetic: no network, no paid
provider (the paid seam raises if touched), `log_turn`/`send_push` mocked."""

from __future__ import annotations

import asyncio
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
from shared import print_autoeval  # noqa: E402


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


async def _drain_tasks():
    """Let the fire-and-forget autoeval task run to completion."""
    for _ in range(4):
        await asyncio.sleep(0)


def _vision(ocr_items=None):
    async def process(photo_b64, message):
        return {
            "classification": "ELECTRICAL_PRINT",
            "classification_confidence": 0.9,
            "vision_result": "a schematic drawing",
            "ocr_items": list(ocr_items or []),
            "tesseract_text": "",
            "drawing_type": "control circuit",
            "drawing_type_confidence": 0.8,
        }

    return process


@pytest.fixture
def wired(monkeypatch):
    """Real rung, theory branch scripted, everything external mocked."""
    monkeypatch.setattr(bot.engine.vision, "process", _vision(["-27/K44", "21", "22"]))
    monkeypatch.setattr(bot, "_print_interpreter_configured", lambda: False)
    monkeypatch.setattr(bot, "typing_action", _NullTyping)
    monkeypatch.setattr(bot.engine.router, "last_model_for", lambda _sid: "together/gemma-test")
    from printsense import interpret as _interp

    monkeypatch.setattr(
        _interp,
        "interpret_print",
        MagicMock(side_effect=AssertionError("paid provider must never be called")),
    )
    monkeypatch.setattr(_interp, "pop_last_usage", lambda: None)
    log_turn = AsyncMock()
    push = AsyncMock()
    monkeypatch.setattr(bot, "log_turn", log_turn)
    monkeypatch.setattr(bot, "send_push", push)
    monkeypatch.setattr(print_autoeval, "ALERT_LIMITER", print_autoeval.AlertRateLimiter())
    return {"log_turn": log_turn, "push": push, "monkeypatch": monkeypatch}


async def _run_theory_turn(wired, reply_text, caption="explain this print to me"):
    async def grounded(*a, **k):
        return reply_text

    wired["monkeypatch"].setattr(bot.engine, "_grounded_print_reply", grounded)
    update = _update()
    claimed = await bot._try_print_translator_reply(b"raw", b"vision", caption, update, MagicMock())
    await _drain_tasks()
    return claimed, update


@pytest.mark.asyncio
async def test_theory_turn_captured_with_meta(wired):
    claimed, update = await _run_theory_turn(
        wired, "This sheet shows a start/stop circuit. Verify with a meter."
    )
    assert claimed is True
    update.message.reply_text.assert_awaited()  # reply delivered, unaltered path
    kw = wired["log_turn"].await_args.kwargs
    assert kw["source"] == "telegram"
    assert kw["intent"] == "print_translator"
    assert kw["meta"]["surface"] == "print_translator"
    autoeval = kw["meta"]["autoeval"]
    assert autoeval["branch"] == "theory"
    assert autoeval["severity"] == "ok"
    assert autoeval["provider"] == "together"
    assert kw["bot_response"].startswith("This sheet shows")  # grades the sent text
    wired["push"].assert_not_awaited()


@pytest.mark.asyncio
async def test_deterministic_branch_captured_without_model_calls(wired):
    router = AsyncMock()
    wired["monkeypatch"].setattr(bot.engine.router, "complete", router)
    update = _update()
    claimed = await bot._try_print_translator_reply(
        b"raw", b"vision", "is the 21/22 contact normally open or closed?", update, MagicMock()
    )
    await _drain_tasks()
    assert claimed is True
    router.assert_not_awaited()  # spend law: the hook added zero model calls
    kw = wired["log_turn"].await_args.kwargs
    assert kw["meta"]["autoeval"]["branch"] == "deterministic_fastpath"
    assert kw["has_citations"] is True


@pytest.mark.asyncio
async def test_p0_alert_fires_once_then_rate_limits(wired):
    claimed, _ = await _run_theory_turn(wired, "The contactor is energized.")
    assert claimed is True
    wired["push"].assert_awaited_once()
    assert wired["push"].await_args.kwargs["priority"] == "high"

    claimed, _ = await _run_theory_turn(wired, "The contactor is energized.")
    assert claimed is True
    wired["push"].assert_awaited_once()  # limiter suppressed the repeat


@pytest.mark.asyncio
@pytest.mark.parametrize("broken", ["evaluate", "log_turn", "push"])
async def test_fail_open_never_touches_the_reply(wired, broken):
    if broken == "evaluate":
        wired["monkeypatch"].setattr(
            print_autoeval,
            "evaluate_print_turn",
            MagicMock(side_effect=RuntimeError("boom")),
        )
    elif broken == "log_turn":
        wired["log_turn"].side_effect = RuntimeError("boom")
    else:
        wired["push"].side_effect = RuntimeError("boom")
        wired["monkeypatch"].setattr(
            bot.engine, "_grounded_print_reply", AsyncMock(return_value="It is energized.")
        )
    claimed, update = await _run_theory_turn(wired, "The contactor is energized.")
    assert claimed is True
    update.message.reply_text.assert_awaited()  # technician still got the answer


@pytest.mark.asyncio
async def test_kill_switch_disables_capture(wired, monkeypatch):
    monkeypatch.setenv("PRINT_AUTOEVAL_ENABLED", "0")
    claimed, _ = await _run_theory_turn(wired, "Anything at all.")
    assert claimed is True
    wired["log_turn"].assert_not_awaited()
    wired["push"].assert_not_awaited()
