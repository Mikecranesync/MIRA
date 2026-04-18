#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.49,<2"]
# ///
"""Capture close-up shots of each .feature section (1440 width, 2x DPI)."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).parent / "preview"
OUT.mkdir(exist_ok=True)
URL = os.getenv("PREVIEW_URL", "http://localhost:3201/")


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page = await ctx.new_page()
        await page.goto(URL, wait_until="networkidle")
        await page.evaluate(
            """() => {
                document.querySelectorAll('.fade-in').forEach(el => el.classList.add('visible'));
                const style = document.createElement('style');
                style.textContent = `
                  .fade-in { opacity: 1 !important; transform: none !important; }
                  .conv-turn { opacity: 1 !important; transform: none !important; animation: none !important; }
                `;
                document.head.appendChild(style);
            }"""
        )
        features = await page.query_selector_all(".feature")
        for i, el in enumerate(features, 1):
            await el.scroll_into_view_if_needed()
            await page.wait_for_timeout(400)
            path = OUT / f"feature-{i}.png"
            await el.screenshot(path=str(path))
            print(f"  feature-{i}.png — written")
        await browser.close()
    print("Done")


if __name__ == "__main__":
    asyncio.run(main())
