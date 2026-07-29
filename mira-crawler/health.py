"""Crawler health CLI — reads the per-job heartbeat, judges the schedule.

Dependency-free on purpose: imports ONLY ``job_registry`` +
``metrics.heartbeat`` (both stdlib-only). The Phase-4 watchdog shells out to
``python health.py --json`` and must be robust — dragging in docling/apscheduler
here would make the read path slow and fragile exactly where reliability
matters.

Honest, graceful degradation (the three demanded behaviours):

* **Cold start** — no heartbeat log yet (fresh deploy) reads as
  ``no_evidence_yet`` and exits 0. It is NEVER reported as "unhealthy": absence
  of evidence is not evidence of failure.
* **ran-0-new is healthy** — a crawl that discovered nothing is
  ``healthy_no_new``, distinct from ``failed`` and from ``never_ran``.
* **daemon-dead** — the 30-minute healthcheck going ``stale`` (silent past its
  40-minute window) is the scheduler-thread-is-dead signal and drives the
  overall verdict to ``degraded`` (exit 1) so the watchdog can alert.

A job only degrades the overall verdict when it is ``failed`` or ``stale`` — a
``never_ran`` job (e.g. a weekly report on a box that came up on a Tuesday) is
not yet due and must not raise a false alarm.

Usage:
    python health.py            # human-readable
    python health.py --json     # machine-readable (watchdog)
"""

from __future__ import annotations

import argparse
import json
import time
from typing import Any

import job_registry as jr
from metrics import heartbeat as hb

# Per-job verdicts.
HEALTHY = "healthy"
HEALTHY_NO_NEW = "healthy_no_new"
STALE = "stale"
FAILED = "failed"
NEVER_RAN = "never_ran"

# Overall roll-up.
OVERALL_HEALTHY = HEALTHY
DEGRADED = "degraded"
NO_EVIDENCE_YET = "no_evidence_yet"

# Verdicts that mean "something is wrong right now".
_DEGRADING = frozenset({FAILED, STALE})


def judge_job(spec: jr.JobSpec, latest: dict[str, Any] | None, *, now_epoch: int) -> dict[str, Any]:
    """Judge one job from its newest heartbeat (or ``None`` if never recorded)."""
    if latest is None:
        return {"verdict": NEVER_RAN, "why": "no heartbeat recorded yet", "age_seconds": None}

    status = latest.get("status")
    age = now_epoch - int(latest.get("epoch", 0))

    if status == hb.STATUS_FAILED:
        return {"verdict": FAILED, "why": "last run failed", "age_seconds": age}
    if age > spec.stale_after_seconds:
        return {
            "verdict": STALE,
            "why": f"silent {age}s (> {spec.stale_after_seconds}s window)",
            "age_seconds": age,
        }
    if status == hb.STATUS_NO_NEW:
        return {"verdict": HEALTHY_NO_NEW, "why": f"ran {age}s ago, nothing new", "age_seconds": age}
    return {"verdict": HEALTHY, "why": f"ran {age}s ago", "age_seconds": age}


def build_health(records: list[dict[str, Any]], *, now_epoch: int) -> dict[str, Any]:
    """Aggregate per-job heartbeats into a whole-schedule verdict.

    Iterates the registry (not the log) so a job that has never emitted a
    heartbeat is still present and judged ``never_ran`` rather than silently
    absent.
    """
    latest = hb.latest_by_job(records)
    jobs: dict[str, Any] = {}
    verdicts: list[str] = []
    for spec in jr.JOBS:
        v = judge_job(spec, latest.get(spec.id), now_epoch=now_epoch)
        v["name"] = spec.name
        jobs[spec.id] = v
        verdicts.append(v["verdict"])

    if any(v in _DEGRADING for v in verdicts):
        overall = DEGRADED
    elif all(v == NEVER_RAN for v in verdicts):
        overall = NO_EVIDENCE_YET
    else:
        overall = OVERALL_HEALTHY

    return {"overall": overall, "checked_at_epoch": now_epoch, "jobs": jobs}


def exit_code(report: dict[str, Any]) -> int:
    """0 for healthy / no-evidence-yet, 1 for degraded — the watchdog's signal."""
    return 1 if report.get("overall") == DEGRADED else 0


def render_text(report: dict[str, Any]) -> str:
    lines = [
        "CRAWLER HEALTH (per-job heartbeat evidence)",
        "=" * 43,
        f"overall: {report['overall']}",
        "",
    ]
    for jid, v in report["jobs"].items():
        lines.append(f"[{v['verdict']:<14}] {jid:<24} {v['why']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crawler scheduler health from heartbeat evidence.")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--heartbeat-log",
        default=None,
        help="path to job_heartbeat.jsonl (default: MIRA_JOB_HEARTBEAT_LOG or data/)",
    )
    parser.add_argument(
        "--now",
        type=int,
        default=None,
        help="reference epoch seconds (default: now) — test/repro hook",
    )
    args = parser.parse_args(argv)

    now_epoch = int(time.time()) if args.now is None else args.now
    records = hb.read_records(args.heartbeat_log)
    report = build_health(records, now_epoch=now_epoch)

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(render_text(report))
    return exit_code(report)


if __name__ == "__main__":
    raise SystemExit(main())
