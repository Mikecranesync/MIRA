import { defineConfig } from "@playwright/test";

/**
 * Self-contained render proof for the (hub)/command-center page.
 *
 * Boots its own PRODUCTION server (next build && next start) — `next dev` from a
 * cold/foreign .next cache 404s every (hub) route (see project memory:
 * concurrent-writers), so we always screenshot the prod build.
 *
 * Auth: the spec mints a next-auth JWE session cookie directly (Hub local-e2e
 * recipe, PR #1589) using the SAME throwaway AUTH_SECRET this server starts with,
 * so the (hub) middleware decrypts it and lets us in — no real login, no prod
 * traffic. The tree fetch is mocked in-spec so the green dot is deterministic and
 * independent of dev-DB seed state / Node-RED being up.
 *
 * DATABASE_URL etc. come from `doppler run -p factorylm -c dev` (the (hub) layout
 * SSR may touch the dev DB); AUTH_SECRET is force-overridden to the test value so
 * the minted cookie matches.
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.command-center.config.ts
 */
const PORT = 3940;
const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "command-center.spec.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      `env NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' NODE_ENV=production ./node_modules/.bin/next build && ` +
      `env NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' AUTH_SECRET='${AUTH_SECRET}' NODE_ENV=production ./node_modules/.bin/next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: true,
  },
});
