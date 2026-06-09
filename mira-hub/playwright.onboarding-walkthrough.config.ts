import { defineConfig } from "@playwright/test";

/**
 * Full onboarding walkthrough screenshot reel (Company → … → Train & approve).
 * Same self-contained prod-server + minted-JWE + route-mock recipe as
 * playwright.command-center.config.ts / playwright.onboarding-validate.config.ts.
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.onboarding-walkthrough.config.ts
 */
const PORT = 3942;
const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "onboarding-walkthrough.spec.ts",
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
      `env NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' NODE_ENV=production ./node_modules/.bin/next build && ` +
      `env NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' NODE_ENV=production ./node_modules/.bin/next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: true,
  },
});
