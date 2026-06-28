"""Celery-beat task — run-centric fault detection (issue #2341).

Thin wrapper around ``run_engine.pipeline.run_historization``:
  - NO-OP unless ``MIRA_RUN_DIFF_ENABLED == "1"`` (default disabled).
  - reads recent tag_events (own minimal reader — does NOT import the
    unmerged tag_diff_historizer), segments runs, persists runs/steps,
    updates the baseline, computes + persists diffs.

Beat cadence is every 30s (see celeryconfig.beat_schedule), but the disabled
fast-path keeps that cheap until the feature is switched on per deployment.

Config (env):
  MIRA_RUN_DIFF_ENABLED            "1" to enable (default off)
  MIRA_TENANT_ID                   tenant UUID
  NEON_DATABASE_URL                Hub DB
  MIRA_RUN_TRIGGERS                "uns_path=tag_path:threshold,..."
  MIRA_RUN_K_SIGMA                 sigma multiplier for 'critical' (default 3.0)
  MIRA_BASELINE_NORMAL_RUN_COUNT   max normal runs in the baseline (default 5)
  MIRA_BASELINE_MIN_RUNS           min normal runs before scoring (default 2)
  MIRA_SNAPSHOT_PRE_SECONDS        evidence window pre-roll (default 300)
  MIRA_SNAPSHOT_POST_SECONDS       evidence window post-roll (default 300)
  MIRA_RUN_LOOKBACK_SECONDS        tag_events read horizon per beat (default 3600)
"""

from __future__ import annotations

import logging
import os

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

try:
    from mira_crawler.run_engine.models import Reading, parse_run_triggers
    from mira_crawler.run_engine.pipeline import run_historization
    from mira_crawler.run_engine.store import NeonRunStore
except ImportError:
    from run_engine.models import Reading, parse_run_triggers
    from run_engine.pipeline import run_historization
    from run_engine.store import NeonRunStore

logger = logging.getLogger("mira-crawler.tasks.historize_runs")


def _enabled() -> bool:
    return os.getenv("MIRA_RUN_DIFF_ENABLED") == "1"


def _engine(neon_url: str):
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    return create_engine(
        neon_url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _read_recent_events(
    neon_url: str,
    tenant_id: str,
    *,
    uns_paths: list[str],
    lookback_seconds: float,
) -> list[Reading]:
    """Read recent tag_events for the trigger equipment (own minimal reader).

    Deliberately self-contained — we do NOT import the (unmerged)
    tag_diff_historizer. tag_events is never modified.
    """
    if not uns_paths:
        return []
    from sqlalchemy import text

    engine = _engine(neon_url)
    with engine.connect() as conn:
        conn.execute(
            text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
        )
        rows = (
            conn.execute(
                text(
                    """
                    SELECT tag_path, value, value_type, quality,
                           uns_path::text AS uns_path,
                           event_id::text AS event_id, simulated, source_system,
                           extract(epoch FROM event_timestamp) AS ts
                      FROM tag_events
                     WHERE tenant_id = :tid
                       AND uns_path::text = ANY(:uns_paths)
                       AND event_timestamp >= NOW() - (:lookback || ' seconds')::interval
                     ORDER BY event_timestamp ASC
                    """
                ),
                {
                    "tid": tenant_id,
                    "uns_paths": uns_paths,
                    "lookback": str(int(lookback_seconds)),
                },
            )
            .mappings()
            .all()
        )

    out: list[Reading] = []
    for r in rows:
        raw = r["value"]
        try:
            numeric = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            numeric = None
        out.append(
            Reading(
                tag_path=r["tag_path"],
                value=numeric,
                event_timestamp=float(r["ts"]),
                uns_path=r["uns_path"],
                value_type=r["value_type"],
                quality=r["quality"],
                event_id=r["event_id"],
                simulated=bool(r["simulated"]),
                source_system=r["source_system"],
                raw_value=raw,
            )
        )
    return out


@app.task(name="tasks.historize_runs.historize_runs")
def historize_runs() -> dict:
    """Detect runs, baseline them, and diff each closed run for anomalies."""
    if not _enabled():
        return {"status": "disabled"}

    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not tenant_id or not neon_url:
        logger.error("historize_runs: MIRA_TENANT_ID / NEON_DATABASE_URL not set")
        return {"status": "error", "error": "missing_config"}

    triggers = parse_run_triggers(os.getenv("MIRA_RUN_TRIGGERS"))
    if not triggers:
        return {"status": "no_triggers"}

    k_sigma = float(os.getenv("MIRA_RUN_K_SIGMA", "3.0"))
    normal_run_count = int(os.getenv("MIRA_BASELINE_NORMAL_RUN_COUNT", "5"))
    min_baseline_runs = int(os.getenv("MIRA_BASELINE_MIN_RUNS", "2"))
    pre_seconds = float(os.getenv("MIRA_SNAPSHOT_PRE_SECONDS", "300"))
    post_seconds = float(os.getenv("MIRA_SNAPSHOT_POST_SECONDS", "300"))
    lookback = float(os.getenv("MIRA_RUN_LOOKBACK_SECONDS", "3600"))

    try:
        readings = _read_recent_events(
            neon_url,
            tenant_id,
            uns_paths=list(triggers.keys()),
            lookback_seconds=lookback,
        )
        store = NeonRunStore(neon_url)
        summary = run_historization(
            readings,
            store,
            triggers,
            tenant_id=tenant_id,
            k_sigma=k_sigma,
            normal_run_count=normal_run_count,
            min_baseline_runs=min_baseline_runs,
            pre_seconds=pre_seconds,
            post_seconds=post_seconds,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("historize_runs failed: %s", exc)
        return {"status": "error", "error": str(exc)}

    logger.info(
        "historize_runs: opened=%d closed=%d anomalous=%d diffs=%d",
        summary.get("runs_opened", 0),
        summary.get("runs_closed", 0),
        summary.get("anomalous_runs", 0),
        summary.get("diffs_written", 0),
    )
    return summary
