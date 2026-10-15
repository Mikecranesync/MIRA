/**
 * Stranger Walk scorer unit tests (#4460). Not collected by the default
 * `vitest run` (root config includes src/** only). Run explicitly:
 *   npx vitest run --config tests/stranger-walk/vitest.stranger-walk.config.ts
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/stranger-walk/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "../../src") },
  },
});
