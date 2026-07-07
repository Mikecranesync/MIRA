"""KB Growth Cron — hourly batch ingest of queued PDFs.

Reads ``mira-crawler/cron/manual_queue.json``, processes up to
``KB_GROWTH_BATCH_SIZE`` (default 5) entries per run, retries transient
failures with exponential backoff, dedups against ``knowledge_entries``,
and emits milestone Telegram notifications.

Spec: ``docs/specs/kb-ingest-acceleration-spec.md``

Crontab entry (VPS, set by ``scripts/install_crons.sh``):
  0 * * * * cd /opt/mira && doppler run -- python3 \\
      mira-crawler/cron/kb_growth_cron.py >> /var/log/kb_growth.log 2>&1

CLI:
  python3 kb_growth_cron.py                 # run a batch (default)
  python3 kb_growth_cron.py --status        # print queue stats and exit
  python3 kb_growth_cron.py --hydrate-from-cache
                                            # append manual_cache rows as pending
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ─── reporting (optional — degrades gracefully) ───────────────────────────────
_REPO_ROOT = Path(__file__).parent.parent.parent
try:
    from mira_crawler.reporting.agent_report import AgentReport
    from mira_crawler.reporting.telegram_notify import notify as _tg_notify

    _REPORT_AVAILABLE = True
except ImportError:
    try:
        sys.path.insert(0, str(_REPO_ROOT))
        from mira_crawler.reporting.agent_report import AgentReport
        from mira_crawler.reporting.telegram_notify import notify as _tg_notify

        _REPORT_AVAILABLE = True
    except ImportError:
        _REPORT_AVAILABLE = False

        def _tg_notify(*_: object) -> bool:
            return False  # type: ignore[misc]


# ─── paths ────────────────────────────────────────────────────────────────────
_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
QUEUE_FILE = _HERE / "manual_queue.json"
PIPELINE = _REPO / "mira-crawler" / "tasks" / "full_ingest_pipeline.py"

# ─── tunables (env-overridable) ───────────────────────────────────────────────
BATCH_SIZE = int(os.getenv("KB_GROWTH_BATCH_SIZE", "5"))
RUN_BUDGET_SEC = int(os.getenv("KB_GROWTH_RUN_BUDGET_SEC", "3000"))  # 50 min
PIPELINE_TIMEOUT_SEC = int(os.getenv("KB_GROWTH_PIPELINE_TIMEOUT_SEC", "900"))
MAX_ATTEMPTS = int(os.getenv("KB_GROWTH_MAX_ATTEMPTS", "5"))
RETRY_BASE_SEC = int(os.getenv("KB_GROWTH_RETRY_BASE_SEC", "600"))  # 10 min
RETRY_CAP_SEC = int(os.getenv("KB_GROWTH_RETRY_CAP_SEC", "21600"))  # 6 h
STALE_STATE_SEC = int(os.getenv("KB_GROWTH_STALE_STATE_SEC", "3600"))  # 1 h

MILESTONE_STEP = int(os.getenv("KB_GROWTH_MILESTONE_STEP", "100"))
TENANT_ID = os.getenv("MIRA_TENANT_ID", "")
NEON_URL = os.getenv("NEON_DATABASE_URL", "")

# ─── error classification ─────────────────────────────────────────────────────
# Substrings (lowercased) that indicate a transient error worth retrying.
_TRANSIENT_MARKERS = (
    "timeout",
    "timed out",
    "504",
    "502",
    "503",
    "connectionerror",
    "connecterror",
    "networkerror",
    "readtimeout",
    "temporarily unavailable",
    "operationalerror",
    "interfaceerror",
    "remote end closed",
    "max retries",
    "ssl",
)
# Substrings that indicate a hard failure — never retry.
_HARD_MARKERS = (
    "404",
    "410",
    "bad magic bytes",
    "exceeds 50 mb",
    "not a valid pdf",
    "no such host",
    "name resolution",
)


def _classify_error(err: str) -> str:
    """Return ``'retryable'`` or ``'hard'`` for an error tail."""
    low = (err or "").lower()
    if any(m in low for m in _HARD_MARKERS):
        return "hard"
    if any(m in low for m in _TRANSIENT_MARKERS):
        return "retryable"
    # Default: unknown errors are retryable, but bounded by MAX_ATTEMPTS.
    return "retryable"


# ─── helpers ──────────────────────────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ts() -> str:
    return _now().isoformat(timespec="seconds")


def _log(msg: str) -> None:
    print(f"[{_ts()}] {msg}", flush=True)


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        # datetime.fromisoformat handles "+00:00" suffix on 3.11+.
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def load_queue() -> list[dict]:
    with open(QUEUE_FILE) as f:
        return json.load(f)


def save_queue(queue: list[dict]) -> None:
    """Atomic write — temp file + rename so a crash never leaves a half file."""
    tmp = QUEUE_FILE.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(queue, f, indent=2)
    os.replace(tmp, QUEUE_FILE)


# ─── dedup against NeonDB ─────────────────────────────────────────────────────
def url_already_ingested(url: str) -> bool:
    """Return True if any chunk for this URL exists in knowledge_entries.

    Falls open: any DB error returns False so the cron keeps draining.
    """
    if not NEON_URL or not TENANT_ID or not url:
        return False
    try:
        import psycopg2

        with psycopg2.connect(NEON_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM knowledge_entries "
                    "WHERE tenant_id = %s::uuid AND source_url = %s LIMIT 1",
                    (TENANT_ID, url),
                )
                return cur.fetchone() is not None
    except Exception as exc:
        _log(f"dedup_check_failed for {url[:80]}: {exc}")
        return False


# ─── state machine ───────────────────────────────────────────────────────────
def _backoff_seconds(attempts: int) -> int:
    delay = RETRY_BASE_SEC * (2 ** max(0, attempts - 1))
    return min(delay, RETRY_CAP_SEC)


def _is_due_for_retry(entry: dict, now: datetime) -> bool:
    if entry.get("status") != "failed_retryable":
        return False
    nxt = _parse_iso(entry.get("next_retry_at"))
    if nxt is None:
        return True
    return now >= nxt


def _eligible_for_run(entry: dict, now: datetime) -> bool:
    return entry.get("status") == "pending" or _is_due_for_retry(entry, now)


def revive_stale(queue: list[dict]) -> int:
    """Reset entries stuck in ``downloading``/``processing`` for > STALE_STATE_SEC."""
    now = _now()
    revived = 0
    for entry in queue:
        if entry.get("status") not in ("downloading", "processing"):
            continue
        started = _parse_iso(entry.get("started_at"))
        if started is None or (now - started).total_seconds() > STALE_STATE_SEC:
            entry["status"] = "failed_retryable"
            entry["last_error"] = "stale_state_reset"
            entry["next_retry_at"] = _ts()
            revived += 1
    return revived


# ─── pipeline driver ─────────────────────────────────────────────────────────
def run_pipeline(entry: dict) -> tuple[bool, str, int]:
    """Run full_ingest_pipeline.py for one entry.

    Returns (success, output_tail, chunks_inserted).
    chunks_inserted is parsed best-effort from the report; defaults to 0.
    """
    cmd = [
        sys.executable,
        str(PIPELINE),
        "--pdf-url",
        entry["url"],
        "--manufacturer",
        entry.get("manufacturer", ""),
        "--model",
        entry.get("model", ""),
        "--type",
        entry.get("type", "installation_manual"),
        "--no-quality-gate",
    ]
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=PIPELINE_TIMEOUT_SEC,
        env=env,
    )
    output = (result.stdout + result.stderr).strip()
    tail_lines = output.splitlines()[-25:]
    tail = "\n".join(tail_lines)

    # Best-effort chunk count parse from the pipeline's report line:
    #   "KB Chunks:    16 chunks created (...)"
    chunks = 0
    for line in tail_lines:
        s = line.strip()
        if s.startswith("KB Chunks:"):
            try:
                chunks = int(s.split(":", 1)[1].strip().split()[0])
            except (ValueError, IndexError):
                chunks = 0
            break

    return result.returncode == 0, tail, chunks


def _process_entry(entry: dict, queue: list[dict]) -> dict:
    """Process one entry through download → pipeline. Mutates entry in place.

    Persists ``downloading``/``processing`` mid-flight via save_queue() so a
    crash leaves a recoverable trail.
    """
    name = f"{entry.get('manufacturer', '?')} {entry.get('model', '?')}"
    url = entry.get("url", "")
    entry["attempts"] = int(entry.get("attempts", 0)) + 1
    entry["started_at"] = _ts()

    # Pre-flight dedup.
    if url_already_ingested(url):
        entry["status"] = "skipped_dedup"
        entry["done_at"] = _ts()
        entry.pop("next_retry_at", None)
        _log(f"SKIPPED (already ingested): {name}")
        save_queue(queue)
        return entry

    entry["status"] = "downloading"
    save_queue(queue)

    # The pipeline does both download + extract; we flip to "processing"
    # right before invoking it so a mid-pipeline crash is visible.
    entry["status"] = "processing"
    save_queue(queue)

    try:
        success, tail, chunks = run_pipeline(entry)
    except subprocess.TimeoutExpired:
        success, tail, chunks = False, f"TIMEOUT after {PIPELINE_TIMEOUT_SEC}s", 0
    except Exception as exc:
        success, tail, chunks = False, str(exc), 0

    if success:
        entry["status"] = "done"
        entry["done_at"] = _ts()
        entry["chunks_inserted"] = chunks
        entry.pop("next_retry_at", None)
        entry.pop("last_error", None)
        _log(f"SUCCESS: {name} ({chunks} chunks)")
        # --- drive-pack bridge (default-OFF via MIRA_DRIVE_PACK_BRIDGE; fail-open) ---
        # A successful manual ingest MAY create a review-only drive-pack update
        # candidate if the PDF matches a known drive family and its hash is new/
        # changed. It never extracts/grades inline, never promotes, never touches
        # a trusted pack — and MUST NOT affect this (already-successful) KB ingest.
        try:
            import sys as _sys

            _cdir = str(Path(__file__).resolve().parent.parent)  # mira-crawler/
            if _cdir not in _sys.path:
                _sys.path.insert(0, _cdir)
            from drive_pack_bridge import maybe_create_candidate

            _b = maybe_create_candidate(entry, now_iso=entry["done_at"])
            if _b.get("status") == "candidate_created":
                _log(
                    f"drive-pack candidate: {_b.get('registry_manual_id')} ({_b.get('change_state')}) → {_b.get('candidate_path')}"
                )
            elif _b.get("status") not in ("disabled", "unchanged"):
                _log(f"drive-pack bridge: {_b.get('status')} ({_b.get('reason', '')})")
        except Exception as _exc:  # noqa: BLE001 — bridge must NEVER fail KB ingest
            _log(f"drive-pack bridge skipped (non-fatal): {_exc}")
    else:
        kind = _classify_error(tail)
        entry["last_error"] = tail[-200:]
        if kind == "hard" or entry["attempts"] >= MAX_ATTEMPTS:
            entry["status"] = "failed"
            entry["failed_at"] = _ts()
            entry.pop("next_retry_at", None)
            _log(f"FAILED (hard, attempt {entry['attempts']}): {name}")
        else:
            entry["status"] = "failed_retryable"
            delay = _backoff_seconds(entry["attempts"])
            entry["next_retry_at"] = (_now() + timedelta(seconds=delay)).isoformat(
                timespec="seconds"
            )
            _log(f"FAILED (retry in {delay}s, attempt {entry['attempts']}): {name}")

    _log(f"Pipeline output (tail):\n{tail}")
    save_queue(queue)
    return entry


# ─── batch loop ──────────────────────────────────────────────────────────────
def _queue_stats(queue: list[dict]) -> dict[str, int]:
    counts = {
        "pending": 0,
        "downloading": 0,
        "processing": 0,
        "done": 0,
        "failed": 0,
        "failed_retryable": 0,
        "skipped_dedup": 0,
    }
    for e in queue:
        s = e.get("status", "pending")
        counts[s] = counts.get(s, 0) + 1
    counts["total"] = len(queue)
    counts["remaining"] = counts["pending"] + counts["failed_retryable"]
    return counts


def run_batch() -> dict:
    """Process up to BATCH_SIZE eligible entries. Returns a run summary."""
    if not QUEUE_FILE.exists():
        _log(f"ERROR: queue file not found: {QUEUE_FILE}")
        sys.exit(1)
    if not PIPELINE.exists():
        _log(f"ERROR: pipeline not found: {PIPELINE}")
        sys.exit(1)

    queue = load_queue()

    revived = revive_stale(queue)
    if revived:
        _log(f"Janitor: revived {revived} stale entries")
        save_queue(queue)

    now = _now()
    eligible_idx = [i for i, e in enumerate(queue) if _eligible_for_run(e, now)]

    if not eligible_idx:
        stats = _queue_stats(queue)
        _log(f"No eligible entries. Stats: {stats}")
        return {"processed": [], "stats": stats, "started_at": _ts()}

    done_before = sum(1 for e in queue if e.get("status") == "done")
    started_at = time.monotonic()
    processed: list[dict] = []

    for idx in eligible_idx[:BATCH_SIZE]:
        if time.monotonic() - started_at > RUN_BUDGET_SEC:
            _log(f"Run budget exceeded ({RUN_BUDGET_SEC}s) — stopping batch early")
            break
        entry = queue[idx]
        _log(
            f"Processing [{idx + 1}/{len(queue)}] (attempt "
            f"{int(entry.get('attempts', 0)) + 1}): "
            f"{entry.get('manufacturer', '?')} {entry.get('model', '?')} — "
            f"{entry.get('url', '')[:80]}"
        )
        processed.append(_process_entry(entry, queue))

    stats = _queue_stats(queue)
    done_after = stats["done"]
    _log(f"Run complete. Processed {len(processed)} entries. Stats: {stats}")

    return {
        "processed": processed,
        "stats": stats,
        "done_before": done_before,
        "done_after": done_after,
        "started_at": _ts(),
    }


# ─── reporting ───────────────────────────────────────────────────────────────
def _milestone_crossed(before: int, after: int, step: int) -> int | None:
    """Return the milestone (e.g. 100, 200) crossed in this run, or None."""
    if step <= 0 or after <= before:
        return None
    last_before = (before // step) * step
    last_after = (after // step) * step
    if last_after > last_before:
        return last_after
    return None


def _emit_run_report(summary: dict) -> None:
    stats = summary["stats"]
    processed = summary["processed"]
    done_before = summary.get("done_before", stats["done"])
    done_after = summary.get("done_after", stats["done"])

    # Per-PDF Telegram only in legacy single-mode (BATCH_SIZE == 1).
    if BATCH_SIZE == 1 and processed:
        e = processed[0]
        name = f"{e.get('manufacturer', '?')} {e.get('model', '?')}"
        try:
            if e["status"] == "done":
                _tg_notify(
                    "kb_growth",
                    f"✅ Ingested *{name}*\n"
                    f"Queue: {stats['done']} done · "
                    f"{stats['failed']} failed · {stats['remaining']} remaining",
                )
            elif e["status"] == "skipped_dedup":
                _tg_notify("kb_growth", f"⏭ Skipped (already in KB): *{name}*")
            elif e["status"] == "failed":
                err = e.get("last_error", "")[:120]
                _tg_notify("kb_growth", f"❌ Failed: *{name}*\n`{err}`")
            else:  # failed_retryable
                err = e.get("last_error", "")[:120]
                _tg_notify(
                    "kb_growth",
                    f"⚠️ Retry queued: *{name}*\n`{err}`",
                )
        except Exception as exc:
            _log(f"Telegram notify failed (non-fatal): {exc}")

    # Milestone Telegram — every MILESTONE_STEP done, plus all-done.
    milestone = _milestone_crossed(done_before, done_after, MILESTONE_STEP)
    if milestone is not None:
        try:
            _tg_notify(
                "kb_growth",
                f"📚 KB milestone: *{milestone} manuals ingested*\n"
                f"Remaining: {stats['remaining']} · Failed: {stats['failed']}",
            )
        except Exception as exc:
            _log(f"Milestone notify failed (non-fatal): {exc}")
    if stats["remaining"] == 0 and processed:
        try:
            _tg_notify(
                "kb_growth",
                f"🎉 KB backlog cleared!\n"
                f"{stats['done']} done · {stats['failed']} hard-failed · "
                f"{stats['skipped_dedup']} skipped",
            )
        except Exception as exc:
            _log(f"All-done notify failed (non-fatal): {exc}")

    # HTML/Markdown report.
    if not _REPORT_AVAILABLE:
        return
    try:
        successes = sum(1 for e in processed if e["status"] == "done")
        retries = sum(1 for e in processed if e["status"] == "failed_retryable")
        hard_fails = sum(1 for e in processed if e["status"] == "failed")
        status_level = "ok" if hard_fails == 0 else "warning"
        report = (
            AgentReport("kb-growth-cron")
            .set_title("KB Growth Cron", f"{len(processed)} processed")
            .set_status(status_level)  # type: ignore[arg-type]
            .add_metric("Done (total)", stats["done"], "PDFs", trend="up")
            .add_metric("Done (run)", successes, "PDFs")
            .add_metric("Retry queued", retries, "PDFs")
            .add_metric("Hard failed", stats["failed"], "PDFs")
            .add_metric("Remaining", stats["remaining"], "PDFs")
            .add_metric("Skipped (dedup)", stats["skipped_dedup"], "PDFs")
        )
        if stats["remaining"] > 0:
            report.add_action(f"Drain {stats['remaining']} pending+retryable")
        if stats["failed"] > 0:
            report.add_action(f"Investigate {stats['failed']} hard-failed PDFs")
        report.save(telegram=False)
    except Exception as exc:
        _log(f"Report generation failed (non-fatal): {exc}")


# ─── queue hydration from manual_cache (one-shot ops command) ─────────────────
def hydrate_from_manual_cache() -> int:
    """Append ``manual_cache`` rows to the queue as ``pending``.

    Skips:
    - rows whose ``manual_url`` is already in ``manual_queue.json``,
    - rows whose ``manual_url`` already has chunks in ``knowledge_entries``.

    Returns the number of new rows appended.
    """
    if not NEON_URL or not TENANT_ID:
        _log("hydrate: NEON_DATABASE_URL or MIRA_TENANT_ID not set")
        return 0

    try:
        import psycopg2
    except ImportError:
        _log("hydrate: psycopg2 not installed")
        return 0

    queue = load_queue()
    existing_urls = {e.get("url") for e in queue if e.get("url")}

    appended = 0
    with psycopg2.connect(NEON_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT manufacturer, model, manual_url, manual_title
                  FROM manual_cache
                 WHERE manual_url IS NOT NULL
                   AND manual_url <> ''
                   AND manual_url NOT IN (
                       SELECT DISTINCT source_url FROM knowledge_entries
                        WHERE tenant_id = %s::uuid AND source_url IS NOT NULL
                   )
                """,
                (TENANT_ID,),
            )
            rows = cur.fetchall()

    for mfr, model, url, title in rows:
        if url in existing_urls:
            continue
        queue.append(
            {
                "url": url,
                "manufacturer": mfr or "Unknown",
                "model": model or "Unknown",
                "type": "installation_manual",
                "status": "pending",
                "notes": f"Hydrated from manual_cache on {_ts()}: {title or ''}"[:300],
            }
        )
        existing_urls.add(url)
        appended += 1

    save_queue(queue)
    _log(f"hydrate: appended {appended} new entries from manual_cache")
    return appended


# ─── main ────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="KB growth cron")
    parser.add_argument("--status", action="store_true", help="Print queue stats and exit")
    parser.add_argument(
        "--hydrate-from-cache",
        action="store_true",
        help="Append manual_cache rows to the queue as pending",
    )
    args = parser.parse_args()

    if args.status:
        if not QUEUE_FILE.exists():
            _log(f"queue file not found: {QUEUE_FILE}")
            sys.exit(1)
        print(json.dumps(_queue_stats(load_queue()), indent=2))
        return

    if args.hydrate_from_cache:
        hydrate_from_manual_cache()
        return

    _log(f"KB growth cron starting (batch={BATCH_SIZE}, budget={RUN_BUDGET_SEC}s)")
    # Singleton lock: if a slow batch hasn't finished before the next hourly tick,
    # a second run would double-process the queue and double memory/CPU. The lock
    # is an advisory fcntl lock (OS-released if the holder dies, so a crash can't
    # permanently block ingest); a second concurrent run exits cleanly (0).
    # Fail-open: if the hardening helper isn't importable, run without the lock.
    try:
        sys.path.insert(0, str(_REPO_ROOT / "tools" / "lead-hunter"))
        from hardening import singleton_lock

        lock_cm = singleton_lock("kb-growth")
    except Exception:  # noqa: BLE001 — never let lock setup block ingest
        from contextlib import nullcontext

        lock_cm = nullcontext()
    with lock_cm:
        summary = run_batch()
        _emit_run_report(summary)
    _log("KB growth cron done")


if __name__ == "__main__":
    main()
