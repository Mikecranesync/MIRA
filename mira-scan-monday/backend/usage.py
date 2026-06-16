"""Per-installation daily scan counters + free-tier quota gate.

Counts successful /scan/extract calls per Monday account_id per day,
sums the trailing 30 days for the free-tier monthly cap, and exposes
helpers for `/scan/extract` to gate on quota before burning an OpenAI
Vision call on a request that's just going to 429.

The counter is best-effort. If NeonDB is unavailable, bumps no-op
silently — a scan flow must never fail because telemetry is offline.
The quota gate is fail-open for the same reason: if `month_scan_count`
can't reach the DB, callers should let the scan through rather than
locking out a paying user because of an unrelated infra glitch.
"""

from __future__ import annotations

import logging
import os

from . import db

logger = logging.getLogger("mira-scan.usage")


# Free-tier monthly cap. Scans beyond this for an authenticated install
# return HTTP 429 from `/scan/extract` so the iframe can prompt "upgrade
# to keep scanning." Set to a generous default — adjust via env once we
# have real install-volume data.
FREE_TIER_MONTHLY_CAP = int(os.getenv("MIRA_FREE_TIER_MONTHLY_CAP", "50"))


async def bump_scan_count(account_id: str) -> None:
    """Increment today's scan_count for an account. Best-effort no-op
    on any failure (DB down, tenant unset, etc.)."""
    if not account_id:
        return
    sql = """
        INSERT INTO account_usage_daily
            (account_id, usage_date, scan_count, last_seen_at)
        VALUES (%s, CURRENT_DATE, 1, NOW())
        ON CONFLICT (account_id, usage_date) DO UPDATE
            SET scan_count   = account_usage_daily.scan_count + 1,
                last_seen_at = NOW()
    """
    try:
        await db.execute(sql, (account_id,))
    except db.DBUnavailable:
        return
    except Exception:
        logger.exception("usage.bump_scan_count failed for account_id=%s", account_id)


async def today_scan_count(account_id: str) -> int:
    """Return today's scan_count for an account, or 0 on miss/failure."""
    if not account_id:
        return 0
    sql = """
        SELECT scan_count FROM account_usage_daily
         WHERE account_id = %s AND usage_date = CURRENT_DATE
         LIMIT 1
    """
    try:
        row = await db.fetch_one(sql, (account_id,))
    except db.DBUnavailable:
        return 0
    except Exception:
        logger.exception("usage.today_scan_count failed for account_id=%s", account_id)
        return 0
    return int(row[0]) if row else 0


async def month_scan_count(account_id: str) -> int:
    """Sum scan_count over the trailing 30 days for an account.

    Used as the free-tier quota gate input. Returns 0 when account_id is
    empty (standalone path), DB is unavailable, or the account has no
    activity in the window. Never raises — the caller should fail-open
    on a 0 from a real (non-empty) account_id rather than locking out
    paying customers because telemetry is down.
    """
    if not account_id:
        return 0
    sql = """
        SELECT COALESCE(SUM(scan_count), 0)::integer
          FROM account_usage_daily
         WHERE account_id = %s
           AND usage_date >= CURRENT_DATE - INTERVAL '30 days'
    """
    try:
        row = await db.fetch_one(sql, (account_id,))
    except db.DBUnavailable:
        return 0
    except Exception:
        logger.exception("usage.month_scan_count failed for account_id=%s", account_id)
        return 0
    return int(row[0]) if row and row[0] is not None else 0


FREE_TIER_MONTHLY_CHAT_CAP = int(os.getenv("MIRA_FREE_TIER_MONTHLY_CHAT_CAP", "200"))


async def bump_chat_count(account_id: str) -> None:
    """Increment today's chat_count for an account. Best-effort no-op on failure."""
    if not account_id:
        return
    sql = """
        INSERT INTO account_usage_daily
            (account_id, usage_date, chat_count, last_seen_at)
        VALUES (%s, CURRENT_DATE, 1, NOW())
        ON CONFLICT (account_id, usage_date) DO UPDATE
            SET chat_count   = account_usage_daily.chat_count + 1,
                last_seen_at = NOW()
    """
    try:
        await db.execute(sql, (account_id,))
    except db.DBUnavailable:
        return
    except Exception:
        logger.exception("usage.bump_chat_count failed for account_id=%s", account_id)


async def month_chat_count(account_id: str) -> int:
    """Sum chat_count over the trailing 30 days for an account.

    Returns 0 on empty account_id, DB unavailability, or no activity.
    Never raises — callers must fail-open so a DB outage never locks out
    a legitimate user.
    """
    if not account_id:
        return 0
    sql = """
        SELECT COALESCE(SUM(chat_count), 0)::integer
          FROM account_usage_daily
         WHERE account_id = %s
           AND usage_date >= CURRENT_DATE - INTERVAL '30 days'
    """
    try:
        row = await db.fetch_one(sql, (account_id,))
    except db.DBUnavailable:
        return 0
    except Exception:
        logger.exception("usage.month_chat_count failed for account_id=%s", account_id)
        return 0
    return int(row[0]) if row and row[0] is not None else 0


async def days_summary(account_id: str, days: int = 30) -> list[dict]:
    """Return up to N most-recent days of scan_count for an account.

    Empty list on no data or DB unavailable. Used by an admin dashboard
    (not yet built) to show install activity over time.
    """
    if not account_id:
        return []
    sql = """
        SELECT usage_date, scan_count, last_seen_at
          FROM account_usage_daily
         WHERE account_id = %s
         ORDER BY usage_date DESC
         LIMIT %s
    """
    try:
        rows = await db.fetch_all(sql, (account_id, max(1, min(int(days), 365))))
    except db.DBUnavailable:
        return []
    except Exception:
        logger.exception("usage.days_summary failed for account_id=%s", account_id)
        return []
    return [
        {
            "usage_date": r[0].isoformat() if r[0] else None,
            "scan_count": int(r[1]),
            "last_seen_at": r[2].isoformat() if r[2] else None,
        }
        for r in rows
    ]
