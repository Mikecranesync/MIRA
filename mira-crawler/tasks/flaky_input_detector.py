"""Flaky-input detector Celery task wrapper (Phase 9 / issue #1661).

Thin Celery beat task that calls ``run_detection_cycle`` from
``mira-bots/agents/flaky_input_detector.py``.  All logic lives there;
this module only owns the Celery plumbing and env-var wiring.

Scheduled every 5 min on the ``historian`` queue (same profile that
already runs ``tag_diff_historizer`` and ``historize_runs``).

Env:
  NEON_DATABASE_URL       — NeonDB connection string (required)
  MIRA_TENANT_ID          — tenant UUID (required)
  FLAKY_WINDOW            — detection window label (default '1h')
  FLAKY_MIN_BASELINE_DAYS — minimum days of history required (default 7)
  FLAKY_BATCH_SIZE        — max tag-diff rows per run (default 500)
"""

from __future__ import annotations

import logging
import os

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app  # type: ignore[import]

# Import the core detector from mira-bots.  In Docker, mira-bots is on
# PYTHONPATH; in local dev, fall back to the sibling directory.
try:
    from mira_bots.agents.flaky_input_detector import run_detection_cycle
except ImportError:  # pragma: no cover
    import pathlib
    import sys

    _bots_dir = pathlib.Path(__file__).resolve().parents[2] / "mira-bots"
    if str(_bots_dir) not in sys.path:
        sys.path.insert(0, str(_bots_dir))
    from agents.flaky_input_detector import run_detection_cycle  # type: ignore[import]

logger = logging.getLogger("mira-crawler.tasks.flaky_input_detector")


@app.task(
    name="tasks.flaky_input_detector.detect_flaky_inputs",
    bind=True,
    max_retries=2,
)
def detect_flaky_inputs(self, tenant_id: str | None = None) -> dict:
    """Run one flaky-input detection pass for a tenant.

    Scheduled every 5 min by Celery beat (historian profile). Single-tenant
    per invocation; fail-open — errors are logged, never raised to the caller.
    """
    tenant_id = tenant_id or os.getenv("MIRA_TENANT_ID", "")
    if not tenant_id:
        logger.warning("flaky_input_detector: MIRA_TENANT_ID not set — skipping")
        return {"status": "skipped", "reason": "missing_tenant_id"}

    db_url = os.getenv("NEON_DATABASE_URL", "")
    if not db_url:
        logger.warning("flaky_input_detector: NEON_DATABASE_URL not set — skipping")
        return {"status": "skipped", "reason": "missing_db_url"}

    try:
        result = run_detection_cycle(db_url, tenant_id)
        logger.info("flaky_input_detector: %s", result)
        return {"status": "ok", **result}
    except Exception as exc:  # noqa: BLE001 — retry on transient failure
        logger.exception("flaky_input_detector: unexpected error: %s", exc)
        raise self.retry(exc=exc, countdown=60, max_retries=2)
