"""Append-only per-job heartbeat for the crawler scheduler — dependency-free.

One JSONL row per scheduled-job run, recording whether the job actually fired
and how it went. This is the fix for the "registration != success" trap: the
old 30-minute ``healthcheck`` only proved ``CrawlerConfig()`` constructs, never
that a crawl ran. ``health.py`` reads these rows to answer, per job, *did it run
recently* and *did it succeed* — distinguishing three honest outcomes:

* ``ok``      — the job ran and did work (stored new chunks, or a non-crawl job
  completed cleanly).
* ``no_new``  — the job ran but there was nothing new (0 URLs discovered, or
  everything already indexed). This is HEALTHY, not a failure (Phase 0).
* ``failed``  — the job raised, or every discovered URL errored.

Same discipline as ``metrics/latency.py``: stdlib-only, append-only, fail-soft
readers, wall-clock injectable for tests. It is intentionally NOT a second
store — ``latency.py`` records *ingest* stage timings; this records *scheduled
job* outcomes; ``health.py`` aggregates both kinds of evidence.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STATUS_OK = "ok"
STATUS_NO_NEW = "no_new"
STATUS_FAILED = "failed"

SCHEMA_VERSION = 1

# Absolute, cwd-INDEPENDENT default: heartbeat.py lives in mira-crawler/metrics/,
# so parent.parent is mira-crawler/. A cwd-relative string (as latency.py uses)
# would double to mira-crawler/mira-crawler/data/… under the daemon's cwd
# (run.sh does `cd $SCRIPT_DIR`), so the daemon and the watchdog/health CLI would
# read different files. Resolve from __file__ instead (the fleet_status.py
# pattern). This matches install_watchdog.sh's HEARTBEAT_LOG default, so daemon
# and watchdog agree with NO run.sh edit.
DEFAULT_LOG_PATH = str(Path(__file__).resolve().parent.parent / "data" / "job_heartbeat.jsonl")


def _default_log_path() -> Path:
    return Path(os.getenv("MIRA_JOB_HEARTBEAT_LOG", DEFAULT_LOG_PATH))


def classify_crawl_stats(stats: Any) -> str:
    """Map a crawl's returned stats dict to a heartbeat status.

    Crawls return ``{total_urls, fetched, skipped, stored_chunks, errors}``
    (``crawler/base_crawler.py``). Non-crawl jobs (report) return ``None`` and
    are ``ok`` if they didn't raise.
    """
    if not isinstance(stats, dict):
        return STATUS_OK
    if stats.get("stored_chunks", 0) > 0:
        return STATUS_OK
    if stats.get("total_urls", 0) == 0:
        return STATUS_NO_NEW  # nothing discovered — healthy idle
    # discovered URLs but stored nothing:
    if stats.get("errors", 0) > 0 and stats.get("fetched", 0) == 0:
        return STATUS_FAILED  # every discovered URL errored
    return STATUS_NO_NEW  # fetched/deduped but nothing new to store


def record_job(
    job_id: str,
    status: str,
    *,
    detail: dict[str, Any] | None = None,
    log_path: str | Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    """Append one heartbeat row for ``job_id`` and return it.

    ``now`` (epoch seconds) is injectable so tests never touch the wall clock.
    """
    epoch = time.time() if now is None else now
    record = {
        "schema_version": SCHEMA_VERSION,
        "job_id": job_id,
        "status": status,
        "epoch": int(epoch),
        "ts": datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat(timespec="seconds"),
        "detail": detail or {},
    }
    path = Path(log_path) if log_path is not None else _default_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
    return record


def read_records(log_path: str | Path | None = None) -> list[dict[str, Any]]:
    """All heartbeat rows, oldest-first. Fail-soft: a missing file returns
    ``[]`` and malformed lines are skipped — a health tool must never crash on
    bad state."""
    path = Path(log_path) if log_path is not None else _default_log_path()
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("job_id"):
            rows.append(obj)
    return rows


def latest_by_job(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The newest row per ``job_id`` (by ``epoch``)."""
    latest: dict[str, dict[str, Any]] = {}
    for r in records:
        jid = r.get("job_id")
        if not jid:
            continue
        prev = latest.get(jid)
        if prev is None or r.get("epoch", 0) >= prev.get("epoch", 0):
            latest[jid] = r
    return latest
