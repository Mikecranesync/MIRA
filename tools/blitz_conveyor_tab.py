#!/usr/bin/env python3
"""Capture the CONVEYOR tab inside ConvSimpleLive (sibling of PMC STATION)."""
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "docs" / "promo-screenshots"
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
    page = ctx.new_page()
    page.goto("http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive", timeout=15000, wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    try:
        page.get_by_text("CONVEYOR", exact=False).first.click(timeout=5000)
        page.wait_for_timeout(4000)
        fp = OUT / "2026-06-01_blitz-convsimplelive-conveyor-tab_desktop.png"
        page.screenshot(path=str(fp))
        print(f"OK  {fp.name}  {fp.stat().st_size} B")
    except Exception as e:
        print(f"ERR  {e}")
    ctx.close()
    b.close()
