/**
 * #4122 — a step that is both isolated and energized. Two prompt rounds lowered
 * the rate but plateaued (23 -> 13 -> 12 of 35 answers); the #4101 technician
 * review confirmed the harm ("if you tighten it after the power's on that's a
 * dangerous situation"). This deterministic check finds the step and lets the
 * route put the energized-work banner above the full answer (owner rule: safety
 * flags never withhold the answer).
 *
 * A step is a sentence, list item or heading line. A step is flagged when an
 * isolation state (locked out, isolated, de-energized, power off) is in force —
 * stated in the step itself, or opened by a lead-in/heading and not yet closed by
 * a written restore — and the same step needs power: a live voltage/supply/output
 * reading, operating the machine (start, run, press Run, commanded), powering it
 * on, reading a display/LED/fault screen, or resetting a breaker to watch it.
 * Dead checks (absence of voltage, zero, dead, continuity, resistance,
 * insulation) never count as needing power.
 *
 * Measured on 140 blind-labeled answers (step-energy-measure.test.ts).
 */

const ISOLATED =
  /\b(?:lock(?:ed)?[\s-]?out|lockout(?:\/tagout)?|LOTO|isolated|de[\s-]?energi[sz]ed|power(?:ed)?\s+(?:off|down)|with (?:the )?power (?:removed|off))\b/i;
const RESTORE =
  /\b(?:remove (?:the )?lock(?:out)?|lock(?:out)? (?:is )?removed|restore (?:the )?power|power (?:is )?restored|re[\s-]?energi[sz](?:e|es|ed|ing)\b|re-?apply power|reconnect(?:ing)? (?:the )?power|turn (?:the )?power (?:back )?on|power (?:it|the \w+) (?:back )?(?:on|up))\b/i;
const DEAD_CHECK =
  /\b(?:absence of voltage|zero (?:volts|voltage|energy)|0\s?V\b|no voltage|(?:voltage|power) is (?:absent|off|removed)|is de[\s-]?energi[sz]ed|are de[\s-]?energi[sz]ed|is dead|are dead|confirmed dead|verif\w* (?:it is |they are )?dead|continuity|resistance|insulation|megger|open[\s-]circuit|(?:voltage |non-contact )?tester|test meter|test[\s-]lead|(?:low|high)[\s-]voltage)\b/gi;
/** The lockout is taken off in this very step — a correct later energized step. */
const LOCKOUT_REMOVED =
  /\b(?:remov\w* (?:the )?lock[\s-]?out|lock[\s-]?out (?:has been |is )?removed|lock[\s-]?out removal|locked out removed)\b/i;
/** Isolation stated as still in force — contradicts any restore in the same step. */
const STILL_ISOLATED = /\b(?:still (?:locked[\s-]?out|isolated|de[\s-]?energi[sz]ed)|under (?:lock[\s-]?out|LOTO)(?![\s-]*(?:removal|removed))|with the lock[\s-]?out (?:still )?in place)\b/i;
/** "with the VFD powered and the motor terminals isolated" — powered, not isolated. */
const EXPLICITLY_POWERED = /\b(?:with|while) (?:the )?\w+ (?:powered|energi[sz]ed|running)\b/i;
const LIVE_READING =
  /\b(?:measure|check|read|verify|confirm|test)\w*\b[^.;\n]{0,60}?\b(?:voltage|volts|current|amps?|frequency|(?:output|supply)(?! terminals? (?:are|is) tight| wiring| connections?| for (?:proper|loose|open|shorted)))\b/i;
const OPERATE =
  /\b(?:press(?:ing)? (?:the )?(?:start|run)|commanded to run|re-?issue (?:a )?run|run command|start the (?:motor|machine|drive)|power (?:it|the \w+) (?:back )?(?:on|up)|power-?up|re[\s-]?energi[sz]e|restore (?:the )?power|reconnect(?:ing)? (?:the )?power|reset (?:it|the (?:breaker|overload|fault))|watch (?:for|the handle)|trips? again|display|LEDs?|status (?:screen|indicator)|fault (?:code|screen|display))\b/i;

/** Mechanical work scheduled for after power is back ("tighten only after the lockout is
 *  removed and power is restored") — the #4101 technician-flagged shape. */
const MECHANICAL_AFTER_RESTORE =
  /\b(?:tighten|torque|re-?terminate|replace|clean|reconnect (?:the )?(?:wires?|leads?|conductors?))\w*\b[^.\n]{0,90}?\b(?:only )?(?:after|once|when)\b[^.\n]{0,80}?\b(?:power (?:is |has been )?restored|restore (?:the )?power|re[\s-]?energi[sz]\w*|power (?:is )?(?:back )?on)\b/i;

/** Split an answer into steps: lines, then sentences within a line. A list line keeps
 *  its list flag on every sentence, and its "2." marker is never split off on its own. */
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*•])\s/;
function steps(text: string): { line: number; text: string; lead: boolean; list: boolean }[] {
  const out: { line: number; text: string; lead: boolean; list: boolean }[] = [];
  text.split(/\n+/).forEach((raw, line) => {
    // Models emit non-ASCII hyphens (U+2011 "de‑energized") and NBSPs.
    const l = raw.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u00a0\u202f]/g, " ").trim();
    if (!l) return;
    const lead = /[:：]\s*\**\s*$/.test(l) || /^#{1,6}\s/.test(l) || /^\*\*[^*]+\*\*:?$/.test(l);
    const list = LIST_ITEM.test(l);
    const body = l.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "");
    for (const s of body.split(/(?<=[.!?])\s+(?=[A-Z0-9*])/)) out.push({ line, text: s, lead, list });
  });
  return out;
}

/** The first step that is both isolated and needs power, or null. */
export function stepEnergyContradiction(answerText: string): string | null {
  let scopeOpen = false;
  let listScope = false; // isolation stated just before a list carries into that list
  for (const s of steps(answerText)) {
    const t = s.text;
    if (MECHANICAL_AFTER_RESTORE.test(t)) return t;
    const inList = s.list;
    if (!inList && listScope && !ISOLATED.test(t)) listScope = false;
    const still = STILL_ISOLATED.test(t);
    const restored = RESTORE.test(t) || LOCKOUT_REMOVED.test(t);
    // A step that removes the lockout / restores power (and does not also claim the
    // lockout is still on) is the correct later energized step: it closes the scope.
    if (restored && !still) { scopeOpen = false; listScope = false; continue; }
    const isolatedHere = still || (ISOLATED.test(t) && !EXPLICITLY_POWERED.test(t));
    // A dead check ("confirm the bus is dead", "verify with a voltage tester") is
    // blanked out before looking for a live reading, so "confirm the bus is dead,
    // then measure the output" still counts and "verify it is de-energized" does not.
    const needsPower = OPERATE.test(t) || LIVE_READING.test(t.replace(DEAD_CHECK, " "));
    if ((isolatedHere || scopeOpen || (listScope && inList)) && needsPower) return t;
    if (isolatedHere && s.lead) scopeOpen = true;
    if (isolatedHere && !inList) listScope = true;
  }
  return null;
}
