import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // *.soak.test.ts is the full 128k+ adversarial tier — excluded from the PR
    // path and run by stream-soak-nightly.yml (vitest.soak.config.ts). The fast
    // deterministic tier (stream-soak.test.ts) still runs on every PR.
    exclude: ["src/**/*.integration.test.ts", "src/**/*.soak.test.ts", "tests/e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
