"""Bridge: scan-discovered manuals → existing crawler infrastructure.

Per Mike's correction: "all scrapers already exist, find them and use them."
The two existing queues a scan-found PDF should land in:

    1. NeonDB `manual_cache` table — UNIQUE on (manufacturer, model),
       read by mira-crawler/tasks/ingest.py::ingest_all_pending Celery
       task (when workers come up). This is the canonical discovery
       record. Source field is set to 'mira-scan' so we can attribute
       finds without disturbing other pipelines (tavily, apify, etc.).

    2. /opt/mira/mira-crawler/cron/manual_queue.json — the operator
       queue that mira-crawler/cron/kb_growth_cron.py drains daily at
       06:00 UTC. Schema: {url, manufacturer, model, type, status,
       notes}. We append (skipping URL dups) so the existing cron
       picks our finds up automatically — no new ingest code.

Both writes are best-effort: a scan flow must never fail because the
crawler queue is offline or read-only. Each handler logs its own errors
and returns whether it succeeded so callers can surface partial state.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from . import db

logger = logging.getLogger("mira-scan.crawler_bridge")

# Bind-mounted into the mira-scan-backend container by docker-compose.
MANUAL_QUEUE_JSON_PATH = Path(
    os.getenv(
        "MANUAL_QUEUE_JSON_PATH",
        "/opt/mira/mira-crawler/cron/manual_queue.json",
    )
)

# Set high-ish so scan-driven finds beat the operator's curated backlog
# but below 10 (max) so a human-priority entry can still jump the line.
MIRA_SCAN_DOWNLOAD_PRIORITY = int(os.getenv("MIRA_SCAN_DOWNLOAD_PRIORITY", "8"))


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
    bumping confidence/priority on re-find but never clobbering a
    user-validated row.
    """
    if not (manufacturer and model and manual_url):
        return False

    sql = """
        INSERT INTO manual_cache
            (manufacturer, model, manual_url, manual_title, manual_type,
             source, found_via, confidence_score, download_priority,
             local_file_available, validated_by_user, llm_validated)
        VALUES (%s, %s, %s, %s, %s, 'mira-scan', %s, 0.85, %s,
                FALSE, FALSE, FALSE)
        ON CONFLICT (manufacturer, model) DO UPDATE SET
            manual_url       = COALESCE(manual_cache.manual_url, EXCLUDED.manual_url),
            manual_title     = COALESCE(manual_cache.manual_title, EXCLUDED.manual_title),
            manual_type      = COALESCE(manual_cache.manual_type, EXCLUDED.manual_type),
            found_via        = EXCLUDED.found_via,
            download_priority = GREATEST(manual_cache.download_priority, EXCLUDED.download_priority),
            updated_at       = NOW()
    """
    try:
        await db.execute(
            sql,
            (
                manufacturer.strip(),
                model.strip(),
                manual_url,
                (manual_title or "")[:500] or None,
                (manual_type or "")[:50] or None,
                (found_via or "")[:50] or None,
                MIRA_SCAN_DOWNLOAD_PRIORITY,
            ),
        )
        logger.info("manual_cache upserted: %s / %s", manufacturer, model)
        return True
    except db.DBUnavailable:
        logger.info("manual_cache: DB unavailable — skipping upsert")
        return False
    except Exception:
        logger.exception("manual_cache upsert failed for %r %r", manufacturer, model)
        return False


def append_to_manual_queue_json(
    *,
    url: str,
    manufacturer: str,
    model: str,
    manual_type: str = "installation_manual",
    notes: str = "auto-queued from mira-scan",
) -> bool:
    """Append an entry to mira-crawler/cron/manual_queue.json.

    The existing cron (kb_growth_cron.py) drains this file daily at
    06:00 UTC, running full_ingest_pipeline.py for each pending entry.
    We dedupe by URL so re-scans of the same equipment don't pile up.

    Returns True if a new entry was added, False if it already existed
    or the file isn't writable.
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


async def record_scan_discovery(
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
        notes=f"auto-queued from mira-scan; title={(manual_title or '')[:120]}",
    )
    return {
        "manual_cache_written": cache_ok,
        "manual_queue_json_appended": json_ok,
        "manual_queue_path": str(MANUAL_QUEUE_JSON_PATH),
    }
