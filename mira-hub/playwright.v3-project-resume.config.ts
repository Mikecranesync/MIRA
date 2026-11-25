import { defineConfig, devices } from "@playwright/test";
import { fixtureOrigin, fixtureWebServer } from "./tests/local-fixtures/harness/fixture-harness.cjs";

/**
 * Production-build fixture proof for reopening a project from the sidebar (#4681). LOCAL ONLY, TEST
 * ONLY: lives outside tests/e2e. Same shared harness as the Prepare job fixture (#5731 F1/F4): the
 * Hub is served on 127.0.0.1 with a per-run secret, an allowlisted environment (no database or
 * provider credentials, no dotenv) and an egress guard; the spec answers every /api/** request.
 *
 * Run:
 *   cd mira-hub
 *   npx playwright test --config playwright.v3-project-resume.config.ts
 */
const PORT = 3941; // the spec asserts the same constant
process.env.FIXTURE_PORT = String(PORT);

export default defineConfig({
  testDir: "./tests/local-fixtures",
  testMatch: ["v3-project-resume.spec.ts", "v3-manual-lookup-handoff.spec.ts", "fixture-attestation.spec.ts"],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: fixtureOrigin(PORT), trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  ],
  webServer: fixtureWebServer(PORT),
});
