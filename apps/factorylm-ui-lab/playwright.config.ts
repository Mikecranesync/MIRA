import { defineConfig } from "playwright/test";

// Browser proof for the disconnected lab. The web server is the STATIC
// preview of dist/ (no dev server, no HMR), so the CSP in index.html is
// exercised exactly as a static host would ship it. Everything binds to
// 127.0.0.1 so the specs can assert that no request leaves the loopback.
const PORT = 4174;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["junit", { outputFile: "test-results/e2e-junit.xml" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `PORT=${PORT} bun scripts/preview.ts`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
