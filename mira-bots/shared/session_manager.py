"""MIRA Session Manager — SQLite-backed conversation state persistence.

Extracted from engine.py (Supervisor class) to be independently testable.
engine.py delegates all state read/write work here.

Dependency direction: session_manager ← stdlib only (no engine imports)

Slice 1 (#4844): conversation_state_v2 is keyed by (tenant_id, chat_id).
load/save/record_exchange require a tenant from authenticated context
or the declared UNSCOPED_CONVERSATION_TENANT default used by pipeline-
shaped callers. Never env, payload tenant_id, or raw chat_id. The
legacy conversation_state table is left intact for mixed-version
deploys (old services keep writing it; new code ignores it).
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

# Declared single-tenant default for pipeline-shaped callers that have no
# authenticated tenant (mira-pipeline / Open WebUI). Not env, not chat_id.
# Authenticated tenants never share this bucket. BRAVO #4852 / #4844.
UNSCOPED_CONVERSATION_TENANT = "unscoped"

# New table so mixed-version deploys keep the chat_id-only conversation_state
# for old services. New code reads/writes only this table. No backfill.
CONVERSATION_STATE_TABLE = "conversation_state_v2"

CONVERSATION_STATE_DDL = f"""
        CREATE TABLE IF NOT EXISTS {CONVERSATION_STATE_TABLE} (
            tenant_id        TEXT NOT NULL,
            chat_id          TEXT NOT NULL,
            state            TEXT NOT NULL DEFAULT 'IDLE',
            context          TEXT NOT NULL DEFAULT '{{}}',
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


def resolve_process_state_tenant(explicit: str | None = None) -> str:
    """Tenant for process()/process_full state I/O.

    Non-empty explicit wins. Else the request-scoped bind. Else the
    declared UNSCOPED_CONVERSATION_TENANT default (pipeline / Open WebUI).
    Never reads MIRA_TENANT_ID or chat_id.
    """
    if explicit is not None and str(explicit).strip():
        return require_conversation_tenant(explicit)
    bound = _STATE_TENANT.get()
    if bound and str(bound).strip():
        return require_conversation_tenant(bound)
    return UNSCOPED_CONVERSATION_TENANT


def ensure_table(db_path: str) -> None:
    """Create conversation_state_v2 and related tables if they don't exist.

    Does not DROP or rebuild the legacy chat_id-only ``conversation_state``
    table. Old services keep writing that table until they are redeployed;
    new code uses only ``conversation_state_v2`` (START FRESH — no backfill).
    """
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
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
        f"SELECT * FROM {CONVERSATION_STATE_TABLE} WHERE tenant_id = ? AND chat_id = ?",
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
        f"""INSERT INTO {CONVERSATION_STATE_TABLE}
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
            f"SELECT voice_enabled FROM {CONVERSATION_STATE_TABLE} WHERE tenant_id = ? AND chat_id = ?",
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
        f"""INSERT INTO {CONVERSATION_STATE_TABLE} (tenant_id, chat_id, voice_enabled)
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
