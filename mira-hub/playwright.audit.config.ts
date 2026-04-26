import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["ux-audit.spec.ts", "ux-regression.spec.ts"],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/auth-setup.ts",
  use: {
    baseURL: "https://app.factorylm.com",
    screenshot: "off",
    video: "off",
    trace: "off",
    storageState: "playwright/.auth/user.json",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
