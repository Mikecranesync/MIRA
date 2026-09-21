import { defineConfig, devices } from "@playwright/test";

/**
 * V3 addressable-thread-history proof (#3922): `/v3/?notebook=<id>&thread=<id>`
 * against a LOCAL dev server already running (real dev Neon + real free-tier
 * LLM cascade). No webServer here — the harness starts/owns the server.
 *
 * Run:
 *   cd mira-hub
 *   HUB_URL=http://localhost:3131 npx playwright test \
 *     --config playwright.v3-history.config.ts
 */
export const HUB_URL = process.env.HUB_URL ?? "http://localhost:3131";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "v3-thread-history.spec.ts",
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: HUB_URL,
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
