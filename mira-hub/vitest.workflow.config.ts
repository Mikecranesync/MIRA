import { defineConfig } from "vitest/config";
import path from "node:path";

// Explicitly selected disposable WF-01 fixture. Generic unit/integration
// collection must not load these modules or their stricter database guard.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/workflow/*.integration.test.ts"],
    testTimeout: 30000,
    maxWorkers: 1,
    minWorkers: 1,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
