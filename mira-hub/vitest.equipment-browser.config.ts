import { defineConfig } from "vitest/config";
import integration from "./vitest.integration.config";
import { equipmentTestDatabaseUrl } from "./scripts/equipment-test-database.mjs";

const databaseUrl = equipmentTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.MIRA_TEST_DB_CONFIRM);

export default defineConfig({
  ...integration,
  test: {
    ...integration.test,
    env: { ...integration.test?.env, TEST_DATABASE_URL: databaseUrl },
    include: [
      "src/capabilities/equipment-browser/__tests__/http.integration.test.ts",
      "src/capabilities/equipment-browser/__tests__/tenant-read.integration.test.ts",
      "src/capabilities/bench-components/__tests__/store.integration.test.ts",
    ],
    exclude: ["node_modules/**", "tests/e2e/**"],
  },
});
