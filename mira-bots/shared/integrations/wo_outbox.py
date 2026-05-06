"""Atlas WO outbox + drain — Unit 8 hardening (CRA-17).

When ``atlas_cmms.create_work_order`` exhausts its in-process retry budget
(3 attempts with exponential backoff), the failing payload is persisted
to a local SQLite outbox via ``enqueue()``. A periodic drain task started
in the bot's ``_startup`` retries every ``DRAIN_INTERVAL_SECONDS``;
payloads still unsent after ``ALERT_AFTER_SECONDS`` (3h) trigger a single
admin push alert via ``notifications/push.send_push``.

Design notes:
- One table, one writer (the bot process), one drain task. KISS.
- Outbox lives in the same SQLite db as the rest of mira-bots state
  (``MIRA_DB_PATH``, default ``/data/mira.db``). WAL mode per
  ``.claude/rules/python-standards.md``.
- Schema migration: ``mira-bridge/migrations/004_add_wo_outbox.sql``.
  The migration is run by mira-bridge on container start; this module
  also calls ``CREATE TABLE IF NOT EXISTS`` defensively so unit tests
  against a fresh ``:memory:`` db work without running migrations.
- Spec deviation from CRA-17: the original spec said "Add Node-RED
  outbox-drain flow". An in-process asyncio drain in mira-bots delivers
  the same effective architecture with far less operational surface
  (no Node-RED flow to keep alive). Easy to migrate to Node-RED later
  if cross-container concerns appear.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

logger = logging.getLogger("mira-gsd")


DRAIN_INTERVAL_SECONDS = 300.0  # 5 minutes between drain passes
ALERT_AFTER_SECONDS = 3 * 3600  # admin alerted once when row > 3h unsent
MAX_DRAIN_BATCH = 50  # safety: don't drain a runaway queue all at once


_SCHEMA = """
CREATE TABLE IF NOT EXISTS wo_outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    payload_json    TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      REAL NOT NULL,
    last_attempt_at REAL,
    sent_at         REAL,
    atlas_wo_id     INTEGER,
    alerted_at      REAL
);
CREATE INDEX IF NOT EXISTS idx_wo_outbox_pending
    ON wo_outbox(sent_at, last_attempt_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wo_outbox_stale
    ON wo_outbox(sent_at, alerted_at, created_at) WHERE sent_at IS NULL AND alerted_at IS NULL;
"""


@dataclass
class OutboxRow:
    id: int
    payload: dict
    attempts: int
    last_error: str | None
    created_at: float
    last_attempt_at: float | None
    alerted_at: float | None


def _connect(db_path: str | None = None) -> sqlite3.Connection:
    path = db_path or os.getenv("MIRA_DB_PATH", "/data/mira.db")
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def enqueue(payload: dict, last_error: str, *, db_path: str | None = None) -> int:
    """Persist a failed WO payload to the outbox. Returns the row id."""
    conn = _connect(db_path)
    try:
        cur = conn.execute(
            "INSERT INTO wo_outbox "
            "(payload_json, attempts, last_error, created_at, last_attempt_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (json.dumps(payload), 1, last_error[:1000], time.time(), time.time()),
        )
        row_id = int(cur.lastrowid)
        logger.warning(
            "WO_OUTBOX_ENQUEUE id=%d title=%r error=%s",
            row_id,
            str(payload.get("title", ""))[:60],
            last_error[:200],
        )
        return row_id
    finally:
        conn.close()


def list_pending(*, db_path: str | None = None, limit: int = MAX_DRAIN_BATCH) -> list[OutboxRow]:
    """Return up to ``limit`` rows that haven't been sent yet, oldest first."""
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            "SELECT id, payload_json, attempts, last_error, created_at, "
            " last_attempt_at, alerted_at "
            "FROM wo_outbox WHERE sent_at IS NULL "
            "ORDER BY created_at ASC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        conn.close()
    return [
        OutboxRow(
            id=int(r[0]),
            payload=json.loads(r[1]),
            attempts=int(r[2]),
            last_error=r[3],
            created_at=float(r[4]),
            last_attempt_at=float(r[5]) if r[5] is not None else None,
            alerted_at=float(r[6]) if r[6] is not None else None,
        )
        for r in rows
    ]


def mark_sent(row_id: int, atlas_wo_id: int, *, db_path: str | None = None) -> None:
    conn = _connect(db_path)
    try:
        conn.execute(
            "UPDATE wo_outbox SET sent_at = ?, atlas_wo_id = ? WHERE id = ?",
            (time.time(), int(atlas_wo_id), row_id),
        )
    finally:
        conn.close()


def mark_attempt(row_id: int, error: str, *, db_path: str | None = None) -> None:
    conn = _connect(db_path)
    try:
        conn.execute(
            "UPDATE wo_outbox "
            "SET attempts = attempts + 1, last_error = ?, last_attempt_at = ? "
            "WHERE id = ?",
            (error[:1000], time.time(), row_id),
        )
    finally:
        conn.close()


def mark_alerted(row_id: int, *, db_path: str | None = None) -> None:
    conn = _connect(db_path)
    try:
        conn.execute(
            "UPDATE wo_outbox SET alerted_at = ? WHERE id = ? AND alerted_at IS NULL",
            (time.time(), row_id),
        )
    finally:
        conn.close()


def stats(*, db_path: str | None = None) -> dict[str, int]:
    """For /health endpoints + tests. Returns counts by outcome."""
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            "SELECT "
            " COALESCE(SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS sent, "
            " COALESCE(SUM(CASE WHEN sent_at IS NULL THEN 1 ELSE 0 END), 0) AS pending, "
            " COALESCE(SUM(CASE WHEN sent_at IS NULL AND alerted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS alerted, "
            " COUNT(*) AS total "
            "FROM wo_outbox"
        ).fetchone()
    finally:
        conn.close()
    return {
        "sent": int(rows[0]),
        "pending": int(rows[1]),
        "alerted": int(rows[2]),
        "total": int(rows[3]),
    }


# ----------------------------------------------------------------- drain task


async def drain_once(
    submit_fn: Callable[[dict], Awaitable[dict]],
    alert_fn: Callable[[OutboxRow], Awaitable[None]] | None = None,
    *,
    db_path: str | None = None,
    now: float | None = None,
) -> dict[str, int]:
    """Single drain pass — exposed for testing.

    ``submit_fn(payload)`` must call Atlas (without retry — the outbox itself
    is the retry mechanism) and return either ``{"id": N, ...}`` on success
    or ``{"error": "..."}`` on failure.

    ``alert_fn(row)`` is called once per row that has aged past
    ``ALERT_AFTER_SECONDS`` without being sent. Caller wires this to
    ``notifications/push.send_push``. ``alerted_at`` is stamped before the
    callback so duplicate alerts don't fire on the next drain pass.

    Returns ``{"sent": N, "still_pending": M, "newly_alerted": K}``.
    """
    rows = list_pending(db_path=db_path)
    t = now if now is not None else time.time()
    sent = 0
    still_pending = 0
    newly_alerted = 0

    for row in rows:
        try:
            result = await submit_fn(row.payload)
        except Exception as exc:
            mark_attempt(row.id, f"submit_fn raised: {exc!r}", db_path=db_path)
            still_pending += 1
            continue

        if "error" in result:
            mark_attempt(row.id, str(result.get("error", ""))[:1000], db_path=db_path)
            still_pending += 1
        elif result.get("id") is not None:
            mark_sent(row.id, int(result["id"]), db_path=db_path)
            sent += 1
            continue
        else:
            mark_attempt(row.id, f"submit returned no id: {result!r}"[:1000], db_path=db_path)
            still_pending += 1

        if (
            row.alerted_at is None
            and (t - row.created_at) >= ALERT_AFTER_SECONDS
            and alert_fn is not None
        ):
            mark_alerted(row.id, db_path=db_path)
            try:
                await alert_fn(row)
                newly_alerted += 1
            except Exception as alert_exc:
                logger.warning(
                    "WO_OUTBOX_ALERT_FAILED id=%d error=%s",
                    row.id,
                    alert_exc,
                )

    if rows:
        logger.info(
            "WO_OUTBOX_DRAIN scanned=%d sent=%d still_pending=%d newly_alerted=%d",
            len(rows),
            sent,
            still_pending,
            newly_alerted,
        )
    return {"sent": sent, "still_pending": still_pending, "newly_alerted": newly_alerted}


async def run_drain_forever(
    submit_fn: Callable[[dict], Awaitable[dict]],
    alert_fn: Callable[[OutboxRow], Awaitable[None]] | None = None,
    *,
    interval_seconds: float = DRAIN_INTERVAL_SECONDS,
    db_path: str | None = None,
) -> None:
    """Background-task driver. Spawn from bot startup; never returns."""
    logger.info(
        "WO_OUTBOX_DRAIN_START interval=%ds alert_after=%ds db=%s",
        int(interval_seconds),
        ALERT_AFTER_SECONDS,
        db_path or os.getenv("MIRA_DB_PATH", "/data/mira.db"),
    )
    while True:
        try:
            await drain_once(submit_fn, alert_fn, db_path=db_path)
        except Exception as exc:
            logger.error("WO_OUTBOX_DRAIN_LOOP_ERROR %s", exc, exc_info=True)
        await asyncio.sleep(interval_seconds)


__all__ = [
    "ALERT_AFTER_SECONDS",
    "DRAIN_INTERVAL_SECONDS",
    "MAX_DRAIN_BATCH",
    "OutboxRow",
    "drain_once",
    "enqueue",
    "list_pending",
    "mark_alerted",
    "mark_attempt",
    "mark_sent",
    "run_drain_forever",
    "stats",
]
