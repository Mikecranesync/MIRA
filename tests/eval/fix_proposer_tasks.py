"""MIRA Fix Proposer Celery Task — nightly 04:30 UTC.

Runs after the nightly eval (03:00) and active learning (04:00). Clusters
failing scenarios, asks Claude for a minimal patch proposal, opens a draft
GitHub PR for each cluster.

Beat schedule entry (add to /opt/master_of_puppets/celery_app.py):
    'mira-fix-proposer-nightly': {
        'task': 'mira_fix_proposer.run_nightly',
        'schedule': crontab(hour=4, minute=30),   # 04:30 UTC
    }

Environment variables required:
    FIX_PROPOSER_GH_TOKEN      GitHub PAT with contents:write + pull_requests:write
    ANTHROPIC_API_KEY          Claude API key
    FIX_PROPOSER_DISABLED      Set to "1" to disable without removing the schedule

Optional tuning:
    FIX_PROPOSER_MIN_CLUSTER       Min failures per cluster (default: 3)
    FIX_PROPOSER_MAX_CLUSTERS      Max clusters per run (default: 3)
    FIX_PROPOSER_STATE_PATH        State JSON (default: /opt/mira/data/fix_proposer_state.json)
    FIX_PROPOSER_RUNS_DIR          Scorecards directory (default: /opt/mira/tests/eval/runs)
    CLAUDE_MODEL                   Model override (default: claude-sonnet-4-6)
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

# Resolve repo root so we can import FixProposer regardless of CWD
_REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from mira_bots.tools.fix_proposer import (  # noqa: E402
    FixProposer,
    FixProposerConfig,
)

logger = logging.getLogger("mira-fix-proposer-task")

MIRA_DIR = Path(os.getenv("MIRA_DIR", "/opt/mira"))
LOCK_FILE = Path("/tmp/mira_fix_proposer.lock")
LOCK_MAX_AGE_S = 1800  # 30 min — Claude + git operations can take a while


def _acquire_lock() -> bool:
    if LOCK_FILE.exists():
        age = time.monotonic() - LOCK_FILE.stat().st_mtime
        if age < LOCK_MAX_AGE_S:
            logger.warning("Fix proposer already running (lock age=%.0fs) — skipping", age)
            return False
        logger.warning("Fix proposer lock stale (age=%.0fs) — clearing", age)
        LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def _release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


@shared_task(name="mira_fix_proposer.run_nightly", max_retries=0, ignore_result=False)
def run_nightly() -> dict:
    """Nightly fix-proposal automation: failure clusters → Claude → draft PR."""
    if os.getenv("FIX_PROPOSER_DISABLED", "").strip() == "1":
        logger.info("Fix proposer disabled via FIX_PROPOSER_DISABLED=1 — skipping")
        return {"status": "skipped", "reason": "disabled"}

    if not _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")

    try:
        gh_token = os.getenv("FIX_PROPOSER_GH_TOKEN", "")
        api_key = os.getenv("ANTHROPIC_API_KEY", "")

        if not gh_token:
            logger.error("FIX_PROPOSER_GH_TOKEN not set — cannot open PR")
            return {"status": "error", "reason": "missing_gh_token", "ts": ts}
        if not api_key:
            logger.error("ANTHROPIC_API_KEY not set — cannot call Claude")
            return {"status": "error", "reason": "missing_api_key", "ts": ts}

        proposer = FixProposer(FixProposerConfig(
            anthropic_api_key=api_key,
            gh_token=gh_token,
            repo_root=MIRA_DIR,
            state_path=Path(os.getenv(
                "FIX_PROPOSER_STATE_PATH",
                "/opt/mira/data/fix_proposer_state.json",
            )),
            runs_dir=Path(os.getenv(
                "FIX_PROPOSER_RUNS_DIR",
                str(MIRA_DIR / "tests" / "eval" / "runs"),
            )),
            claude_model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            min_cluster_size=int(os.getenv("FIX_PROPOSER_MIN_CLUSTER", "3")),
            max_clusters_per_run=int(os.getenv("FIX_PROPOSER_MAX_CLUSTERS", "3")),
        ))

        result = asyncio.run(proposer.run(dry_run=False))

        if result.get("pr_urls"):
            logger.info(
                "Fix proposer complete: %d clusters → %d PRs",
                result.get("clusters_found", 0),
                len(result["pr_urls"]),
            )
        else:
            logger.info(
                "Fix proposer complete: %d failures, %d clusters (no PRs)",
                result.get("failures_total", 0),
                result.get("clusters_found", 0),
            )

        return result

    except Exception as e:
        logger.error("Fix proposer unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock()
