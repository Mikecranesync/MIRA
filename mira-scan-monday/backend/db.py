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
_ENSURED_OAUTH = False
_ENSURED_USAGE = False


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


async def ensure_monday_installations_table() -> None:
    """Idempotent: create the per-account OAuth-token storage table.

    One row per Monday account that installs the marketplace app. The
    `access_token` is the long-lived OAuth token issued by Monday;
    `revoked_at` is set when a 401 from Monday's GraphQL says the user
    uninstalled or rotated their grant.
    """
    global _ENSURED_OAUTH
    if _ENSURED_OAUTH:
        return
    if not NEON_DATABASE_URL:
        return
    try:
        async with await _connect() as conn, conn.cursor() as cur:
            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS monday_installations (
                    account_id    text PRIMARY KEY,
                    access_token  text NOT NULL,
                    scope         text,
                    user_id       text,
                    installed_at  timestamptz NOT NULL DEFAULT NOW(),
                    last_seen_at  timestamptz NOT NULL DEFAULT NOW(),
                    revoked_at    timestamptz
                )
                """
            )
            # Idempotent migration for the subscription billing webhook —
            # added 2026-05-05 alongside the /monday/webhook route.
            await cur.execute(
                """
                ALTER TABLE monday_installations
                  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'free'
                """
            )
            # access_token NOT NULL was the original schema; the lifecycle
            # webhook needs to upsert install rows BEFORE the OAuth
            # callback delivers the token, so relax the constraint. Safe
            # to re-run on rows that already have a token.
            await cur.execute(
                """
                ALTER TABLE monday_installations
                  ALTER COLUMN access_token DROP NOT NULL
                """
            )
        _ENSURED_OAUTH = True
        logger.info("monday_installations table is ready")
    except Exception:
        logger.exception("ensure_monday_installations_table failed; OAuth writes will fail")


async def ensure_account_usage_table() -> None:
    """Idempotent: create the per-account daily-usage counter table.

    One row per (account_id, usage_date). Used as the billing-tier signal
    — `usage.bump_scan_count(account_id)` upserts on this PK and treats
    failure as a no-op (telemetry must never break a scan flow).
    """
    global _ENSURED_USAGE
    if _ENSURED_USAGE:
        return
    if not NEON_DATABASE_URL:
        return
    try:
        async with await _connect() as conn, conn.cursor() as cur:
            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS account_usage_daily (
                    account_id   text NOT NULL,
                    usage_date   date NOT NULL DEFAULT CURRENT_DATE,
                    scan_count   integer NOT NULL DEFAULT 0,
                    last_seen_at timestamptz NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (account_id, usage_date)
                )
                """
            )
            await cur.execute(
                """
                CREATE INDEX IF NOT EXISTS account_usage_daily_date_idx
                  ON account_usage_daily (usage_date DESC)
                """
            )
            # Idempotent migration: add chat_count column for /chat/message quota gate.
            await cur.execute(
                """
                ALTER TABLE account_usage_daily
                  ADD COLUMN IF NOT EXISTS chat_count integer NOT NULL DEFAULT 0
                """
            )
        _ENSURED_USAGE = True
        logger.info("account_usage_daily table is ready")
    except Exception:
        logger.exception("ensure_account_usage_table failed; counter writes will no-op")
