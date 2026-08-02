"""Bridge: a discovered manual -> MIRA's existing crawler infrastructure.

Ported and adapted from ``mira-scan-monday/backend/crawler_bridge.py``
(commit ``8fa3dce3``) per "Mike's correction: all scrapers already exist,
find them and use them" — same discipline this port follows. Adapted from
psycopg3 async (a dependency mira-bots does not pin) to the psycopg2 +
``asyncio.to_thread`` pattern already used in this package (see
``wo_evidence.py`` / ``ctx_enrichment.py``) so this module introduces no new
runtime dependency.

The two existing queues a discovered PDF should land in:

    1. NeonDB `manual_cache` table — UNIQUE on (manufacturer, model), read by
       mira-crawler/tasks/ingest.py::ingest_all_pending. This is the
       canonical discovery record. `source` is set to 'mira-manual-search'
       so finds are attributable without disturbing other pipelines
       (tavily, apify, the OEM crawler, etc.).

    2. mira-crawler/cron/manual_queue.json — the operator queue that
       mira-crawler/cron/kb_growth_cron.py drains daily, running
       full_ingest_pipeline.py for each pending entry. We append (skipping
       URL dups) so the existing cron picks discoveries up automatically —
       no new ingest code.

Both writes are best-effort: a discovery flow must never fail because the
crawler queue is offline or read-only. Each handler logs its own errors and
returns whether it succeeded so callers can surface partial state.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

import psycopg2

logger = logging.getLogger("mira.manual_search.crawler_bridge")

MANUAL_QUEUE_JSON_PATH = Path(
    os.getenv(
        "MANUAL_QUEUE_JSON_PATH",
        "/opt/mira/mira-crawler/cron/manual_queue.json",
    )
)

# Set high-ish so a discovered manual beats the operator's curated backlog
# but below 10 (max) so a human-priority entry can still jump the line.
MANUAL_SEARCH_DOWNLOAD_PRIORITY = int(os.getenv("MANUAL_SEARCH_DOWNLOAD_PRIORITY", "8"))


def _upsert_manual_cache_sync(
    manufacturer: str,
    model: str,
    manual_url: str,
    manual_title: str | None,
    manual_type: str | None,
    found_via: str,
) -> bool:
    """Synchronous NeonDB upsert. Returns False on any miss; never raises."""
    db_url = os.getenv("NEON_DATABASE_URL", "")
    if not (db_url and manufacturer and model and manual_url):
        return False

    sql = """
        INSERT INTO manual_cache
            (manufacturer, model, manual_url, manual_title, manual_type,
             source, found_via, confidence_score, download_priority,
             local_file_available, validated_by_user, llm_validated)
        VALUES (%s, %s, %s, %s, %s, 'mira-manual-search', %s, 0.85, %s,
                FALSE, FALSE, FALSE)
        ON CONFLICT (manufacturer, model) DO UPDATE SET
            manual_url        = COALESCE(manual_cache.manual_url, EXCLUDED.manual_url),
            manual_title      = COALESCE(manual_cache.manual_title, EXCLUDED.manual_title),
            manual_type       = COALESCE(manual_cache.manual_type, EXCLUDED.manual_type),
            found_via         = EXCLUDED.found_via,
            download_priority = GREATEST(manual_cache.download_priority, EXCLUDED.download_priority),
            updated_at        = NOW()
    """
    try:
        conn = psycopg2.connect(db_url)
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    sql,
                    (
                        manufacturer.strip(),
                        model.strip(),
                        manual_url,
                        (manual_title or "")[:500] or None,
                        (manual_type or "")[:50] or None,
                        (found_via or "")[:50] or None,
                        MANUAL_SEARCH_DOWNLOAD_PRIORITY,
                    ),
                )
        conn.close()
        logger.info("manual_cache upserted: %s / %s", manufacturer, model)
        return True
    except Exception:  # noqa: BLE001 -- a discovery flow must never raise
        logger.exception("manual_cache upsert failed for %r %r", manufacturer, model)
        return False


async def upsert_manual_cache(
    manufacturer: str,
    model: str,
    manual_url: str,
    *,
    manual_title: str | None,
    manual_type: str | None,
    found_via: str = "serper",
) -> bool:
    """Upsert a row in NeonDB `manual_cache`.

    Uses ON CONFLICT on the existing UNIQUE (manufacturer, model) index,
    bumping priority on re-find but never clobbering a user-validated row.
    Never raises — returns False on any miss (unset NEON_DATABASE_URL, DB
    error, missing args).
    """
    try:
        return await asyncio.to_thread(
            _upsert_manual_cache_sync,
            manufacturer,
            model,
            manual_url,
            manual_title,
            manual_type,
            found_via,
        )
    except Exception:  # noqa: BLE001
        logger.exception("upsert_manual_cache failed for %r %r", manufacturer, model)
        return False


def append_to_manual_queue_json(
    *,
    url: str,
    manufacturer: str,
    model: str,
    manual_type: str = "installation_manual",
    notes: str = "auto-queued from manual_search",
) -> bool:
    """Append an entry to mira-crawler/cron/manual_queue.json.

    The existing cron (kb_growth_cron.py) drains this file daily, running
    full_ingest_pipeline.py for each pending entry. Dedupes by URL so
    re-discovery of the same equipment doesn't pile up.

    Returns True if a new entry was added, False if it already existed or
    the file isn't writable.
    """
    if not (url and manufacturer and model):
        return False
    if not MANUAL_QUEUE_JSON_PATH.exists():
        logger.info(
            "manual_queue.json not found at %s — skipping JSON append",
            MANUAL_QUEUE_JSON_PATH,
        )
        return False
    try:
        text = MANUAL_QUEUE_JSON_PATH.read_text()
        queue = json.loads(text) if text.strip() else []
        if not isinstance(queue, list):
            logger.warning(
                "manual_queue.json is not a list (got %s); skipping",
                type(queue).__name__,
            )
            return False

        if any(isinstance(e, dict) and e.get("url") == url for e in queue):
            logger.info("manual_queue.json: %s already present, no-op", url[:80])
            return False

        queue.append(
            {
                "url": url,
                "manufacturer": manufacturer.strip(),
                "model": model.strip(),
                "type": manual_type,
                "status": "pending",
                "notes": notes,
            }
        )
        # Write atomically: tmpfile + rename so a concurrent cron read
        # can't see a half-written list.
        tmp = MANUAL_QUEUE_JSON_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(queue, indent=2))
        tmp.replace(MANUAL_QUEUE_JSON_PATH)
        logger.info(
            "manual_queue.json: appended %s %s -> %s (now %d entries)",
            manufacturer,
            model,
            url[:80],
            len(queue),
        )
        return True
    except (OSError, ValueError):
        logger.exception("manual_queue.json append failed")
        return False


async def record_manual_discovery(
    manufacturer: str,
    model: str,
    *,
    manual_url: str,
    manual_title: str | None = None,
    manual_type: str | None = None,
) -> dict:
    """Run both bridges. Returns flags so callers can render UX state."""
    cache_ok = await upsert_manual_cache(
        manufacturer,
        model,
        manual_url,
        manual_title=manual_title,
        manual_type=manual_type,
    )
    json_ok = append_to_manual_queue_json(
        url=manual_url,
        manufacturer=manufacturer,
        model=model,
        manual_type=manual_type or "installation_manual",
        notes=f"auto-queued from manual_search; title={(manual_title or '')[:120]}",
    )
    return {
        "manual_cache_written": cache_ok,
        "manual_queue_json_appended": json_ok,
        "manual_queue_path": str(MANUAL_QUEUE_JSON_PATH),
    }
