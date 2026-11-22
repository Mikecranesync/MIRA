import { defineConfig, devices } from "@playwright/test";
import { fixtureOrigin, fixtureWebServer } from "./tests/local-fixtures/harness/fixture-harness.cjs";

/**
 * #5551 Prepare job browser fixture. LOCAL ONLY, TEST ONLY: lives outside tests/e2e (the default
 * config's testDir targets production). The shared harness builds the Hub and serves it on 127.0.0.1
 * with a per-run secret, an allowlisted environment and an egress guard; the spec intercepts every
 * /api request. Fixture proof only, not staging or device acceptance.
 *   cd mira-hub && npx playwright test --config playwright.prepare-job-5551.config.ts
 * One exact origin serves readiness, the auth cookie and navigation: there is no baseURL override and
 * no server reuse (a stale listener would qualify the wrong build). See tests/local-fixtures/harness.
 */
const PORT = 3951; // the spec asserts the same constant
process.env.FIXTURE_PORT = String(PORT);

export default defineConfig({
  testDir: "./tests/local-fixtures",
  testMatch: ["prepare-job-5551.spec.ts", "fixture-attestation.spec.ts"],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: fixtureOrigin(PORT), trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  ],
  webServer: fixtureWebServer(PORT),
});
