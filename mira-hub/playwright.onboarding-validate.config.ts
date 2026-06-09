import { defineConfig } from "@playwright/test";

/**
 * Render proof for the onboarding wizard "Train & approve" step (train-before-deploy).
 *
 * Mirrors playwright.command-center.config.ts: boots its own PRODUCTION server
 * (next build && next start) — `next dev` from a cold/foreign .next cache 404s
 * (hub) routes. The spec mints a next-auth JWE cookie with the SAME throwaway
 * AUTH_SECRET this server boots with, and mocks the wizard / assets / agent-status
 * routes via page.route() so the screenshot is deterministic and needs no dev-DB
 * seed. Captures desktop (1440×900) + mobile (412×915) into docs/promo-screenshots/.
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.onboarding-validate.config.ts
 */
const PORT = 3941;
const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "onboarding-validate.spec.ts",
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
