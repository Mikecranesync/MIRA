/**
 * Equipment-first navigation — default-off feature flag.
 *
 * Read at call time, never at module load, so a test (or a runtime change)
 * that sets the variable is honoured without re-importing this module.
 * Off (unset, empty, anything but "1"/"true") ⇒ the equipment-browser routes
 * answer 404 and the Hub mounts no navigator.
 */
export const EQUIPMENT_NAV_FLAG = "MIRA_EQUIPMENT_NAV";

export function equipmentNavEnabled(): boolean {
  const v = process.env[EQUIPMENT_NAV_FLAG];
  return v === "1" || v === "true";
}
