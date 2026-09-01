import { defineConfig } from "vitest/config";
import path from "path";

// The full adversarial soak tier only. Deliberately separate from
// vitest.config.ts, which excludes *.soak.test.ts from the PR path.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.soak.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 600_000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
