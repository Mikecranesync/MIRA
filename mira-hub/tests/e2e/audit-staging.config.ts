import { defineConfig, devices } from "@playwright/test";

// Staging audit config — runs audit-staging-*.spec.ts files against a staging
// hub (default: SSH-tunnelled to https://app-stg.factorylm.com via
// ssh -L 4101:127.0.0.1:4101 root@165.245.138.91 -N).
//
// Env:
//   E2E_HUB_URL       — base URL of the hub (defaults to http://127.0.0.1:4101)
//   E2E_WEB_URL       — base URL of the marketing site (defaults to http://127.0.0.1:4200)
//   E2E_HUB_EMAIL     — test account email
//   E2E_HUB_PASSWORD  — test account password

export default defineConfig({
  testDir: "./",
  testMatch: ["audit-staging-*.spec.ts"],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-staging" }]],
  use: {
    screenshot: "only-on-failure",
    video: "off",
    trace: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
