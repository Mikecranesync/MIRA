import { defineConfig } from "vitest/config";
import path from "node:path";

// Bake-off harness only (tests/bakeoff). Never part of the unit or integration suites.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/bakeoff/*.bench.ts"],
    testTimeout: 24 * 3600_000,
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
});
