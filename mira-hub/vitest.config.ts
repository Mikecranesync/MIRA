import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/**/*.integration.test.ts", "tests/e2e/**", "node_modules/**"],
    // Lets worker IPC replies be read between tests; without it a long
    // microtask-only file trips vitest's 60 s onTaskUpdate RPC timeout.
    setupFiles: ["./tests/unit/vitest-macrotask-yield.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
