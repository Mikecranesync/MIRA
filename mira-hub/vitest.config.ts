import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/**/*.integration.test.ts", "tests/e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@factorylm/interaction": path.resolve(__dirname, "../packages/factorylm-interaction/src/index.ts"),
      "@factorylm/ui": path.resolve(__dirname, "../packages/factorylm-ui/src"),
    },
  },
});
