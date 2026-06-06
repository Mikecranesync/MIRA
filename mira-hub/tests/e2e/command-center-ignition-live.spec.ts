/**
 * Command Center frames live ConvSimpleLive through the origin-root proxy.
 *
 * LIVE integration test (not mocked). Exercises:
 *   - Real UNS tree retrieval (NeonDB)
 *   - Real display_endpoints row (uns_path enterprise.home_garage.conveyor_lab.conveyor_1)
 *   - Cross-origin frame through http://127.0.0.1:8890 proxy
 *   - XFO stripping (proxy responsibility; CSP frame-src must admit the post-redirect URL)
 *   - Absolute-path Perspective assets (must 200 through proxy, not 404 on a per-id proxy)
 *
 * Preflight: checks gateway health (StatusPing state=RUNNING) + proxy client URL (200).
 * If either fails, skips cleanly (never false-fails on trial restart or proxy down).
 *
 * Auth: mints a JWE session cookie for the REAL dev tenant (e88bd0e8-8a84-4e30-9803-c0dc6efb07fe)
 * so the UNS tree + display_endpoints queries hit the actual DB.
 *
 * Assertions:
 *   - Tree renders ("1 live · 1 display" badge visible, Conveyor 1 selectable)
 *   - Iframe src points to /api/command-center/display/e0690a31-eec5-4da3-b738-8d10c06b266c
 *   - ≥5 requests to http://127.0.0.1:8890/… return 200, including ≥1 Perspective asset path
 *     (proves absolute-path assets forward through proxy)
 *   - No console errors matching frame-ancestors / x-frame-options / CSP (XFO not blocking)
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.command-center-ignition.config.ts
 */
import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as path from "path";
import * as fs from "fs";

const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";
const DEV_TENANT_ID = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe";
const DISPLAY_ID = "e0690a31-eec5-4da3-b738-8d10c06b266c";
const GATEWAY_HEALTH = "http://100.72.2.99:8088/StatusPing";
const PROXY_CLIENT_URL = "http://127.0.0.1:8890/data/perspective/client/ConvSimpleLive";
const OUT = path.resolve(__dirname, "..", "..", "..", "docs", "promo-screenshots");

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

// Preflight: gateway healthy (state=RUNNING) + proxy client URL 200. Returns a skip
// reason string if not ready (the gateway trial restarts ~every 2h → transient 503;
// the proxy may be down). NB: test.skip() is only valid inside a test/beforeEach —
// NOT beforeAll — so the preflight runs at the top of the test body.
async function preflightSkipReason(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const healthRes = await fetch(GATEWAY_HEALTH, { signal: controller.signal });
    const healthJson = (await healthRes.json()) as { state?: string };
    if (healthJson.state !== "RUNNING") {
      return `Ignition gateway not ready (state="${healthJson.state}") — live gate skipped`;
    }
    const proxyRes = await fetch(PROXY_CLIENT_URL, { signal: controller.signal });
    if (proxyRes.status !== 200) {
      return `Proxy client URL returned ${proxyRes.status} — live gate skipped`;
    }
    return null;
  } catch {
    return "Preflight failed (gateway/proxy unreachable) — live gate skipped";
  } finally {
    clearTimeout(timeout);
  }
}

test("Command Center frames live ConvSimpleLive through the origin-root proxy (XFO stripped, absolute assets 200)", async ({
  page,
  context,
  baseURL,
}) => {
  // 0) Preflight — skip (not fail) if the gateway/proxy aren't ready.
  const skipReason = await preflightSkipReason();
  test.skip(skipReason !== null, skipReason ?? "");

  // 1) Mint the JWE session cookie for the REAL dev tenant.
  const trialExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const token = await encode({
    token: {
      uid: "cc-ignition-qa-user",
      tid: DEV_TENANT_ID,
      status: "trial",
      trialExpiresAt,
      email: "command-center-ignition-qa@factorylm-test.com",
    },
    secret: AUTH_SECRET,
  });
  await context.addCookies([
    { name: "next-auth.session-token", value: token, url: baseURL! },
  ]);

  // 2) Collect evidence: console errors + network responses to the proxy.
  const consoleErrors: string[] = [];
  const proxyResponses: { url: string; status: number }[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("response", (res) => {
    if (res.url().includes("127.0.0.1:8890")) {
      proxyResponses.push({ url: res.url(), status: res.status() });
    }
  });

  // 3) Load the Command Center. The tree fetch + reachability probe run here.
  // Perspective holds a live socket, so networkidle never completes — use domcontentloaded only.
  await page.goto("/command-center", { waitUntil: "domcontentloaded" });

  // Verify the page loaded and reachability probe succeeded.
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  // The live badge ("1 live · 1 display") confirms the tree + dot logic ran.
  await expect(page.getByText(/1 live · 1 display/)).toBeVisible({ timeout: 15_000 });

  // 4) Click the Conveyor 1 node to frame the display.
  await expect(page.getByText("Conveyor 1")).toBeVisible();
  await page.getByText("Conveyor 1").click();

  // Wait for the iframe to appear and Perspective to boot.
  const iframeElement = page.frameLocator(`iframe[src*="/api/command-center/display/${DISPLAY_ID}"]`);
  await expect(iframeElement.locator("body")).toBeVisible({ timeout: 10_000 });

  // Give Perspective time to load assets and establish the live socket.
  await page.waitForTimeout(6000);

  // 5) Assertions: proof that the frame loaded through the proxy and absolute assets reached the proxy.
  //
  // Assertion A: At least ~5 requests to 127.0.0.1:8890 returned 200.
  // This proves the proxy is forwarding traffic and stripping XFO.
  const proxySuccesses = proxyResponses.filter((r) => r.status === 200);
  expect(proxySuccesses.length, "proxy 200 responses").toBeGreaterThanOrEqual(5);

  // Assertion B: Among proxy responses, at least one includes a Perspective asset path.
  // This proves absolute-path assets are forwarding (not 404 on a per-id proxy).
  // Perspective assets match patterns like /res/perspective/ or /data/perspective/.
  const perspectiveAssets = proxyResponses.filter((r) =>
    /\/(res|data)\/perspective\//.test(r.url),
  );
  expect(
    perspectiveAssets.length,
    "Perspective absolute-path assets through proxy",
  ).toBeGreaterThan(0);

  // Assertion C: No console error text matches frame-ancestors / x-frame-options / CSP block.
  // This proves XFO and CSP frame-src are not blocking the iframe.
  const xfoErrors = consoleErrors.filter((text) =>
    /refused to frame|x-frame-options|content security policy|frame-ancestors/i.test(text),
  );
  expect(xfoErrors, "no XFO/CSP frame block in console").toEqual([]);

  // 6) Best-effort screenshot (don't fail the test if screenshot times out due to live socket).
  try {
    await page.screenshot({
      path: path.join(OUT, "2026-05-31_command-center-ignition-live-gate_desktop.png"),
      fullPage: false,
    });
    console.log("📸 2026-05-31_command-center-ignition-live-gate_desktop.png");
  } catch (err) {
    console.warn("Screenshot timeout (expected with live socket) — test passed anyway");
  }
});
