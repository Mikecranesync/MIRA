"""P0-2 regenerate rollback must write conversation_state_v2 under unscoped."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[2]
_BOTS = _REPO / "mira-bots"
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))
if str(_BOTS) not in sys.path:
    sys.path.insert(0, str(_BOTS))

from shared.session_manager import (  # noqa: E402
    CONVERSATION_STATE_TABLE,
    UNSCOPED_CONVERSATION_TENANT,
    ensure_table,
    load_state,
    save_state,
)


@pytest.fixture
def db_path(tmp_path):
    path = str(tmp_path / "mira.db")
    ensure_table(path)
    return path


def _seed_v2_q3_and_interactions(db_path: str, chat_id: str) -> None:
    save_state(
        db_path,
        chat_id,
        {"state": "Q3", "exchange_count": 2, "context": {}},
        tenant_id=UNSCOPED_CONVERSATION_TENANT,
    )
    db = sqlite3.connect(db_path)
    db.execute(
        """INSERT INTO interactions
           (chat_id, platform, user_message, bot_response, fsm_state)
           VALUES (?, 'openwebui', 'q1', 'a1', 'Q1')""",
        (chat_id,),
    )
    db.execute(
        """INSERT INTO interactions
           (chat_id, platform, user_message, bot_response, fsm_state)
           VALUES (?, 'openwebui', 'q2', 'a2', 'Q2')""",
        (chat_id,),
    )
    db.commit()
    db.close()


def test_regenerate_rollback_writes_v2_unscoped(db_path):
    """BRAVO #4852: regenerate of q2 must restore v2 state to Q1, not miss the table."""
    from main import _detect_and_rollback_regenerate

    chat = "ow-regen-1"
    _seed_v2_q3_and_interactions(db_path, chat)

    rolled = _detect_and_rollback_regenerate(db_path, chat, "q2")
    assert rolled is True
    after = load_state(db_path, chat, tenant_id=UNSCOPED_CONVERSATION_TENANT)
    assert after["state"] == "Q1"

    db = sqlite3.connect(db_path)
    leftover = db.execute(
        "SELECT user_message FROM interactions WHERE chat_id = ? ORDER BY id",
        (chat,),
    ).fetchall()
    tables = {
        row[0]
        for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    db.close()
    assert [r[0] for r in leftover] == ["q1"]
    assert CONVERSATION_STATE_TABLE in tables
    # Fresh ensure_table DBs have no legacy table; rollback must still work.
    assert "conversation_state" not in tables


def test_regenerate_rollback_does_not_touch_legacy_when_both_tables_exist(tmp_path):
    """BRAVO correction (comment 6453435346): 001 + ensure_table, v2 at Q3.

    Old UPDATE conversation_state rolled the legacy row to Q1 and left v2 at Q3.
    The engine reads v2, so regenerate must write v2 and leave legacy alone.
    """
    from main import _detect_and_rollback_regenerate

    db_path = str(tmp_path / "mixed.db")
    db = sqlite3.connect(db_path)
    db.executescript((_REPO / "mira-bridge/migrations/001_add_gsd_state.sql").read_text())
    db.close()
    ensure_table(db_path)

    chat = "ow-regen-mixed"
    db = sqlite3.connect(db_path)
    db.execute(
        "INSERT INTO conversation_state (chat_id, state) VALUES (?, ?)",
        (chat, "Q3"),
    )
    db.commit()
    db.close()
    _seed_v2_q3_and_interactions(db_path, chat)

    rolled = _detect_and_rollback_regenerate(db_path, chat, "q2")
    assert rolled is True
    assert load_state(db_path, chat, tenant_id=UNSCOPED_CONVERSATION_TENANT)["state"] == "Q1"

    db = sqlite3.connect(db_path)
    legacy = db.execute(
        "SELECT state FROM conversation_state WHERE chat_id = ?", (chat,)
    ).fetchone()
    leftover = db.execute(
        "SELECT user_message FROM interactions WHERE chat_id = ? ORDER BY id",
        (chat,),
    ).fetchall()
    db.close()
    assert legacy[0] == "Q3"
    assert [r[0] for r in leftover] == ["q1"]


