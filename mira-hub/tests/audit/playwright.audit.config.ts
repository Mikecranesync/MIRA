/**
 * Standalone Playwright config for the deep-crawl audit run.
 *
 * Kept separate from mira-hub/playwright.config.ts so audit-only projects
 * (audit-setup, audit-desktop, audit-mobile) don't pollute the shared config
 * used by the existing 32 e2e specs.
 *
 * Run with:
 *   cd mira-hub
 *   npx playwright test --config=tests/audit/playwright.audit.config.ts \
 *     --project=audit-desktop --project=audit-mobile
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "https://app.factorylm.com",
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
  },
  projects: [
    {
      name: "audit-setup",
      testMatch: /audit-setup\.ts$/,
    },
    {
      name: "audit-desktop",
      testMatch: /audit-.*\.spec\.ts/,
      dependencies: ["audit-setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "tests/e2e/.state/hub.json",
      },
    },
    {
      // Chromium with iPhone 13 viewport + UA — represents Chrome on Android
      // in the field. Avoids WebKit dependency (extra ~200MB browser install).
      name: "audit-mobile",
      testMatch: /audit-.*\.spec\.ts/,
      dependencies: ["audit-setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        storageState: "tests/e2e/.state/hub.json",
      },
    },
  ],
});
