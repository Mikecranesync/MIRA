"""MIRA Eval Celery Task — continuous eval harness, 60-minute schedule.

This file is deployed to /opt/master_of_puppets/workers/mira_eval_tasks.py
on the VPS. It registers as a shared_task so it binds to whatever Celery
app is active at import time (master_of_puppets on VPS).

Beat schedule entry (in /opt/master_of_puppets/celery_app.py):
    'mira-eval-every-60-min': {
        'task': 'mira_eval.run_batch',
        'schedule': 3600.0,
    }

Concurrency guard: file-based lock at /tmp/mira_eval.lock.
A run older than 15 minutes is considered stale and cleared.

Failure policy:
  - If run_eval.py returns rc not in {0, 1}: log, do NOT commit.
  - If scorecard file is missing after run: log, do NOT commit.
  - If git push fails: log warning, scorecard stays local.
"""

from __future__ import annotations

import logging
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from celery import shared_task

logger = logging.getLogger("mira-eval-task")

MIRA_DIR = Path(os.getenv("MIRA_DIR", "/opt/mira"))
EVAL_LOG = Path("/var/log/mira-eval.log")
LOCK_FILE = Path("/tmp/mira_eval.lock")
LOCK_MAX_AGE_S = 900  # 15 min — stale lock timeout


# ── Lock helpers ──────────────────────────────────────────────────────────────


def _acquire_lock() -> bool:
    """Return True if lock acquired, False if another run is in progress."""
    if LOCK_FILE.exists():
        age = time.monotonic() - LOCK_FILE.stat().st_mtime
        if age < LOCK_MAX_AGE_S:
            logger.warning("MIRA eval already running (lock age=%.0fs) — skipping", age)
            return False
        logger.warning("MIRA eval lock stale (age=%.0fs) — clearing and proceeding", age)
        LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def _release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


# ── Celery task ───────────────────────────────────────────────────────────────


@shared_task(name="mira_eval.run_batch", max_retries=0, ignore_result=False)
def run_eval_batch() -> dict:
    """Run MIRA eval harness. Returns status dict for Celery result backend."""
    if not _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    out_file = MIRA_DIR / "tests" / "eval" / "runs" / f"{ts}.md"

    try:
        # Pull latest eval fixtures (non-fatal if offline)
        subprocess.run(
            ["git", "fetch", "origin", "main"],
            cwd=MIRA_DIR, capture_output=True, timeout=30,
        )
        subprocess.run(
            ["git", "checkout", "origin/main", "--", "tests/eval/"],
            cwd=MIRA_DIR, capture_output=True, timeout=30,
        )

        # Run harness — exit 0 = all pass, exit 1 = some fail (both valid)
        result = subprocess.run(
            ["python3", "tests/eval/run_eval.py", "--output", str(out_file)],
            cwd=MIRA_DIR,
            capture_output=True,
            text=True,
            timeout=360,
        )

        # Always log
        with EVAL_LOG.open("a") as f:
            f.write(f"\n=== mira_eval.run_batch {ts} UTC ===\n")
            if result.stdout:
                f.write(result.stdout)
            if result.stderr:
                f.write(result.stderr)

        if result.returncode not in (0, 1):
            logger.error(
                "MIRA eval errored (rc=%d) — not committing scorecard", result.returncode
            )
            return {"status": "error", "rc": result.returncode, "ts": ts}

        if not out_file.exists():
            logger.error("MIRA eval finished but scorecard missing: %s", out_file)
            return {"status": "error", "reason": "missing_scorecard", "ts": ts}

        # Stage and commit
        subprocess.run(["git", "add", str(out_file)], cwd=MIRA_DIR, check=True)
        commit_msg = (
            f"chore: eval run {ts} UTC\n\n"
            "Signed-off-by: mira-eval-bot <eval@mira.local>"
        )
        commit_r = subprocess.run(
            ["git", "commit", "-m", commit_msg],
            cwd=MIRA_DIR, capture_output=True, text=True,
        )
        if commit_r.returncode != 0:
            logger.warning("Git commit failed: %s", commit_r.stderr[:300])
            return {"status": "ok_no_commit", "scorecard": str(out_file), "ts": ts}

        push_r = subprocess.run(
            ["git", "push", "origin", "main"],
            cwd=MIRA_DIR, capture_output=True, text=True, timeout=60,
        )
        if push_r.returncode != 0:
            logger.warning("Git push failed: %s", push_r.stderr[:300])

        logger.info("MIRA eval complete: %s (rc=%d)", out_file.name, result.returncode)
        return {"status": "ok", "scorecard": str(out_file), "ts": ts}

    except subprocess.TimeoutExpired as e:
        logger.error("MIRA eval timed out: %s", e)
        return {"status": "error", "reason": "timeout", "ts": ts}
    except Exception as e:
        logger.error("MIRA eval unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock()
