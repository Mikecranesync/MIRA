import { defineConfig, devices } from "@playwright/test";

/**
 * #5551 Prepare job browser fixture: boots its own production build; the spec intercepts EVERY
 * /api request (no DB, no provider). Fixture proof only — not staging or device acceptance.
 *   cd mira-hub && npx playwright test --config playwright.prepare-job-5551.config.ts
 * Never reuses a server (a stale listener would qualify the wrong build); the spec itself refuses any
 * non-loopback baseURL (PJ5551_BASE_URL exists only so that refusal can be demonstrated).
 */
const PORT = 3951;
const AUTH_SECRET = "pj-5551-fixed-secret-do-not-use-in-prod";
const ENV = `NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' NODE_ENV=production`;

export default defineConfig({
  testDir: "./tests/local-fixtures",
  testMatch: ["prepare-job-5551.spec.ts"],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.PJ5551_BASE_URL ?? `http://127.0.0.1:${PORT}`, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `env ${ENV} ./node_modules/.bin/next build && env ${ENV} ./node_modules/.bin/next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 600_000,
    reuseExistingServer: false,
  },
});
