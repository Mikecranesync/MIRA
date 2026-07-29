"""Print-turn persistence — every PrintSense request + full final reply lands in
the same ``interactions`` table as chat turns (2026-07-15 operator directive;
supersedes PR #2714, whose engine-seam implementation predated the OpenAI
interpreter swap and the v3.163.0 autoeval hook).

The write site is the bot-layer autoeval hook (`_autoeval_print_turn`) — the
choke point the bot fast-path turns flow through; engine-path photo turns
already log via ``engine.process``. Provenance per turn: input sha256 · caption
· route (deterministic_fastpath / printsense / cascade) · model · timing ·
fallback reason · full reply text.

Hermetic — tmp sqlite, mocked vision/router/paid seam, no network."""

from __future__ import annotations

import asyncio
import hashlib
import os
import sqlite3
import sys
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, "mira-bots")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))

import pytest  # noqa: E402

pytest.importorskip("pydantic")

import bot  # noqa: E402
from shared import print_autoeval  # noqa: E402
from shared.session_manager import ensure_table, log_interaction  # noqa: E402

EXTRA_COLUMNS = {"route", "model", "devices", "input_sha256", "fallback_reason"}


def _cols(db_path: str) -> set[str]:
    db = sqlite3.connect(db_path)
    cols = {r[1] for r in db.execute("PRAGMA table_info(interactions)")}
    db.close()
    return cols


# --------------------------------------------------------------------------- #
# schema (verbatim from the superseded branch)
# --------------------------------------------------------------------------- #


def test_new_columns_created_and_idempotent(tmp_path):
    db_path = str(tmp_path / "m.db")
    ensure_table(db_path)
    ensure_table(db_path)  # second run must not raise (ALTERs are guarded)
    assert EXTRA_COLUMNS <= _cols(db_path)


def test_existing_db_is_upgraded_in_place(tmp_path):
    """A prod-shaped db created BEFORE this change gains the columns on the
    next ensure_table() — no manual migration."""
    db_path = str(tmp_path / "old.db")
    db = sqlite3.connect(db_path)
    db.execute(
        """CREATE TABLE interactions (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             chat_id TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'telegram',
             user_message TEXT NOT NULL, bot_response TEXT NOT NULL,
             fsm_state TEXT, intent TEXT, has_photo INTEGER DEFAULT 0,
             confidence TEXT, response_time_ms INTEGER,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"""
    )
    db.commit()
    db.close()
    ensure_table(db_path)
    assert EXTRA_COLUMNS <= _cols(db_path)


def test_log_interaction_round_trips_extras(tmp_path):
    db_path = str(tmp_path / "m.db")
    ensure_table(db_path)
    log_interaction(
        db_path,
        "chat-9",
        "Explain this print to me",
        "FULL INTERPRETATION TEXT",
        fsm_state="ELECTRICAL_PRINT",
        intent="print",
        has_photo=True,
        response_time_ms=1234,
        route="printsense",
        model="gpt-5.5",
        devices=7,
        input_sha256="ab" * 32,
        fallback_reason=None,
    )
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    row = dict(db.execute("SELECT * FROM interactions ORDER BY id DESC LIMIT 1").fetchone())
    db.close()
    assert row["bot_response"] == "FULL INTERPRETATION TEXT"
    assert row["route"] == "printsense"
    assert row["model"] == "gpt-5.5"
    assert row["devices"] == 7
    assert row["input_sha256"] == "ab" * 32
    assert row["fallback_reason"] is None


# --------------------------------------------------------------------------- #
# the choke point: the bot autoeval hook persists every print turn
# --------------------------------------------------------------------------- #

_RAW = b"fake-print-image-bytes"
_RAW_SHA = hashlib.sha256(_RAW).hexdigest()


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
    for _ in range(4):
        await asyncio.sleep(0)


def _last_row(db_path: str) -> dict:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT * FROM interactions ORDER BY id DESC LIMIT 1").fetchone()
    db.close()
    assert row is not None, "no interactions row was written"
    return dict(row)


@pytest.fixture
def wired(monkeypatch, tmp_path):
    """Real rung with a REAL tmp interactions db behind engine._log_interaction."""
    db_path = str(tmp_path / "interactions.db")
    ensure_table(db_path)
    monkeypatch.setattr(bot.engine, "db_path", db_path)

    async def vision(photo_b64, message):
        return {
            "classification": "ELECTRICAL_PRINT",
            "classification_confidence": 0.9,
            "vision_result": "a schematic drawing",
            "ocr_items": ["-27/K44"],
            "tesseract_text": "",
            "drawing_type": "control circuit",
            "drawing_type_confidence": 0.8,
        }

    monkeypatch.setattr(bot.engine.vision, "process", vision)
    monkeypatch.setattr(bot, "_print_interpreter_configured", lambda: False)
    monkeypatch.setattr(bot, "typing_action", _NullTyping)
    monkeypatch.setattr(bot.engine.router, "last_model_for", lambda _sid: "together/gemma-test")
    from printsense import interpret as _interp

    monkeypatch.setattr(_interp, "pop_last_usage", lambda: None)
    monkeypatch.setattr(bot, "log_turn", AsyncMock())
    monkeypatch.setattr(bot, "send_push", AsyncMock())
    monkeypatch.setattr(print_autoeval, "ALERT_LIMITER", print_autoeval.AlertRateLimiter())
    return {"db_path": db_path, "monkeypatch": monkeypatch}


@pytest.mark.asyncio
async def test_theory_turn_is_persisted_with_provenance(wired):
    wired["monkeypatch"].setattr(
        bot.engine,
        "_grounded_print_reply",
        AsyncMock(return_value="FULL CASCADE REPLY. Verify with a meter."),
    )
    update = _update()
    claimed = await bot._try_print_translator_reply(
        _RAW, b"vision", "Explain this print to me", update, MagicMock()
    )
    await _drain_tasks()
    assert claimed is True
    row = _last_row(wired["db_path"])
    assert row["user_message"] == "Explain this print to me"
    assert row["bot_response"] == "FULL CASCADE REPLY. Verify with a meter."
    assert row["route"] == "cascade"
    assert row["fallback_reason"] == "interpreter_not_configured"
    assert row["model"] == "gemma-test"
    assert row["input_sha256"] == _RAW_SHA
    assert row["has_photo"] == 1
    assert row["fsm_state"] == "ELECTRICAL_PRINT"
    assert row["response_time_ms"] >= 0


@pytest.mark.asyncio
async def test_deterministic_turn_is_persisted(wired):
    update = _update()
    claimed = await bot._try_print_translator_reply(
        _RAW, b"vision", "is the 21/22 contact normally open or closed?", update, MagicMock()
    )
    await _drain_tasks()
    assert claimed is True
    row = _last_row(wired["db_path"])
    assert row["route"] == "deterministic_fastpath"
    assert row["fallback_reason"] is None
    assert row["input_sha256"] == _RAW_SHA
    assert row["bot_response"]  # the full deterministic reply text


@pytest.mark.asyncio
async def test_persistence_failure_never_eats_the_reply(wired):
    """Logging is best-effort: a broken DB must not break the technician's
    answer — nor the conversation_eval capture that precedes it."""
    wired["monkeypatch"].setattr(bot.engine, "db_path", "Z:/nonexistent/dir/nope.db")
    wired["monkeypatch"].setattr(
        bot.engine, "_grounded_print_reply", AsyncMock(return_value="REPLY")
    )
    update = _update()
    claimed = await bot._try_print_translator_reply(
        _RAW, b"vision", "explain this print", update, MagicMock()
    )
    await _drain_tasks()
    assert claimed is True
    update.message.reply_text.assert_awaited()
    bot.log_turn.assert_awaited()  # NeonDB capture still happened
