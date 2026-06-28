/**
 * Ignition Perspective display health evaluator.
 *
 * WHY THIS EXISTS
 * ---------------
 * Ignition's Perspective client ALWAYS renders a "No Connection to Gateway"
 * overlay in the DOM — it's the built-in WebSocket initialisation status
 * indicator. When the WebSocket connects, Ignition hides the overlay visually
 * (via CSS class change) but the DOM element stays. A naive accessibility
 * snapshot therefore ALWAYS includes that text, even when the gateway is live
 * and showing real OPC tag values. Issue #2064.
 *
 * TRUE CONNECTION STATE must be determined by one of:
 *   (a) the overlay is no longer VISIBLE (computed style display/visibility)
 *   (b) live tag value text is present (Hz, Vdc bus, E-STOP, etc.)
 *   (c) a "Connected: <hostname>" footer string is rendered
 *
 * This helper encodes that logic for use in Playwright tests and by Hermes
 * when it evaluates a ConvSimpleLive or any Ignition Perspective screen.
 *
 * USAGE
 * -----
 * import { evaluateIgnitionDisplay } from "./ignition-display-health";
 *
 * const result = await evaluateIgnitionDisplay(page, displayUrl);
 * // result.connected  → true / false / "timeout"
 * // result.liveValues → the live tag strings found, or []
 * // result.gateway    → "Ignition-LAPTOP-0KA3C70H" or null
 */

import type { Page } from "@playwright/test";

export interface IgnitionDisplayHealth {
  /**
   * "connected"  — WS settled, live values visible, or "Connected:" footer present.
   * "disconnected" — overlay visible AND no live values found after maxWaitMs.
   * "timeout"    — maxWaitMs elapsed before a definitive signal either way.
   */
  connected: "connected" | "disconnected" | "timeout";
  /** Live tag value strings found in the rendered page text. */
  liveValues: string[];
  /** Gateway hostname from the "Connected: <host>" footer, or null. */
  gateway: string | null;
  /** The full innerText of the page after the wait, for debugging. */
  pageText: string;
}

/**
 * Live-value fingerprints for the ConvSimpleLive bench screen.
 * Extend for other Perspective screens as needed.
 */
const LIVE_VALUE_PATTERNS: RegExp[] = [
  /\d+\.\d+\s*Hz/,    // VFD output frequency
  /\d+\.\d+\s*A/,     // VFD current
  /\d+\.\d+\s*Vdc/,   // DC bus voltage
  /\d+\.\d+\s*V/,     // generic voltage
  /E-STOP[\s:]/,      // E-STOP ARMED / OK
  /MLC[\s:]/,         // main line contactor
  /STOPPED|RUNNING|FAULTED/i,  // drive state
  /COMM\s*OK/i,       // comms status
  /PE-\d+/,           // photo-eye tag
];

const CONNECTED_FOOTER_RE = /Connected:\s*(\S+)/;

/**
 * Evaluate whether an Ignition Perspective screen is truly connected.
 *
 * @param page       Playwright Page (must NOT have navigated to the URL yet)
 * @param url        Full URL of the Perspective client screen
 * @param maxWaitMs  Max milliseconds to wait for the WebSocket to settle
 */
export async function evaluateIgnitionDisplay(
  page: Page,
  url: string,
  { maxWaitMs = 15_000 }: { maxWaitMs?: number } = {},
): Promise<IgnitionDisplayHealth> {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  let wsSettled = false;

  // Strategy 1: wait until the "No Connection to Gateway" overlay is not visible.
  // Ignition hides it by switching a CSS class; checking computedStyle is correct.
  try {
    await page.waitForFunction(
      () => {
        // Ignition renders the overlay as a full-page div with this text.
        // We cannot rely on a stable selector because the class names are hashed
        // in production builds, so we scan by text content instead.
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
        );
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (node.textContent?.includes("No Connection to Gateway")) {
            // Found the text — check whether it is visible.
            let el: Element | null = node.parentElement;
            while (el) {
              const s = window.getComputedStyle(el);
              if (
                s.display === "none" ||
                s.visibility === "hidden" ||
                s.opacity === "0"
              ) {
                // Container is hidden → overlay is hidden → WS connected.
                return true;
              }
              el = el.parentElement;
            }
            // Container is visible → still disconnected.
            return false;
          }
        }
        // Text not found at all → either WS connected (overlay removed) or
        // the page hasn't rendered yet. Return true to stop waiting.
        return true;
      },
      { timeout: maxWaitMs },
    );
    wsSettled = true;
  } catch {
    // waitForFunction timed out — WS didn't settle within maxWaitMs.
    wsSettled = false;
  }

  // Grab the rendered page text for analysis.
  const pageText: string = await page.evaluate(() => document.body.innerText ?? "");

  // Detect live values.
  const liveValues = LIVE_VALUE_PATTERNS
    .filter((re) => re.test(pageText))
    .map((re) => (pageText.match(re) ?? [])[0] ?? re.source);

  // Detect connected footer.
  const footerMatch = pageText.match(CONNECTED_FOOTER_RE);
  const gateway = footerMatch ? footerMatch[1] : null;

  // Determine final status.
  const hasLive = liveValues.length > 0 || gateway !== null;
  let connected: IgnitionDisplayHealth["connected"];

  if (wsSettled || hasLive) {
    connected = "connected";
  } else {
    // Banner was still visible at maxWaitMs and no live values found.
    const bannerVisible = pageText.includes("No Connection to Gateway");
    connected = bannerVisible ? "disconnected" : "timeout";
  }

  return { connected, liveValues, gateway, pageText };
}
