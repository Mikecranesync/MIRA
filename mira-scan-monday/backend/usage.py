"""Per-installation daily scan counters.

Counts successful /scan/extract calls per Monday account_id per day.
Used as the billing-tier signal — once we see a meaningful install
volume, this gets wired into a free-tier cap (e.g. 50 scans/mo) with
a softer paywall in the iframe.

The counter is best-effort. If NeonDB is unavailable, bumps no-op
silently — a scan flow must never fail because telemetry is offline.
"""

from __future__ import annotations

import logging

from . import db

logger = logging.getLogger("mira-scan.usage")


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
