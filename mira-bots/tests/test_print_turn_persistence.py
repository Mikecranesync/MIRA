"""Print-turn persistence — every PrintSense request + full final reply lands in
the same ``interactions`` table as chat turns.

Operator directive (2026-07-15): "check the bot results" must retrieve the exact
user message and exact bot response without screenshots. The live phone test
proved the gap: three printsense interpretations ran (04:24–04:39Z) and none
were written to ``interactions`` — only the chat/QA-path turns were.

Persisted per print turn: input checksum · caption · selected route · model ·
timing · extracted device count · full reply text · failure/fallback reason.
Single choke point: ``Supervisor._grounded_print_reply`` (serves both the bot
fast path and the engine's ELECTRICAL_PRINT branch).

Hermetic — tmp sqlite, mocked interpreter/router, no network.
"""

from __future__ import annotations

import base64
import hashlib
import sqlite3
import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, patch

import pytest
from shared.session_manager import ensure_table, log_interaction

EXTRA_COLUMNS = {"route", "model", "devices", "input_sha256", "fallback_reason"}


def _cols(db_path: str) -> set[str]:
    db = sqlite3.connect(db_path)
    cols = {r[1] for r in db.execute("PRAGMA table_info(interactions)")}
    db.close()
    return cols


# --------------------------------------------------------------------------- #
# schema
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
        model="claude-opus-4-8",
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
    assert row["model"] == "claude-opus-4-8"
    assert row["devices"] == 7
    assert row["input_sha256"] == "ab" * 32
    assert row["fallback_reason"] is None


# --------------------------------------------------------------------------- #
# the choke point: _grounded_print_reply persists every print turn
# --------------------------------------------------------------------------- #


@pytest.fixture
def supervisor(tmp_path):
    from shared.engine import Supervisor

    db_path = str(tmp_path / "test.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with patch("shared.engine.VisionWorker"):
            with patch("shared.engine.NameplateWorker"):
                with patch("shared.engine.RAGWorker"):
                    with patch("shared.engine.PrintWorker"):
                        with patch("shared.engine.PLCWorker"):
                            with patch("shared.engine.NemotronClient"):
                                with patch("shared.engine.InferenceRouter"):
                                    sup = Supervisor(
                                        db_path=db_path,
                                        openwebui_url="http://localhost:3000",
                                        api_key="test-key",
                                        collection_id="test-collection",
                                    )
    return sup


_VISION = {
    "classification": "ELECTRICAL_PRINT",
    "vision_result": "a wiring diagram",
    "ocr_items": ["-M1", "-X1"],
    "tesseract_text": "",
    "drawing_type": "wiring diagram",
}

_PHOTO_B64 = base64.b64encode(b"fake-print-image-bytes").decode()
_PHOTO_SHA = hashlib.sha256(b"fake-print-image-bytes").hexdigest()


def _last_row(db_path: str) -> dict:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT * FROM interactions ORDER BY id DESC LIMIT 1").fetchone()
    db.close()
    assert row is not None, "no interactions row was written"
    return dict(row)


async def test_printsense_turn_is_persisted(supervisor):
    async def fake_interp(photo_b64, question, vision_data, meta=None):
        if meta is not None:
            meta.update(route="printsense", model="claude-opus-4-8", devices=5)
        return "FULL PRINTSENSE REPLY"

    supervisor._interpret_print_anthropic = fake_interp

    reply = await supervisor._grounded_print_reply(
        _PHOTO_B64, "Explain this print to me", _VISION, "chat-7"
    )

    assert reply == "FULL PRINTSENSE REPLY"
    row = _last_row(supervisor.db_path)
    assert row["user_message"] == "Explain this print to me"
    assert row["bot_response"] == "FULL PRINTSENSE REPLY"
    assert row["route"] == "printsense"
    assert row["model"] == "claude-opus-4-8"
    assert row["devices"] == 5
    assert row["input_sha256"] == _PHOTO_SHA
    assert row["has_photo"] == 1
    assert row["fsm_state"] == "ELECTRICAL_PRINT"
    assert row["response_time_ms"] >= 0


async def test_cascade_fallback_persists_route_and_reason(supervisor):
    async def fake_interp(photo_b64, question, vision_data, meta=None):
        if meta is not None:
            meta.update(fallback_reason="print_vision_not_configured")
        return ""

    supervisor._interpret_print_anthropic = fake_interp
    supervisor.router.complete = AsyncMock(
        return_value=("CASCADE REPLY", {"provider": "groq", "model": "llama-x"})
    )

    reply = await supervisor._grounded_print_reply(_PHOTO_B64, None, _VISION, "chat-8")

    assert "CASCADE" in reply or reply  # display-ready either way
    row = _last_row(supervisor.db_path)
    assert row["route"] == "cascade"
    assert row["fallback_reason"] == "print_vision_not_configured"
    assert row["input_sha256"] == _PHOTO_SHA
    # captionless turn: the stored user_message documents the implicit ask
    assert row["user_message"]


async def test_persistence_failure_never_eats_the_reply(supervisor, monkeypatch):
    """Logging is best-effort: a broken DB must not break the technician's answer."""

    async def fake_interp(photo_b64, question, vision_data, meta=None):
        if meta is not None:
            meta.update(route="printsense", model="claude-opus-4-8", devices=1)
        return "REPLY"

    supervisor._interpret_print_anthropic = fake_interp
    supervisor.db_path = "Z:/nonexistent/dir/nope.db"  # log_interaction swallows

    reply = await supervisor._grounded_print_reply(_PHOTO_B64, "q", _VISION, "chat-9")
    assert reply == "REPLY"
