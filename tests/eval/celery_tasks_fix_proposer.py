"""MIRA Fix Proposer Celery Task — weekly failure cluster → draft PR automation.

This file is deployed to /opt/master_of_puppets/workers/mira_fix_proposer_tasks.py
on the VPS. It registers as a shared_task so it binds to whatever Celery app is
active at import time (master_of_puppets on VPS).

Beat schedule entry (in /opt/master_of_puppets/celery_app.py):
    'mira-fix-proposer-sunday-0600': {
        'task': 'mira_fix_proposer.run_weekly',
        'schedule': crontab(hour=6, minute=0, day_of_week='sunday'),
    }

Control env vars:
  FIX_PROPOSER_DISABLED=1          Skip all runs without error
  FIX_PROPOSER_MAX_PRS_PER_RUN=3   PR flood guard (default: 3)
  FIX_PROPOSER_MIN_CLUSTER_SIZE=3  Min failures to form a cluster (default: 3)
  FIX_PROPOSER_LLM_MODEL           Claude model (default: claude-sonnet-4-6)
  FIX_PROPOSER_GH_TOKEN            GitHub PAT (falls back to GH_TOKEN env)

Failure policy:
  - If cluster detection produces 0 clusters: log, return status='no_clusters'.
  - If Claude API is unavailable: log, return status='error'.
  - If gh pr create fails: log warning per PR, continue with remaining clusters.
  - Exceptions do not propagate to Celery (max_retries=0, failure is silent).
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from celery import shared_task

logger = logging.getLogger("mira-fix-proposer-task")

MIRA_DIR = Path(os.getenv("MIRA_DIR", "/opt/mira"))
LOCK_FILE = Path("/tmp/mira_fix_proposer.lock")
LOCK_MAX_AGE_S = 3600  # 1 hour — fix proposer can take a while


# ── Lock helpers ──────────────────────────────────────────────────────────────


def _acquire_lock() -> bool:
    if LOCK_FILE.exists():
        age = time.monotonic() - LOCK_FILE.stat().st_mtime
        if age < LOCK_MAX_AGE_S:
            logger.warning(
                "Fix proposer already running (lock age=%.0fs) — skipping", age
            )
            return False
        logger.warning("Fix proposer lock stale (age=%.0fs) — clearing", age)
        LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def _release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


# ── Celery task ───────────────────────────────────────────────────────────────


@shared_task(name="mira_fix_proposer.run_weekly", max_retries=0, ignore_result=False)
def run_fix_proposer() -> dict:
    """Run fix proposer pipeline. Returns status dict for Celery result backend.

    Reads scorecards from the last 7 days, clusters failures by signature,
    proposes patches via Claude API, and opens DRAFT PRs for clusters with
    ≥ FIX_PROPOSER_MIN_CLUSTER_SIZE members.
    """
    if os.getenv("FIX_PROPOSER_DISABLED") == "1":
        logger.info("FIX_PROPOSER_DISABLED=1 — skipping fix proposer run")
        return {"status": "disabled"}

    if not _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")

    try:
        # Ensure the fix_proposer module is importable from MIRA_DIR
        tools_path = str(MIRA_DIR / "mira-bots" / "tools")
        if tools_path not in sys.path:
            sys.path.insert(0, tools_path)

        from fix_proposer import FixProposer  # type: ignore[import]

        scorecards_dir = MIRA_DIR / "tests" / "eval" / "runs"
        gh_token = os.getenv("FIX_PROPOSER_GH_TOKEN", os.getenv("GH_TOKEN", ""))

        proposer = FixProposer(
            scorecards_dir=scorecards_dir,
            repo_path=MIRA_DIR,
            gh_token=gh_token,
        )

        pr_urls = proposer.run(days=7, dry_run=False)

        logger.info(
            "Fix proposer complete at %s — %d PR(s) opened: %s",
            ts, len(pr_urls), pr_urls,
        )
        return {
            "status": "ok",
            "ts": ts,
            "prs_opened": len(pr_urls),
            "pr_urls": pr_urls,
        }

    except ImportError as e:
        logger.error("Failed to import FixProposer — is MIRA_DIR correct? %s", e)
        return {"status": "error", "reason": f"import_error: {e}", "ts": ts}
    except Exception as e:
        logger.error("Fix proposer unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock()
