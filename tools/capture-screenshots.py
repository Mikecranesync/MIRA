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
VIEWPORT = {"width": 1600, "height": 1000}
OUTPUT_WIDTH = 1600
ZOOM_OUTPUT_WIDTH = 900
WEBP_QUALITY = 88
DEVICE_SCALE_FACTOR = 2

CROP_LEFT = 60
CROP_TOP = 50
CROP_RIGHT = 0
CROP_BOTTOM = 60

failures: list[dict] = []


def log_failure(feature: str, shot: str, error: str) -> None:
    entry = {"feature": feature, "shot": shot, "error": error, "ts": datetime.now(timezone.utc).isoformat()}
    failures.append(entry)
    logger.warning("FAILURE [%s/%s]: %s", feature, shot, error)


async def wait_for_response(page: Page, timeout_ms: int = 120000, min_chars: int = 180) -> bool:
    """Wait for MIRA response to finish streaming. Returns True if a substantive response appeared.

    Requires at least `min_chars` characters of response text — prevents returning early on
    short clarifying questions that make weak screenshots.
    """
    try:
        await page.wait_for_selector('[class*="prose"]', state="visible", timeout=timeout_ms)
    except Exception:
        return False
    # Wait for substantive text content (not just loading indicator or 1-line clarifier)
    got_text = False
    for _ in range(60):
        await page.wait_for_timeout(1000)
        text_len = await page.evaluate("""
            (() => {
                const els = document.querySelectorAll('[class*="prose"]');
                const last = els[els.length - 1];
                if (!last) return 0;
                const txt = last.innerText.trim();
                // Ignore loading indicators (typing dots, skeleton placeholders)
                if (/^[\\s.·•…⋯]+$/.test(txt)) return 0;
                return txt.length;
            })()
        """)
        if text_len > min_chars:
            got_text = True
            break
    if not got_text:
        return False
    # Wait for streaming to finish (stop button disappears)
    for _ in range(90):
        await page.wait_for_timeout(1000)
        stop_btns = await page.query_selector_all('button[aria-label="Stop"]')
        if not stop_btns:
            break
    await page.wait_for_timeout(2000)
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


async def capture_answer_zoom(page: Page, name: str) -> None:
    """Capture a tight crop of the LATEST MIRA answer bubble — for inline 'zoom' insets.

    Degrades gracefully: if the prose element can't be found or measured, logs a soft
    failure and returns without raising.
    """
    try:
        box = await page.evaluate("""
            (() => {
                const els = document.querySelectorAll('[class*="prose"]');
                const el = els[els.length - 1];
                if (!el) return null;
                const r = el.getBoundingClientRect();
                const pad = 16;
                return {
                    x: Math.max(0, r.left - pad),
                    y: Math.max(0, r.top - pad),
                    width: Math.min(window.innerWidth, r.width + pad * 2),
                    height: Math.min(window.innerHeight, r.height + pad * 2),
                };
            })()
        """)
        if not box or box["width"] < 100 or box["height"] < 40:
            log_failure("zoom", name, "answer bubble not measurable — skipping zoom")
            return
        raw = SCREENSHOT_DIR / f"{name}-zoom-raw.png"
        await page.screenshot(
            path=str(raw),
            clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]},
        )
        img = Image.open(raw)
        w, _ = img.size
        if w > ZOOM_OUTPUT_WIDTH:
            ratio = ZOOM_OUTPUT_WIDTH / w
            img = img.resize((ZOOM_OUTPUT_WIDTH, int(img.size[1] * ratio)), Image.LANCZOS)
        dst = SCREENSHOT_DIR / f"{name}-zoom.webp"
        img.save(dst, "WEBP", quality=WEBP_QUALITY)
        logger.info("  %s — zoom %dx%d, %.0f KB", dst.name, *img.size, dst.stat().st_size / 1024)
    except Exception as e:
        log_failure("zoom", name, str(e))


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

    # Concrete, rich-context prompt — reduces the chance MIRA asks a clarifying question
    # and instead produces a confident cited diagnosis worth showcasing.
    query = (
        "PowerFlex 753 on Line 3 tripped on fault F-012 (motor overload) twice today — "
        "both trips within 15 minutes of startup. Give me the root cause from the manual, "
        "the parameters to check (F501/F502 etc), and cite the page."
    )

    try:
        chat_input = await page.wait_for_selector("#chat-input", timeout=10000)
        await chat_input.click()
        await page.keyboard.type(query, delay=10)
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
        got_response = await wait_for_response(page, timeout_ms=120000, min_chars=200)
        if not got_response:
            log_failure("fault-diagnosis", "03-full-response", "Substantive response never appeared (120s)")
        await safe_screenshot(page, "fault-diagnosis-03")
        await capture_answer_zoom(page, "fault-diagnosis-03")
        await check_response_quality(page, "fault-diagnosis", "03-full-response")
    except Exception as e:
        log_failure("fault-diagnosis", "03-full-response", str(e))

    try:
        await send_message(
            page,
            "Create a high-priority work order for this fault in Atlas — asset VFD-L3-PF753, "
            "assign to the on-call tech, include the parameter checks from above.",
        )
        got_response = await wait_for_response(page, timeout_ms=90000, min_chars=120)
        if not got_response:
            log_failure("fault-diagnosis", "04-work-order", "Work order response never appeared")
        await safe_screenshot(page, "fault-diagnosis-04")
        await capture_answer_zoom(page, "fault-diagnosis-04")
        await check_response_quality(page, "fault-diagnosis", "04-work-order")
    except Exception as e:
        log_failure("fault-diagnosis", "04-work-order", str(e))


async def capture_cmms_integration(page: Page, base_url: str, atlas_direct: bool = False) -> None:
    """Capture CMMS screenshots for the homepage conversation-transcript.

    By default (atlas_direct=False), uses chat-fallback so the output fits the
    conversation-bubble pattern. Pass --atlas-direct to capture Atlas UI panels
    into cmms-atlas-*.webp for the dedicated /feature/cmms-integration page.
    """
    logger.info("=== CMMS Integration ===")

    if atlas_direct:
        await _capture_cmms_via_atlas(page, base_url)
        return

    await _capture_cmms_via_chat(page, base_url)


async def _capture_cmms_via_atlas(page: Page, base_url: str) -> None:
    cmms_url = os.getenv("ATLAS_CMMS_URL", base_url.replace("app.", "cmms."))
    atlas_user = os.getenv("PLG_ATLAS_ADMIN_USER", "")
    atlas_pass = os.getenv("PLG_ATLAS_ADMIN_PASSWORD", "")

    if not atlas_user:
        log_failure("cmms-atlas", "all", "PLG_ATLAS_ADMIN_USER not set — skipping atlas-direct")
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
        await safe_screenshot(page, "cmms-atlas-01")
        wo_link = await page.query_selector('a[href*="work-order"], tr[class*="cursor"]')
        if wo_link:
            await wo_link.click()
            await page.wait_for_timeout(2000)
        await safe_screenshot(page, "cmms-atlas-02")
        assets_link = await page.query_selector('a[href*="asset"], [data-nav="assets"]')
        if assets_link:
            await assets_link.click()
            await page.wait_for_timeout(2000)
        await safe_screenshot(page, "cmms-atlas-03")
        pm_link = await page.query_selector('a[href*="preventive"], a[href*="pm-schedule"]')
        if pm_link:
            await pm_link.click()
            await page.wait_for_timeout(2000)
        await safe_screenshot(page, "cmms-atlas-04")
    except Exception as e:
        log_failure("cmms-atlas", "capture", str(e))


async def _capture_cmms_via_chat(page: Page, base_url: str) -> None:
    await start_new_chat(page, base_url)

    # Concrete prompts that elicit rich tabular/list answers worth showcasing
    steps = [
        (
            "Show me every open work order in Atlas — give me the WO number, asset, "
            "priority, and age for each one.",
            "cmms-integration-01",
            True,  # capture zoom
        ),
        (
            "Pull up the full details for WO-1042 — the VFD overcurrent on Line 2. "
            "Include the AI-generated description, parts list, and estimated labor.",
            "cmms-integration-02",
            True,
        ),
        (
            "List the top 8 critical assets in the plant with their current health status, "
            "last PM date, and any open work orders.",
            "cmms-integration-03",
            True,
        ),
        (
            "What preventive maintenance is due in the next 7 days? Include asset, task, "
            "technician, and due date.",
            "cmms-integration-04",
            True,
        ),
    ]
    for prompt, shot_name, zoom in steps:
        try:
            await send_message(page, prompt)
            got = await wait_for_response(page, timeout_ms=90000, min_chars=200)
            if not got:
                log_failure("cmms-integration", shot_name, f"No substantive response for: {prompt}")
            await safe_screenshot(page, shot_name)
            if zoom:
                await capture_answer_zoom(page, shot_name)
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
        await send_message(
            page,
            "Read every field on this nameplate — manufacturer, model, serial, voltage, "
            "amps, HP, RPM. Then tell me the three most common failure modes for this class "
            "of motor and what to check first.",
        )
        await page.wait_for_timeout(6000)
        await safe_screenshot(page, "voice-vision-02")
    except Exception as e:
        log_failure("voice-vision", "02-identifying", str(e))

    try:
        got = await wait_for_response(page, timeout_ms=120000, min_chars=250)
        if not got:
            log_failure("voice-vision", "03-identified", "Substantive vision response never appeared (120s)")
        await safe_screenshot(page, "voice-vision-03")
        await capture_answer_zoom(page, "voice-vision-03")
        await check_response_quality(page, "voice-vision", "03-identified")
    except Exception as e:
        log_failure("voice-vision", "03-identified", str(e))

    try:
        await send_message(
            page,
            "This motor is showing a flashing red fault LED on its VFD and tripping on "
            "overload at startup. What are the top 3 things to check right now, ranked by "
            "likelihood? Keep it tactical.",
        )
        got = await wait_for_response(page, timeout_ms=120000, min_chars=200)
        if not got:
            log_failure("voice-vision", "04-followup", "Follow-up response never appeared")
        await safe_screenshot(page, "voice-vision-04")
        await capture_answer_zoom(page, "voice-vision-04")
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


async def main(base_url: str, atlas_direct: bool = False) -> None:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

    jwt = await _get_jwt(base_url)
    if not jwt:
        logger.error("Cannot authenticate — set OPENWEBUI_ADMIN_PASSWORD or OPENWEBUI_API_KEY")
        return

    os.environ["_OWUI_JWT"] = jwt

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=VIEWPORT,
            color_scheme="dark",
            device_scale_factor=DEVICE_SCALE_FACTOR,
        )
        page = await context.new_page()

        await page.goto(f"{base_url}", wait_until="networkidle")
        await page.evaluate(f"localStorage.setItem('token', '{jwt}')")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(3000)

        await capture_fault_diagnosis(page, base_url)
        await capture_cmms_integration(page, base_url, atlas_direct=atlas_direct)
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
    parser.add_argument(
        "--atlas-direct",
        action="store_true",
        help="Also capture Atlas UI panels into cmms-atlas-*.webp (for /feature/cmms-integration).",
    )
    args = parser.parse_args()
    asyncio.run(main(args.base_url, atlas_direct=args.atlas_direct))
