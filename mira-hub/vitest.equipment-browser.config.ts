import { defineConfig } from "vitest/config";
import integration from "./vitest.integration.config";

export default defineConfig({
  ...integration,
  test: {
    ...integration.test,
    include: [
      "src/capabilities/equipment-browser/__tests__/http.integration.test.ts",
      "src/capabilities/equipment-browser/__tests__/tenant-read.integration.test.ts",
      "src/capabilities/bench-components/__tests__/store.integration.test.ts",
    ],
    exclude: ["node_modules/**", "tests/e2e/**"],
  },
});
