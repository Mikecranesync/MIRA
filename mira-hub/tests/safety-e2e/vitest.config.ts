// Separate config so the default `vitest run` (src/**/*.test.ts) never picks
// up the end-to-end safety eval driver; it only runs when invoked explicitly.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/safety-e2e/**/*.e2e.ts"],
    testTimeout: 6 * 60 * 60 * 1000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
    },
  },
});
