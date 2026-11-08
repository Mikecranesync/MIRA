import { defineConfig, devices } from "@playwright/test";

/** #3882 restore-retry proof against a LOCAL dev Hub (see the spec header). */
export default defineConfig({
  testDir: ".",
  testMatch: "v3-restore-list-retry.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.HUB_URL ?? "http://localhost:3131",
    ...devices["Desktop Chrome"],
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  },
});
