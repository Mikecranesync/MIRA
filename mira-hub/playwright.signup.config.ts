/**
 * playwright.signup.config.ts — signup-flow E2E configuration (#108)
 *
 * Runs only tests/e2e/signup-flow.spec.ts against production endpoints.
 * Tests the critical acquisition path: pricing CTA → cmms magic link → hub login.
 *
 * Usage:
 *   npx playwright test --config playwright.signup.config.ts
 *
 * Override targets:
 *   WEB_URL=https://factorylm.com HUB_URL=https://app.factorylm.com \
 *   npx playwright test --config playwright.signup.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testMatch: ["**/signup-flow.spec.ts"],
  fullyParallel: false,
  retries: 1,
  workers: 1,
  timeout: 30_000,
  reporter: [
    ["list"],
    ["github"],
  ],
  use: {
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
    // No baseURL — signup-flow.spec.ts uses absolute URLs from WEB_URL / HUB_URL
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
