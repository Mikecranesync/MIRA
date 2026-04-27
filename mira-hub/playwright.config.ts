import { defineConfig, devices } from "@playwright/test";

// Phase 1: HUB_URL unset → hub at https://app.factorylm.com/hub (current).
// Phase 2: HUB_URL=https://app.factorylm.com → hub serves at root.
export const HUB_URL = process.env.HUB_URL ?? "https://app.factorylm.com/hub";

export default defineConfig({
  testDir: "./tests/e2e",
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
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
