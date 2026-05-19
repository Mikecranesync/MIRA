#!/usr/bin/env python3
"""External demo-surface probe — runs on VPS via crontab.

Hits the critical Florida Expo demo surfaces every 5 minutes and pings
Mike's Telegram on non-200. Closes the #1201 part of the #1041 gate.

Why a VPS-side cron rather than UptimeRobot:
- No vendor signup needed in the demo-prep window
- Latency floor is the same network (LAN-local probe is honest about
  the same wire the demo uses through nginx)
- Tradeoff acknowledged: if the VPS itself dies, the probe goes silent.
  That's why we also keep an off-VPS heartbeat (existing
  heartbeat_monitor sends Telegram on DOWN every 15 min).

Usage:
    python3 scripts/external_probe.py            # one-shot probe + alert
    python3 scripts/external_probe.py --quiet    # only emit on non-200
    python3 scripts/external_probe.py --dry-run  # log what would alert

Crontab line installed by scripts/install_crons.sh:
    */5 * * * *  cd $MIRA_DIR && python3 scripts/external_probe.py --quiet >> $LOG_DIR/external_probe.log 2>&1
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass
from typing import Sequence

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] probe: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("external_probe")

# Demo surfaces — each tuple is (label, URL, expect_status_set).
# /feed/ returns 200 of the login page when unauth, so a >=500 is the
# alert trigger, not !=200.
SURFACES: Sequence[tuple[str, str, set[int]]] = (
    ("pipeline_models",   "https://app.factorylm.com/v1/models",          {200, 401}),
    ("scanbe_health",     "https://app.factorylm.com/api/scanbe/healthz", {200}),
    ("scan_app",          "https://app.factorylm.com/scan/",              {200}),
    ("hub_feed_login",    "https://app.factorylm.com/feed/",              {200}),
    ("atlas_root",        "https://cmms.factorylm.com/",                  {200}),
    ("marketing_landing", "https://factorylm.com/",                       {200}),
)

SLO_LATENCY_S = 8.0  # surface counts as "slow" beyond this even at 200


@dataclass
class ProbeResult:
    label: str
    url: str
    status: int | None
    elapsed_s: float
    ok: bool
    detail: str


def probe_one(label: str, url: str, expect: set[int], timeout: float = 15.0) -> ProbeResult:
    t0 = time.perf_counter()
    try:
        r = httpx.get(url, timeout=timeout, follow_redirects=False)
        elapsed = time.perf_counter() - t0
        ok = r.status_code in expect and elapsed < SLO_LATENCY_S
        detail = f"status={r.status_code} elapsed={elapsed:.2f}s"
        return ProbeResult(label, url, r.status_code, elapsed, ok, detail)
    except httpx.HTTPError as exc:
        elapsed = time.perf_counter() - t0
        return ProbeResult(label, url, None, elapsed, False,
                           f"{exc.__class__.__name__}: {exc}")


def send_telegram_alert(message: str, dry_run: bool = False) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        logger.warning("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — alert suppressed")
        return False
    if dry_run:
        logger.info("DRY-RUN telegram alert:\n%s", message)
        return True
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data={"chat_id": chat, "text": message, "disable_web_page_preview": "true"},
            timeout=10,
        )
        r.raise_for_status()
        return True
    except httpx.HTTPError as exc:
        logger.warning("telegram alert failed: %s", exc)
        return False


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--quiet", action="store_true", help="Skip log lines on healthy results")
    p.add_argument("--dry-run", action="store_true", help="Log alert payload instead of sending")
    args = p.parse_args(argv)

    results = [probe_one(label, url, expect) for label, url, expect in SURFACES]

    failed = [r for r in results if not r.ok]
    if failed:
        lines = [f"MIRA EXPO PROBE — {len(failed)}/{len(results)} surface(s) failing:"]
        for r in failed:
            lines.append(f"  {'-' if r.elapsed_s >= SLO_LATENCY_S else 'X'} {r.label}: {r.detail}")
        for r in results:
            if r.ok and not args.quiet:
                lines.append(f"  + {r.label}: {r.detail}")
        send_telegram_alert("\n".join(lines), dry_run=args.dry_run)
        logger.warning("FAIL %d/%d", len(failed), len(results))
        return 2

    if not args.quiet:
        logger.info("all %d surfaces OK (slowest %.2fs)", len(results),
                    max((r.elapsed_s for r in results), default=0.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
