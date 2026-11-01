/**
 * Mission 001 observation state — default-off feature flag.
 *
 * Read at call time, never at module load, so a test (or a runtime change)
 * that sets the variable is honoured without re-importing this module.
 * Off (unset, empty, anything but "1"/"true") ⇒ the routes answer 404 and the
 * chat consumer adds nothing to the prompt.
 */
export const OBSERVATION_STATE_FLAG = "MIRA_OBSERVATION_STATE";

export function observationStateEnabled(): boolean {
  const v = process.env[OBSERVATION_STATE_FLAG];
  return v === "1" || v === "true";
}
