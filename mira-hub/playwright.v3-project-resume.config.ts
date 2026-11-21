import { defineConfig, devices } from "@playwright/test";

/**
 * Production-build fixture proof for reopening a project from the sidebar (#4681).
 * Same recipe as playwright.command-center.config.ts: own `next build && next start`,
 * a next-auth JWE minted in the spec with the server's throwaway AUTH_SECRET, and every
 * /api/** request answered inside the spec (no database, no provider, no shared env).
 *
 * Run:
 *   cd mira-hub
 *   npx playwright test --config playwright.v3-project-resume.config.ts
 */
const PORT = 3941;
const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["v3-project-resume.spec.ts", "v3-manual-lookup-handoff.spec.ts"],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command:
      `env NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' NODE_ENV=production ./node_modules/.bin/next build && ` +
      `env NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' NODE_ENV=production ./node_modules/.bin/next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
