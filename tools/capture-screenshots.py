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

Requires:
    OPENWEBUI_ADMIN_PASSWORD — Open WebUI admin password (preferred)
    OPENWEBUI_API_KEY        — fallback: Open WebUI API key

First run: playwright install chromium
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from playwright.async_api import Page, async_playwright

logger = logging.getLogger("capture-screenshots")

SCREENSHOT_DIR = Path(__file__).parent.parent / "mira-web" / "public" / "screenshots"
VIEWPORT = {"width": 1280, "height": 800}
OUTPUT_WIDTH = 1280
WEBP_QUALITY = 85

CROP_LEFT = 50
CROP_TOP = 45
CROP_RIGHT = 0
CROP_BOTTOM = 50

failures: list[dict] = []


def log_failure(feature: str, shot: str, error: str) -> None:
    entry = {"feature": feature, "shot": shot, "error": error, "ts": datetime.now(timezone.utc).isoformat()}
    failures.append(entry)
    logger.warning("FAILURE [%s/%s]: %s", feature, shot, error)


async def wait_for_response(page: Page, timeout_ms: int = 90000) -> bool:
    """Wait for MIRA response to finish streaming. Returns True if response appeared."""
    try:
        await page.wait_for_selector('[class*="prose"]', state="visible", timeout=timeout_ms)
    except Exception:
        return False
    # Wait for actual text content (not just loading indicator)
    for _ in range(15):
        await page.wait_for_timeout(1000)
        text_len = await page.evaluate("""
            (() => {
                const el = document.querySelector('[class*="prose"]');
                return el ? el.innerText.trim().length : 0;
            })()
        """)
        if text_len > 50:
            break
    # Wait for streaming to finish (stop button disappears)
    for _ in range(60):
        await page.wait_for_timeout(1000)
        stop_btns = await page.query_selector_all('button[aria-label="Stop"]')
        if not stop_btns:
            break
    await page.wait_for_timeout(1500)
    return True


async def enable_tools(page: Page) -> None:
    """Click the tools icon and enable MIRA Equipment Tools if available."""
    try:
        buttons = await page.query_selector_all("button")
        for b in buttons:
            if not await b.is_visible():
                continue
            box = await b.bounding_box()
            if not box or box["y"] < 300:
                continue
            inner = await b.evaluate("el => el.innerHTML")
            if "M12" in inner and "circle" in inner and box["x"] > 330 and box["x"] < 380:
                await b.click()
                await page.wait_for_timeout(800)
                break

        tools_link = await page.query_selector("text=Tools")
        if tools_link:
            await tools_link.click()
            await page.wait_for_timeout(800)
            checkbox = await page.query_selector('input[type="checkbox"]')
            if checkbox and not await checkbox.is_checked():
                await checkbox.click()
                await page.wait_for_timeout(500)
                logger.info("Enabled MIRA Equipment Tools")
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(300)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
    except Exception as e:
        log_failure("setup", "enable-tools", str(e))


async def start_new_chat(page: Page, base_url: str) -> None:
    jwt = os.getenv("_OWUI_JWT", "")
    await page.goto(f"{base_url}", wait_until="networkidle")
    await page.evaluate(f"localStorage.setItem('token', '{jwt}')")
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(3000)
    await dismiss_banners(page)
    await enable_tools(page)


async def dismiss_banners(page: Page) -> None:
    """Aggressively close all banners, popups, and toasts."""
    await page.wait_for_timeout(500)
    for sel in [
        'button:has-text("×")',
        'button[aria-label="Close"]',
        '[data-dismiss]',
        '.toast-close',
        'button:has-text("Dismiss")',
    ]:
        try:
            btns = await page.query_selector_all(sel)
            for btn in btns:
                if await btn.is_visible():
                    await btn.click()
                    await page.wait_for_timeout(200)
        except Exception:
            pass
    # Nuclear: remove banner DOM elements and inject hide-all CSS
    await page.evaluate("""
        document.querySelectorAll('a').forEach(a => {
            if (a.textContent.includes('Update') || a.textContent.includes('update')) {
                let el = a.closest('div.fixed') || a.closest('div.absolute') || a.parentElement?.parentElement;
                if (el) el.remove();
            }
        });
    """)
    await page.add_style_tag(content="""
        .fixed.bottom-0, .fixed.bottom-2, .fixed.bottom-4,
        .absolute.bottom-0, .absolute.bottom-2,
        [class*="toast"], [class*="notification"], [class*="snackbar"] {
            display: none !important;
        }
    """)
    await page.wait_for_timeout(300)


async def send_message(page: Page, text: str) -> None:
    chat_input = await page.wait_for_selector("#chat-input", timeout=10000)
    await chat_input.click()
    await page.keyboard.type(text, delay=15)
    await page.wait_for_timeout(200)
    await page.keyboard.press("Enter")


def optimize_screenshot(src: Path, dst: Path) -> None:
    img = Image.open(src)
    w, h = img.size
    cropped = img.crop((CROP_LEFT, CROP_TOP, w - CROP_RIGHT, h - CROP_BOTTOM))
    cw, ch = cropped.size
    ratio = OUTPUT_WIDTH / cw
    new_height = int(ch * ratio)
    final = cropped.resize((OUTPUT_WIDTH, new_height), Image.LANCZOS)
    final.save(dst, "WEBP", quality=WEBP_QUALITY)
    size_kb = dst.stat().st_size / 1024
    logger.info("  %s — %dx%d, %.0f KB", dst.name, OUTPUT_WIDTH, new_height, size_kb)


async def safe_screenshot(page: Page, name: str) -> None:
    """Take screenshot with error handling."""
    await dismiss_banners(page)
    await page.wait_for_timeout(300)
    raw = SCREENSHOT_DIR / f"{name}-raw.png"
    await page.screenshot(path=str(raw))
    optimize_screenshot(raw, SCREENSHOT_DIR / f"{name}.webp")


async def check_response_quality(page: Page, feature: str, shot: str) -> None:
    """Check if the MIRA response contains error indicators."""
    content = await page.content()
    lower = content.lower()
    if "unauthorized" in lower:
        log_failure(feature, shot, "MIRA returned 'Unauthorized' — pipeline API key mismatch")
    elif "i don't have access" in lower or "i cannot" in lower:
        log_failure(feature, shot, "MIRA lacks tool access — Equipment Tools not enabled in Open WebUI admin")
    elif "error" in lower and "error_" not in lower:
        # Check for visible error banners
        err_els = await page.query_selector_all('[class*="error"], [class*="alert-danger"]')
        for el in err_els:
            if await el.is_visible():
                text = (await el.inner_text())[:100]
                log_failure(feature, shot, f"Visible error element: {text}")
                break


async def capture_fault_diagnosis(page: Page, base_url: str) -> None:
    logger.info("=== Fault Diagnosis ===")
    await start_new_chat(page, base_url)

    query = "What does fault code F-012 mean on a PowerFlex 753? It tripped twice today on Line 3."

    try:
        chat_input = await page.wait_for_selector("#chat-input", timeout=10000)
        await chat_input.click()
        await page.keyboard.type(query, delay=12)
        await page.wait_for_timeout(500)
        await safe_screenshot(page, "fault-diagnosis-01")
    except Exception as e:
        log_failure("fault-diagnosis", "01-query-typed", str(e))

    try:
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(6000)
        await safe_screenshot(page, "fault-diagnosis-02")
    except Exception as e:
        log_failure("fault-diagnosis", "02-mid-response", str(e))

    try:
        got_response = await wait_for_response(page, timeout_ms=60000)
        if not got_response:
            log_failure("fault-diagnosis", "03-full-response", "Response never appeared (60s timeout)")
        await safe_screenshot(page, "fault-diagnosis-03")
        await check_response_quality(page, "fault-diagnosis", "03-full-response")
    except Exception as e:
        log_failure("fault-diagnosis", "03-full-response", str(e))

    try:
        await send_message(page, "Create a work order for this — high priority, assign to the on-call tech.")
        got_response = await wait_for_response(page, timeout_ms=60000)
        if not got_response:
            log_failure("fault-diagnosis", "04-work-order", "Work order response never appeared")
        await safe_screenshot(page, "fault-diagnosis-04")
        await check_response_quality(page, "fault-diagnosis", "04-work-order")
    except Exception as e:
        log_failure("fault-diagnosis", "04-work-order", str(e))


async def capture_cmms_integration(page: Page, base_url: str) -> None:
    logger.info("=== CMMS Integration ===")

    cmms_url = os.getenv("ATLAS_CMMS_URL", base_url.replace("app.", "cmms."))
    atlas_user = os.getenv("PLG_ATLAS_ADMIN_USER", "")
    atlas_pass = os.getenv("PLG_ATLAS_ADMIN_PASSWORD", "")

    if not atlas_user:
        log_failure("cmms-integration", "all", "PLG_ATLAS_ADMIN_USER not set — using chat fallback (lower quality)")
        await _capture_cmms_via_chat(page, base_url)
        return

    try:
        await page.goto(cmms_url, wait_until="networkidle")
        await page.wait_for_timeout(2000)

        login_field = await page.query_selector('input[type="email"], input[name="email"]')
        if login_field:
            await login_field.fill(atlas_user)
            pw_field = await page.query_selector('input[type="password"]')
            if pw_field:
                await pw_field.fill(atlas_pass)
            login_btn = await page.query_selector('button[type="submit"]')
            if login_btn:
                await login_btn.click()
            await page.wait_for_timeout(3000)

        await safe_screenshot(page, "cmms-integration-01")

        wo_link = await page.query_selector('a[href*="work-order"], tr[class*="cursor"]')
        if wo_link:
            await wo_link.click()
            await page.wait_for_timeout(2000)
        else:
            log_failure("cmms-integration", "02-wo-detail", "No work order link found on page")
        await safe_screenshot(page, "cmms-integration-02")

        assets_link = await page.query_selector('a[href*="asset"], [data-nav="assets"]')
        if assets_link:
            await assets_link.click()
            await page.wait_for_timeout(2000)
        else:
            log_failure("cmms-integration", "03-assets", "No assets link found")
        await safe_screenshot(page, "cmms-integration-03")

        pm_link = await page.query_selector('a[href*="preventive"], a[href*="pm-schedule"]')
        if pm_link:
            await pm_link.click()
            await page.wait_for_timeout(2000)
        else:
            log_failure("cmms-integration", "04-pm", "No PM schedule link found")
        await safe_screenshot(page, "cmms-integration-04")

    except Exception as e:
        log_failure("cmms-integration", "atlas-direct", str(e))
        await _capture_cmms_via_chat(page, base_url)


async def _capture_cmms_via_chat(page: Page, base_url: str) -> None:
    await start_new_chat(page, base_url)

    prompts = [
        "Show me all open work orders",
        "Show me the details for the VFD overcurrent work order",
        "List all equipment assets and their status",
        "What preventive maintenance is due this week?",
    ]
    for i, prompt in enumerate(prompts, 1):
        shot_name = f"cmms-integration-{i:02d}"
        try:
            await send_message(page, prompt)
            got = await wait_for_response(page, timeout_ms=45000)
            if not got:
                log_failure("cmms-integration", shot_name, f"No response for: {prompt}")
            await safe_screenshot(page, shot_name)
            await check_response_quality(page, "cmms-integration", shot_name)
        except Exception as e:
            log_failure("cmms-integration", shot_name, str(e))


async def capture_voice_vision(page: Page, base_url: str) -> None:
    logger.info("=== Voice + Vision ===")
    await start_new_chat(page, base_url)

    nameplate_path = _find_sample_image()
    if not nameplate_path:
        log_failure("voice-vision", "01-upload", "No sample image found in tests/fixtures/ or demo/")

    try:
        if nameplate_path:
            file_input = await page.query_selector('input[type="file"]')
            if file_input:
                await file_input.set_input_files(str(nameplate_path))
                await page.wait_for_timeout(2000)
            else:
                # Try the + button to open file picker
                plus_btn = await page.query_selector('#chat-input ~ button, button[aria-label="More"]')
                if plus_btn:
                    await plus_btn.click()
                    await page.wait_for_timeout(500)
                file_input = await page.query_selector('input[type="file"]')
                if file_input:
                    await file_input.set_input_files(str(nameplate_path))
                    await page.wait_for_timeout(2000)
                else:
                    log_failure("voice-vision", "01-upload", "Cannot find file input element")

        await safe_screenshot(page, "voice-vision-01")
    except Exception as e:
        log_failure("voice-vision", "01-upload", str(e))

    try:
        await send_message(page, "What equipment is this? Identify the manufacturer and model from this nameplate.")
        await page.wait_for_timeout(6000)
        await safe_screenshot(page, "voice-vision-02")
    except Exception as e:
        log_failure("voice-vision", "02-identifying", str(e))

    try:
        got = await wait_for_response(page, timeout_ms=60000)
        if not got:
            log_failure("voice-vision", "03-identified", "Vision response never appeared (60s)")
        await safe_screenshot(page, "voice-vision-03")
        await check_response_quality(page, "voice-vision", "03-identified")
    except Exception as e:
        log_failure("voice-vision", "03-identified", str(e))

    try:
        await send_message(page, "This unit is showing a flashing red LED on the drive. What should I check first?")
        got = await wait_for_response(page)
        if not got:
            log_failure("voice-vision", "04-followup", "Follow-up response never appeared")
        await safe_screenshot(page, "voice-vision-04")
        await check_response_quality(page, "voice-vision", "04-followup")
    except Exception as e:
        log_failure("voice-vision", "04-followup", str(e))


def _find_sample_image() -> Path | None:
    candidates = [
        Path(__file__).parent.parent / "tests" / "fixtures" / "nameplate.jpg",
        Path(__file__).parent.parent / "tests" / "fixtures" / "nameplate.png",
        Path(__file__).parent.parent / "demo" / "sample_nameplate.jpg",
        Path(__file__).parent.parent / "demo" / "sample_nameplate.png",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


async def _get_jwt(base_url: str) -> str:
    email = os.getenv("OPENWEBUI_ADMIN_EMAIL", "mike@cranesync.com")
    password = os.getenv("OPENWEBUI_ADMIN_PASSWORD", "")
    api_key = os.getenv("OPENWEBUI_API_KEY", "")

    if password:
        import httpx as _httpx

        async with _httpx.AsyncClient() as client:
            resp = await client.post(
                f"{base_url}/api/v1/auths/signin",
                json={"email": email, "password": password},
            )
            if resp.status_code == 200:
                return resp.json().get("token", "")
    return api_key


async def main(base_url: str) -> None:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

    jwt = await _get_jwt(base_url)
    if not jwt:
        logger.error("Cannot authenticate — set OPENWEBUI_ADMIN_PASSWORD or OPENWEBUI_API_KEY")
        return

    os.environ["_OWUI_JWT"] = jwt

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport=VIEWPORT, color_scheme="dark")
        page = await context.new_page()

        await page.goto(f"{base_url}", wait_until="networkidle")
        await page.evaluate(f"localStorage.setItem('token', '{jwt}')")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(3000)

        await capture_fault_diagnosis(page, base_url)
        await capture_cmms_integration(page, base_url)
        await capture_voice_vision(page, base_url)

        await browser.close()

    # Clean raw files
    for f in SCREENSHOT_DIR.glob("*-raw.png"):
        f.unlink()

    webp_files = sorted(SCREENSHOT_DIR.glob("*.webp"))
    total_kb = sum(f.stat().st_size for f in webp_files) / 1024
    logger.info("Done — %d screenshots, %.0f KB total", len(webp_files), total_kb)

    # Write failure log
    if failures:
        log_path = SCREENSHOT_DIR / "capture-failures.json"
        log_path.write_text(json.dumps(failures, indent=2))
        logger.warning("%d failures logged to %s", len(failures), log_path)
        for f in failures:
            logger.warning("  [%s/%s] %s", f["feature"], f["shot"], f["error"])
    else:
        logger.info("No failures — all screenshots captured cleanly")


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
