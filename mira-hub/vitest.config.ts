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
      // The shared FactoryLM shell is consumed BY PATH, not as an installed
      // dependency (#3806/#3808). Adding mira-hub to the root workspace would
      // have worked, but it pulls the app's entire dependency closure (20 of 56
      // direct runtime deps, incl. next/bcrypt/pg) into the shared-UI licence
      // audit, which is MIT/Apache-only. Aliasing keeps that audit covering
      // exactly what it was written for and changes no policy.
      "@factorylm/interaction": path.resolve(__dirname, "../packages/factorylm-interaction/src"),
      "@factorylm/theme": path.resolve(__dirname, "../packages/factorylm-theme/src"),
      "@factorylm/ui": path.resolve(__dirname, "../packages/factorylm-ui/src"),
    },
  },
});
