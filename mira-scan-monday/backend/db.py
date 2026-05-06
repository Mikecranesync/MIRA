"""Thin async DB helpers for NeonDB (psycopg 3, no app-side pooling).

Per repo CLAUDE.md / python-standards: Neon's pgbouncer handles pooling;
the application opens a fresh connection per query (NullPool semantics).
At <10 QPS this is fine and avoids prepared-statement collisions in
transaction-mode pooling.

If `NEON_DATABASE_URL` is unset, every helper raises `DBUnavailable` so
callers can fall back gracefully (used by mira_rag's allowlist fallback).
"""

from __future__ import annotations

import logging
import os
from typing import Any

import psycopg

logger = logging.getLogger("mira-scan.db")

NEON_DATABASE_URL = os.getenv("NEON_DATABASE_URL", "")
DB_QUERY_TIMEOUT_MS = int(os.getenv("DB_QUERY_TIMEOUT_MS", "5000"))


class DBUnavailable(RuntimeError):
    pass


def _require_url() -> str:
    if not NEON_DATABASE_URL:
        raise DBUnavailable("NEON_DATABASE_URL is not configured")
    return NEON_DATABASE_URL


async def _connect() -> psycopg.AsyncConnection:
    url = _require_url()
    conn = await psycopg.AsyncConnection.connect(
        url,
        autocommit=True,
        connect_timeout=10,
    )
    # Enforce a per-query statement timeout so a slow ILIKE on a giant
    # table can never tarpit the request handler.
    async with conn.cursor() as cur:
        await cur.execute(f"SET statement_timeout = {DB_QUERY_TIMEOUT_MS}")
    return conn


async def fetch_one(sql: str, params: tuple[Any, ...] = ()) -> tuple | None:
    async with await _connect() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)
        return await cur.fetchone()


async def fetch_all(
    sql: str, params: tuple[Any, ...] = (), limit: int | None = None
) -> list[tuple]:
    async with await _connect() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()
    return rows if limit is None else rows[:limit]


async def execute(sql: str, params: tuple[Any, ...] = ()) -> None:
    async with await _connect() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)


_ENSURED = False


async def ensure_scan_queue_table() -> None:
    """Idempotent: create the scan-driven manual-request queue if it
    doesn't exist yet. Called once at app startup.
    """
    global _ENSURED
    if _ENSURED:
        return
    if not NEON_DATABASE_URL:
        return
    try:
        async with await _connect() as conn, conn.cursor() as cur:
            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS mira_scan_queue (
                    id           bigserial PRIMARY KEY,
                    make         text NOT NULL,
                    model        text NOT NULL,
                    serial       text,
                    source       text NOT NULL DEFAULT 'mira-scan',
                    status       text NOT NULL DEFAULT 'pending',
                    tenant_id    text,
                    notes        text,
                    manual_url   text,
                    times_seen   integer NOT NULL DEFAULT 1,
                    first_seen   timestamptz NOT NULL DEFAULT NOW(),
                    last_seen    timestamptz NOT NULL DEFAULT NOW(),
                    created_at   timestamptz NOT NULL DEFAULT NOW(),
                    updated_at   timestamptz NOT NULL DEFAULT NOW()
                )
                """
            )
            await cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS mira_scan_queue_dedupe
                  ON mira_scan_queue (LOWER(make), LOWER(model))
                """
            )
            await cur.execute(
                """
                CREATE INDEX IF NOT EXISTS mira_scan_queue_status_idx
                  ON mira_scan_queue (status, created_at DESC)
                """
            )
        _ENSURED = True
        logger.info("mira_scan_queue table is ready")
    except Exception:
        logger.exception("ensure_scan_queue_table failed; queue writes will no-op")
