/**
 * Fidelity-harness Playwright config (ADR-0038, PRD 2026-10-14, #4439).
 *
 * Local-only: not referenced by any workflow, and the default
 * playwright.config.ts only collects tests/e2e. Run it explicitly:
 *   npx playwright test --config tests/fidelity/playwright.fidelity.config.ts
 *
 * Boots `next dev` (basePath /hub) with a THROWAWAY AUTH_SECRET minted per
 * run, so the session cookie the spec mints is only valid against this
 * process. Never point this at a staging/prod secret.
 */
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Set once in the runner process; workers inherit the env, so the spec's
// cookie and the dev server share one secret. Never read from Doppler.
process.env.FIDELITY_AUTH_SECRET ||= randomBytes(32).toString("hex");
const PORT = Number(process.env.FIDELITY_PORT ?? 3999);

export default defineConfig({
  testDir: ".",
  testMatch: ["fidelity.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    cwd: "../..",
    url: `http://localhost:${PORT}/hub/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      AUTH_SECRET: process.env.FIDELITY_AUTH_SECRET,
      NEXTAUTH_SECRET: process.env.FIDELITY_AUTH_SECRET,
      NEXTAUTH_URL: `http://localhost:${PORT}/hub`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
