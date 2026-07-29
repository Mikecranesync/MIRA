import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Laptop -> Cloud human-like E2E.
 * Full artifacts ON (trace/video/screenshot) — this run is for debugging the whole
 * chain, and the /loop command reads these to diagnose failures.
 * Retries 0 here on purpose: the /mira-e2e-laptop-to-cloud loop owns retry (max 5).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/laptop-to-cloud.spec.ts"],
  globalSetup: "./tests/e2e/laptop-to-cloud.globalSetup.ts",
  globalTeardown: "./tests/e2e/laptop-to-cloud.globalTeardown.ts",
  outputDir: path.join("test-results", "laptop-to-cloud"),
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000, // offline parse + hub round-trips + promote/approve
  reporter: [["list"], ["html", { outputFolder: "test-results/laptop-to-cloud/report", open: "never" }]],
  use: {
    baseURL: process.env.HUB_APP_BASE ?? "https://app.factorylm.com",
    storageState: "tests/e2e/.state/hub.json",
    screenshot: "on",
    video: "on",
    trace: "on",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], acceptDownloads: true },
    },
  ],
});
