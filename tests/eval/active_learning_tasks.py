"""MIRA Active Learning Celery Task — nightly 04:00 UTC.

Scans feedback_log for thumbs-down entries since last run, anonymizes them via Claude,
infers pass criteria, generates YAML eval fixtures, and opens a draft GitHub PR.

This file is deployed to /opt/master_of_puppets/workers/mira_active_learning_tasks.py
on the VPS. It registers as a shared_task bound to the master_of_puppets Celery app.

Beat schedule entry (add to /opt/master_of_puppets/celery_app.py):
    'mira-active-learning-nightly': {
        'task': 'mira_active_learning.run_nightly',
        'schedule': crontab(hour=4, minute=0),   # 04:00 UTC — after judge eval at 03:00
    }

Environment variables required:
    ACTIVE_LEARNING_GH_TOKEN   GitHub PAT with contents:write + pull_requests:write
    ANTHROPIC_API_KEY          Claude API key (same as used by mira-bots)
    MIRA_DB_PATH               SQLite path (default: /opt/mira/data/mira.db)
    ACTIVE_LEARNING_DISABLED   Set to "1" to disable without removing the schedule

Optional tuning:
    ACTIVE_LEARNING_MIN_CONFIDENCE      Float 0-1 (default: 0.6)
    ACTIVE_LEARNING_MAX_FIXTURES_PER_RUN  Int (default: 10)
    ACTIVE_LEARNING_STATE_PATH          State JSON (default: /opt/mira/data/active_learning_state.json)
    CLAUDE_MODEL                        Model override (default: claude-sonnet-4-6)
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

# Resolve repo root so we can import ActiveLearner regardless of CWD
_REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from mira_bots.tools.active_learner import ActiveLearner  # noqa: E402

logger = logging.getLogger("mira-active-learning-task")

MIRA_DIR = str(Path(os.getenv("MIRA_DIR", "/opt/mira")))
LOCK_FILE = Path("/tmp/mira_active_learning.lock")
LOCK_MAX_AGE_S = 1800  # 30 min — anonymize+PR can take a while


# ── Lock helpers ──────────────────────────────────────────────────────────────


def _acquire_lock() -> bool:
    if LOCK_FILE.exists():
        age = time.monotonic() - LOCK_FILE.stat().st_mtime
        if age < LOCK_MAX_AGE_S:
            logger.warning("Active learning already running (lock age=%.0fs) — skipping", age)
            return False
        logger.warning("Active learning lock stale (age=%.0fs) — clearing", age)
        LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def _release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


# ── Celery task ───────────────────────────────────────────────────────────────


@shared_task(name="mira_active_learning.run_nightly", max_retries=0, ignore_result=False)
def run_nightly() -> dict:
    """Nightly active learning: 👎 feedback → anonymized fixtures → draft PR."""
    if os.getenv("ACTIVE_LEARNING_DISABLED", "").strip() == "1":
        logger.info("Active learning disabled via ACTIVE_LEARNING_DISABLED=1 — skipping")
        return {"status": "skipped", "reason": "disabled"}

    if not _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")

    try:
        gh_token = os.getenv("ACTIVE_LEARNING_GH_TOKEN", "")
        api_key = os.getenv("ANTHROPIC_API_KEY", "")

        if not gh_token:
            logger.error("ACTIVE_LEARNING_GH_TOKEN not set — cannot open PR")
            return {"status": "error", "reason": "missing_gh_token", "ts": ts}
        if not api_key:
            logger.error("ANTHROPIC_API_KEY not set — cannot anonymize")
            return {"status": "error", "reason": "missing_api_key", "ts": ts}

        learner = ActiveLearner(
            db_path=os.getenv("MIRA_DB_PATH", "/opt/mira/data/mira.db"),
            state_path=os.getenv(
                "ACTIVE_LEARNING_STATE_PATH",
                "/opt/mira/data/active_learning_state.json",
            ),
            gh_token=gh_token,
            anthropic_api_key=api_key,
            claude_model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            min_confidence=float(os.getenv("ACTIVE_LEARNING_MIN_CONFIDENCE", "0.6")),
            max_fixtures_per_run=int(os.getenv("ACTIVE_LEARNING_MAX_FIXTURES_PER_RUN", "10")),
        )

        result = asyncio.run(learner.run(dry_run=False, mira_dir=MIRA_DIR))

        if result.get("pr_url"):
            logger.info(
                "Active learning complete: %d fixtures → %s",
                result["fixtures_generated"],
                result["pr_url"],
            )
        else:
            logger.info(
                "Active learning complete: %d fixtures generated, %d skipped (no PR)",
                result.get("fixtures_generated", 0),
                result.get("skipped", 0),
            )

        return result

    except Exception as e:
        logger.error("Active learning unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock()
