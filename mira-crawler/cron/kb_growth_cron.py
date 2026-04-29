"""
KB Growth Cron — runs every 6 hours via crontab.
Downloads one PDF from the queue, ingests it, logs the result.
Dumb as an alarm clock. No frameworks. No dependencies beyond what's on the VPS.

Crontab entry (VPS):
  0 */6 * * * cd /opt/mira && doppler run -- python3 mira-crawler/cron/kb_growth_cron.py >> /var/log/kb_growth.log 2>&1
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Reporting + notifications (optional — degrades gracefully)
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
        def _tg_notify(*_: object) -> bool: return False  # type: ignore[misc]

# ─── paths ────────────────────────────────────────────────────────────────────
_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
QUEUE_FILE = _HERE / "manual_queue.json"
PIPELINE = _REPO / "mira-crawler" / "tasks" / "full_ingest_pipeline.py"
LOG_FILE = Path("/var/log/kb_growth.log")


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _log(msg: str) -> None:
    line = f"[{_ts()}] {msg}"
    print(line, flush=True)


def load_queue() -> list[dict]:
    with open(QUEUE_FILE) as f:
        return json.load(f)


def save_queue(queue: list[dict]) -> None:
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f, indent=2)


def run_pipeline(entry: dict) -> tuple[bool, str]:
    """Run full_ingest_pipeline.py for one entry. Returns (success, output_tail)."""
    cmd = [
        sys.executable,
        str(PIPELINE),
        "--pdf-url", entry["url"],
        "--manufacturer", entry["manufacturer"],
        "--model", entry["model"],
        "--type", entry.get("type", "installation_manual"),
        "--no-quality-gate",
    ]
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=900,
        env=env,
    )
    output = (result.stdout + result.stderr).strip()
    tail = "\n".join(output.splitlines()[-20:])  # last 20 lines for log
    return result.returncode == 0, tail


def main() -> None:
    _log("KB growth cron starting")

    if not QUEUE_FILE.exists():
        _log(f"ERROR: queue file not found: {QUEUE_FILE}")
        sys.exit(1)

    if not PIPELINE.exists():
        _log(f"ERROR: pipeline not found: {PIPELINE}")
        sys.exit(1)

    queue = load_queue()
    pending = [i for i, e in enumerate(queue) if e.get("status") == "pending"]

    if not pending:
        _log("Queue empty — nothing to ingest. Add PDFs to manual_queue.json.")
        done = sum(1 for e in queue if e.get("status") == "done")
        failed = sum(1 for e in queue if e.get("status") == "failed")
        _log(f"Queue stats: {done} done, {failed} failed, 0 pending")
        sys.exit(0)

    idx = pending[0]
    entry = queue[idx]
    _log(f"Processing [{idx+1}/{len(queue)}]: {entry['manufacturer']} {entry['model']} — {entry['url'][:80]}")

    try:
        success, tail = run_pipeline(entry)
    except subprocess.TimeoutExpired:
        success = False
        tail = "TIMEOUT after 900s"
    except Exception as exc:
        success = False
        tail = str(exc)

    if success:
        entry["status"] = "done"
        entry["done_at"] = _ts()
        _log(f"SUCCESS: {entry['manufacturer']} {entry['model']}")
    else:
        entry["status"] = "failed"
        entry["failed_at"] = _ts()
        entry["error"] = tail[-200:]  # cap stored error
        _log(f"FAILED: {entry['manufacturer']} {entry['model']}")

    _log(f"Pipeline output (tail):\n{tail}")

    queue[idx] = entry
    save_queue(queue)

    remaining = sum(1 for e in queue if e.get("status") == "pending")
    done = sum(1 for e in queue if e.get("status") == "done")
    failed = sum(1 for e in queue if e.get("status") == "failed")
    _log(f"Queue: {done} done, {failed} failed, {remaining} pending")
    _log("KB growth cron done")

    _emit_report(entry, success, done, failed, remaining)


def _emit_report(
    entry: dict,
    success: bool,
    done: int,
    failed: int,
    remaining: int,
) -> None:
    name = f"{entry['manufacturer']} {entry['model']}"

    # Telegram notification
    try:
        if success:
            _tg_notify(
                "kb_growth",
                f"✅ Ingested *{name}*\nQueue: {done} done · {failed} failed · {remaining} remaining",
            )
        else:
            err = entry.get("error", "unknown error")[:120]
            _tg_notify(
                "kb_growth",
                f"❌ Failed: *{name}*\n`{err}`\nWill retry next cycle",
            )
    except Exception as exc:
        _log(f"Telegram notify failed (non-fatal): {exc}")

    # HTML/Markdown report
    if not _REPORT_AVAILABLE:
        return
    try:
        status_level = "ok" if success else "warning"
        report = (
            AgentReport("kb-growth-cron")
            .set_title("KB Growth Cron", name)
            .set_status(status_level)  # type: ignore[arg-type]
            .add_metric("Done", done, "PDFs", trend="up")
            .add_metric("Failed", failed, "PDFs", trend="flat" if failed == 0 else "down")
            .add_metric("Remaining", remaining, "PDFs")
        )
        if success:
            report.add_alert("ok", f"Ingested: {name}")
        else:
            report.add_alert(
                "warning",
                f"Failed: {name} — {entry.get('error', '')[:120]}",
            )
        if remaining > 0:
            report.add_action(f"Review {remaining} pending PDFs in manual_queue.json")
        if failed > 0:
            report.add_action(f"Investigate {failed} failed PDF(s) and re-queue or remove")
        report.save(telegram=False)  # Telegram already sent above
    except Exception as exc:
        _log(f"Report generation failed (non-fatal): {exc}")


if __name__ == "__main__":
    main()
