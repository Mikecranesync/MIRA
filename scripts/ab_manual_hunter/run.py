#!/usr/bin/env python3
"""Hardened Allen-Bradley / Rockwell manual hunter.

Probes the Rockwell literature CDN for a small allowlist of publications,
downloads any new PDFs to ~/MiraDrop/inbox/ where the mira-drop-watcher
takes over and pushes them through Hub → KB.

Why this exists (short version): we tried the Trigger.dev → Celery → docling
pipeline in April-May 2026 and it twice OOM'd the 8 GB VPS for hours at a
time (PRs #1318 / #1319 / #1336). This is the "smaller scale" replacement:
runs on CHARLIE (M4, 16+ GB), uses the Hub chunker (not docling), one
launchd cron, hard-bounded per-run, fail-loud-not-silent.

Plan: docs/handoffs/2026-05-23-ab-ingest-revival.md
Targets: scripts/ab_manual_hunter/targets.yaml

Hardening (matches tools/lead-hunter/hardening.py pattern):
  1. STOP_INGEST kill switch — `touch ~/.mira/STOP_INGEST` halts the hunter
  2. Singleton lock — overlapping runs exit clean
  3. Preflight env check — fails fast with actionable error
  4. Hard 20-min timeout — SIGALRM kills the run if it hangs
  5. Per-run cap — default 3 NEW PDFs per run (override via --max-new)
  6. Per-source rate limit — 0.2s between probes, 0.5s between pubs
  7. Idempotent — skips pubs already in MiraDrop/done/ ledger
  8. Run report + alert sink — JSON line per run, Telegram on degraded/fail
  9. Dry-run default for first invocation (set MIRA_AB_HUNTER_LIVE=1 to fetch)

Exit codes:
  0  healthy
  1  degraded (something flagged but the run completed)
  2  preflight failure
  3  hard timeout
  4  unhandled exception
  5  STOP_INGEST flag tripped
"""
from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import yaml

# Force UTF-8 on Windows (matches plc/ccw/scripts/fetch_rockwell_docs.py)
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# --- Import the hardening primitives from tools/lead-hunter ---------------
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "tools" / "lead-hunter"))
from hardening import (  # noqa: E402  (sys.path-injected import)
    RunReport,
    alert,
    hard_timeout,
    preflight_secrets,
    singleton_lock,
)

# --- Import the existing Rockwell URL prober (DRY — keep one source) ------
sys.path.insert(0, str(REPO_ROOT / "plc" / "ccw" / "scripts"))
import fetch_rockwell_docs as rw  # noqa: E402  (sys.path-injected import)

# --- Optional Telegram notifier (degrades gracefully if absent) -----------
sys.path.insert(0, str(REPO_ROOT / "mira-crawler"))
try:
    from reporting.telegram_notify import notify as _tg_notify  # noqa: E402
except Exception:
    def _tg_notify(*_a, **_kw) -> bool:  # type: ignore[misc]
        return False


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ab-hunter")

# --- Paths ----------------------------------------------------------------
TARGETS_PATH = Path(__file__).parent / "targets.yaml"
DROP_INBOX = Path.home() / "MiraDrop" / "inbox"
DROP_DONE = Path.home() / "MiraDrop" / "done"
DROP_FAILED = Path.home() / "MiraDrop" / "failed"
RUN_LOG_DIR = Path.home() / ".mira" / "ab-hunter"
STOP_FLAG = Path.home() / ".mira" / "STOP_INGEST"
LOCK_DIR = Path.home() / ".mira" / "locks"

HARD_TIMEOUT_SECS = int(os.getenv("AB_HUNTER_TIMEOUT_SECS", "1200"))  # 20 min
DEFAULT_MAX_NEW = int(os.getenv("AB_HUNTER_MAX_NEW", "3"))
LIVE_MODE = os.getenv("MIRA_AB_HUNTER_LIVE", "0") == "1"


def _stop_flag_tripped() -> tuple[bool, str | None]:
    """Return (True, reason) if operator has paused the hunter."""
    if STOP_FLAG.exists():
        try:
            reason = STOP_FLAG.read_text(encoding="utf-8").strip() or "no reason given"
        except Exception:
            reason = "(could not read STOP_INGEST contents)"
        return True, reason
    return False, None


def _load_targets() -> list[dict]:
    if not TARGETS_PATH.exists():
        log.error("targets.yaml not found at %s", TARGETS_PATH)
        return []
    with TARGETS_PATH.open() as f:
        data = yaml.safe_load(f) or {}
    return data.get("publications") or []


def _already_have(pub: str) -> bool:
    """True if any revision of this pub is in MiraDrop/done/ or still in inbox/."""
    for parent in (DROP_DONE, DROP_INBOX):
        if not parent.exists():
            continue
        for f in parent.glob(f"{pub.upper()}*.pdf"):
            if f.is_file():
                return True
        for f in parent.glob(f"{pub.lower()}*.pdf"):
            if f.is_file():
                return True
    return False


def _probe_and_download(
    session,
    pub: str,
    ptype: str,
    dest_dir: Path,
    live: bool,
) -> tuple[bool, str | None, str | None]:
    """Return (ok, dest_filename, source_url). Honours live flag (dry-run if False)."""
    pub_lower = pub.lower()
    for pattern in rw.URL_PATTERNS:
        for rev in rw.REV_CANDIDATES:
            url = pattern.format(type=ptype, pub_lower=pub_lower, rev=rev)
            try:
                resp = rw.try_url(session, url)
            except Exception as exc:
                log.debug("  FAIL %s — %s", url, exc)
                continue
            if resp.status_code == 200:
                first_chunk = resp.raw.read(8, decode_content=True) if resp.raw else b""
                if not rw.is_pdf(first_chunk):
                    resp.close()
                    continue
                # Found a real PDF.
                fname = f"{pub.upper()}_-en-{rev}.pdf"
                if not live:
                    resp.close()
                    log.info("DRY-RUN would download %s from %s", fname, url)
                    return True, fname, url
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / fname
                with open(dest, "wb") as fh:
                    fh.write(first_chunk)
                    for chunk in resp.iter_content(chunk_size=64 * 1024):
                        if chunk:
                            fh.write(chunk)
                resp.close()
                size_kib = dest.stat().st_size / 1024
                log.info("OK %s (%.0f KiB) <- %s", fname, size_kib, url)
                return True, fname, url
            if resp.status_code != 404:
                log.info("  http %d %s", resp.status_code, url)
            resp.close()
            time.sleep(0.2)
    return False, None, None


def _send_telegram(report: RunReport) -> None:
    """Roll up the run into a Telegram message. Best-effort, never raises."""
    hits = [s for s in report.steps if s.status == "ok" and s.detail.get("source_url")]
    skipped = [s for s in report.steps if s.status == "skip"]
    fails = [s for s in report.steps if s.status == "fail"]

    if report.overall == "ok" and not hits:
        # quiet runs (nothing new found) — don't spam Mike
        return

    if report.overall == "ok":
        emoji = "✅"
    elif report.overall == "degraded":
        emoji = "⚠️"
    else:
        emoji = "❌"

    lines: list[str] = [f"{emoji} ab-manual-hunter — {report.overall}"]
    if hits:
        lines.append(f"\n*Downloaded {len(hits)}* new PDF(s) to MiraDrop:")
        for s in hits:
            lines.append(f"  • `{s.detail.get('pub')}` — {s.detail.get('title','')[:60]}")
    if skipped:
        lines.append(f"\n_{len(skipped)} already-have / over-cap, skipped_")
    if fails:
        lines.append(f"\n*Failures:* {len(fails)}")
        for s in fails[:3]:
            lines.append(f"  • {s.name}: {s.error}")
    if report.alerts:
        lines.append("\n*Alerts:*")
        for a in report.alerts[:5]:
            lines.append(f"  • {a}")
    lines.append(
        f"\n_dur {report.duration_s:.0f}s · "
        f"{'LIVE' if LIVE_MODE else 'DRY-RUN'} · "
        f"see `~/.mira/ab-hunter/` for the run report_"
    )
    _tg_notify("kb_growth", "\n".join(lines))


def _write_run_report(report: RunReport) -> Path:
    RUN_LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    p = RUN_LOG_DIR / f"run-{ts}.json"
    p.write_text(report.to_json())
    return p


def _do_run(args, report: RunReport) -> int:
    # Step 0 — STOP flag check (fail safe).
    with report.step("stop_flag") as r:
        tripped, reason = _stop_flag_tripped()
        r.detail = {"tripped": tripped, "reason": reason}
        if tripped:
            r.status = "skip"
            report.add_alert(f"STOP_INGEST flag set: {reason}")
            log.warning("STOP_INGEST tripped (%s) — exiting clean", reason)
            return 5

    # Step 1 — load targets.
    with report.step("load_targets") as r:
        targets = _load_targets()
        r.detail = {"loaded": len(targets), "live_mode": LIVE_MODE}
        if not targets:
            r.status = "fail"
            r.error = "no targets in targets.yaml"
            return 1

    # Step 2 — filter by priority + dedup against MiraDrop ledger + per-run cap.
    priority_cap = args.priority
    pending: list[dict] = []
    for t in targets:
        pub = t.get("pub")
        if not pub:
            continue
        if t.get("priority", 99) > priority_cap:
            continue
        if _already_have(pub):
            log.info("SKIP %s — already have in MiraDrop", pub)
            continue
        pending.append(t)
    log.info("pending=%d (cap=%d new this run)", len(pending), args.max_new)

    # Step 3 — probe + download.
    session = rw.requests.Session()
    session.headers.update({
        "User-Agent": (
            "MIRA-AB-Hunter/0.1 (small-scale; contact: harperhousebuyers@gmail.com)"
        ),
        "Accept": "application/pdf,*/*",
    })

    n_downloaded = 0
    n_deferred = 0
    deferred_pubs: list[str] = []
    for t in pending:
        if n_downloaded >= args.max_new:
            n_deferred += 1
            deferred_pubs.append(t["pub"])
            continue
        with report.step(f"probe:{t['pub']}") as r:
            try:
                ok, fname, url = _probe_and_download(
                    session,
                    t["pub"],
                    t.get("type", "um"),
                    DROP_INBOX,
                    live=LIVE_MODE,
                )
            except Exception as exc:
                r.status = "fail"
                r.error = f"{type(exc).__name__}: {exc}"
                continue
            r.detail = {
                "pub": t["pub"],
                "title": t.get("title", ""),
                "fname": fname,
                "source_url": url,
                "live": LIVE_MODE,
            }
            if ok:
                n_downloaded += 1
            else:
                r.status = "skip"
                r.detail["reason"] = "no working URL found"
            time.sleep(0.5)  # polite client between pubs

    # Step 4 — health flags.
    with report.step("health_assertions") as r:
        r.detail = {
            "downloaded": n_downloaded,
            "deferred_to_next_run": n_deferred,
            "deferred_pubs": deferred_pubs,
            "live": LIVE_MODE,
        }
        if n_downloaded == 0 and LIVE_MODE and not _stop_flag_tripped()[0]:
            report.add_alert(
                "Live run downloaded zero new PDFs and STOP flag is not set — "
                "either all up-to-date or Rockwell URL patterns drifted "
                "(re-probe manually)."
            )

    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--max-new",
        type=int,
        default=DEFAULT_MAX_NEW,
        help="Max NEW PDFs to download this run (default: 3 / AB_HUNTER_MAX_NEW)",
    )
    ap.add_argument(
        "--priority",
        type=int,
        default=2,
        help="Priority ceiling (default: 2 — only cohorts 1+2 attempted)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Force dry-run regardless of MIRA_AB_HUNTER_LIVE (default if env not set)",
    )
    args = ap.parse_args()

    if args.dry_run:
        global LIVE_MODE
        LIVE_MODE = False

    report = RunReport(routine="ab-manual-hunter")
    rc = 4
    try:
        with singleton_lock("ab-manual-hunter", lock_dir=LOCK_DIR):
            # Preflight is intentionally tiny — we run unauthenticated against
            # a public Rockwell CDN. Telegram is optional (graceful skip).
            preflight_secrets(required=(), optional=("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"))
            with hard_timeout(HARD_TIMEOUT_SECS):
                rc = _do_run(args, report)
    except TimeoutError as exc:
        log.error("HARD TIMEOUT: %s", exc)
        report.add_alert(f"hard_timeout {HARD_TIMEOUT_SECS}s expired")
        rc = 3
    except SystemExit:
        raise
    except Exception:
        log.error("unhandled exception\n%s", traceback.format_exc())
        report.add_alert(f"unhandled: {traceback.format_exc(limit=3)}")
        rc = 4

    report.finalize()
    path = _write_run_report(report)
    log.info("run report -> %s (overall=%s)", path, report.overall)

    alert(report)        # JSONL + optional Discord
    _send_telegram(report)
    return rc


if __name__ == "__main__":
    sys.exit(main())
