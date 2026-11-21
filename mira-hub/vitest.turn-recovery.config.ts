import { defineConfig } from "vitest/config";
import integration from "./vitest.integration.config";
import { RECOVERY_PROFILE, recoveryTestDatabaseUrl } from "./scripts/recovery-test-database.mjs";

// Explicit disposable profile for the three loopback-only recovery suites. The shared-dev
// runner (test:integration:dev) uses vitest.integration.config.ts, which excludes them.
const databaseUrl = recoveryTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.MIRA_TEST_DB_CONFIRM, RECOVERY_PROFILE);

export default defineConfig({
  ...integration,
  test: {
    ...integration.test,
    env: { ...integration.test?.env, TEST_DATABASE_URL: databaseUrl, MIRA_TEST_PROFILE: RECOVERY_PROFILE },
    include: [
      "src/capabilities/turn-recovery/status.integration.test.ts",
      "src/capabilities/turn-recovery/chat.integration.test.ts",
      "src/capabilities/turn-recovery/round2.integration.test.ts",
    ],
    exclude: ["node_modules/**", "tests/e2e/**"],
  },
});
