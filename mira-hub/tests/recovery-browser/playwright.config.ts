import { defineConfig, devices } from "@playwright/test";
import { writeEnvReport } from "./guards.mjs";

// Local, test-only fixture proof for the native round4 Hub findings. No webServer: tests/recovery-browser/run.mjs
// owns the one server and passes its exact origin in R4_ORIGIN.
const origin = process.env.R4_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("R4_ORIGIN must be one exact loopback origin (run via run.mjs)");

if (process.env.R4_ENV_REPORT) writeEnvReport(process.env.R4_ENV_REPORT); // the Playwright process reports its own environment

export default defineConfig({
  testDir: ".",
  testMatch: "recovery.spec.ts",
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: process.env.R4_RESULTS ?? "results.json" }]],
  use: { baseURL: origin, trace: "off", screenshot: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  ],
});
