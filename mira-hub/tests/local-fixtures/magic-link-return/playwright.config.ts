import { defineConfig, devices } from "@playwright/test";

/**
 * #5753 magic-link return browser test. LOCAL ONLY, TEST ONLY: it lives outside
 * tests/e2e, whose default config targets production, so the default suite never
 * collects it. It sits next to the spec, inside the test tree, not at the module root. Run it through its runner, which starts the disposable database,
 * the local Hub and the mail capture, then calls this config:
 *   cd mira-hub && bash tests/local-fixtures/magic-link-return/run.sh
 * There is no baseURL and no webServer: every URL in the spec is absolute and
 * loopback-only, and the runner owns the server.
 */
export default defineConfig({
  testDir: ".",
  testMatch: ["browser-isolation.spec.ts", "magic-link-return.spec.ts"],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: { screenshot: "only-on-failure", video: "off", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
