#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.49,<2", "Pillow>=11,<12", "httpx>=0.28,<1"]
# ///
"""Capture product screenshots from live MIRA deployment via Playwright.

Automates Open WebUI and Atlas CMMS to capture 12 screenshots (4 per feature)
for the expandable gallery on factorylm.com.

Usage:
    uv run tools/capture-screenshots.py --base-url https://app.factorylm.com
    uv run tools/capture-screenshots.py --base-url http://localhost:3010

Requires:
    OPENWEBUI_API_KEY  — Bearer token for Open WebUI API
    PLG_ATLAS_ADMIN_USER / PLG_ATLAS_ADMIN_PASSWORD — Atlas CMMS credentials (optional)

First run: playwright install chromium
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
from pathlib import Path

from PIL import Image
from playwright.async_api import Page, async_playwright

logger = logging.getLogger("capture-screenshots")

SCREENSHOT_DIR = Path(__file__).parent.parent / "mira-web" / "public" / "screenshots"
VIEWPORT = {"width": 1280, "height": 800}
OUTPUT_WIDTH = 640
WEBP_QUALITY = 82


async def wait_for_response(page: Page, timeout_ms: int = 30000) -> None:
    """Wait for MIRA's chat response to finish streaming."""
    await page.wait_for_selector(
        '[class*="prose"]',
        state="visible",
        timeout=timeout_ms,
    )
    await page.wait_for_timeout(2000)
    still_streaming = True
    attempts = 0
    while still_streaming and attempts < 20:
        await page.wait_for_timeout(1000)
        buttons = await page.query_selector_all('button[aria-label="Stop"]')
        still_streaming = len(buttons) > 0
        attempts += 1


async def hide_sidebar(page: Page) -> None:
    """Collapse the Open WebUI sidebar for cleaner screenshots."""
    sidebar_toggle = await page.query_selector('button[aria-label="Toggle Sidebar"]')
    if sidebar_toggle:
        await sidebar_toggle.click()
        await page.wait_for_timeout(500)


async def send_message(page: Page, text: str) -> None:
    """Type and send a chat message in Open WebUI."""
    textarea = await page.wait_for_selector("textarea", timeout=10000)
    await textarea.fill(text)
    await page.wait_for_timeout(300)
    submit = await page.query_selector('button[type="submit"]')
    if submit:
        await submit.click()
    else:
        await textarea.press("Enter")


def optimize_screenshot(src: Path, dst: Path) -> None:
    """Resize and convert to WebP."""
    img = Image.open(src)
    ratio = OUTPUT_WIDTH / img.width
    new_height = int(img.height * ratio)
    img = img.resize((OUTPUT_WIDTH, new_height), Image.LANCZOS)
    img.save(dst, "WEBP", quality=WEBP_QUALITY)
    size_kb = dst.stat().st_size / 1024
    logger.info("  %s — %dx%d, %.0f KB", dst.name, OUTPUT_WIDTH, new_height, size_kb)


async def capture_fault_diagnosis(page: Page, base_url: str) -> None:
    """Capture 4 screenshots for the Fault Diagnosis feature."""
    logger.info("=== Fault Diagnosis ===")

    await page.goto(f"{base_url}", wait_until="networkidle")
    await page.wait_for_timeout(2000)
    await hide_sidebar(page)

    new_chat = await page.query_selector('button[aria-label="New Chat"]')
    if new_chat:
        await new_chat.click()
        await page.wait_for_timeout(1000)

    # Shot 1: User typing the query
    query = "What does fault code F-012 mean on a PowerFlex 753? It tripped twice today on Line 3."
    textarea = await page.wait_for_selector("textarea", timeout=10000)
    await textarea.fill(query)
    await page.wait_for_timeout(500)
    raw = SCREENSHOT_DIR / "fault-diagnosis-01-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "fault-diagnosis-01.webp")

    # Shot 2: Send and capture mid-response
    await send_message(page, query)
    await page.wait_for_timeout(4000)
    raw = SCREENSHOT_DIR / "fault-diagnosis-02-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "fault-diagnosis-02.webp")

    # Shot 3: Full response
    await wait_for_response(page)
    raw = SCREENSHOT_DIR / "fault-diagnosis-03-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "fault-diagnosis-03.webp")

    # Shot 4: Follow-up about work order
    await send_message(page, "Create a work order for this — high priority, assign to the on-call tech.")
    await wait_for_response(page)
    raw = SCREENSHOT_DIR / "fault-diagnosis-04-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "fault-diagnosis-04.webp")


async def capture_cmms_integration(page: Page, base_url: str) -> None:
    """Capture 4 screenshots for the CMMS Integration feature."""
    logger.info("=== CMMS Integration ===")

    cmms_url = os.getenv("ATLAS_CMMS_URL", base_url.replace("app.", "cmms."))
    atlas_user = os.getenv("PLG_ATLAS_ADMIN_USER", "")
    atlas_pass = os.getenv("PLG_ATLAS_ADMIN_PASSWORD", "")

    if not atlas_user:
        logger.warning("PLG_ATLAS_ADMIN_USER not set — using Open WebUI chat for CMMS shots")
        await _capture_cmms_via_chat(page, base_url)
        return

    await page.goto(cmms_url, wait_until="networkidle")
    await page.wait_for_timeout(2000)

    # Login if needed
    login_field = await page.query_selector('input[type="email"], input[name="email"]')
    if login_field:
        await login_field.fill(atlas_user)
        password_field = await page.query_selector('input[type="password"]')
        if password_field:
            await password_field.fill(atlas_pass)
        login_btn = await page.query_selector('button[type="submit"]')
        if login_btn:
            await login_btn.click()
        await page.wait_for_timeout(3000)

    # Shot 1: Work order list
    raw = SCREENSHOT_DIR / "cmms-integration-01-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "cmms-integration-01.webp")

    # Shot 2: Click into first work order detail
    wo_link = await page.query_selector('a[href*="work-order"], tr[class*="cursor"]')
    if wo_link:
        await wo_link.click()
        await page.wait_for_timeout(2000)
    raw = SCREENSHOT_DIR / "cmms-integration-02-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "cmms-integration-02.webp")

    # Shot 3: Assets page
    assets_link = await page.query_selector('a[href*="asset"], [data-nav="assets"]')
    if assets_link:
        await assets_link.click()
        await page.wait_for_timeout(2000)
    raw = SCREENSHOT_DIR / "cmms-integration-03-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "cmms-integration-03.webp")

    # Shot 4: PM schedules
    pm_link = await page.query_selector('a[href*="preventive"], a[href*="pm-schedule"]')
    if pm_link:
        await pm_link.click()
        await page.wait_for_timeout(2000)
    raw = SCREENSHOT_DIR / "cmms-integration-04-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "cmms-integration-04.webp")


async def _capture_cmms_via_chat(page: Page, base_url: str) -> None:
    """Fallback: capture CMMS features via Open WebUI chat commands."""
    await page.goto(f"{base_url}", wait_until="networkidle")
    await hide_sidebar(page)

    new_chat = await page.query_selector('button[aria-label="New Chat"]')
    if new_chat:
        await new_chat.click()
        await page.wait_for_timeout(1000)

    prompts = [
        "Show me all open work orders",
        "Show me the details for the VFD overcurrent work order",
        "List all equipment assets and their status",
        "What preventive maintenance is due this week?",
    ]
    for i, prompt in enumerate(prompts, 1):
        await send_message(page, prompt)
        await wait_for_response(page)
        raw = SCREENSHOT_DIR / f"cmms-integration-{i:02d}-raw.png"
        await page.screenshot(path=str(raw))
        optimize_screenshot(raw, SCREENSHOT_DIR / f"cmms-integration-{i:02d}.webp")


async def capture_voice_vision(page: Page, base_url: str) -> None:
    """Capture 4 screenshots for the Voice + Vision feature."""
    logger.info("=== Voice + Vision ===")

    await page.goto(f"{base_url}", wait_until="networkidle")
    await page.wait_for_timeout(2000)
    await hide_sidebar(page)

    new_chat = await page.query_selector('button[aria-label="New Chat"]')
    if new_chat:
        await new_chat.click()
        await page.wait_for_timeout(1000)

    # Shot 1: Upload a photo — find the file upload button
    nameplate_path = _find_sample_image()
    if nameplate_path:
        file_input = await page.query_selector('input[type="file"]')
        if file_input:
            await file_input.set_input_files(str(nameplate_path))
            await page.wait_for_timeout(2000)

    raw = SCREENSHOT_DIR / "voice-vision-01-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "voice-vision-01.webp")

    # Shot 2: Send photo with question
    await send_message(page, "What equipment is this? Identify the manufacturer and model from this nameplate.")
    await page.wait_for_timeout(5000)
    raw = SCREENSHOT_DIR / "voice-vision-02-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "voice-vision-02.webp")

    # Shot 3: Full vision response
    await wait_for_response(page, timeout_ms=60000)
    raw = SCREENSHOT_DIR / "voice-vision-03-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "voice-vision-03.webp")

    # Shot 4: Follow-up diagnostic
    await send_message(page, "This unit is showing a flashing red LED on the drive. What should I check first?")
    await wait_for_response(page)
    raw = SCREENSHOT_DIR / "voice-vision-04-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / "voice-vision-04.webp")


def _find_sample_image() -> Path | None:
    """Find a sample equipment photo for the vision demo."""
    candidates = [
        Path(__file__).parent.parent / "tests" / "fixtures" / "nameplate.jpg",
        Path(__file__).parent.parent / "tests" / "fixtures" / "nameplate.png",
        Path(__file__).parent.parent / "demo" / "sample_nameplate.jpg",
    ]
    for p in candidates:
        if p.exists():
            return p
    logger.warning("No sample image found — vision screenshot will show text-only chat")
    return None


async def main(base_url: str) -> None:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

    api_key = os.getenv("OPENWEBUI_API_KEY", "")
    if not api_key:
        logger.error("OPENWEBUI_API_KEY not set — cannot authenticate with Open WebUI")
        return

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=VIEWPORT,
            color_scheme="dark",
            extra_http_headers={"Authorization": f"Bearer {api_key}"},
        )
        page = await context.new_page()

        # Authenticate via cookie — Open WebUI uses JWT in localStorage
        await page.goto(f"{base_url}", wait_until="networkidle")
        await page.evaluate(
            f"localStorage.setItem('token', '{api_key}')"
        )
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(2000)

        await capture_fault_diagnosis(page, base_url)
        await capture_cmms_integration(page, base_url)
        await capture_voice_vision(page, base_url)

        await browser.close()

    raw_files = list(SCREENSHOT_DIR.glob("*-raw.png"))
    for f in raw_files:
        f.unlink()

    webp_files = sorted(SCREENSHOT_DIR.glob("*.webp"))
    total_kb = sum(f.stat().st_size for f in webp_files) / 1024
    logger.info("Done — %d screenshots, %.0f KB total", len(webp_files), total_kb)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    parser = argparse.ArgumentParser(description="Capture MIRA product screenshots")
    parser.add_argument(
        "--base-url",
        default="https://app.factorylm.com",
        help="Open WebUI base URL (default: https://app.factorylm.com)",
    )
    args = parser.parse_args()
    asyncio.run(main(args.base_url))
