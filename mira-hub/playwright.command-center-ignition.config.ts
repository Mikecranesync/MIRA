import { defineConfig } from "@playwright/test";

/**
 * LIVE / un-mocked integration gate for the Command Center → Ignition Perspective display.
 *
 * Unlike playwright.command-center.config.ts (which mocks the tree + framed display),
 * this spec drives the REAL Command Center against the REAL dev DB, a running
 * origin-root proxy (on :8890), and the live Ignition gateway. The frame must render
 * cross-origin through the proxy (XFO stripped), and absolute-path Perspective assets
 * must 200 through the proxy (not 404 on a per-id sub-path proxy).
 *
 * Prerequisites:
 *   - Origin-root proxy running on http://127.0.0.1:8890 (reverse-proxies Ignition + strips X-Frame-Options)
 *   - Ignition gateway reachable at http://100.72.2.99:8088 and responding with state=RUNNING
 *   - ConvSimpleLive display published to /data/perspective/client/ConvSimpleLive
 *   - Dev DB seeded with tenant e88bd0e8-8a84-4e30-9803-c0dc6efb07fe + display_endpoints row
 *
 * The test preflight checks gateway health + proxy client URL reachability (StatusPing,
 * /data/perspective/client/ConvSimpleLive). If either fails or gateway is STARTING,
 * the test skips cleanly (never false-fails on trial restart or proxy down).
 *
 * CSP_FRAME_SRC_DISPLAY_HOSTS MUST include the proxy origin (http://127.0.0.1:8890)
 * so the hub frame-src CSP admits the post-redirect frame URL.
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.command-center-ignition.config.ts
 */
const PORT = 3942;
const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "command-center-ignition-live.spec.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      `env NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' CSP_FRAME_SRC_DISPLAY_HOSTS='http://127.0.0.1:8890' NODE_ENV=production ./node_modules/.bin/next build && ` +
      `env NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' CSP_FRAME_SRC_DISPLAY_HOSTS='http://127.0.0.1:8890' NODE_ENV=production ./node_modules/.bin/next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: true,
  },
});
