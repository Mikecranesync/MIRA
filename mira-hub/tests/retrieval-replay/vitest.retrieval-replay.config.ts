/**
 * Retrieval replay pure-function tests. Not collected by the default `vitest run`
 * (root config includes src/** only). Run explicitly:
 *   npx vitest run --config tests/retrieval-replay/vitest.retrieval-replay.config.ts
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node", include: ["tests/retrieval-replay/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
});
