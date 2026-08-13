/**
 * Self-contained Playwright config for the Equipment Notebook end-to-end loop
 * and visual-regression baselines.
 *
 * Targets a LOCAL production build (default http://127.0.0.1:3130/hub) so the
 * run is deterministic and never touches staging/prod. Credentials are read
 * from env at run time (NOTEBOOK_TEST_EMAIL / NOTEBOOK_TEST_PASSWORD) — never
 * committed, never printed. The auth setup writes storage state to a gitignored
 * path so the loop and visual specs reuse one login.
 *
 * Run:
 *   cd mira-hub
 *   NOTEBOOK_BASE_URL=http://127.0.0.1:3130/hub \
 *   NOTEBOOK_TEST_EMAIL=… NOTEBOOK_TEST_PASSWORD=… \
 *   npx playwright test --config=tests/equipment/playwright.equipment.config.ts
 *
 * Update visual baselines intentionally:
 *   … npx playwright test --config=tests/equipment/playwright.equipment.config.ts --update-snapshots
 */
import { defineConfig, devices } from "@playwright/test";

// Trailing slash is REQUIRED: Playwright joins paths with `new URL(path, base)`,
// which drops the base path for a leading-slash path. With base ".../hub/" and
// relative spec paths ("equipment/"), the /hub prefix is preserved.
const BASE = (process.env.NOTEBOOK_BASE_URL ?? "http://127.0.0.1:3130/hub").replace(/\/?$/, "/");
const STATE = "tests/equipment/.state/notebook.json";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  // outputFolder is resolved relative to this config's dir (testDir "."), so
  // keep it bare — "tests/equipment/.report" would nest as tests/equipment/…
  reporter: [["list"], ["html", { outputFolder: ".report", open: "never" }]],
  // Snapshots differ across OSes; pin to a stable name so CI on Linux and the
  // local Windows run compare like-for-like per project.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{projectName}{ext}",
  use: {
    baseURL: BASE,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Deterministic screenshots.
    launchOptions: { args: ["--force-color-profile=srgb"] },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "loop",
      testMatch: /notebook-loop\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: STATE },
    },
    {
      // The SAME full loop on a phone — the product milestone is a new user on
      // a phone, so the loop must pass at 412×915 with touch, not just desktop.
      name: "loop-mobile",
      testMatch: /notebook-loop\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        storageState: STATE,
      },
    },
    {
      name: "adversarial",
      testMatch: /notebook-adversarial\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: STATE },
    },
    {
      name: "adversarial-mobile",
      testMatch: /notebook-adversarial\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        storageState: STATE,
      },
    },
    {
      name: "visual-desktop",
      testMatch: /notebook-visual\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: STATE },
    },
    {
      name: "visual-tablet",
      testMatch: /notebook-visual\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, storageState: STATE },
    },
    {
      name: "visual-mobile",
      testMatch: /notebook-visual\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        storageState: STATE,
      },
    },
    {
      name: "visual-narrow",
      testMatch: /notebook-visual\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 780 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        storageState: STATE,
      },
    },
  ],
});
