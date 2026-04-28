/**
 * playwright.smoke.config.ts — CI smoke-test configuration (#689)
 *
 * Runs only tests/e2e/smoke.spec.ts against production endpoints.
 * Used by .github/workflows/smoke-test.yml as the deploy gate.
 *
 * Usage:
 *   npx playwright test --config playwright.smoke.config.ts
 *
 * Override targets:
 *   WEB_URL=https://factorylm.com HUB_URL=https://app.factorylm.com \
 *   npx playwright test --config playwright.smoke.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testMatch: ["**/smoke.spec.ts"],
  fullyParallel: false,
  retries: 1,       // one retry absorbs transient network blips; two failures = real breakage
  workers: 1,
  timeout: 30_000,  // per-test timeout
  reporter: [
    ["list"],
    ["github"],     // annotates PR checks with inline failure details on GitHub Actions
  ],
  use: {
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
    // No baseURL — smoke.spec.ts uses absolute URLs from WEB_URL / HUB_URL env vars
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
