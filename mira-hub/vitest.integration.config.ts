import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration-test config: runs *.integration.test.ts (real Postgres via
// TEST_DATABASE_URL). The default vitest.config.ts excludes these so unit `test`
// stays DB-free; this config includes them. Used by `bun run test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts", "tests/integration/**/*.integration.test.ts"],
    exclude: ["node_modules/**", "tests/e2e/**", "src/capabilities/equipment-browser/**/*.integration.test.ts",
      // Loopback-only recovery suites: run through vitest.turn-recovery.config.ts (npm run test:integration:turn-recovery).
      "src/capabilities/turn-recovery/**/*.integration.test.ts"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
