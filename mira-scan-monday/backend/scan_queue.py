"""Scan-driven manual-request queue.

When `/kb/lookup` returns no match, we record the (make, model) into
`mira_scan_queue` so an operator (or a future scraper) can find a manual
URL and feed it into `mira-crawler/cron/manual_queue.json`. Every scan
that misses bumps `times_seen` for that (make, model) instead of
duplicating, so a popular bit of equipment surfaces naturally near the
top of any "what should we ingest next" review.

This file deliberately does NOT call ManualsLib or write to
manual_queue.json directly — that bridge is operator-driven for now,
because URL discovery is not deterministic and we don't want to silently
ingest documents that haven't been reviewed.
"""

from __future__ import annotations

import logging

from . import db

logger = logging.getLogger("mira-scan.queue")


async def enqueue(
    make: str,
    model: str,
    serial: str | None = None,
    source: str = "mira-scan",
    tenant_id: str | None = None,
    notes: str | None = None,
) -> dict | None:
    """Insert (or bump) a row in mira_scan_queue. Returns a small dict
    with id, status, times_seen on success; None on any failure.

    Failures are logged but never raised — a scan flow must never fail
    because the queue is offline.
    """
    if not (make and model):
        return None

    sql = """
        INSERT INTO mira_scan_queue
            (make, model, serial, source, tenant_id, notes)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (LOWER(make), LOWER(model)) DO UPDATE
            SET times_seen = mira_scan_queue.times_seen + 1,
                last_seen  = NOW(),
                updated_at = NOW(),
                serial     = COALESCE(EXCLUDED.serial, mira_scan_queue.serial),
                notes      = COALESCE(EXCLUDED.notes,  mira_scan_queue.notes)
        RETURNING id, status, times_seen, first_seen
    """
    try:
        row = await db.fetch_one(
            sql, (make.strip(), model.strip(), serial, source, tenant_id, notes)
        )
    except db.DBUnavailable:
        logger.info("queue: NEON_DATABASE_URL unset — skipping enqueue (%s %s)", make, model)
        return None
    except Exception:
        logger.exception("queue: enqueue failed for %r %r", make, model)
        return None

    if row is None:
        return None
    return {
        "id": int(row[0]),
        "status": str(row[1]),
        "times_seen": int(row[2]),
        "first_seen": row[3].isoformat() if row[3] else None,
    }


async def status(limit: int = 50) -> dict:
    """Return queue summary: counts by status + most-recent N items."""
    counts_sql = "SELECT status, COUNT(*) FROM mira_scan_queue GROUP BY status"
    items_sql = """
        SELECT id, make, model, serial, source, status, times_seen,
               first_seen, last_seen, manual_url
          FROM mira_scan_queue
         ORDER BY last_seen DESC
         LIMIT %s
    """
    try:
        counts_rows = await db.fetch_all(counts_sql)
        item_rows = await db.fetch_all(items_sql, (max(1, min(limit, 500)),))
    except db.DBUnavailable:
        return {"available": False, "counts": {}, "items": []}
    except Exception:
        logger.exception("queue: status query failed")
        return {"available": False, "counts": {}, "items": []}

    counts = {str(r[0]): int(r[1]) for r in counts_rows}
    items = [
        {
            "id": int(r[0]),
            "make": r[1],
            "model": r[2],
            "serial": r[3],
            "source": r[4],
            "status": r[5],
            "times_seen": int(r[6]),
            "first_seen": r[7].isoformat() if r[7] else None,
            "last_seen": r[8].isoformat() if r[8] else None,
            "manual_url": r[9],
        }
        for r in item_rows
    ]
    return {"available": True, "counts": counts, "items": items}
