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


_ROW_COLS = (
    "id, make, model, serial, source, status, times_seen, first_seen, last_seen, manual_url, notes"
)


def _row_to_dict(r: tuple) -> dict:
    return {
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
        "notes": r[10],
    }


async def find_one(make: str, model: str) -> dict | None:
    """Return the queue row for a specific (make, model), or None."""
    if not (make and model):
        return None
    sql = f"""
        SELECT {_ROW_COLS}
          FROM mira_scan_queue
         WHERE LOWER(make)  = LOWER(%s)
           AND LOWER(model) = LOWER(%s)
         LIMIT 1
    """
    try:
        row = await db.fetch_one(sql, (make.strip(), model.strip()))
    except db.DBUnavailable:
        return None
    except Exception:
        logger.exception("queue: find_one failed for %r %r", make, model)
        return None
    return _row_to_dict(row) if row else None


async def _set_status(
    make: str,
    model: str,
    *,
    status: str,
    manual_url: str | None = None,
    notes: str | None = None,
) -> None:
    """Update the queue row's status. No-op if the row doesn't exist or
    the DB is unavailable — callers must not depend on the write
    succeeding (this is best-effort progress reporting)."""
    if not (make and model):
        return
    # Coalesce so passing manual_url=None doesn't clobber an earlier value.
    sql = """
        UPDATE mira_scan_queue
           SET status     = %s,
               manual_url = COALESCE(%s, manual_url),
               notes      = COALESCE(%s, notes),
               updated_at = NOW(),
               last_seen  = NOW()
         WHERE LOWER(make)  = LOWER(%s)
           AND LOWER(model) = LOWER(%s)
    """
    try:
        await db.execute(sql, (status, manual_url, notes, make.strip(), model.strip()))
    except db.DBUnavailable:
        return
    except Exception:
        logger.exception("queue: status update failed for %r %r", make, model)


async def mark_searching(make: str, model: str) -> None:
    await _set_status(make, model, status="searching")


async def mark_found(
    make: str,
    model: str,
    *,
    manual_url: str | None,
    title: str | None = None,
    host: str | None = None,
    doc_type: str | None = None,
) -> None:
    note_bits = [b for b in (title, host, doc_type) if b]
    notes = " | ".join(note_bits) if note_bits else None
    # If we got a candidate but no direct PDF, surface it as 'candidate'
    # so the operator dashboard distinguishes "ready to ingest" from
    # "needs human review".
    status = "found" if manual_url else "candidate"
    await _set_status(make, model, status=status, manual_url=manual_url, notes=notes)


async def mark_no_match(make: str, model: str, notes: str | None = None) -> None:
    await _set_status(make, model, status="no_match", notes=notes)


async def mark_failed(make: str, model: str, err: str) -> None:
    await _set_status(make, model, status="failed", notes=f"search error: {err[:300]}")


async def status(limit: int = 50) -> dict:
    """Return queue summary: counts by status + most-recent N items."""
    counts_sql = "SELECT status, COUNT(*) FROM mira_scan_queue GROUP BY status"
    items_sql = f"""
        SELECT {_ROW_COLS}
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
    items = [_row_to_dict(r) for r in item_rows]
    return {"available": True, "counts": counts, "items": items}
