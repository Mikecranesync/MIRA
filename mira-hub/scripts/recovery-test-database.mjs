/** The turn-recovery profile runs schema-bearing fixtures on an explicit local DB. */
import { equipmentTestDatabaseUrl } from "./equipment-test-database.mjs";

export const RECOVERY_PROFILE = "turn-recovery";

/**
 * Validate BEFORE any connection exists: the profile marker (only vitest.turn-recovery.config.ts
 * sets it, so the shared-dev runner and the default integration config can never reach a suite),
 * the DISPOSABLE confirmation, and a canonical option-free loopback PostgreSQL URL.
 */
export function recoveryTestDatabaseUrl(value = "", confirmation = "", profile = "") {
  if (profile !== RECOVERY_PROFILE) {
    throw new Error("The turn-recovery integration suites run only under the explicit disposable turn-recovery profile (npm run test:integration:turn-recovery).");
  }
  try {
    return equipmentTestDatabaseUrl(value, confirmation);
  } catch (error) {
    // Same canonical checks as the equipment profile, reported under this profile's name.
    throw new Error(String(error instanceof Error ? error.message : error).replace(/equipment-browser/g, "turn-recovery"));
  }
}
