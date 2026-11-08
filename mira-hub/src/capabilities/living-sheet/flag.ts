/**
 * Living Work Sheet — default-off feature flag.
 *
 * Read at call time, never at module load, so a test (or a runtime change)
 * that sets the variable is honoured without re-importing this module.
 * Off (unset, empty, anything but "1"/"true") ⇒ the routes answer 404.
 * Exactly like capabilities/observations/flag.ts.
 */
export const LIVING_SHEET_FLAG = "NOTEBOOK_LIVING_SHEET";

export function livingSheetEnabled(): boolean {
  const v = process.env[LIVING_SHEET_FLAG];
  return v === "1" || v === "true";
}
