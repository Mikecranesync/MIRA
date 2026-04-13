"""Authenticated UX audit of app.factorylm.com diagnostic conversation."""

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

logger = logging.getLogger("mira-audit-app")
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

UA = "MIRA-Audit/1.0 (authenticated UX audit)"

# Test credentials — supplied via env, never hardcoded
EMAIL = os.environ.get("AUDIT_EMAIL", "")
PASSWORD = os.environ.get("AUDIT_PASSWORD", "")

# Conversation under test
DIAGNOSTIC_PROMPT = "GS10 VFD showing OC fault on startup"
SELECTION_PROMPT = "2"
FOLLOWUP_PROMPT = "2 again, can you explain more?"

# Selectors — Open WebUI (SvelteKit SPA)
# These are tried in order; first match wins.
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


def has_numbered_options(text: str) -> bool:
    """Detect lines like '1. ...' or '1) ...' in response text."""
    return bool(re.search(r"^\d+[.)]\s", text, re.MULTILINE))


def _dismiss_overlays(page) -> None:
    """Dismiss update banners, toasts, and notification overlays that block clicks."""
    # Open WebUI update banner — bottom-right z-50 overlay
    for dismiss_sel in [
        "div.absolute.bottom-8.right-8 button",  # close button on update toast
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

    # Click any remaining blocking overlay away
    try:
        overlay = page.query_selector("div.absolute.bottom-8.right-8.z-50")
        if overlay and overlay.is_visible():
            overlay.evaluate("el => el.remove()")
            logger.info("Removed blocking overlay via DOM")
    except Exception:
        pass


def send_message(page, input_sel: str, message: str) -> None:
    """Type a message into the chat input and submit it."""
    page.fill(input_sel, message) if "textarea" in input_sel else None

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

    # Dismiss any overlays (update banner, notifications) before clicking send
    _dismiss_overlays(page)

    # Press Enter or click Send button
    btn_sel, btn = find_selector(page, SEND_BTN_SELECTORS, timeout=2000)
    if btn:
        try:
            btn.click(timeout=5000)
        except PWTimeoutError:
            # Overlay still blocking — force click
            btn.click(force=True)
    else:
        page.keyboard.press("Enter")


def wait_for_new_response(page, response_sel: str, prev_count: int, timeout_ms: int = 45000) -> str:
    """
    Poll until the number of response elements exceeds prev_count
    and the last element appears stable (not still streaming).
    Returns the text of the final response.
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


def screenshot(page, name: str) -> Path:
    """Take a full-page screenshot and return its path."""
    path = SHOT_DIR / f"{name}.png"
    try:
        page.screenshot(path=str(path), full_page=True)
        logger.info("Screenshot saved: %s", path.name)
    except Exception as e:
        logger.warning("Screenshot failed (%s): %s", name, e)
    return path


# ---------------------------------------------------------------------------
# Main audit flow
# ---------------------------------------------------------------------------


def run_audit(base_url: str, headless: bool) -> dict:
    """Execute the full authenticated conversation audit. Returns findings dict."""
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
        # Step 1 — Load the chat UI
        # ------------------------------------------------------------------
        logger.info("Loading chat UI...")
        try:
            page.goto(base_url, timeout=30000, wait_until="networkidle")
        except PWTimeoutError:
            logger.warning("networkidle timed out — continuing anyway")

        # Handle possible redirect to /auth login page
        if "/auth" in page.url or "/login" in page.url:
            logger.info("Redirected to login page — filling credentials")
            try:
                page.fill("input[type='email']", EMAIL, timeout=10000)
                page.fill("input[type='password']", PASSWORD, timeout=5000)
                page.keyboard.press("Enter")
                page.wait_for_url(lambda u: "/auth" not in u and "/login" not in u, timeout=15000)
                logger.info("Login via UI succeeded")
            except Exception as e:
                findings["errors"].append(f"UI login failed: {e}")
                logger.error("UI login failed: %s", e)

        screenshot(page, "01-initial-load")

        # Dismiss any startup overlays (update banners, etc.)
        time.sleep(1)
        _dismiss_overlays(page)

        # ------------------------------------------------------------------
        # Step 2 — Locate chat input
        # ------------------------------------------------------------------
        input_sel, _ = find_selector(page, CHAT_INPUT_SELECTORS, timeout=15000)
        if not input_sel:
            findings["errors"].append("Could not locate chat input — aborting")
            logger.error("Chat input not found. Aborting.")
            screenshot(page, "error-no-input")
            browser.close()
            return findings

        logger.info("Chat input found: %s", input_sel)

        # ------------------------------------------------------------------
        # Step 3 — Locate response selector (baseline: 0 responses)
        # ------------------------------------------------------------------
        # Determine which response selector works by trying each
        response_sel = RESPONSE_SELECTORS[0]
        for sel in RESPONSE_SELECTORS:
            els = page.query_selector_all(sel)
            if els:
                response_sel = sel
                logger.info("Response selector: %s (%d existing elements)", sel, len(els))
                break

        # ------------------------------------------------------------------
        # Step 4 — Model selection (if needed)
        # ------------------------------------------------------------------
        logger.info("Checking model selector...")
        model_sel_candidates = [
            "button[aria-label*='model']",
            "button[aria-label*='Model']",
            ".model-selector",
            "[data-testid='model-selector']",
            "button:has-text('Select a model')",
            "#model-selector",
        ]
        model_btn_sel, model_btn = find_selector(page, model_sel_candidates, timeout=3000)
        if model_btn:
            current_model = (model_btn.inner_text() or "").strip()
            logger.info("Current model label: %r", current_model)
            if "mira" not in current_model.lower() and "diagnostic" not in current_model.lower():
                try:
                    model_btn.click()
                    time.sleep(0.5)
                    # Look for MIRA Diagnostic option
                    mira_option = page.locator(
                        "li:has-text('MIRA'), option:has-text('MIRA'), "
                        "[role='option']:has-text('MIRA'), "
                        "li:has-text('mira-diagnostic')"
                    ).first
                    if mira_option.count():
                        mira_option.click()
                        logger.info("Switched to MIRA Diagnostic model")
                        time.sleep(0.5)
                    else:
                        logger.warning("MIRA Diagnostic option not visible in dropdown")
                        page.keyboard.press("Escape")
                except Exception as e:
                    logger.warning("Model selection failed: %s", e)
                    findings["errors"].append(f"Model selection: {e}")
        else:
            logger.info("No model selector found — using default model")

        screenshot(page, "02-before-first-message")

        # ------------------------------------------------------------------
        # Step 5 — Exchange 1: Diagnostic prompt
        # ------------------------------------------------------------------
        logger.info("Sending: %r", DIAGNOSTIC_PROMPT)
        prev_count = len(page.query_selector_all(response_sel))
        t0 = time.monotonic()
        try:
            send_message(page, input_sel, DIAGNOSTIC_PROMPT)
        except Exception as e:
            findings["errors"].append(f"Send msg 1 failed: {e}")
            logger.error("Send failed: %s", e)
            browser.close()
            return findings

        response1 = wait_for_new_response(page, response_sel, prev_count, timeout_ms=45000)
        latency1 = round(time.monotonic() - t0, 2)
        options_detected = has_numbered_options(response1)

        logger.info("Response 1 received (%.1fs, %d chars)", latency1, len(response1))
        logger.info("Numbered options detected: %s", options_detected)

        screenshot(page, "03-response-1")

        ex1 = {
            "exchange": 1,
            "sent": DIAGNOSTIC_PROMPT,
            "received": response1[:800],
            "latency_s": latency1,
            "options_detected": options_detected,
            "char_count": len(response1),
        }
        findings["exchanges"].append(ex1)

        # ------------------------------------------------------------------
        # Step 6 — Exchange 2: Numeric selection
        # ------------------------------------------------------------------
        logger.info("Sending selection: %r", SELECTION_PROMPT)
        prev_count = len(page.query_selector_all(response_sel))
        t0 = time.monotonic()
        try:
            send_message(page, input_sel, SELECTION_PROMPT)
        except Exception as e:
            findings["errors"].append(f"Send msg 2 failed: {e}")
            logger.error("Send failed: %s", e)

        response2 = wait_for_new_response(page, response_sel, prev_count, timeout_ms=45000)
        latency2 = round(time.monotonic() - t0, 2)

        logger.info("Response 2 received (%.1fs, %d chars)", latency2, len(response2))

        screenshot(page, "04-response-2")

        ex2 = {
            "exchange": 2,
            "sent": SELECTION_PROMPT,
            "received": response2[:800],
            "latency_s": latency2,
            "options_detected": has_numbered_options(response2),
            "char_count": len(response2),
        }
        findings["exchanges"].append(ex2)

        # ------------------------------------------------------------------
        # Step 7 — Exchange 3: Natural follow-up + contextuality check
        # ------------------------------------------------------------------
        logger.info("Sending follow-up: %r", FOLLOWUP_PROMPT)
        prev_count = len(page.query_selector_all(response_sel))
        t0 = time.monotonic()
        try:
            send_message(page, input_sel, FOLLOWUP_PROMPT)
        except Exception as e:
            findings["errors"].append(f"Send msg 3 failed: {e}")
            logger.error("Send failed: %s", e)

        response3 = wait_for_new_response(page, response_sel, prev_count, timeout_ms=45000)
        latency3 = round(time.monotonic() - t0, 2)

        # Contextuality: response 3 should NOT repeat the exact same numbered options as response 1,
        # and should NOT read like a cold-start greeting (no mention of GS10 or context)
        is_contextual = _check_contextuality(response1, response3)

        logger.info(
            "Response 3 received (%.1fs, %d chars) contextual=%s",
            latency3,
            len(response3),
            is_contextual,
        )

        screenshot(page, "05-response-3-followup")

        ex3 = {
            "exchange": 3,
            "sent": FOLLOWUP_PROMPT,
            "received": response3[:800],
            "latency_s": latency3,
            "options_detected": has_numbered_options(response3),
            "char_count": len(response3),
            "is_contextual": is_contextual,
        }
        findings["exchanges"].append(ex3)

        # ------------------------------------------------------------------
        # Step 8 — Final screenshot of full thread
        # ------------------------------------------------------------------
        screenshot(page, "06-full-thread")
        findings["console_errors"] = console_errors[-30:]

        browser.close()

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    findings["summary"] = {
        "total_exchanges": len(findings["exchanges"]),
        "options_in_first_response": findings["exchanges"][0]["options_detected"]
        if findings["exchanges"]
        else False,
        "avg_latency_s": round(
            sum(e["latency_s"] for e in findings["exchanges"]) / max(len(findings["exchanges"]), 1),
            2,
        ),
        "follow_up_contextual": findings["exchanges"][2]["is_contextual"]
        if len(findings["exchanges"]) >= 3
        else None,
        "total_errors": len(findings["errors"]),
        "console_error_count": len(findings.get("console_errors", [])),
    }

    return findings


def _check_contextuality(response1: str, response3: str) -> bool:
    """
    Heuristic: response 3 is contextual if it does NOT look like a cold-start restart.
    We check that it doesn't re-present the same top-level numbered list from response 1
    AND that it contains some content (not empty / error).
    """
    if not response3.strip():
        return False

    # Extract numbered items from response1
    items1 = set(re.findall(r"^\d+[.)]\s+(.+)", response1, re.MULTILINE))
    items3 = set(re.findall(r"^\d+[.)]\s+(.+)", response3, re.MULTILINE))

    # If > 80% of response1 items appear verbatim in response3, it's likely a restart
    if items1 and len(items1 & items3) / len(items1) > 0.8:
        return False

    # Response 3 should be non-trivial
    return len(response3.strip()) > 50


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------


def write_report(findings: dict) -> Path:
    """Write a markdown findings report. Returns the path."""
    report_path = OUT_DIR / "app-findings.md"
    ts = findings.get("timestamp", "unknown")
    target = findings.get("target", "unknown")
    summary = findings.get("summary", {})

    lines = [
        "# MIRA App — Authenticated UX Audit",
        f"\n_Run: {ts}_  \n_Target: {target}_\n",
        "## Summary\n",
        "| Metric | Value |",
        "|---|---|",
        f"| Exchanges completed | {summary.get('total_exchanges', 0)} |",
        f"| Auth success | {findings.get('auth_ok', False)} |",
        f"| Options in first response | {summary.get('options_in_first_response')} |",
        f"| Avg response latency | {summary.get('avg_latency_s')}s |",
        f"| Follow-up contextual | {summary.get('follow_up_contextual')} |",
        f"| Errors | {summary.get('total_errors', 0)} |",
        f"| Console errors | {summary.get('console_error_count', 0)} |",
        "\n## Conversation Exchanges\n",
    ]

    for ex in findings.get("exchanges", []):
        n = ex["exchange"]
        lines.append(f"### Exchange {n}")
        lines.append(f"**Sent:** `{ex['sent']}`  ")
        lines.append(f"**Latency:** {ex['latency_s']}s | **Chars:** {ex['char_count']}")
        if "options_detected" in ex:
            lines.append(f"**Numbered options detected:** {ex['options_detected']}")
        if "is_contextual" in ex:
            lines.append(f"**Context carried forward:** {ex['is_contextual']}")
        lines.append("\n**Response preview:**")
        lines.append(f"```\n{ex['received'][:600]}\n```")
        shot_name = {1: "03-response-1", 2: "04-response-2", 3: "05-response-3-followup"}.get(n)
        if shot_name:
            lines.append(f"\n![Exchange {n}](app-screenshots/{shot_name}.png)\n")

    # Errors
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

    lines.append("\n## Screenshots\n")
    for shot in sorted(SHOT_DIR.glob("*.png")):
        lines.append(f"- `{shot.name}` — [{shot.name}](app-screenshots/{shot.name})")

    report_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("Report written: %s", report_path)
    return report_path


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Authenticated UX audit of MIRA chat interface")
    parser.add_argument(
        "--target",
        choices=list(TARGETS.keys()),
        default="prod",
        help="Which deployment to audit (default: prod)",
    )
    parser.add_argument(
        "--headless",
        dest="headless",
        action="store_true",
        default=True,
        help="Run browser in headless mode (default: True)",
    )
    parser.add_argument(
        "--no-headless",
        dest="headless",
        action="store_false",
        help="Run browser with visible UI (useful for debugging)",
    )
    args = parser.parse_args()

    base_url = TARGETS[args.target]
    findings = run_audit(base_url, headless=args.headless)

    # Write JSON
    json_path = OUT_DIR / "app-findings.json"
    json_path.write_text(json.dumps(findings, indent=2), encoding="utf-8")
    logger.info("JSON findings: %s", json_path)

    report_path = write_report(findings)

    print(f"\nReport:      {report_path}")
    print(f"JSON:        {json_path}")
    print(f"Screenshots: {SHOT_DIR}")

    summary = findings.get("summary", {})
    print(
        f"\nResult: {summary.get('total_exchanges', 0)} exchanges completed, "
        f"{summary.get('total_errors', 0)} errors, "
        f"contextual={summary.get('follow_up_contextual')}"
    )

    return 0 if summary.get("total_errors", 1) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
