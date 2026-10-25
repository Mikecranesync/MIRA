/**
 * Fidelity-harness oracle generator config (ADR-0038, #4439).
 *
 * Deliberately NOT collected by the default `vitest run` (root config includes
 * src/** only), so the generator never runs in CI. Run it explicitly:
 *   npx vitest run --config tests/fidelity/vitest.fidelity.config.ts
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/fidelity/**/*.gen.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "../../src") },
  },
});
