"""Tag-diff historizer task — schedule the relay's TagDiffLogger (issue #2343).

The relay's ``tag_diff_logger`` (mira-relay/) ships the *logic* + store boundary
for turning the raw ``tag_events`` stream (migration 033) into the
meaningful-change ``tag_event_diffs`` stream (migration 037) — but wiring it to a
schedule was left as a documented Phase-5 follow-up. This module is that wiring:
a Celery beat task (every 5 min) that reads the unprocessed slice of
``tag_events`` and runs it through ``TagDiffLogger``.

Design (mirrors freshness.py + the relay's logic/store split):

  * ``run_historize_batch`` is a PURE core over an injected ``store`` (exposes
    ``load_state`` / ``persist_diffs``) and ``read_events`` reader. Tests inject
    an in-memory store + a fake reader, so no DB/Redis is needed.
  * ``historize_tag_diffs`` is the thin Celery wrapper: it builds the real
    ``NeonDiffStore`` + a real cursor-based event reader and calls the core,
    retrying on failure.

Cursor (Option A — implicit, no migration): each run reads
``tag_events`` rows newer than ``MAX(event_timestamp)`` already present in
``tag_event_diffs`` for the tenant. ``event_timestamp`` is TIMESTAMPTZ in both
tables; the reader converts to epoch-seconds floats for ``TagReading`` and the
default cursor is ``'epoch'``.

Single-tenant: the task takes ``tenant_id`` (default ``MIRA_TENANT_ID``).
Multi-tenant fan-out is a documented follow-up.

Env:
  * ``NEON_DATABASE_URL``  — DB (shared with the rest of the crawler).
  * ``MIRA_TENANT_ID``     — default tenant.
  * ``TAG_DIFF_BATCH_SIZE``  — rows per run (default 1000).
  * ``TAG_DIFF_CONFIG_JSON`` — JSON DiffConfig overrides; unset → defaults.
"""

from __future__ import annotations

import json
import logging
import os

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

# Reuse the relay's diff logic + prod store — do NOT reimplement.
# In Docker the relay dir is on PYTHONPATH; locally fall back to the sibling dir.
try:
    from tag_diff_logger import (
        DiffConfig,
        NeonDiffStore,
        TagDiffLogger,
        TagReading,
    )
except ImportError:  # pragma: no cover - exercised only outside the test path
    import pathlib
    import sys

    _relay_dir = pathlib.Path(__file__).resolve().parents[2] / "mira-relay"
    if str(_relay_dir) not in sys.path:
        sys.path.insert(0, str(_relay_dir))
    from tag_diff_logger import (  # noqa: E402
        DiffConfig,
        NeonDiffStore,
        TagDiffLogger,
        TagReading,
    )

logger = logging.getLogger("mira-crawler.tasks.tag_diff_historizer")

DEFAULT_BATCH_SIZE = 1000


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------


def _load_config() -> DiffConfig:
    """Build a DiffConfig from TAG_DIFF_CONFIG_JSON; empty/unset → defaults."""
    raw = (os.getenv("TAG_DIFF_CONFIG_JSON") or "").strip()
    if not raw:
        return DiffConfig()
    return DiffConfig.from_dict(json.loads(raw))


# ---------------------------------------------------------------------------
# Pure core — testable without DB or broker
# ---------------------------------------------------------------------------


def run_historize_batch(*, store, read_events, config, tenant_id, batch_size) -> dict:
    """Read one unprocessed batch and persist its meaningful diffs.

    Args:
        store: a DiffStore (``load_state`` / ``persist_diffs``).
        read_events: ``(tenant_id, since_ts, batch_size) -> list[TagReading]``.
            ``since_ts=None`` tells the reader to use its implicit cursor.
        config: DiffConfig controlling what counts as a meaningful change.
        tenant_id: tenant to historize.
        batch_size: max tag_events rows per run.

    Returns a summary dict: status, tenant_id, tag_events_read, diffs_written,
    last_processed_ts (max event_timestamp in the batch, or None when empty).
    """
    if not tenant_id:
        logger.error("historize: no tenant_id — skipping")
        return {
            "status": "error",
            "error": "no_tenant_id",
            "tenant_id": tenant_id,
            "tag_events_read": 0,
            "diffs_written": 0,
            "last_processed_ts": None,
        }

    readings = read_events(tenant_id, None, batch_size)
    if not readings:
        return {
            "status": "ok",
            "tenant_id": tenant_id,
            "tag_events_read": 0,
            "diffs_written": 0,
            "last_processed_ts": None,
        }

    diffs = TagDiffLogger(store).process_batch(readings, config, tenant_id=tenant_id)
    last_processed_ts = max(r.event_timestamp for r in readings)

    logger.info(
        "historize tenant=%s read=%d diffs=%d last_ts=%s",
        tenant_id,
        len(readings),
        len(diffs),
        last_processed_ts,
    )
    return {
        "status": "ok",
        "tenant_id": tenant_id,
        "tag_events_read": len(readings),
        "diffs_written": len(diffs),
        "last_processed_ts": last_processed_ts,
    }


# ---------------------------------------------------------------------------
# Real cursor-based event reader (Option A implicit cursor + RLS)
# ---------------------------------------------------------------------------


def _row_to_reading(row) -> TagReading:
    meta = row["metadata"]
    if isinstance(meta, str):
        meta = json.loads(meta) if meta else {}
    elif meta is None:
        meta = {}
    value = row["value"]
    return TagReading(
        tag_path=row["tag_path"],
        value=None if value is None else str(value),
        value_type=row["value_type"],
        quality=row["quality"],
        event_timestamp=float(row["ets"]),
        event_id=row["event_id"],
        uns_path=row["uns_path"],
        source_system=row["source_system"],
        simulated=bool(row["simulated"]),
        metadata=meta,
    )


def _make_event_reader(neon_url: str):
    """Return a reader that fetches the unprocessed tag_events slice for a tenant.

    Cursor = MAX(event_timestamp) already in tag_event_diffs for the tenant
    (default 'epoch'). RLS is set per the NeonDiffStore pattern.
    """

    def read_events(tenant_id: str, since_ts, batch_size: int) -> list[TagReading]:
        from sqlalchemy import NullPool, create_engine, text

        engine = create_engine(
            neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
            )
            if since_ts is None:
                cursor = conn.execute(
                    text(
                        """
                        SELECT COALESCE(MAX(event_timestamp), 'epoch'::timestamptz)
                          FROM tag_event_diffs
                         WHERE tenant_id = :tid
                        """
                    ),
                    {"tid": tenant_id},
                ).scalar()
            else:
                cursor = conn.execute(
                    text("SELECT to_timestamp(:s)"), {"s": float(since_ts)}
                ).scalar()

            rows = (
                conn.execute(
                    text(
                        """
                        SELECT tag_path,
                               value,
                               value_type,
                               quality,
                               EXTRACT(EPOCH FROM event_timestamp) AS ets,
                               event_id::text   AS event_id,
                               uns_path::text   AS uns_path,
                               source_system,
                               simulated,
                               metadata
                          FROM tag_events
                         WHERE tenant_id = :tid
                           AND event_timestamp > :cursor
                         ORDER BY event_timestamp ASC
                         LIMIT :limit
                        """
                    ),
                    {"tid": tenant_id, "cursor": cursor, "limit": batch_size},
                )
                .mappings()
                .all()
            )
        return [_row_to_reading(r) for r in rows]

    return read_events


# ---------------------------------------------------------------------------
# Celery task — thin wrapper around the pure core
# ---------------------------------------------------------------------------


@app.task(name="tasks.tag_diff_historizer.historize_tag_diffs", bind=True)
def historize_tag_diffs(self, tenant_id: str | None = None) -> dict:
    """Read the unprocessed tag_events slice and persist meaningful diffs.

    Scheduled every 5 min (see celeryconfig.beat_schedule). Retries on failure.
    """
    tenant_id = tenant_id or os.getenv("MIRA_TENANT_ID")
    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot historize tag diffs")
        return {
            "status": "error",
            "error": "no_tenant_id",
            "tenant_id": tenant_id,
            "tag_events_read": 0,
            "diffs_written": 0,
            "last_processed_ts": None,
        }

    neon_url = os.getenv("NEON_DATABASE_URL")
    if not neon_url:
        logger.error("NEON_DATABASE_URL not set — cannot historize tag diffs")
        return {
            "status": "error",
            "error": "no_database_url",
            "tenant_id": tenant_id,
            "tag_events_read": 0,
            "diffs_written": 0,
            "last_processed_ts": None,
        }

    batch_size = int(os.getenv("TAG_DIFF_BATCH_SIZE", str(DEFAULT_BATCH_SIZE)))
    config = _load_config()
    store = NeonDiffStore(neon_url)
    read_events = _make_event_reader(neon_url)

    try:
        return run_historize_batch(
            store=store,
            read_events=read_events,
            config=config,
            tenant_id=tenant_id,
            batch_size=batch_size,
        )
    except Exception as exc:  # noqa: BLE001 - retry on any transient failure
        logger.exception("historize_tag_diffs failed: %s", exc)
        raise self.retry(exc=exc, countdown=30, max_retries=3)
