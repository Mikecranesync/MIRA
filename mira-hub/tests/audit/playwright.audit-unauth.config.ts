import { defineConfig, devices } from "@playwright/test";

/**
 * Unauthenticated audit config — no setup project, no storageState.
 * Runs only the unauth spec so we don't pull credentials.
 */
export default defineConfig({
  testDir: "../e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "https://app.factorylm.com",
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  projects: [
    {
      name: "audit-unauth",
      testMatch: /audit-2026-05-17-unauth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
