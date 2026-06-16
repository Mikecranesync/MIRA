#!/usr/bin/env python3
"""Ingest pipeline guardrails — CHARLIE-local.

Runs every ~15 min via launchd. Watches the disk + memory + MiraDrop queue
+ recent ab-manual-hunter outcomes + recent docker container OOMs. If any
threshold trips, alerts via Telegram AND (if severe) writes the
``~/.mira/STOP_INGEST`` flag so the next ab-manual-hunter run exits clean
instead of piling onto a stressed host.

Why this exists (one sentence): the May 2026 docling/celery OOM incidents
(PRs #1318 / #1336) had no early-warning layer — the VPS just hung. This
is the canary.

Thresholds — start conservative, tighten with experience:

| Signal | warn @ | STOP @ | Notes |
|---|---|---|---|
| Disk usage (`/`) | > 80 % | > 92 % | macOS df reports root; the inbox + done/ live there |
| Free memory (psutil) | < 2 GiB | < 1 GiB | CHARLIE has 16+ GiB, so 2 GiB free is already a problem |
| MiraDrop inbox queue depth | > 20 PDFs | > 50 | If watcher is jammed, don't add more |
| MiraDrop failed/ count (last 24h) | > 5 | > 20 | Persistent failure suggests Hub or KB problem |
| ab-hunter run-report fail rate (last 5 runs) | ≥ 2/5 fail | ≥ 4/5 fail | Persistent fail = URL pattern drift or net problem |
| Docker container OOM-killed (last hour) | any | any | Always severe; STOP immediately |

Exit codes:
  0 — all green
  1 — one or more warnings (alert sent, no STOP)
  2 — STOP threshold hit (STOP_INGEST written, alert sent)
  3 — guardrails itself errored (e.g. couldn't reach docker)
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# --- Reuse the same hardening primitives as ab_manual_hunter --------------
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools" / "lead-hunter"))
from hardening import RunReport, alert, singleton_lock  # noqa: E402

sys.path.insert(0, str(REPO_ROOT / "mira-crawler"))
try:
    from reporting.telegram_notify import notify as _tg_notify
except Exception:
    def _tg_notify(*_a, **_kw) -> bool:  # type: ignore[misc]
        return False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("guardrails")

# --- Paths + thresholds ---------------------------------------------------
HOME = Path.home()
DROP_INBOX = HOME / "MiraDrop" / "inbox"
DROP_FAILED = HOME / "MiraDrop" / "failed"
AB_HUNTER_RUNS = HOME / ".mira" / "ab-hunter"
STOP_FLAG = HOME / ".mira" / "STOP_INGEST"
GUARDRAILS_STATE = HOME / ".mira" / "guardrails-state.json"
LOCK_DIR = HOME / ".mira" / "locks"

DISK_WARN_PCT = float(os.getenv("GUARD_DISK_WARN_PCT", "80"))
DISK_STOP_PCT = float(os.getenv("GUARD_DISK_STOP_PCT", "92"))
MEM_WARN_GIB = float(os.getenv("GUARD_MEM_WARN_GIB", "2"))
MEM_STOP_GIB = float(os.getenv("GUARD_MEM_STOP_GIB", "1"))
INBOX_WARN = int(os.getenv("GUARD_INBOX_WARN", "20"))
INBOX_STOP = int(os.getenv("GUARD_INBOX_STOP", "50"))
FAILED_WARN_24H = int(os.getenv("GUARD_FAILED_WARN_24H", "5"))
FAILED_STOP_24H = int(os.getenv("GUARD_FAILED_STOP_24H", "20"))
HUNTER_FAIL_WARN_5 = int(os.getenv("GUARD_HUNTER_FAIL_WARN_5", "2"))
HUNTER_FAIL_STOP_5 = int(os.getenv("GUARD_HUNTER_FAIL_STOP_5", "4"))

# Sentinel comment the guardrails write into STOP_INGEST so a future run
# can tell "auto-paused by guardrails" from "operator-paused".
STOP_SENTINEL = "AUTO_PAUSED_BY_GUARDRAILS"


def _disk_pct() -> float:
    u = shutil.disk_usage("/")
    return (u.used / u.total) * 100


def _mem_free_gib() -> float | None:
    """Free MEMORY in GiB. Returns None if psutil isn't available."""
    try:
        import psutil
        return psutil.virtual_memory().available / (1024**3)
    except ImportError:
        # Fall back to `vm_stat` parsing on macOS
        try:
            out = subprocess.check_output(["vm_stat"], text=True, timeout=5)
            page_size = 16384  # macOS default; not perfect but close enough as a fallback
            free_pages = inactive_pages = 0
            for line in out.splitlines():
                if line.startswith("Pages free:"):
                    free_pages = int(line.split()[2].rstrip("."))
                elif line.startswith("Pages inactive:"):
                    inactive_pages = int(line.split()[2].rstrip("."))
            return ((free_pages + inactive_pages) * page_size) / (1024**3)
        except Exception:
            return None


def _inbox_depth() -> int:
    if not DROP_INBOX.exists():
        return 0
    return sum(1 for _ in DROP_INBOX.glob("*"))


def _failed_in_window(hours: int = 24) -> int:
    if not DROP_FAILED.exists():
        return 0
    cutoff = time.time() - hours * 3600
    return sum(
        1 for p in DROP_FAILED.glob("*")
        if p.is_file() and p.stat().st_mtime >= cutoff
    )


def _hunter_last5_fail_count() -> tuple[int, int]:
    """Returns (fail_count, runs_examined). Counts overall != 'ok' as a fail."""
    if not AB_HUNTER_RUNS.exists():
        return 0, 0
    runs = sorted(AB_HUNTER_RUNS.glob("run-*.json"), reverse=True)[:5]
    fails = 0
    for p in runs:
        try:
            data = json.loads(p.read_text())
            if data.get("overall") not in ("ok",):
                fails += 1
        except Exception:
            fails += 1  # corrupted report counts as a fail signal
    return fails, len(runs)


def _container_oom_last_hour() -> list[str]:
    """Return list of container names docker reports as OOMKilled in the last hour."""
    try:
        out = subprocess.check_output(
            ["docker", "ps", "-a", "--format", "{{.Names}}|{{.Status}}"],
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        log.warning("docker ps failed: %s", exc)
        return []
    oomed: list[str] = []
    for line in out.splitlines():
        if not line.strip():
            continue
        name, _, status = line.partition("|")
        # docker's status string for an OOMed container says "Exited (137) <time> ago".
        # 137 = 128 + SIGKILL(9), which is what the OOM killer sends.
        if "(137)" in status and ("minutes ago" in status or "minute ago" in status):
            oomed.append(name.strip())
    return oomed


def _write_stop_flag(reason: str) -> None:
    STOP_FLAG.parent.mkdir(parents=True, exist_ok=True)
    STOP_FLAG.write_text(
        f"{STOP_SENTINEL}\nset_at={datetime.now(timezone.utc).isoformat()}\nreason={reason}\n"
    )


def _send_telegram(level: str, report: RunReport, summary: str) -> None:
    if level == "ok":
        return
    emoji = "⚠️" if level == "warn" else "🛑"
    flagged_lines: list[str] = []
    for s in report.steps:
        if s.detail.get("level") in ("warn", "stop"):
            flagged_lines.append(
                f"  • *{s.name}* — {s.detail.get('level', 'warn').upper()}: {s.detail.get('note', '')}"
            )
    body = f"{emoji} ingest-guardrails — {level.upper()}\n{summary}"
    if flagged_lines:
        body += "\n\n*Tripped:*\n" + "\n".join(flagged_lines)
    if level == "stop":
        body += "\n\n*STOP_INGEST flag written* — hunter will skip its next run. Clear with `rm ~/.mira/STOP_INGEST`."
    _tg_notify("system", body)


def _run_checks() -> tuple[str, RunReport, str]:
    """Returns (overall_level, report, human_summary)."""
    report = RunReport(routine="ingest-guardrails")
    flags: list[tuple[str, str, str]] = []  # (signal, level, note)

    # ── Disk
    with report.step("disk") as r:
        pct = _disk_pct()
        r.detail = {"used_pct": round(pct, 1), "thresholds": {"warn": DISK_WARN_PCT, "stop": DISK_STOP_PCT}}
        if pct >= DISK_STOP_PCT:
            r.detail["level"] = "stop"
            r.detail["note"] = f"disk {pct:.1f}% used (stop @ {DISK_STOP_PCT}%)"
            flags.append(("disk", "stop", r.detail["note"]))
        elif pct >= DISK_WARN_PCT:
            r.detail["level"] = "warn"
            r.detail["note"] = f"disk {pct:.1f}% used (warn @ {DISK_WARN_PCT}%)"
            flags.append(("disk", "warn", r.detail["note"]))

    # ── Memory
    with report.step("memory") as r:
        free = _mem_free_gib()
        if free is None:
            r.status = "skip"
            r.detail["note"] = "psutil not installed and vm_stat parse failed"
        else:
            r.detail = {"free_gib": round(free, 2), "thresholds": {"warn": MEM_WARN_GIB, "stop": MEM_STOP_GIB}}
            if free <= MEM_STOP_GIB:
                r.detail["level"] = "stop"
                r.detail["note"] = f"only {free:.2f} GiB free (stop @ {MEM_STOP_GIB} GiB)"
                flags.append(("memory", "stop", r.detail["note"]))
            elif free <= MEM_WARN_GIB:
                r.detail["level"] = "warn"
                r.detail["note"] = f"only {free:.2f} GiB free (warn @ {MEM_WARN_GIB} GiB)"
                flags.append(("memory", "warn", r.detail["note"]))

    # ── MiraDrop inbox queue
    with report.step("miradrop_inbox") as r:
        depth = _inbox_depth()
        r.detail = {"queued": depth, "thresholds": {"warn": INBOX_WARN, "stop": INBOX_STOP}}
        if depth >= INBOX_STOP:
            r.detail["level"] = "stop"
            r.detail["note"] = f"{depth} pending in inbox (stop @ {INBOX_STOP})"
            flags.append(("miradrop_inbox", "stop", r.detail["note"]))
        elif depth >= INBOX_WARN:
            r.detail["level"] = "warn"
            r.detail["note"] = f"{depth} pending in inbox (warn @ {INBOX_WARN})"
            flags.append(("miradrop_inbox", "warn", r.detail["note"]))

    # ── MiraDrop failed/ in last 24 h
    with report.step("miradrop_failed_24h") as r:
        fc = _failed_in_window(24)
        r.detail = {"count": fc, "thresholds": {"warn": FAILED_WARN_24H, "stop": FAILED_STOP_24H}}
        if fc >= FAILED_STOP_24H:
            r.detail["level"] = "stop"
            r.detail["note"] = f"{fc} files in failed/ (stop @ {FAILED_STOP_24H})"
            flags.append(("miradrop_failed", "stop", r.detail["note"]))
        elif fc >= FAILED_WARN_24H:
            r.detail["level"] = "warn"
            r.detail["note"] = f"{fc} files in failed/ (warn @ {FAILED_WARN_24H})"
            flags.append(("miradrop_failed", "warn", r.detail["note"]))

    # ── ab-hunter recent failure rate (last 5)
    with report.step("ab_hunter_fail_5") as r:
        fails, examined = _hunter_last5_fail_count()
        r.detail = {
            "fails": fails,
            "of_runs": examined,
            "thresholds": {"warn": HUNTER_FAIL_WARN_5, "stop": HUNTER_FAIL_STOP_5},
        }
        if examined == 0:
            r.status = "skip"
            r.detail["note"] = "no ab-hunter runs yet"
        elif fails >= HUNTER_FAIL_STOP_5:
            r.detail["level"] = "stop"
            r.detail["note"] = f"{fails}/{examined} recent ab-hunter runs failed (stop @ {HUNTER_FAIL_STOP_5}/5)"
            flags.append(("ab_hunter", "stop", r.detail["note"]))
        elif fails >= HUNTER_FAIL_WARN_5:
            r.detail["level"] = "warn"
            r.detail["note"] = f"{fails}/{examined} recent ab-hunter runs failed (warn @ {HUNTER_FAIL_WARN_5}/5)"
            flags.append(("ab_hunter", "warn", r.detail["note"]))

    # ── Docker OOM (always STOP if seen)
    with report.step("docker_oom_last_hour") as r:
        oomed = _container_oom_last_hour()
        r.detail = {"oomed_count": len(oomed), "oomed_names": ", ".join(oomed)}
        if oomed:
            r.detail["level"] = "stop"
            r.detail["note"] = f"OOM-killed in last hour: {', '.join(oomed)}"
            flags.append(("docker_oom", "stop", r.detail["note"]))

    # ── Roll up
    has_stop = any(f[1] == "stop" for f in flags)
    has_warn = any(f[1] == "warn" for f in flags)
    if has_stop:
        level = "stop"
    elif has_warn:
        level = "warn"
    else:
        level = "ok"

    summary_bits: list[str] = []
    for s in report.steps:
        d = s.detail
        if "used_pct" in d:
            summary_bits.append(f"disk={d['used_pct']}%")
        elif "free_gib" in d:
            summary_bits.append(f"free={d['free_gib']} GiB")
        elif "queued" in d:
            summary_bits.append(f"inbox={d['queued']}")
        elif s.name == "miradrop_failed_24h":
            summary_bits.append(f"failed24h={d.get('count', 0)}")
        elif s.name == "ab_hunter_fail_5":
            summary_bits.append(f"hunter_fail={d.get('fails', 0)}/{d.get('of_runs', 0)}")
        elif s.name == "docker_oom_last_hour":
            summary_bits.append(f"oom={d.get('oomed_count', 0)}")
    summary = "  ·  ".join(summary_bits)

    return level, report, summary


def main() -> int:
    rc = 3
    try:
        with singleton_lock("ingest-guardrails", lock_dir=LOCK_DIR):
            level, report, summary = _run_checks()
            log.info("guardrails: %s — %s", level.upper(), summary)

            # Persist a small state file Mike can `cat` to see what's tripping.
            GUARDRAILS_STATE.parent.mkdir(parents=True, exist_ok=True)
            GUARDRAILS_STATE.write_text(
                json.dumps(
                    {
                        "at": datetime.now(timezone.utc).isoformat(),
                        "level": level,
                        "summary": summary,
                        "report": json.loads(report.to_json()),
                    },
                    indent=2,
                )
            )

            if level == "stop":
                # Don't trample an operator-set STOP. Only auto-write when the
                # flag file is absent OR its first line is the sentinel.
                if not STOP_FLAG.exists() or STOP_FLAG.read_text().startswith(STOP_SENTINEL):
                    _write_stop_flag(reason=f"guardrails STOP: {summary}")
                    log.warning("STOP_INGEST written — ingest paused")
                else:
                    log.warning("STOP_INGEST already set by operator — leaving alone")

            report.finalize()
            alert(report)  # JSONL only on non-healthy
            _send_telegram(level, report, summary)

            if level == "stop":
                rc = 2
            elif level == "warn":
                rc = 1
            else:
                rc = 0
    except Exception:
        import traceback
        log.error("guardrails crashed:\n%s", traceback.format_exc())
        rc = 3

    return rc


if __name__ == "__main__":
    sys.exit(main())
