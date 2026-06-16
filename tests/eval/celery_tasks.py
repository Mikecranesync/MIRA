"""MIRA Eval Celery Tasks — continuous eval harness.

Three tasks:

  mira_eval.run_batch             — Hourly, judge DISABLED (fast/cheap deterministic eval).
  mira_eval.run_batch_with_judge  — Nightly at 03:00 UTC, judge ENABLED (full quality eval).
  mira_synth.generate_nightly     — Nightly at 02:00 UTC, synthetic pair generation (runs before judge).

This file is deployed to /opt/master_of_puppets/workers/mira_eval_tasks.py
on the VPS. It registers as a shared_task so it binds to whatever Celery
app is active at import time (master_of_puppets on VPS).

Beat schedule entries (in /opt/master_of_puppets/celery_app.py):

    from celery.schedules import crontab

    'mira-eval-every-60-min': {
        'task': 'mira_eval.run_batch',
        'schedule': 3600.0,
    },
    'mira-eval-nightly-with-judge': {
        'task': 'mira_eval.run_batch_with_judge',
        'schedule': crontab(hour=3, minute=0),
    },
    'mira-synth-nightly': {
        'task': 'mira_synth.generate_nightly',
        'schedule': crontab(hour=2, minute=0),
    }

Concurrency guard: file-based lock at /tmp/mira_eval.lock.
A run older than 15 minutes is considered stale and cleared.
The nightly judge run uses a separate lock at /tmp/mira_eval_judge.lock
so it does not block the hourly run (they may briefly overlap at 03:00).

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
JUDGE_LOCK_FILE = Path("/tmp/mira_eval_judge.lock")
SYNTH_LOCK_FILE = Path("/tmp/mira_synth.lock")
LOCK_MAX_AGE_S = 900  # 15 min — stale lock timeout


# ── Lock helpers ──────────────────────────────────────────────────────────────


def _acquire_lock(lock_path: Path = LOCK_FILE) -> bool:
    """Return True if lock acquired, False if another run is in progress."""
    if lock_path.exists():
        age = time.monotonic() - lock_path.stat().st_mtime
        if age < LOCK_MAX_AGE_S:
            logger.warning(
                "MIRA eval lock held (%s, age=%.0fs) — skipping", lock_path.name, age
            )
            return False
        logger.warning(
            "MIRA eval lock stale (%s, age=%.0fs) — clearing and proceeding",
            lock_path.name,
            age,
        )
        lock_path.unlink(missing_ok=True)
    lock_path.write_text(str(os.getpid()))
    return True


def _release_lock(lock_path: Path = LOCK_FILE) -> None:
    lock_path.unlink(missing_ok=True)


# ── Shared run helper ─────────────────────────────────────────────────────────


def _run_eval(ts: str, out_file: Path, judge_enabled: bool) -> dict:
    """Pull latest fixtures, run eval harness, commit + push scorecard.

    Returns a status dict for the Celery result backend.
    """
    # Pull latest eval fixtures (non-fatal if offline)
    subprocess.run(
        ["git", "fetch", "origin", "main"],
        cwd=MIRA_DIR, capture_output=True, timeout=30,
    )
    subprocess.run(
        ["git", "checkout", "origin/main", "--", "tests/eval/"],
        cwd=MIRA_DIR, capture_output=True, timeout=30,
    )

    # Build subprocess env — inherit everything, override EVAL_DISABLE_JUDGE
    sub_env = {**os.environ, "EVAL_DISABLE_JUDGE": "0" if judge_enabled else "1"}

    result = subprocess.run(
        ["python3", "tests/eval/run_eval.py", "--output", str(out_file)],
        cwd=MIRA_DIR,
        capture_output=True,
        text=True,
        timeout=4200,  # 57 scenarios × ~3 turns × 20s/turn worst case
        env=sub_env,
    )

    # Always log
    with EVAL_LOG.open("a") as f:
        tag = "with_judge" if judge_enabled else "no_judge"
        f.write(f"\n=== mira_eval.run_batch [{tag}] {ts} UTC ===\n")
        if result.stdout:
            f.write(result.stdout)
        if result.stderr:
            f.write(result.stderr)

    if result.returncode not in (0, 1):
        logger.error(
            "MIRA eval errored (rc=%d, judge=%s) — not committing scorecard",
            result.returncode,
            judge_enabled,
        )
        return {"status": "error", "rc": result.returncode, "ts": ts}

    if not out_file.exists():
        logger.error("MIRA eval finished but scorecard missing: %s", out_file)
        return {"status": "error", "reason": "missing_scorecard", "ts": ts}

    # Stage scorecard + judge JSONL (if present)
    files_to_stage = [str(out_file)]
    judge_jsonl = out_file.with_suffix("").with_name(out_file.stem + "-judge.jsonl")
    if judge_jsonl.exists():
        files_to_stage.append(str(judge_jsonl))

    subprocess.run(["git", "add"] + files_to_stage, cwd=MIRA_DIR, check=True)

    # Safety whitelist — the bot is only permitted to commit paths under
    # tests/eval/**. On 2026-04-24 an eval run (00c34e6) somehow co-committed
    # mira-hub/src/** changes alongside the scorecard, stripping the Upload
    # picker wiring out of the Knowledge page. Root cause of the extra
    # staging was never identified, so we defend here: refuse to commit
    # anything off-path and unstage it before logging + bailing.
    staged_r = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=MIRA_DIR, capture_output=True, text=True,
    )
    staged_paths = [p for p in staged_r.stdout.splitlines() if p.strip()]
    off_path = [p for p in staged_paths if not p.startswith("tests/eval/")]
    if off_path:
        logger.error(
            "MIRA eval refusing to commit — %d off-whitelist paths staged: %s",
            len(off_path),
            ", ".join(off_path[:10]),
        )
        # Unstage everything off-whitelist so the next iteration has a clean slate
        subprocess.run(
            ["git", "reset", "HEAD", "--"] + off_path,
            cwd=MIRA_DIR, capture_output=True, text=True,
        )
        # Also throw away any working-tree changes to those paths so the source
        # of truth (origin/main) wins on the next fetch — otherwise the same
        # rogue modifications will re-stage on the next run.
        subprocess.run(
            ["git", "checkout", "HEAD", "--"] + off_path,
            cwd=MIRA_DIR, capture_output=True, text=True,
        )
        return {
            "status": "refused",
            "reason": "off_whitelist_paths_staged",
            "paths": off_path,
            "ts": ts,
        }

    tag_label = "with judge" if judge_enabled else "no judge"
    commit_msg = (
        f"chore: eval run {ts} UTC ({tag_label})\n\n"
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

    logger.info(
        "MIRA eval complete: %s (rc=%d, judge=%s)",
        out_file.name,
        result.returncode,
        judge_enabled,
    )
    return {"status": "ok", "scorecard": str(out_file), "judge_enabled": judge_enabled, "ts": ts}


# ── Celery tasks ──────────────────────────────────────────────────────────────


@shared_task(name="mira_eval.run_batch", max_retries=0, ignore_result=False)
def run_eval_batch() -> dict:
    """Hourly eval — judge DISABLED (fast, cheap, deterministic checkpoints only).

    Beat schedule: every 3600 seconds.
    """
    if not _acquire_lock(LOCK_FILE):
        return {"status": "skipped", "reason": "lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    out_file = MIRA_DIR / "tests" / "eval" / "runs" / f"{ts}.md"

    try:
        return _run_eval(ts, out_file, judge_enabled=False)
    except subprocess.TimeoutExpired as e:
        logger.error("MIRA eval timed out: %s", e)
        return {"status": "error", "reason": "timeout", "ts": ts}
    except Exception as e:
        logger.error("MIRA eval unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock(LOCK_FILE)


@shared_task(name="mira_eval.run_batch_with_judge", max_retries=0, ignore_result=False)
def run_eval_batch_with_judge() -> dict:
    """Nightly eval — judge ENABLED (LLM-as-judge quality scoring across 4 dimensions).

    Beat schedule: crontab(hour=3, minute=0) — 03:00 UTC.
    Requires GROQ_API_KEY or ANTHROPIC_API_KEY in environment.
    Uses a separate lock file so it does not block the hourly run.
    Output: scorecard .md + sibling -judge.jsonl committed to main.
    """
    if not _acquire_lock(JUDGE_LOCK_FILE):
        return {"status": "skipped", "reason": "judge_lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    out_file = MIRA_DIR / "tests" / "eval" / "runs" / f"{ts}-judge.md"

    try:
        return _run_eval(ts, out_file, judge_enabled=True)
    except subprocess.TimeoutExpired as e:
        logger.error("MIRA eval with judge timed out: %s", e)
        return {"status": "error", "reason": "timeout", "ts": ts}
    except Exception as e:
        logger.error("MIRA eval with judge unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock(JUDGE_LOCK_FILE)


@shared_task(name="mira_synth.generate_nightly", max_retries=0, ignore_result=False)
def generate_nightly_pairs() -> dict:
    """Nightly synthetic pair generation at 02:00 UTC (1 hour before judge eval).

    Runs synthetic_pair_gen.py to generate fixtures for tests/eval/fixtures/synthetic/
    and DPO JSONL to /opt/mira/data/dpo_pairs/. Commits new fixtures to main.

    Beat schedule: crontab(hour=2, minute=0) — 02:00 UTC.
    Requires ANTHROPIC_API_KEY in environment.
    """
    if not _acquire_lock(SYNTH_LOCK_FILE):
        return {"status": "skipped", "reason": "synth_lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    fixture_dir = MIRA_DIR / "tests" / "eval" / "fixtures" / "synthetic"
    dpo_dir = MIRA_DIR / "data" / "dpo_pairs"
    synth_log = EVAL_LOG.parent / "mira-synth.log"

    try:
        result = subprocess.run(
            [
                "python3",
                str(MIRA_DIR / "mira-bots" / "tools" / "synthetic_pair_gen.py"),
                "--fixture-dir", str(fixture_dir),
                "--dpo-dir", str(dpo_dir),
            ],
            cwd=MIRA_DIR,
            capture_output=True,
            text=True,
            timeout=600,
            env={**os.environ},
        )

        with synth_log.open("a") as f:
            f.write(f"\n=== mira_synth.generate_nightly {ts} UTC ===\n")
            if result.stdout:
                f.write(result.stdout)
            if result.stderr:
                f.write(result.stderr)

        if result.returncode != 0:
            logger.error("Synthetic pair gen errored (rc=%d)", result.returncode)
            return {"status": "error", "rc": result.returncode, "ts": ts}

        # Parse output to get counts
        try:
            summary = __import__("json").loads(result.stdout.strip().split("\n")[-1])
        except Exception:
            summary = {}

        fixture_count = summary.get("fixture_count", 0)
        if fixture_count == 0:
            logger.info("Synthetic gen produced 0 fixtures — nothing to commit")
            return {"status": "ok", "fixture_count": 0, "ts": ts}

        # Stage + commit new fixtures and DPO JSONL
        subprocess.run(
            ["git", "add",
             str(fixture_dir),
             str(dpo_dir)],
            cwd=MIRA_DIR, check=True,
        )
        commit_r = subprocess.run(
            ["git", "commit", "-m",
             f"auto: {fixture_count} synthetic eval fixtures + DPO pairs ({ts} UTC)\n\n"
             "Signed-off-by: mira-synth-bot <eval@mira.local>"],
            cwd=MIRA_DIR, capture_output=True, text=True,
        )
        if commit_r.returncode != 0:
            logger.warning("Synth commit failed (nothing to commit?): %s", commit_r.stderr[:200])
            return {"status": "ok_no_commit", "fixture_count": fixture_count, "ts": ts}

        push_r = subprocess.run(
            ["git", "push", "origin", "main"],
            cwd=MIRA_DIR, capture_output=True, text=True, timeout=60,
        )
        if push_r.returncode != 0:
            logger.warning("Synth push failed: %s", push_r.stderr[:200])

        logger.info("Nightly synth complete: %d fixtures, %d DPO pairs", fixture_count, summary.get("dpo_count", 0))
        return {
            "status": "ok",
            "fixture_count": fixture_count,
            "dpo_count": summary.get("dpo_count", 0),
            "ts": ts,
        }

    except subprocess.TimeoutExpired as e:
        logger.error("Synthetic pair gen timed out: %s", e)
        return {"status": "error", "reason": "timeout", "ts": ts}
    except Exception as e:
        logger.error("Synthetic pair gen unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock(SYNTH_LOCK_FILE)
