import { defineConfig, devices } from "@playwright/test";

// Self-contained local e2e for the /discovery surface. Unlike playwright.config.ts
// (which targets the deployed hub for audits), this builds + starts the Hub locally
// so the feature can be proven before merge — no prod traffic, no external services.
//
// NEXT_PUBLIC_BASE_PATH="" + NEXT_PUBLIC_API_BASE="" → serve at root (prod shape).
// AUTH_SECRET is a throwaway test value; the spec mints a matching session JWT.

const PORT = 3344;
const AUTH_SECRET = "test-auth-secret-fieldbus-discovery-e2e";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "discovery.spec.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `next build && next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_BASE_PATH: "",
      NEXT_PUBLIC_API_BASE: "",
      AUTH_SECRET,
      NODE_ENV: "production",
    },
  },
});
