/**
 * Stranger Walk Playwright config (#4460). STAGING ONLY — staging.ts refuses
 * any other base. No web server: the walk drives the deployed staging Hub.
 * Not collected by the default playwright.config.ts (tests/e2e only).
 *
 *   doppler run --project factorylm --config stg -- \
 *     npx playwright test --config tests/stranger-walk/playwright.stranger-walk.config.ts
 */
import { defineConfig, devices } from "@playwright/test";
import { stagingBase } from "./staging";

export default defineConfig({
  testDir: ".",
  testMatch: ["walk.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0, // a retry would hide exactly the flakes the repeat run must list
  reporter: [["list"]],
  use: {
    baseURL: stagingBase(),
    serviceWorkers: "block",
    actionTimeout: 30_000, // a missing element is a BROKEN row in 30 s, never a hung run
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
