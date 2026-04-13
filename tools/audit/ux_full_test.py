"""Full 16-exchange diagnostic UX test for MIRA chat on app.factorylm.com.

Runs a complete VFD overcurrent fault diagnostic conversation including photo
upload, numbered selections, and follow-up troubleshooting questions.
Captures screenshots at every exchange and writes ux-findings.md + ux-findings.json.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from pathlib import Path

import httpx
from playwright.sync_api import TimeoutError as PWTimeoutError
from playwright.sync_api import sync_playwright

logger = logging.getLogger("mira-ux-test")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------
TARGETS: dict[str, str] = {
    "local": "http://localhost:3010",
    "prod": "https://app.factorylm.com",
}

OUT_DIR = Path(__file__).parent
SHOT_DIR = OUT_DIR / "app-screenshots"
SHOT_DIR.mkdir(parents=True, exist_ok=True)

REPO_ROOT = Path(__file__).parent.parent.parent  # MIRA/

UA = "MIRA-UX-Test/1.0 (full diagnostic flow)"

EMAIL = os.environ.get("AUDIT_EMAIL", "")
PASSWORD = os.environ.get("AUDIT_PASSWORD", "")

# ---------------------------------------------------------------------------
# 16-exchange conversation script
# ---------------------------------------------------------------------------
EXCHANGES = [
    {
        "type": "photo",
        "msg": "What is this equipment?",
        "image": "tests/regime3_nameplate/photos/real/gp_vfd_001.jpg",
        "label": "photo-upload",
    },
    {"type": "select", "msg": "1", "label": "select-1"},
    {
        "type": "text",
        "msg": "The drive is showing an OC overcurrent fault on startup",
        "label": "oc-fault",
    },
    {"type": "select", "msg": "2", "label": "select-2"},
    {
        "type": "text",
        "msg": "It happens every time we try to start the motor",
        "label": "every-start",
    },
    {
        "type": "text",
        "msg": "The motor is a 5HP 460V 3-phase induction motor",
        "label": "motor-specs",
    },
    {"type": "select", "msg": "1", "label": "select-1-again"},
    {
        "type": "text",
        "msg": "We replaced the drive last month, same problem",
        "label": "replaced-drive",
    },
    {
        "type": "text",
        "msg": "What should I check on the wiring?",
        "label": "wiring-question",
    },
    {"type": "select", "msg": "3", "label": "select-3"},
    {"type": "text", "msg": "The cable run is about 200 feet", "label": "cable-length"},
    {
        "type": "text",
        "msg": "We measured 458V at the drive input terminals",
        "label": "voltage-reading",
    },
    {"type": "select", "msg": "option 2", "label": "natural-select"},
    {
        "type": "text",
        "msg": "No, there is no output reactor installed",
        "label": "no-reactor",
    },
    {
        "type": "text",
        "msg": "What are the recommended parameter settings?",
        "label": "param-settings",
    },
    {
        "type": "text",
        "msg": "Can you summarize the diagnosis?",
        "label": "summary",
    },
]

# Selectors — Open WebUI (SvelteKit SPA)
CHAT_INPUT_SELECTORS = [
    "textarea#chat-textarea",
    "textarea[placeholder]",
    "div[contenteditable='true']",
    "textarea",
]
RESPONSE_SELECTORS = [
    ".chat-assistant",
    "[class*='assistant']",
    "[data-testid='bot-message']",
    ".prose",
    ".message-content",
    ".response-content",
]
SEND_BTN_SELECTORS = [
    "button[aria-label='Send message']",
    "button[type='submit']",
    "button.send-btn",
]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def get_jwt(base_url: str) -> str:
    """Sign in via Open WebUI REST API and return the JWT bearer token."""
    if not EMAIL or not PASSWORD:
        logger.error("AUDIT_EMAIL and AUDIT_PASSWORD must be set in the environment.")
        sys.exit(1)

    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                f"{base_url}/api/v1/auths/signin",
                json={"email": EMAIL, "password": PASSWORD},
            )
            resp.raise_for_status()
            token = resp.json().get("token", "")
            if not token:
                logger.error("Auth succeeded but no token in response: %s", resp.text[:200])
                sys.exit(1)
            logger.info("Auth OK — token acquired (len=%d)", len(token))
            return token
    except httpx.HTTPStatusError as e:
        logger.error("Auth failed HTTP %s: %s", e.response.status_code, e.response.text[:200])
        sys.exit(1)
    except Exception as e:
        logger.error("Auth request error: %s", e)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Playwright helpers
# ---------------------------------------------------------------------------


def find_selector(page, selectors: list[str], timeout: int = 5000):
    """Return the first selector from the list that resolves on the page."""
    for sel in selectors:
        try:
            el = page.wait_for_selector(sel, timeout=timeout, state="visible")
            if el:
                return sel, el
        except PWTimeoutError:
            continue
    return None, None


def get_last_response_text(page, response_sel: str) -> str:
    """Return the text content of the last assistant message element."""
    els = page.query_selector_all(response_sel)
    if not els:
        return ""
    return (els[-1].inner_text() or "").strip()


def extract_numbered_options(page, response_sel: str, response_text: str) -> list[str]:
    """
    Extract numbered list options from the response.

    Open WebUI renders '1. item' as <ol><li>, so inner_text() strips numbering.
    Try both regex on raw text and direct <li> DOM extraction.
    """
    # Strategy 1: regex on plain text (works if numbering is preserved)
    options = re.findall(r"^\d+[.)]\s+(.+)", response_text, re.MULTILINE)
    if options:
        return options

    # Strategy 2: extract <li> elements from the last assistant message DOM
    try:
        els = page.query_selector_all(response_sel)
        if els:
            last_el = els[-1]
            li_els = last_el.query_selector_all("li")
            if li_els:
                return [(li.inner_text() or "").strip() for li in li_els if li.inner_text()]
    except Exception as e:
        logger.debug("li extraction failed: %s", e)

    return []


def _dismiss_overlays(page) -> None:
    """Dismiss update banners, toasts, and notification overlays that block clicks."""
    for dismiss_sel in [
        "div.absolute.bottom-8.right-8 button",
        "div[class*='bottom-8'][class*='right-8'] button",
        "button[aria-label='Close']",
        "button[aria-label='Dismiss']",
    ]:
        try:
            btn = page.query_selector(dismiss_sel)
            if btn and btn.is_visible():
                btn.click(force=True)
                logger.info("Dismissed overlay: %s", dismiss_sel)
                time.sleep(0.3)
        except Exception:
            pass

    try:
        overlay = page.query_selector("div.absolute.bottom-8.right-8.z-50")
        if overlay and overlay.is_visible():
            overlay.evaluate("el => el.remove()")
            logger.info("Removed blocking overlay via DOM")
    except Exception:
        pass


def send_message(page, input_sel: str, message: str) -> None:
    """Type a message into the chat input and submit it."""
    el = page.query_selector(input_sel)
    if el is None:
        raise RuntimeError(f"Chat input not found with selector: {input_sel}")

    tag = el.evaluate("el => el.tagName.toLowerCase()")
    if tag == "textarea":
        page.fill(input_sel, "")
        page.type(input_sel, message, delay=30)
    else:
        # contenteditable div
        el.click()
        el.evaluate(f"el => {{ el.innerText = {json.dumps(message)}; }}")
        el.dispatch_event("input")

    _dismiss_overlays(page)

    btn_sel, btn = find_selector(page, SEND_BTN_SELECTORS, timeout=2000)
    if btn:
        try:
            btn.click(timeout=5000)
        except PWTimeoutError:
            btn.click(force=True)
    else:
        page.keyboard.press("Enter")


def send_photo_message(page, input_sel: str, message: str, image_path: str) -> bool:
    """
    Upload image via file input, then send with caption text.
    Returns True if image was uploaded via UI, False if fell back to text-only.
    """
    resolved = Path(image_path).resolve()
    if not resolved.exists():
        logger.warning("Image not found: %s — sending text only", resolved)
        send_message(page, input_sel, message)
        return False

    file_input = page.query_selector("input[type='file']")

    if not file_input:
        # Try clicking the + / attach button to reveal the hidden file input
        for plus_sel in [
            "button[aria-label='More']",
            "button[aria-label='Attach files']",
            "button[aria-label='Upload']",
            "button:has(svg.lucide-plus)",
            "button:has(svg.lucide-paperclip)",
            ".chat-input button:first-child",
            "button.chat-input-addon",
        ]:
            try:
                btn = page.query_selector(plus_sel)
                if btn and btn.is_visible():
                    btn.click()
                    time.sleep(0.5)
                    file_input = page.query_selector("input[type='file']")
                    if file_input:
                        logger.info("File input revealed via: %s", plus_sel)
                        break
            except Exception:
                pass

    if file_input:
        try:
            file_input.set_input_files(str(resolved))
            time.sleep(2.5)  # wait for upload + thumbnail preview
            logger.info("Image uploaded via file input: %s", resolved.name)
            uploaded = True
        except Exception as e:
            logger.warning("set_input_files failed (%s) — falling back to text", e)
            uploaded = False
    else:
        logger.warning("Could not locate file input — trying API fallback")
        uploaded = False

    # Send the caption regardless
    send_message(page, input_sel, message)
    return uploaded


def wait_for_new_response(page, response_sel: str, prev_count: int, timeout_ms: int = 45000) -> str:
    """
    Poll until the number of response elements exceeds prev_count and the last
    element is stable (streaming complete). Returns the final response text.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    last_text = ""
    stable_ticks = 0

    while time.monotonic() < deadline:
        els = page.query_selector_all(response_sel)
        current_count = len(els)
        if current_count > prev_count:
            current_text = (els[-1].inner_text() or "").strip()
            if current_text and current_text == last_text:
                stable_ticks += 1
                if stable_ticks >= 3:
                    return current_text
            else:
                last_text = current_text
                stable_ticks = 0
        time.sleep(0.8)

    # Return whatever we have even if not fully stable
    return get_last_response_text(page, response_sel)


def screenshot(page, name: str, full_page: bool = True) -> Path:
    """Take a screenshot and return its path."""
    path = SHOT_DIR / f"{name}.png"
    try:
        page.screenshot(path=str(path), full_page=full_page)
        logger.info("Screenshot: %s", path.name)
    except Exception as e:
        logger.warning("Screenshot failed (%s): %s", name, e)
    return path


def start_new_chat(page) -> None:
    """Click the new chat button in the sidebar to start a clean conversation."""
    new_chat_selectors = [
        "button[aria-label='New chat']",
        "button[aria-label='New Chat']",
        "a[aria-label='New chat']",
        "button:has(svg.lucide-square-pen)",
        "button:has(svg.lucide-edit)",
        "nav button:first-child",
    ]
    for sel in new_chat_selectors:
        try:
            btn = page.query_selector(sel)
            if btn and btn.is_visible():
                btn.click()
                time.sleep(1.5)
                logger.info("Started new chat via: %s", sel)
                return
        except Exception:
            pass

    # Fallback: navigate to root which opens a new chat
    logger.warning("New chat button not found — reloading root URL")
    try:
        page.goto(page.url.split("/#")[0].split("/c/")[0], timeout=15000)
        time.sleep(1.5)
    except Exception as e:
        logger.warning("Root reload failed: %s", e)


# ---------------------------------------------------------------------------
# Main test flow
# ---------------------------------------------------------------------------


def run_ux_test(base_url: str, headless: bool) -> dict:
    """Execute all 16 exchanges and return structured findings."""
    logger.info("Target: %s  headless=%s", base_url, headless)

    token = get_jwt(base_url)

    findings: dict = {
        "target": base_url,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "auth_ok": True,
        "exchanges": [],
        "errors": [],
        "summary": {},
    }

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        ctx = browser.new_context(
            user_agent=UA,
            viewport={"width": 1280, "height": 900},
            extra_http_headers={"Authorization": f"Bearer {token}"},
        )
        page = ctx.new_page()

        console_errors: list[str] = []

        def on_console(msg):
            if msg.type in ("error", "warning"):
                console_errors.append(f"[{msg.type}] {msg.text[:200]}")

        page.on("console", on_console)

        # ------------------------------------------------------------------
        # Load UI
        # ------------------------------------------------------------------
        logger.info("Loading chat UI...")
        try:
            page.goto(base_url, timeout=30000, wait_until="networkidle")
        except PWTimeoutError:
            logger.warning("networkidle timed out — continuing anyway")

        if "/auth" in page.url or "/login" in page.url:
            logger.info("Redirected to login — filling credentials")
            try:
                page.fill("input[type='email']", EMAIL, timeout=10000)
                page.fill("input[type='password']", PASSWORD, timeout=5000)
                page.keyboard.press("Enter")
                page.wait_for_url(lambda u: "/auth" not in u and "/login" not in u, timeout=15000)
                logger.info("UI login succeeded")
            except Exception as e:
                findings["errors"].append(f"UI login failed: {e}")
                logger.error("UI login failed: %s", e)

        screenshot(page, "ux-00-initial-load")

        time.sleep(1)
        _dismiss_overlays(page)

        # Start a fresh chat to clear any prior conversation state
        start_new_chat(page)
        time.sleep(0.5)
        _dismiss_overlays(page)
        screenshot(page, "ux-00b-new-chat")

        # ------------------------------------------------------------------
        # Locate chat input
        # ------------------------------------------------------------------
        input_sel, _ = find_selector(page, CHAT_INPUT_SELECTORS, timeout=15000)
        if not input_sel:
            findings["errors"].append("Could not locate chat input — aborting")
            logger.error("Chat input not found. Aborting.")
            screenshot(page, "ux-error-no-input")
            browser.close()
            return findings

        logger.info("Chat input: %s", input_sel)

        # Locate response selector
        response_sel = RESPONSE_SELECTORS[0]
        for sel in RESPONSE_SELECTORS:
            els = page.query_selector_all(sel)
            if els:
                response_sel = sel
                logger.info("Response selector: %s (%d existing)", sel, len(els))
                break

        # ------------------------------------------------------------------
        # Execute all 16 exchanges
        # ------------------------------------------------------------------
        for idx, exchange in enumerate(EXCHANGES):
            ex_num = idx + 1
            label = exchange["label"]
            shot_name = f"ux-{ex_num:02d}-{label}"

            logger.info(
                "--- Exchange %d/%d [%s] type=%s ---",
                ex_num,
                len(EXCHANGES),
                label,
                exchange["type"],
            )

            prev_count = len(page.query_selector_all(response_sel))
            t0 = time.monotonic()
            image_uploaded = False

            try:
                _dismiss_overlays(page)

                if exchange["type"] == "photo":
                    image_path = str(REPO_ROOT / exchange["image"])
                    image_uploaded = send_photo_message(
                        page, input_sel, exchange["msg"], image_path
                    )
                    # Vision inference is slower — extend timeout
                    timeout_ms = 90000
                else:
                    send_message(page, input_sel, exchange["msg"])
                    timeout_ms = 45000

            except Exception as e:
                err_msg = f"Exchange {ex_num} send failed: {e}"
                findings["errors"].append(err_msg)
                logger.error(err_msg)
                screenshot(page, f"ux-error-{ex_num:02d}-send-failed")
                # Record the failed exchange and continue
                findings["exchanges"].append(
                    {
                        "exchange": ex_num,
                        "type": exchange["type"],
                        "label": label,
                        "sent": exchange["msg"],
                        "image_uploaded": image_uploaded,
                        "response": "",
                        "response_chars": 0,
                        "latency_s": round(time.monotonic() - t0, 2),
                        "numbered_options_detected": False,
                        "options_count": 0,
                        "options_list": [],
                        "screenshot": f"{shot_name}.png",
                        "error": str(e),
                    }
                )
                continue

            # Wait for response
            try:
                response_text = wait_for_new_response(
                    page, response_sel, prev_count, timeout_ms=timeout_ms
                )
            except Exception as e:
                err_msg = f"Exchange {ex_num} wait_for_response failed: {e}"
                findings["errors"].append(err_msg)
                logger.error(err_msg)
                response_text = get_last_response_text(page, response_sel)

            latency_s = round(time.monotonic() - t0, 2)

            # Extract numbered options
            options = extract_numbered_options(page, response_sel, response_text)
            numbered_detected = len(options) > 0

            logger.info(
                "Exchange %d done: %.1fs, %d chars, options=%d",
                ex_num,
                latency_s,
                len(response_text),
                len(options),
            )

            screenshot(page, shot_name)

            sent_label = (
                f"[PHOTO] {exchange['msg']}" if exchange["type"] == "photo" else exchange["msg"]
            )

            findings["exchanges"].append(
                {
                    "exchange": ex_num,
                    "type": exchange["type"],
                    "label": label,
                    "sent": sent_label,
                    "image_uploaded": image_uploaded,
                    "response": response_text[:800],
                    "response_chars": len(response_text),
                    "latency_s": latency_s,
                    "numbered_options_detected": numbered_detected,
                    "options_count": len(options),
                    "options_list": options[:10],
                    "screenshot": f"{shot_name}.png",
                }
            )

        # ------------------------------------------------------------------
        # Full-thread final screenshot
        # ------------------------------------------------------------------
        try:
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.3)
        except Exception:
            pass
        screenshot(page, "ux-17-full-thread")

        findings["console_errors"] = console_errors[-30:]
        browser.close()

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    completed = findings["exchanges"]
    photo_ex = next((e for e in completed if e["type"] == "photo"), None)
    select_exchanges = [e for e in completed if e["type"] == "select"]
    select_resolved = sum(1 for e in select_exchanges if e.get("response_chars", 0) > 50)
    avg_latency = (
        round(sum(e["latency_s"] for e in completed) / len(completed), 2) if completed else 0.0
    )
    # Context preserved: last exchange should mention something from earlier in
    # the conversation (drive, motor, OC) — simple heuristic
    last_response = completed[-1]["response"].lower() if completed else ""
    context_preserved = any(
        kw in last_response for kw in ["drive", "motor", "overcurrent", "oc", "vfd", "fault"]
    )

    findings["summary"] = {
        "total_exchanges": len(completed),
        "photo_accepted": photo_ex.get("image_uploaded", False) if photo_ex else False,
        "selections_resolved": select_resolved,
        "selections_total": len(select_exchanges),
        "avg_latency_s": avg_latency,
        "context_preserved": context_preserved,
        "total_errors": len(findings["errors"]),
        "console_error_count": len(findings.get("console_errors", [])),
    }

    return findings


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------


def write_report(findings: dict) -> Path:
    """Write ux-findings.md. Returns the path."""
    report_path = OUT_DIR / "ux-findings.md"
    ts = findings.get("timestamp", "unknown")
    target = findings.get("target", "unknown")
    s = findings.get("summary", {})

    lines = [
        "# MIRA UX Full Diagnostic Test",
        f"\n_Run: {ts}_  \n_Target: {target}_\n",
        "## Summary\n",
        "| Metric | Value |",
        "|---|---|",
        f"| Total exchanges | {s.get('total_exchanges', 0)} |",
        f"| Photo accepted | {s.get('photo_accepted')} |",
        f"| Selections resolved | {s.get('selections_resolved')}/{s.get('selections_total')} |",
        f"| Avg latency | {s.get('avg_latency_s')}s |",
        f"| Context preserved | {s.get('context_preserved')} |",
        f"| Errors | {s.get('total_errors', 0)} |",
        f"| Console errors | {s.get('console_error_count', 0)} |",
        "\n## Exchange Log\n",
    ]

    for ex in findings.get("exchanges", []):
        n = ex["exchange"]
        label = ex.get("label", "")
        shot = ex.get("screenshot", "")
        lines.append(f"### Exchange {n} — {label}")
        lines.append(f"**Sent:** {ex['sent']}  ")
        lines.append(f"**Latency:** {ex['latency_s']}s | **Chars:** {ex['response_chars']}")
        if ex.get("numbered_options_detected"):
            lines.append(f"**Options detected:** {ex['options_count']} items")
        if ex.get("error"):
            lines.append(f"**ERROR:** {ex['error']}")
        if ex.get("response"):
            lines.append("\n**Response:**")
            lines.append(f"> {ex['response'][:600].replace(chr(10), chr(10) + '> ')}")
        if shot:
            lines.append(f"\n![Exchange {n}](app-screenshots/{shot})\n")

    # Errors section
    errors = findings.get("errors", [])
    lines.append(f"\n## Errors ({len(errors)})\n")
    if errors:
        for e in errors:
            lines.append(f"- {e}")
    else:
        lines.append("_None._")

    # Console errors
    console_errors = findings.get("console_errors", [])
    lines.append(f"\n## Browser Console Errors ({len(console_errors)})\n")
    if console_errors:
        for e in console_errors[:20]:
            lines.append(f"- {e}")
    else:
        lines.append("_None._")

    lines.append("\n## UX Observations\n")
    lines.append("_(empty — fill in after reviewing screenshots)_\n")

    lines.append("\n## Screenshots\n")
    for shot in sorted(SHOT_DIR.glob("ux-*.png")):
        lines.append(f"- `{shot.name}` — [view](app-screenshots/{shot.name})")

    report_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("Report written: %s", report_path)
    return report_path


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Full 16-exchange diagnostic UX test for MIRA chat"
    )
    parser.add_argument(
        "--target",
        choices=list(TARGETS.keys()),
        default="prod",
        help="Deployment to test (default: prod)",
    )
    parser.add_argument(
        "--headless",
        dest="headless",
        action="store_true",
        default=True,
        help="Run browser headless (default: True)",
    )
    parser.add_argument(
        "--no-headless",
        dest="headless",
        action="store_false",
        help="Run with visible browser UI (useful for debugging)",
    )
    args = parser.parse_args()

    base_url = TARGETS[args.target]
    findings = run_ux_test(base_url, headless=args.headless)

    json_path = OUT_DIR / "ux-findings.json"
    json_path.write_text(json.dumps(findings, indent=2), encoding="utf-8")
    logger.info("JSON findings: %s", json_path)

    report_path = write_report(findings)

    print(f"\nReport:      {report_path}")
    print(f"JSON:        {json_path}")
    print(f"Screenshots: {SHOT_DIR}")

    s = findings.get("summary", {})
    print(
        f"\nResult: {s.get('total_exchanges', 0)}/16 exchanges, "
        f"{s.get('total_errors', 0)} errors, "
        f"photo={s.get('photo_accepted')}, "
        f"context={s.get('context_preserved')}"
    )

    return 0 if s.get("total_errors", 1) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
