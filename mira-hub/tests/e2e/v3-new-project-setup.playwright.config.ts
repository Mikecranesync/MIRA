import { defineConfig, devices } from "@playwright/test";

/** #4632 New project setup proof against a LOCAL dev Hub (see the spec header). */
export default defineConfig({
  testDir: ".",
  testMatch: "v3-new-project-setup.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"] },
});
