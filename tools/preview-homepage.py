#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.49,<2"]
# ///
"""Render mira-web homepage previews so humans can eyeball the conversation redesign.

Run:  uv run tools/preview-homepage.py
Outputs: tools/preview/{desktop,mobile}.png + per-feature clips
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).parent / "preview"
OUT.mkdir(exist_ok=True)

URL = os.getenv("PREVIEW_URL", "http://localhost:3201/")


async def snap(browser, label: str, w: int, h: int) -> None:
    ctx = await browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2)
    page = await ctx.new_page()
    resp = await page.goto(URL, wait_until="networkidle")
    if not resp or not resp.ok:
        raise SystemExit(f"nav failed: {resp.status if resp else '?'}")
    # The page gates section visibility on scroll-triggered IntersectionObserver.
    # Force-reveal all .fade-in sections and force-complete all .conv-turn animations
    # so the full-page screenshot shows the real layout.
    await page.evaluate(
        """() => {
            document.querySelectorAll('.fade-in').forEach(el => el.classList.add('visible'));
            const style = document.createElement('style');
            style.textContent = `
              .fade-in { opacity: 1 !important; transform: none !important; }
              .conv-turn { opacity: 1 !important; transform: none !important; animation: none !important; }
            `;
            document.head.appendChild(style);
            window.scrollTo(0, document.body.scrollHeight);
        }"""
    )
    await page.wait_for_timeout(400)
    await page.evaluate("window.scrollTo(0, 0)")
    await page.wait_for_timeout(400)
    await page.screenshot(path=str(OUT / f"{label}.png"), full_page=True)
    print(f"  {label}.png")
    # Per-feature clips — scroll each into view first so clip coords align with viewport
    rects = await page.evaluate(
        """() => Array.from(document.querySelectorAll('.feature')).map(el => {
            const r = el.getBoundingClientRect();
            return {x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height};
        })"""
    )
    print(f"  ({len(rects)} feature sections detected)")
    await ctx.close()


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await snap(browser, "desktop", 1440, 900)
            await snap(browser, "mobile", 390, 844)
        finally:
            await browser.close()
    print(f"Done — previews in {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
