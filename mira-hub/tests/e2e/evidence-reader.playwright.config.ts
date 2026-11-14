import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "evidence-reader.spec.ts", workers: 1, retries: 0,
  use: { baseURL: "http://127.0.0.1:4176", channel: "chrome", screenshot: "only-on-failure" },
  webServer: { command: "bun run evidence-fixture/server.mjs", url: "http://127.0.0.1:4176", reuseExistingServer: false },
});
