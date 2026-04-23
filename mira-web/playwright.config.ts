import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  retries: 0,
  reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3200",
    // Auth token passed as query param — matches mira-web session pattern
    extraHTTPHeaders: {},
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
