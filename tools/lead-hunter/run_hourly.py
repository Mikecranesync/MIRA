#!/usr/bin/env python3
"""Hardened hourly entry point for lead-hunter.

Called by: launchd (com.mira.lead-hunter) or Celery beat.
Doppler injects secrets via the wrapper command.

Reliability layers (in order):
  1. Singleton lock           — prevents overlapping runs
  2. Preflight secret check   — fails fast with actionable error if missing
  3. Hard 25-min timeout      — must finish before next hour
  4. Per-step RunReport       — captures pass/fail/skip for every phase
  5. Alert sink               — degraded/failed runs append to JSONL + optional webhook

Exit codes:
  0  healthy run (or skipped via singleton lock)
  1  routine completed but degraded (e.g. enrichment ran zero contacts)
  2  preflight failure (missing secrets) — fix env, will retry next hour
  3  hard timeout exceeded
  4  unhandled exception
"""
from __future__ import annotations

import logging
import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from hardening import (
    RunReport,
    alert,
    hard_timeout,
    preflight_secrets,
    singleton_lock,
)

REPO_ROOT = Path(__file__).parent.parent.parent
LOG_PATH = REPO_ROOT / "marketing" / "prospects" / "lead-hunter.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(), logging.FileHandler(LOG_PATH, mode="a")],
)
log = logging.getLogger("lead-hunter.runner")

HARD_TIMEOUT_SECS = int(os.getenv("LEAD_HUNTER_TIMEOUT_SECS", "1500"))  # 25 min
REQUIRED_SECRETS = ("NEON_DATABASE_URL",)
OPTIONAL_SECRETS = (
    "SERPER_API_KEY",
    "FIRECRAWL_API_KEY",
    "HUNTER_API_KEY",
    "HUBSPOT_API_KEY",
    "HUBSPOT_ACCESS_TOKEN",
)


def _run() -> int:
    """Inner routine — returns exit code based on RunReport health."""
    report = RunReport(routine="lead-hunter-hourly")

    # 1. Preflight: required secrets must be set
    with report.step("preflight") as step:
        present = preflight_secrets(REQUIRED_SECRETS, OPTIONAL_SECRETS)
        step.detail.update({k: v for k, v in present.items()})
        # Note degraded paths
        if not (present.get("HUBSPOT_API_KEY") or present.get("HUBSPOT_ACCESS_TOKEN")):
            report.add_alert("HubSpot token missing — qualified leads will not be pushed")
        if not present.get("FIRECRAWL_API_KEY"):
            report.add_alert("FIRECRAWL_API_KEY missing — contact enrichment will be limited")
        if not present.get("SERPER_API_KEY"):
            report.add_alert("SERPER_API_KEY missing — discovery will fall back to DuckDuckGo")

    # 1b. Apply DB schema (idempotent)
    db_url = os.environ.get("NEON_DATABASE_URL", "")
    with report.step("apply_schema") as step:
        if not db_url:
            step.status = "skip"
            step.detail["reason"] = "no NEON_DATABASE_URL"
        else:
            sys.path.insert(0, str(Path(__file__).parent))
            import hunt as hunt_mod
            hunt_mod.apply_schema(db_url)
            step.detail["applied"] = True

    # 2. Run discovery + enrichment with the hard timeout wrapping ONLY this work
    discovered = enriched = enriched_attempted = inserted = hs_pushed = 0
    with report.step("discover_and_enrich") as step:
        from celery_tasks import run_discover_and_enrich
        result = run_discover_and_enrich()
        if result.get("skipped"):
            step.status = "skip"
            step.detail["reason"] = result.get("reason", "unknown")
        else:
            discovered = result.get("discovered", 0)
            enriched = result.get("enriched", 0)
            enriched_attempted = result.get("enriched_attempted", 0)
            inserted = result.get("inserted", 0)
            hs_pushed = result.get("hs_pushed", 0)
            step.detail.update({
                "discovered": discovered,
                "enriched": enriched,
                "enriched_attempted": enriched_attempted,
                "inserted": inserted,
                "hs_pushed": hs_pushed,
                "city": result.get("city", "?"),
            })

    # 3. Silent-failure detectors — catch the bugs that hid yesterday's bad runs
    with report.step("health_assertions") as step:
        # Discovery worked but enrichment didn't — the Charlie failure pattern
        if discovered > 0 and enriched == 0 and (
            os.environ.get("FIRECRAWL_API_KEY") or os.environ.get("HUNTER_API_KEY")
        ):
            report.add_alert(
                f"Discovery found {discovered} facilities but enrichment ran 0 — "
                "Firecrawl/Hunter likely failing or all facilities below ICP gate"
            )
        # Inserted but nothing pushed despite HubSpot configured
        if inserted > 0 and hs_pushed == 0 and (
            os.environ.get("HUBSPOT_API_KEY") or os.environ.get("HUBSPOT_ACCESS_TOKEN")
        ):
            report.add_alert(
                f"Inserted {inserted} new facilities but pushed 0 to HubSpot — "
                "either no leads cleared ICP+real-name gate, or HubSpot auth failed"
            )
        # Partial enrichment failure — most attempts failed but we got some
        if enriched_attempted >= 4 and enriched / max(enriched_attempted, 1) < 0.5:
            report.add_alert(
                f"Enrichment partial failure: {enriched}/{enriched_attempted} succeeded "
                "(<50%) — Firecrawl/Hunter degraded or many sites blocking scrapers"
            )
        step.detail["assertions_passed"] = len(report.alerts) == 0

    report.finalize()
    log.info("RUN_REPORT %s", report.to_json())
    alert(report)

    if report.overall == "fail":
        return 1
    if report.overall == "degraded":
        return 1
    return 0


def main() -> int:
    try:
        with singleton_lock("lead-hunter"):
            try:
                with hard_timeout(HARD_TIMEOUT_SECS):
                    return _run()
            except TimeoutError as e:
                log.error("HARD TIMEOUT: %s", e)
                # Build a minimal report so the timeout is alerted, not silent
                report = RunReport(routine="lead-hunter-hourly")
                report.add_alert(f"Hard timeout exceeded ({HARD_TIMEOUT_SECS}s)")
                report.finalize()
                report.overall = "fail"
                alert(report)
                return 3
    except SystemExit as e:
        # preflight_secrets calls sys.exit(2); singleton_lock calls sys.exit(0)
        return int(e.code) if isinstance(e.code, int) else 0
    except Exception as e:
        log.error("UNHANDLED EXCEPTION: %s\n%s", e, traceback.format_exc())
        report = RunReport(routine="lead-hunter-hourly")
        report.add_alert(f"Unhandled exception: {type(e).__name__}: {e}")
        report.finalize()
        report.overall = "fail"
        alert(report)
        return 4


if __name__ == "__main__":
    sys.exit(main())
