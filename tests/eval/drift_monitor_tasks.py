"""MIRA Drift Monitor Celery Task — weekly Sundays 03:00 UTC.

Samples recent production queries, computes cosine distance from fixture
centroid, flags drift when score > threshold.

Beat schedule entry (add to /opt/master_of_puppets/celery_app.py):
    'mira-drift-monitor-weekly': {
        'task': 'mira_drift_monitor.run_weekly',
        'schedule': crontab(hour=3, minute=0, day_of_week='sunday'),
    }

Environment:
    MIRA_DB_PATH            SQLite path (default: /opt/mira/data/mira.db)
    OLLAMA_BASE_URL         Ollama URL (default: http://host.docker.internal:11434)
    DRIFT_THRESHOLD         Cosine distance threshold (default: 0.15)
    DRIFT_SAMPLE_SIZE       Max prod queries (default: 500)
    DRIFT_LOOKBACK_DAYS     Days to sample (default: 7)
    DRIFT_MONITOR_DISABLED  Set to "1" to disable
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from celery import shared_task

# Resolve repo root so we can import DriftMonitor
_REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from mira_bots.tools.drift_monitor import (  # noqa: E402
    DriftMonitor,
    DriftMonitorConfig,
)

logger = logging.getLogger("mira-drift-monitor-task")

MIRA_DIR = Path(os.getenv("MIRA_DIR", "/opt/mira"))
LOCK_FILE = Path("/tmp/mira_drift_monitor.lock")
LOCK_MAX_AGE_S = 1200  # 20 min — embedding 500 queries takes time


def _acquire_lock() -> bool:
    if LOCK_FILE.exists():
        age = time.monotonic() - LOCK_FILE.stat().st_mtime
        if age < LOCK_MAX_AGE_S:
            logger.warning("Drift monitor already running (lock age=%.0fs) — skipping", age)
            return False
        logger.warning("Drift monitor lock stale (age=%.0fs) — clearing", age)
        LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def _release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


@shared_task(name="mira_drift_monitor.run_weekly", max_retries=0, ignore_result=False)
def run_weekly() -> dict:
    """Weekly drift check: prod queries vs fixture centroid."""
    if os.getenv("DRIFT_MONITOR_DISABLED", "").strip() == "1":
        logger.info("Drift monitor disabled — skipping")
        return {"status": "skipped", "reason": "disabled"}

    if not _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")

    try:
        monitor = DriftMonitor(DriftMonitorConfig(
            db_path=Path(os.getenv("MIRA_DB_PATH", "/opt/mira/data/mira.db")),
            ollama_url=os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434"),
            embed_model=os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest"),
            fixtures_dir=Path(os.getenv(
                "DRIFT_FIXTURES_DIR", str(MIRA_DIR / "tests" / "eval" / "fixtures")
            )),
            output_dir=Path(os.getenv(
                "DRIFT_OUTPUT_DIR", str(MIRA_DIR / "tests" / "eval" / "drift")
            )),
            threshold=float(os.getenv("DRIFT_THRESHOLD", "0.15")),
            sample_size=int(os.getenv("DRIFT_SAMPLE_SIZE", "500")),
            top_n=int(os.getenv("DRIFT_TOP_N", "10")),
            lookback_days=int(os.getenv("DRIFT_LOOKBACK_DAYS", "7")),
        ))

        report = asyncio.run(monitor.run(dry_run=False))

        level = logging.WARNING if report.drift_flagged else logging.INFO
        logger.log(
            level,
            "Drift monitor: score=%.4f threshold=%.4f flagged=%s (%d prod / %d fixtures)",
            report.drift_score, report.threshold, report.drift_flagged,
            report.prod_sample_size, report.fixture_count,
        )

        return {
            "status": "ok",
            "drift_score": report.drift_score,
            "drift_flagged": report.drift_flagged,
            "prod_sample_size": report.prod_sample_size,
            "fixture_count": report.fixture_count,
            "top_unfamiliar_count": len(report.top_unfamiliar),
            "ts": ts,
        }

    except Exception as e:
        logger.error("Drift monitor unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock()
