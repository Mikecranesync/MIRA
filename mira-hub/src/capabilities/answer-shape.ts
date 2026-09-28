/**
 * Two answer-shape rules shared by every chat route (2026-09-27, from the
 * weekly scorecard: MIRA's weakest subject was Safety, 2.5/5 vs a plain LLM's
 * 4.2, and some cited answers shipped no source card).
 */

/** Isolation written into the step it belongs to, on every answer — not only
 *  when a hazard keyword fires. One clause at the step, never a lecture. */
export const ISOLATION_STEP_RULE =
  "SAFETY IN THE STEPS: whenever a step opens an enclosure, touches conductors, reaches into " +
  "machinery or releases stored energy (pressure, springs, gravity, capacitors), state the " +
  "isolation and verification condition inline in THAT step — e.g. 'with the drive locked out and " +
  "the DC bus confirmed dead with a meter, check…'. Write the verification without a voltage " +
  "number: a number there reads as a machine rating. One clause per step; no separate safety lecture.";

export function withStepSafety(systemPrompt: string): string {
  return `${systemPrompt}\n\n${ISOLATION_STEP_RULE}`;
}

/** Providers emit their own citation markers ("【2†L3-L4】", "【2】"). Normalize
 *  every form to the [n] the UI and citation selection understand, so a cited
 *  fact always ships its source card (#4032). */
export function normalizeCitationMarkers(text: string): string {
  return text.replace(/【\s*(\d{1,2})\s*(?:†[^】]*)?】/g, "[$1]");
}
