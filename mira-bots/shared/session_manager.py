"""MIRA Session Manager — SQLite-backed conversation state persistence.

Extracted from engine.py (Supervisor class) to be independently testable.
engine.py delegates all state read/write work here.

Dependency direction: session_manager ← stdlib only (no engine imports)

Slice 1 (#4844): conversation_state is keyed by (tenant_id, chat_id).
load/save/record_exchange require a trusted tenant from authenticated
context. Empty tenant fails closed — never env, payload tenant_id, or
raw chat_id for state writes.
"""

from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import sqlite3
from collections.abc import Iterator

logger = logging.getLogger("mira-gsd")

# Request-scoped trusted tenant for conversation-state reads/writes.
# Set only from the per-call process()/process_full() tenant_id argument
# (ChatDispatcher passes mira_user.tenant_id). Never from MIRA_TENANT_ID,
# resolve_tenant(chat_id), or an untrusted payload field.
_STATE_TENANT: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "mira_conversation_state_tenant", default=None
)

CONVERSATION_STATE_DDL = """
        CREATE TABLE IF NOT EXISTS conversation_state (
            tenant_id        TEXT NOT NULL,
            chat_id          TEXT NOT NULL,
            state            TEXT NOT NULL DEFAULT 'IDLE',
            context          TEXT NOT NULL DEFAULT '{}',
            asset_identified TEXT,
            fault_category   TEXT,
            exchange_count   INTEGER NOT NULL DEFAULT 0,
            final_state      TEXT,
            voice_enabled    INTEGER NOT NULL DEFAULT 0,
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenant_id, chat_id)
        )
    """


class MissingConversationTenant(ValueError):
    """Raised when a conversation-state read/write has no trusted tenant."""


def require_conversation_tenant(tenant_id: str | None) -> str:
    """Return a non-empty tenant_id or fail closed.

    State writes must not fall back to MIRA_TENANT_ID, chat_id, or a
    payload-supplied tenant. Callers that lack a trusted tenant are
    rejected here rather than silently sharing a row.
    """
    tid = (tenant_id or "").strip()
    if not tid:
        raise MissingConversationTenant(
            "conversation state requires a trusted tenant_id from authenticated context"
        )
    return tid


def current_conversation_tenant(explicit: str | None = None) -> str:
    """Resolve the trusted tenant for a state read/write.

    Prefer an explicit argument when it is a non-empty string; otherwise
    use the request-scoped ContextVar. Never reads env or chat_id.
    """
    if explicit is not None and str(explicit).strip():
        return require_conversation_tenant(explicit)
    return require_conversation_tenant(_STATE_TENANT.get())


@contextlib.contextmanager
def bind_conversation_tenant(tenant_id: str | None) -> Iterator[None]:
    """Bind the request-scoped tenant for conversation-state access."""
    token = _STATE_TENANT.set((tenant_id or "").strip() or None)
    try:
        yield
    finally:
        _STATE_TENANT.reset(token)


def _conversation_state_needs_rebuild(db: sqlite3.Connection) -> bool:
    """True when the live table is missing or still uses the chat_id-only PK.

    Owner decision #4844: existing rows have no tenant to backfill from
    and state is short-lived — START FRESH (drop + recreate). Do not
    assign old rows to a tenant.
    """
    info = list(db.execute("PRAGMA table_info(conversation_state)"))
    if not info:
        return False
    names = {row[1] for row in info}
    pk_cols = [row[1] for row in sorted(info, key=lambda r: r[5]) if row[5]]
    return "tenant_id" not in names or pk_cols != ["tenant_id", "chat_id"]


def ensure_table(db_path: str) -> None:
    """Create conversation_state and related tables if they don't exist.

    Rebuilds conversation_state when the live schema is still keyed by
    chat_id only. That drop is intentional (START FRESH) — in-flight
    rows are short-lived session state, not durable history.
    """
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    if _conversation_state_needs_rebuild(db):
        logger.warning(
            "conversation_state schema is chat_id-only — dropping and recreating "
            "with PRIMARY KEY (tenant_id, chat_id); in-flight rows are discarded (#4844 START FRESH)"
        )
        db.execute("DROP TABLE conversation_state")
    db.execute(CONVERSATION_STATE_DDL)
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
    # Print-turn provenance columns (2026-07-15 operator directive: every
    # PrintSense request + full reply must be retrievable from THIS table).
    # SQLite has no ADD COLUMN IF NOT EXISTS — guarded ALTERs upgrade a prod
    # db in place and no-op on every later start.
    for _col_ddl in (
        "route TEXT",
        "model TEXT",
        "devices INTEGER",
        "input_sha256 TEXT",
        "fallback_reason TEXT",
    ):
        try:
            db.execute(f"ALTER TABLE interactions ADD COLUMN {_col_ddl}")
        except sqlite3.OperationalError:
            pass  # already present
    db.commit()
    db.close()


def load_state(db_path: str, chat_id: str, tenant_id: str | None = None) -> dict:
    """Load conversation state from SQLite. Returns a fresh IDLE state if not found.

    Requires a trusted tenant (argument or request-scoped bind). Two tenants
    that share a chat_id get separate rows.
    """
    tid = current_conversation_tenant(tenant_id)
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.row_factory = sqlite3.Row
    row = db.execute(
        "SELECT * FROM conversation_state WHERE tenant_id = ? AND chat_id = ?",
        (tid, chat_id),
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
        "tenant_id": tid,
        "state": "IDLE",
        "context": {"session_context": {}},
        "asset_identified": None,
        "fault_category": None,
        "exchange_count": 0,
        "final_state": None,
    }


def save_state(db_path: str, chat_id: str, state: dict, tenant_id: str | None = None) -> None:
    """Persist conversation state to SQLite under (tenant_id, chat_id)."""
    tid = current_conversation_tenant(tenant_id)
    context_json = json.dumps(state.get("context", {}))
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        """INSERT INTO conversation_state
           (tenant_id, chat_id, state, context, asset_identified, fault_category,
            exchange_count, final_state, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(tenant_id, chat_id) DO UPDATE SET
             state = excluded.state,
             context = excluded.context,
             asset_identified = excluded.asset_identified,
             fault_category = excluded.fault_category,
             exchange_count = excluded.exchange_count,
             final_state = excluded.final_state,
             updated_at = CURRENT_TIMESTAMP""",
        (
            tid,
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


def record_exchange(
    db_path: str,
    chat_id: str,
    state: dict,
    message: str,
    reply: str,
    tenant_id: str | None = None,
) -> None:
    """Save a user/assistant exchange to conversation history and persist state."""
    ctx = state.get("context") or {}
    history = ctx.get("history", [])
    history.append({"role": "user", "content": message})
    history.append({"role": "assistant", "content": reply})
    ctx["history"] = history
    state["context"] = ctx
    save_state(db_path, chat_id, state, tenant_id=tenant_id)


def get_voice_enabled(db_path: str, chat_id: str, tenant_id: str | None = None) -> bool:
    """Read voice_enabled for this (tenant_id, chat_id). Fail closed without tenant."""
    tid = current_conversation_tenant(tenant_id)
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    try:
        row = db.execute(
            "SELECT voice_enabled FROM conversation_state WHERE tenant_id = ? AND chat_id = ?",
            (tid, chat_id),
        ).fetchone()
        return bool(row[0]) if row else False
    finally:
        db.close()


def set_voice_enabled(
    db_path: str, chat_id: str, enabled: bool, tenant_id: str | None = None
) -> None:
    """Upsert voice_enabled for this (tenant_id, chat_id). Fail closed without tenant."""
    tid = current_conversation_tenant(tenant_id)
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        """INSERT INTO conversation_state (tenant_id, chat_id, voice_enabled)
           VALUES (?, ?, ?)
           ON CONFLICT(tenant_id, chat_id) DO UPDATE SET
             voice_enabled = excluded.voice_enabled""",
        (tid, chat_id, 1 if enabled else 0),
    )
    db.commit()
    db.close()


def get_recent_interactions(db_path: str, since_id: int = 0, limit: int = 500) -> list[dict]:
    """Fetch interactions newer than since_id without a full table scan."""
    try:
        db = sqlite3.connect(db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT * FROM interactions WHERE id > ? ORDER BY id LIMIT ?",
            (since_id, limit),
        ).fetchall()
        db.close()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning("get_recent_interactions failed: %s", e)
        return []


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
    route: str | None = None,
    model: str | None = None,
    devices: int | None = None,
    input_sha256: str | None = None,
    fallback_reason: str | None = None,
) -> None:
    """Append-only log of every user/bot exchange for quality analysis.

    The optional provenance fields (``route``/``model``/``devices``/
    ``input_sha256``/``fallback_reason``) are populated by print turns so
    "check the bot results" retrieves the full story without screenshots
    (2026-07-15 operator directive).

    Slice 1 does not re-key ``interactions`` (S2) — that store is out of
    scope. This logger is append-only and is not a conversation-state upsert.
    """
    try:
        db = sqlite3.connect(db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            """INSERT INTO interactions
               (chat_id, platform, user_message, bot_response, fsm_state,
                intent, has_photo, confidence, response_time_ms,
                route, model, devices, input_sha256, fallback_reason)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                route,
                model,
                devices,
                input_sha256,
                fallback_reason,
            ),
        )
        db.commit()
        db.close()
    except Exception as e:
        logger.warning("Failed to log interaction: %s", e)
