"""MIRA Session Manager — SQLite-backed conversation state persistence.

Extracted from engine.py (Supervisor class) to be independently testable.
engine.py delegates all state read/write work here.

Dependency direction: session_manager ← stdlib only (no engine imports)
"""

from __future__ import annotations

import json
import logging
import sqlite3

logger = logging.getLogger("mira-gsd")


def ensure_table(db_path: str) -> None:
    """Create conversation_state and related tables if they don't exist."""
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS conversation_state (
            chat_id          TEXT PRIMARY KEY,
            state            TEXT NOT NULL DEFAULT 'IDLE',
            context          TEXT NOT NULL DEFAULT '{}',
            asset_identified TEXT,
            fault_category   TEXT,
            exchange_count   INTEGER NOT NULL DEFAULT 0,
            final_state      TEXT,
            voice_enabled    INTEGER NOT NULL DEFAULT 0,
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS feedback_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id         TEXT NOT NULL,
            feedback        TEXT NOT NULL,
            reason          TEXT,
            last_reply      TEXT,
            exchange_count  INTEGER,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS interactions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id          TEXT NOT NULL,
            platform         TEXT NOT NULL DEFAULT 'telegram',
            user_message     TEXT NOT NULL,
            bot_response     TEXT NOT NULL,
            fsm_state        TEXT,
            intent           TEXT,
            has_photo        INTEGER DEFAULT 0,
            confidence       TEXT,
            response_time_ms INTEGER,
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    try:
        db.execute(
            "ALTER TABLE conversation_state ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0"
        )
    except Exception as e:
        logger.debug("voice_enabled column already exists: %s", e)
    db.commit()
    db.close()


def load_state(db_path: str, chat_id: str) -> dict:
    """Load conversation state from SQLite. Returns a fresh IDLE state if not found."""
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.row_factory = sqlite3.Row
    row = db.execute(
        "SELECT * FROM conversation_state WHERE chat_id = ?", (chat_id,)
    ).fetchone()
    db.close()
    if row:
        state = dict(row)
        try:
            state["context"] = json.loads(state["context"])
        except (json.JSONDecodeError, TypeError):
            state["context"] = {}
        state["context"].setdefault("session_context", {})
        return state
    return {
        "chat_id": chat_id,
        "state": "IDLE",
        "context": {"session_context": {}},
        "asset_identified": None,
        "fault_category": None,
        "exchange_count": 0,
        "final_state": None,
    }


def save_state(db_path: str, chat_id: str, state: dict) -> None:
    """Persist conversation state to SQLite."""
    context_json = json.dumps(state.get("context", {}))
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        """INSERT INTO conversation_state
           (chat_id, state, context, asset_identified, fault_category,
            exchange_count, final_state, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(chat_id) DO UPDATE SET
             state = excluded.state,
             context = excluded.context,
             asset_identified = excluded.asset_identified,
             fault_category = excluded.fault_category,
             exchange_count = excluded.exchange_count,
             final_state = excluded.final_state,
             updated_at = CURRENT_TIMESTAMP""",
        (
            chat_id,
            state["state"],
            context_json,
            state.get("asset_identified"),
            state.get("fault_category"),
            state["exchange_count"],
            state.get("final_state"),
        ),
    )
    db.commit()
    db.close()


def record_exchange(db_path: str, chat_id: str, state: dict, message: str, reply: str) -> None:
    """Save a user/assistant exchange to conversation history and persist state."""
    ctx = state.get("context") or {}
    history = ctx.get("history", [])
    history.append({"role": "user", "content": message})
    history.append({"role": "assistant", "content": reply})
    ctx["history"] = history
    state["context"] = ctx
    save_state(db_path, chat_id, state)


def log_interaction(
    db_path: str,
    chat_id: str,
    message: str,
    reply: str,
    *,
    fsm_state: str = "",
    intent: str = "",
    has_photo: bool = False,
    confidence: str = "",
    response_time_ms: int = 0,
    platform: str = "telegram",
) -> None:
    """Append-only log of every user/bot exchange for quality analysis."""
    try:
        db = sqlite3.connect(db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            """INSERT INTO interactions
               (chat_id, platform, user_message, bot_response, fsm_state,
                intent, has_photo, confidence, response_time_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                chat_id,
                platform,
                message,
                reply,
                fsm_state,
                intent,
                int(has_photo),
                confidence,
                response_time_ms,
            ),
        )
        db.commit()
        db.close()
    except Exception as e:
        logger.warning("Failed to log interaction: %s", e)
