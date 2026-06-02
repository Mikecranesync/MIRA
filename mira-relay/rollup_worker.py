"""mira-relay/rollup_worker.py — Daily rollup of tag_events older than 90 days.

Rolls up raw tag_events rows into tag_event_summary_daily (one row per
tenant + uns_path + tag_id + event_type per calendar day). Raw rows are then
deleted to keep table growth bounded.

Retention policy (Phase 5 / master plan):
  - Raw tag_events: 90 days
  - Daily summary: indefinite (small row count)

Run as:
    python -m mira-relay.rollup_worker [--dry-run] [--retention-days 90]

TODO: Schedule via Coolify / cron / pg_cron. For production, this should run
daily at 03:00 UTC (after European and US midnight, before peak traffic).
A pg_cron entry on NeonDB is the preferred path — no app-side scheduler needed:

    SELECT cron.schedule('tag-events-rollup', '0 3 * * *',
        'CALL tag_events_daily_rollup(90)');

The CALL-based version is provided as a migration stub below in ROLLUP_PROCEDURE_SQL.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

logger = logging.getLogger("mira-relay.rollup")

# ---------------------------------------------------------------------------
# Schema — create if not exists (idempotent)
# ---------------------------------------------------------------------------

SUMMARY_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS tag_event_summary_daily (
    summary_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    summary_date    DATE NOT NULL,                      -- the calendar day (UTC)
    uns_path        LTREE NOT NULL,
    tag_id          TEXT NOT NULL,
    event_type      TEXT NOT NULL,

    -- Aggregates
    event_count     INT NOT NULL DEFAULT 0,
    first_ts        TIMESTAMPTZ,
    last_ts         TIMESTAMPTZ,

    -- For value_changed: min/max/avg delta over the day
    delta_min       DOUBLE PRECISION,
    delta_max       DOUBLE PRECISION,
    delta_avg       DOUBLE PRECISION,

    -- For fault windows: total fault duration in seconds
    fault_duration_seconds DOUBLE PRECISION,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, summary_date, uns_path, tag_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_tag_event_summary_tenant_date
    ON tag_event_summary_daily (tenant_id, summary_date DESC);
"""

# ---------------------------------------------------------------------------
# Rollup query — aggregate then delete
# ---------------------------------------------------------------------------

ROLLUP_INSERT_SQL = """
INSERT INTO tag_event_summary_daily (
    tenant_id, summary_date, uns_path, tag_id, event_type,
    event_count, first_ts, last_ts, delta_min, delta_max, delta_avg,
    fault_duration_seconds
)
SELECT
    tenant_id,
    ts::date AS summary_date,
    uns_path,
    tag_id,
    event_type,
    COUNT(*)                            AS event_count,
    MIN(ts)                             AS first_ts,
    MAX(ts)                             AS last_ts,
    MIN(delta)                          AS delta_min,
    MAX(delta)                          AS delta_max,
    AVG(delta)                          AS delta_avg,
    -- Fault duration: sum of (window_end - window_start) for fault_window_close rows
    SUM(
        CASE
            WHEN event_type = 'fault_window_close'
                 AND window_start IS NOT NULL
                 AND window_end IS NOT NULL
            THEN EXTRACT(EPOCH FROM (window_end - window_start))
            ELSE 0
        END
    )                                   AS fault_duration_seconds
FROM tag_events
WHERE ts < NOW() - INTERVAL ':retention_days days'
GROUP BY tenant_id, ts::date, uns_path, tag_id, event_type
ON CONFLICT (tenant_id, summary_date, uns_path, tag_id, event_type)
DO UPDATE SET
    event_count             = tag_event_summary_daily.event_count + EXCLUDED.event_count,
    last_ts                 = GREATEST(tag_event_summary_daily.last_ts, EXCLUDED.last_ts),
    delta_min               = LEAST(tag_event_summary_daily.delta_min, EXCLUDED.delta_min),
    delta_max               = GREATEST(tag_event_summary_daily.delta_max, EXCLUDED.delta_max),
    fault_duration_seconds  = COALESCE(tag_event_summary_daily.fault_duration_seconds, 0)
                              + COALESCE(EXCLUDED.fault_duration_seconds, 0)
"""

ROLLUP_DELETE_SQL = """
DELETE FROM tag_events
WHERE ts < NOW() - INTERVAL ':retention_days days'
"""

# ---------------------------------------------------------------------------
# Optional: pg_cron procedure stub
# ---------------------------------------------------------------------------

ROLLUP_PROCEDURE_SQL = """
-- Optional pg_cron target (Neon supports pg_cron natively).
-- Install once via migration; schedule via cron.schedule() after.
CREATE OR REPLACE PROCEDURE tag_events_daily_rollup(retention_days INT DEFAULT 90)
LANGUAGE plpgsql AS $$
BEGIN
    -- 1. Aggregate rows older than retention_days into summary table.
    INSERT INTO tag_event_summary_daily ( ... )
    SELECT ... FROM tag_events WHERE ts < NOW() - (retention_days || ' days')::INTERVAL
    GROUP BY ...
    ON CONFLICT ... DO UPDATE ...;

    -- 2. Delete the raw rows that were just summarised.
    DELETE FROM tag_events WHERE ts < NOW() - (retention_days || ' days')::INTERVAL;

    RAISE NOTICE 'tag_events rollup complete (retention=% days)', retention_days;
END;
$$;
-- Schedule: SELECT cron.schedule('tag-events-rollup', '0 3 * * *', 'CALL tag_events_daily_rollup(90)');
"""


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def run_rollup(retention_days: int = 90, dry_run: bool = False) -> int:
    """Roll up tag_events older than retention_days into daily summary.

    Returns: number of raw rows deleted (0 if dry_run or DB unavailable).
    Fail-soft: any DB error is logged and 0 returned.
    """
    db_url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        logger.warning("No NEON_DATABASE_URL / DATABASE_URL — rollup skipped")
        return 0

    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        engine = create_engine(
            db_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
    except Exception as exc:
        logger.warning("rollup_worker: engine init failed: %s", exc)
        return 0

    try:
        with engine.begin() as conn:
            # Ensure summary table exists.
            conn.execute(text(SUMMARY_TABLE_DDL))

            # Count rows to be rolled up (for logging / dry-run).
            count_row = conn.execute(
                text(
                    "SELECT COUNT(*) FROM tag_events "
                    "WHERE ts < NOW() - INTERVAL ':rd days'"
                    .replace(":rd", str(retention_days))
                )
            ).fetchone()
            row_count = count_row[0] if count_row else 0

            logger.info(
                "Rollup: %d raw tag_events rows older than %d days to process%s",
                row_count,
                retention_days,
                " (dry-run — skipping writes)" if dry_run else "",
            )

            if dry_run or row_count == 0:
                return 0

            # Insert into summary.
            insert_sql = ROLLUP_INSERT_SQL.replace(":retention_days", str(retention_days))
            conn.execute(text(insert_sql))

            # Delete raw rows.
            delete_sql = ROLLUP_DELETE_SQL.replace(":retention_days", str(retention_days))
            result = conn.execute(text(delete_sql))
            deleted = result.rowcount

        logger.info("Rollup complete: deleted %d raw tag_events rows", deleted)
        return deleted

    except Exception as exc:
        logger.warning("rollup_worker: rollup failed: %s", exc)
        return 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Roll up tag_events older than N days into daily summary.",
    )
    p.add_argument(
        "--retention-days",
        type=int,
        default=int(os.getenv("TAG_EVENTS_RETENTION_DAYS", "90")),
        help="Delete raw rows older than this many days (default: 90)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Count rows and log without deleting anything",
    )
    p.add_argument(
        "--log-level",
        default=os.getenv("LOG_LEVEL", "INFO"),
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    started_at = datetime.now(timezone.utc).isoformat()
    logger.info("rollup_worker starting (retention=%d days, dry_run=%s, started_at=%s)",
                args.retention_days, args.dry_run, started_at)
    deleted = run_rollup(retention_days=args.retention_days, dry_run=args.dry_run)
    logger.info("rollup_worker done: %d rows affected", deleted)
    return 0


if __name__ == "__main__":
    sys.exit(main())
