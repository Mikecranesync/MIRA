/**
 * CV-101 technician journey config (SYNTHETIC TECHNICIAN). STAGING ONLY — staging.ts refuses any
 * other base. The spec launches its own browser per target (desktop / phone emulation / the
 * attached Pixel over CDP), so no `use.browserName` here.
 *
 *   CV_TARGET=desktop doppler run --project factorylm --config stg -- \
 *     npx playwright test --config tests/stranger-walk/playwright.cv101-journey.config.ts
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["cv101-journey.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { actionTimeout: 30_000, navigationTimeout: 60_000 },
});
