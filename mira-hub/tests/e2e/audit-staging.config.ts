import { defineConfig, devices } from "@playwright/test";

/**
 * Standalone config for the 2026-05-19 staging audit.
 *
 * Separate from playwright.config.ts so we don't depend on the audit-setup
 * project + storageState (we log in inside the spec itself, against the
 * staging Hub via SSH tunnel at http://127.0.0.1:4101).
 */
export default defineConfig({
  testDir: ".",
  testMatch: /audit-staging-2026-05-19\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 5 * 60_000,
  use: {
    baseURL: process.env.E2E_HUB_URL ?? "http://127.0.0.1:4101",
    screenshot: "off",
    video: "off",
    trace: "off",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
