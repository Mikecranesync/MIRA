#!/usr/bin/env python3
"""Blitz capture of all known Ignition Perspective + gateway views.

Single browser context, one reused page, 4s settle, desktop-only.
Outputs to docs/promo-screenshots/ with date-stamped filenames.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

GATEWAY = "http://100.72.2.99:8088"
DATE = "2026-06-01"
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "promo-screenshots"

TARGETS: list[tuple[str, str, str]] = [
    # (project_slug, view_slug, url)
    # ConvSimpleLive
    ("convsimplelive", "root",      f"{GATEWAY}/data/perspective/client/ConvSimpleLive"),
    ("convsimplelive", "home",      f"{GATEWAY}/data/perspective/client/ConvSimpleLive/page/home"),
    ("convsimplelive", "main",      f"{GATEWAY}/data/perspective/client/ConvSimpleLive/page/main"),
    ("convsimplelive", "live",      f"{GATEWAY}/data/perspective/client/ConvSimpleLive/page/live"),
    ("convsimplelive", "dashboard", f"{GATEWAY}/data/perspective/client/ConvSimpleLive/page/dashboard"),
    ("convsimplelive", "conveyor",  f"{GATEWAY}/data/perspective/client/ConvSimpleLive/page/conveyor"),
    ("convsimplelive", "overview",  f"{GATEWAY}/data/perspective/client/ConvSimpleLive/page/overview"),
    # ConveyorMIRA
    ("conveyormira", "root",          f"{GATEWAY}/data/perspective/client/ConveyorMIRA"),
    ("conveyormira", "speed",         f"{GATEWAY}/data/perspective/client/ConveyorMIRA/page/speed"),
    ("conveyormira", "status",        f"{GATEWAY}/data/perspective/client/ConveyorMIRA/page/status"),
    ("conveyormira", "faults",        f"{GATEWAY}/data/perspective/client/ConveyorMIRA/page/faults"),
    ("conveyormira", "navbar",        f"{GATEWAY}/data/perspective/client/ConveyorMIRA/page/navbar"),
    ("conveyormira", "mira-panel",    f"{GATEWAY}/data/perspective/client/ConveyorMIRA/page/mira-panel"),
    ("conveyormira", "mira-connect",  f"{GATEWAY}/data/perspective/client/ConveyorMIRA/page/mira-connect"),
    ("conveyormira", "mira-alerts",   f"{GATEWAY}/data/perspective/client/ConveyorMIRA/page/mira-alerts"),
    ("conveyormira", "mira-settings", f"{GATEWAY}/data/perspective/client/ConveyorMIRA/page/mira-settings"),
    # Mira_tags
    ("mira_tags", "root",         f"{GATEWAY}/data/perspective/client/Mira_tags"),
    ("mira_tags", "speedcontrol", f"{GATEWAY}/data/perspective/client/Mira_tags/page/SpeedControl"),
    # Gateway pages
    ("gateway", "home",          f"{GATEWAY}"),
    ("gateway", "config-tags",   f"{GATEWAY}/web/config/tags"),
    ("gateway", "config-devices", f"{GATEWAY}/web/config/com.inductiveautomation.xopc.drivers"),
    ("gateway", "status-modules", f"{GATEWAY}/web/status/sys.modules"),
    ("gateway", "status-sessions", f"{GATEWAY}/web/status/perspective.sessions"),
    # Perspective launcher
    ("perspective", "launcher", f"{GATEWAY}/data/perspective/client"),
]


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    ok = 0
    fail = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            ignore_https_errors=True,
        )
        page = context.new_page()

        for project, view, url in TARGETS:
            fname = f"{DATE}_blitz-{project}-{view}_desktop.png"
            fpath = OUT_DIR / fname
            try:
                page.goto(url, timeout=15000, wait_until="domcontentloaded")
                page.wait_for_timeout(4000)
                page.screenshot(path=str(fpath), full_page=False)
                size = fpath.stat().st_size if fpath.exists() else 0
                print(f"OK  {fname}  {size:>9} B  ({url})", flush=True)
                ok += 1
            except Exception as e:
                msg = str(e).splitlines()[0][:120]
                print(f"ERR {fname}  -- {msg}  ({url})", flush=True)
                # Best-effort screenshot of whatever is on screen
                try:
                    page.screenshot(path=str(fpath), full_page=False)
                    size = fpath.stat().st_size if fpath.exists() else 0
                    print(f"    salvage  {size:>9} B", flush=True)
                except Exception:
                    pass
                fail += 1

        context.close()
        browser.close()

    dt = time.monotonic() - t0
    print(f"\nDone in {dt:.1f}s  ok={ok}  fail={fail}  out={OUT_DIR}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
