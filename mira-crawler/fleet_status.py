"""Manual-discovery fleet status — read-only "code reality vs. runtime reality" report.

The manual/bulletin discovery fleet (Trigger.dev tasks, the AB manual hunter,
kb_growth_cron, sitemap/RSS crawlers) exists in code. This tool answers the
harder question: **which parts actually ran recently?** — by reading the local
runtime artifacts the fleet already writes, and printing the exact operator
commands for the evidence that only lives off-box (Redis dedup sets, NeonDB
freshness, Trigger.dev Cloud).

It is strictly READ-ONLY: it opens files and prints. No network, no DB, no
writes, no fieldbus. Run it on a node where the artifacts live (Charlie for the
hunter/guardrails, the VPS for the queue) to get a real snapshot; run it in a
checkout and it honestly reports "artifact absent — run on <node>" plus the
command to check.

It deliberately does NOT duplicate ``cron/kb_growth_cron.py --status`` (queue
counts) — it *aggregates* that plus the hunter run reports, guardrails state,
and the STOP_INGEST kill switch into one fleet view, and never claims a
component is "live" without a local artifact to prove it (see the judgment
vocabulary below).

Usage:
    python fleet_status.py            # human-readable report
    python fleet_status.py --json     # machine-readable
    python fleet_status.py --commands # just the operator command block
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

_THIS = Path(__file__).resolve().parent  # mira-crawler/
_HOME = Path.home()

# Default artifact locations (all overridable for tests / non-standard deploys).
DEFAULT_QUEUE = _THIS / "cron" / "manual_queue.json"
DEFAULT_HUNTER_DIR = _HOME / ".mira" / "ab-hunter"
DEFAULT_GUARDRAILS = _HOME / ".mira" / "guardrails-state.json"
DEFAULT_STOP_FLAG = _HOME / ".mira" / "STOP_INGEST"
STOP_SENTINEL = "AUTO_PAUSED_BY_GUARDRAILS"  # scripts/ingest_guardrails.py

# Honest judgment vocabulary (from the deep-dive prompt). A component is only
# "built_and_firing" when a LOCAL artifact proves a recent run.
BUILT_AND_FIRING = "built_and_firing"
BUILT_NEEDS_RUNTIME_PROOF = "built_but_needs_runtime_proof"
BUILT_DRY_RUN_ONLY = "built_but_dry_run_only"
UNKNOWN_NEEDS_OPERATOR = "unknown_needs_operator_verification"


# --------------------------------------------------------------------------
# Pure readers (unit-tested with fixtures; no wall-clock, no network)
# --------------------------------------------------------------------------


def summarize_queue(path: str | Path) -> dict[str, Any]:
    """Counts by status + newest timestamps from ``manual_queue.json``.

    Fail-soft: a missing file returns ``exists=False``; a malformed file returns
    ``error`` rather than raising — a status tool must never crash on bad state.
    """
    p = Path(path)
    if not p.is_file():
        return {"exists": False, "path": str(p)}
    try:
        rows = json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        return {"exists": True, "path": str(p), "error": f"unparseable: {exc}"}
    if not isinstance(rows, list):
        return {"exists": True, "path": str(p), "error": "not a list"}

    counts: dict[str, int] = {}
    newest_done = newest_started = None
    for r in rows:
        if not isinstance(r, dict):
            continue
        counts[r.get("status", "unknown")] = counts.get(r.get("status", "unknown"), 0) + 1
        if r.get("done_at"):
            newest_done = max(newest_done, r["done_at"]) if newest_done else r["done_at"]
        if r.get("started_at"):
            newest_started = (
                max(newest_started, r["started_at"]) if newest_started else r["started_at"]
            )
    return {
        "exists": True,
        "path": str(p),
        "total": len(rows),
        "counts_by_status": dict(sorted(counts.items())),
        "newest_done_at": newest_done,
        "newest_started_at": newest_started,
        "mtime_epoch": int(p.stat().st_mtime),
    }


def read_latest_run_report(hunter_dir: str | Path) -> dict[str, Any] | None:
    """Newest ``run-*.json`` the AB hunter wrote. ``run-<UTCts>.json`` names sort
    lexicographically by time, so max() is the latest. None if the dir/files are
    absent (i.e. the hunter hasn't run on this box)."""
    d = Path(hunter_dir)
    if not d.is_dir():
        return None
    runs = sorted(d.glob("run-*.json"))
    if not runs:
        return None
    try:
        return {"file": runs[-1].name, "report": json.loads(runs[-1].read_text(encoding="utf-8"))}
    except (ValueError, OSError) as exc:
        return {"file": runs[-1].name, "error": f"unparseable: {exc}"}


def read_guardrails_state(path: str | Path) -> dict[str, Any] | None:
    p = Path(path)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        return {"error": f"unparseable: {exc}"}


def check_stop_ingest(path: str | Path) -> dict[str, Any]:
    """Is the ingest kill-switch set, and was it auto-set by guardrails or by an
    operator? (The guardrails write the ``AUTO_PAUSED_BY_GUARDRAILS`` sentinel as
    the first line; a bare operator ``touch`` has no sentinel.)"""
    p = Path(path)
    if not p.exists():
        return {"present": False}
    try:
        first = (p.read_text(encoding="utf-8").splitlines() or [""])[0].strip()
    except OSError:
        first = ""
    return {"present": True, "auto_paused": STOP_SENTINEL in first, "first_line": first}


def hunter_config(env: dict[str, str] | None = None) -> dict[str, Any]:
    """The hunter's runtime mode from its env (as launchd sets it). Dry-run
    unless ``MIRA_AB_HUNTER_LIVE=1``."""
    env = env if env is not None else os.environ
    live = env.get("MIRA_AB_HUNTER_LIVE", "0") == "1"
    try:
        max_new = int(env.get("AB_HUNTER_MAX_NEW", "3"))
    except ValueError:
        max_new = 3
    return {"live": live, "mode": "LIVE" if live else "DRY-RUN", "max_new_per_run": max_new}


def _iso_to_epoch(ts: str | None) -> int | None:
    """Parse an ISO-8601 timestamp to epoch seconds; None if unparseable. Used
    to judge queue freshness from the queue's OWN activity timestamps rather than
    the file's mtime (mtime resets on git checkout/copy and would lie off-box)."""
    if not ts:
        return None
    try:
        from datetime import datetime

        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
    except (ValueError, TypeError):
        return None


def judge_queue(queue: dict[str, Any], *, now_epoch: int, stale_secs: int = 7200) -> dict[str, str]:
    """Honest verdict for the KB-growth queue from local evidence only.

    Judges on the queue's OWN newest activity timestamp (``done_at``/
    ``started_at``), NOT the file mtime — mtime is the checkout time in a repo
    clone and would falsely read "firing". A queue with only old activity is
    ``needs_runtime_proof``, never "firing".
    """
    if not queue.get("exists"):
        return {
            "verdict": UNKNOWN_NEEDS_OPERATOR,
            "why": "manual_queue.json not on this box — run on the VPS",
        }
    if queue.get("error"):
        return {"verdict": UNKNOWN_NEEDS_OPERATOR, "why": queue["error"]}
    newest_iso = max(
        x
        for x in [queue.get("newest_done_at"), queue.get("newest_started_at"), ""]
        if x is not None
    )
    newest_epoch = _iso_to_epoch(newest_iso or None)
    if newest_epoch is None:
        return {
            "verdict": BUILT_NEEDS_RUNTIME_PROOF,
            "why": "queue present but no done_at/started_at activity recorded — cron may never have run here",
        }
    age = now_epoch - newest_epoch
    if age <= stale_secs:
        return {
            "verdict": BUILT_AND_FIRING,
            "why": f"newest queue activity {age}s ago (< {stale_secs}s) — cron advancing",
        }
    return {
        "verdict": BUILT_NEEDS_RUNTIME_PROOF,
        "why": f"newest queue activity {age}s ago (> {stale_secs}s) — cron idle/stopped, or this is a checkout",
    }


def judge_hunter(cfg: dict[str, Any], latest_run: dict[str, Any] | None) -> dict[str, str]:
    if not cfg["live"]:
        return {
            "verdict": BUILT_DRY_RUN_ONLY,
            "why": "MIRA_AB_HUNTER_LIVE!=1 — discovers but downloads nothing",
        }
    if latest_run is None:
        return {
            "verdict": UNKNOWN_NEEDS_OPERATOR,
            "why": "LIVE per env but no run-*.json on this box — run on Charlie",
        }
    return {"verdict": BUILT_AND_FIRING, "why": f"LIVE + latest report {latest_run.get('file')}"}


def operator_commands() -> str:
    """Exact commands for evidence that does NOT live in any checkout — Redis
    dedup sets, NeonDB freshness, the Trigger bridge, Trigger.dev Cloud."""
    return _OPERATOR_COMMANDS


_OPERATOR_COMMANDS = """\
# --- CHARLIE (100.70.49.126): AB hunter + guardrails ---
ls -t ~/.mira/ab-hunter/run-*.json | head -3 && cat "$(ls -t ~/.mira/ab-hunter/run-*.json | head -1)" | jq '.overall,.at,.duration_s'
cat ~/.mira/guardrails-state.json | jq '{level,at,summary}'
ls -l ~/.mira/STOP_INGEST 2>/dev/null && head -1 ~/.mira/STOP_INGEST || echo "STOP_INGEST not set"
tail -50 /tmp/ab-manual-hunter.log
launchctl list | grep -E "ab-manual-hunter|ingest-guardrails"

# --- VPS: kb_growth_cron ---
python3 /opt/mira/mira-crawler/cron/kb_growth_cron.py --status
stat /opt/mira/mira-crawler/cron/manual_queue.json | grep Modify
tail -50 /var/log/mira-agents/kb_growth.log

# --- Redis (broker): crawler dedup set sizes = which crawlers ran ---
redis-cli SCARD mira:rss:seen_guids
redis-cli HLEN  mira:sitemaps:lastmod
redis-cli SCARD mira:gdrive:processed_files
redis-cli SCARD mira:manualslib:seen_manuals
redis-cli SCARD mira:patents:seen_ids
redis-cli LLEN  celery                       # tasks queued by the Trigger bridge

# --- Trigger bridge (FastAPI :8003) ---
curl -s http://localhost:8003/health | jq '.status,.redis'

# --- NeonDB: has the KB actually grown? (staging/read-only only) ---
psql "$NEON_DATABASE_URL" -c "SELECT MAX(created_at), COUNT(*) FROM knowledge_entries;"

# --- Trigger.dev Cloud task-run history is NOT in the repo ---
# Inspect at https://cloud.trigger.dev (project proj_mira-ingest) — no local artifact.
"""


def build_report(
    *,
    queue: dict[str, Any],
    latest_run: dict[str, Any] | None,
    guardrails: dict[str, Any] | None,
    stop: dict[str, Any],
    hunter: dict[str, Any],
    now_epoch: int,
) -> dict[str, Any]:
    return {
        "kb_growth_queue": {**queue, **judge_queue(queue, now_epoch=now_epoch)},
        "ab_manual_hunter": {
            **hunter,
            "latest_run": latest_run,
            **judge_hunter(hunter, latest_run),
        },
        "ingest_guardrails": guardrails or {"present": False, "verdict": UNKNOWN_NEEDS_OPERATOR},
        "stop_ingest": stop,
        "off_box_evidence": {
            "note": "Redis seen_* sizes, NeonDB freshness, Trigger bridge, and Trigger.dev Cloud "
            "runs are NOT inspectable from a checkout — use --commands.",
            "verdict": UNKNOWN_NEEDS_OPERATOR,
        },
    }


def render_text(report: dict[str, Any]) -> str:
    q = report["kb_growth_queue"]
    h = report["ab_manual_hunter"]
    s = report["stop_ingest"]
    g = report["ingest_guardrails"]
    lines = [
        "MANUAL-DISCOVERY FLEET STATUS (read-only; local artifacts only)",
        "=" * 62,
        f"[kb_growth_queue]   {q.get('verdict')}",
        f"    {q.get('why')}",
    ]
    if q.get("exists") and not q.get("error"):
        lines.append(
            f"    counts: {q.get('counts_by_status')}  newest_done_at={q.get('newest_done_at')}"
        )
    lines += [
        f"[ab_manual_hunter]  {h.get('verdict')}  ({h.get('mode')}, max_new={h.get('max_new_per_run')})",
        f"    {h.get('why')}",
        f"[stop_ingest]       {'SET' if s.get('present') else 'not set'}"
        + (
            f"  ({'auto (guardrails)' if s.get('auto_paused') else 'operator'})"
            if s.get("present")
            else ""
        ),
        f"[ingest_guardrails] level={g.get('level', 'unknown')} at={g.get('at', 'n/a')}",
        "",
        "Off-box evidence (Redis/NeonDB/Trigger) — prove with `--commands`.",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    import time

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--commands", action="store_true", help="print only the operator command block"
    )
    parser.add_argument("--queue", default=str(DEFAULT_QUEUE))
    parser.add_argument("--hunter-dir", default=str(DEFAULT_HUNTER_DIR))
    parser.add_argument("--guardrails", default=str(DEFAULT_GUARDRAILS))
    parser.add_argument("--stop-flag", default=str(DEFAULT_STOP_FLAG))
    args = parser.parse_args(argv)

    if args.commands:
        print(operator_commands())
        return 0

    report = build_report(
        queue=summarize_queue(args.queue),
        latest_run=read_latest_run_report(args.hunter_dir),
        guardrails=read_guardrails_state(args.guardrails),
        stop=check_stop_ingest(args.stop_flag),
        hunter=hunter_config(),
        now_epoch=int(time.time()),
    )
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(render_text(report))
        print("\n--- operator commands (off-box evidence) ---\n")
        print(operator_commands())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
