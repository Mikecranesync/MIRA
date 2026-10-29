// Guard tests for the e2e safety harness (pin guard, model-id canonicalizer).
// Kept out of the default hub run; invoke explicitly:
//   npx vitest run --config tests/safety-e2e/vitest.guards.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/safety-e2e/**/*.test.ts"],
    testTimeout: 10 * 60 * 1000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
    },
  },
});
