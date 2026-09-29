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
  "number: a number there reads as a machine rating. One clause per step; no separate safety lecture. " +
  // #4122: the rule above said when to isolate and nothing about steps that need
  // power, so the model wrote both conditions into one step ("restore power with
  // the lockout in place", "powered but locked out", "measure the output while it
  // runs" under a lockout clause) — staging, both graders, all 3 isolation reps.
  "A step is EITHER isolated OR energized, never both: never write 'restore power with the lockout " +
  "in place', 're-energize under lockout', or a live reading inside a locked-out step. Absence of " +
  "voltage is verified with the equipment still locked out, using a meter proven on a known source — " +
  "never by re-energizing. If a check genuinely needs power (a live reading, a firmware load, a test " +
  "run), make it its own later step that says the lockout is removed and power restored by a " +
  "qualified person under the site's energized-work procedure; if it can be done de-energized, keep " +
  "it de-energized. " +
  // #4122 slice 2 (staging 9e4bf1f2): the exemption above was stretched to work that
  // never needs power ("tighten only after … power is restored"), and a breaker reset —
  // which applies power — was listed under "With the lockout in place".
  "Tightening, torquing, replacing, cleaning or inspecting are de-energized work: do them locked " +
  "out and never tell the technician to restore power first. Resetting a breaker, re-fitting a fuse " +
  "to see whether it trips, or starting the machine applies power, so it is an energized step — " +
  "never under a lockout heading or inside a locked-out list; it goes in its own later step as above.";

export function withStepSafety(systemPrompt: string): string {
  return `${systemPrompt}\n\n${ISOLATION_STEP_RULE}`;
}

/** Providers emit their own citation markers ("【2†L3-L4】", "【2】"). Normalize
 *  every form to the [n] the UI and citation selection understand, so a cited
 *  fact always ships its source card (#4032). */
export function normalizeCitationMarkers(text: string): string {
  return text.replace(/【\s*(\d{1,2})\s*(?:†[^】]*)?】/g, "[$1]");
}
