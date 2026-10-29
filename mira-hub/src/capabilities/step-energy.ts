/**
 * #4122 — a step that is both isolated and energized. Two prompt rounds lowered
 * the rate but plateaued (23 -> 13 -> 12 of 35 answers); the #4101 technician
 * review confirmed the harm ("if you tighten it after the power's on that's a
 * dangerous situation"). This deterministic check finds the step.
 * Owner decision 2026-10-16 (#4122/#3790): a lockout/energy contradiction is
 * replaced with SAFETY_STOP (validateAnswer A2a). The coherent written
 * restore-then-measure shape still warns without withholding (#3984).
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

export const ISOLATED =
  /\b(?:lock(?:ed)?[\s-]?out|lockout(?:\/tagout)?|LOTO|isolated|de[\s-]?energi[sz]ed|power(?:ed)?\s+(?:off|down)|with (?:the )?power (?:removed|off))\b/i;
/** Written restore — verb-first and object-first ("the lockout is removed",
 *  "power is restored"). Exported so the isolation tracker reuses this
 *  grammar instead of a second phrase list. */
export const RESTORE =
  /\b(?:remove (?:the )?(?:lock[\s-]?outs?|loto|lock\s*\/\s*tags?)|lock(?:out)? (?:is )?removed|restor(?:e|es|ed|ing) (?:the )?power|power (?:is )?restored|re[\s-]?energi[sz](?:e|es|ed|ing)\b|re-?apply power|reconnect(?:ing)? (?:the )?power|turn (?:the )?power (?:back )?on|power (?:it|the \w+) (?:back )?(?:on|up)|bring (?:it|the \w+) back (?:up|on(?:line)?)|apply (?:main |the )?(?:power|voltage))\b/i;
const DEAD_CHECK =
  /\b(?:absence of voltage|zero (?:volts|voltage|energy)|0\s?V\b|no voltage|(?:voltage|power) is (?:absent|off|removed)|is de[\s-]?energi[sz]ed|are de[\s-]?energi[sz]ed|is dead|are dead|confirmed dead|verif\w* (?:it is |they are )?dead|continuity|resistance|insulation|megger|open[\s-]circuit|(?:voltage |non-contact )?tester|test meter|test[\s-]lead|(?:low|high)[\s-]voltage|voltage (?:class|rating)|rated voltage)\b/gi;
/** The lockout is taken off in this very step — a correct later energized step. */
export const LOCKOUT_REMOVED =
  /\b(?:remov\w* (?:the )?lock[\s-]?out|lock[\s-]?out (?:has been |is )?removed|lock[\s-]?out removal|locked out removed)\b/i;
/** Isolation stated as still in force — contradicts any restore in the same step.
 *  Exported so the isolation tracker in answer-validation.ts reuses this grammar
 *  instead of duplicating a phrase list (a restore "under lockout" must not
 *  end isolation). */
export const STILL_ISOLATED = /\b(?:still (?:locked[\s-]?out|isolated|de[\s-]?energi[sz]ed)|under (?:lock[\s-]?out|LOTO)(?![\s-]*(?:removal|removed))|with the lock[\s-]?out (?:still )?in place)\b/i;
/** "with the VFD powered and the motor terminals isolated" — powered, not isolated. */
const EXPLICITLY_POWERED = /\b(?:with|while) (?:the )?\w+ (?:powered|energi[sz]ed|running)\b/i;
const LIVE_READING =
  /\b(?:measure|check|read|verify|confirm|test)\w*\b[^.;\n]{0,60}?\b(?:voltage|volts|current|amps?|frequency|(?:output|supply)(?! terminals? (?:are|is) tight| wiring| connections?| for (?:proper|loose|open|shorted)))\b/i;
/** Existing OPERATE atom — bare "energize the circuit", not re-energize
 *  (RESTORE already covers re-energize). */
const ENERGIZE_CIRCUIT = /(?<!de[\s-])energi[sz]e (?:the )?(?:\w+ )?circuit/i;
const SEQUENCE_WORD = /\b(?:then|after|afterwards|once|next|finally)\b/i;
/** #4943: an indicator going OUT, OFF or DARK is de-energization evidence (the GS10
 *  "charge LED off, then measure" check), not an observation that needs power. Blanked
 *  before OPERATE is tested; reading LEDs or a display that is lit still counts. */
const INDICATOR_DARK = /\b(?:leds?|lamps?|lights?|indicators?|display)\b(?:\s+\w+){0,3}?\s+(?:out|off|dark)\b/gi;
const operates = (x: string): boolean => OPERATE.test(x.replace(INDICATOR_DARK, " "));
const LOCKOUT_ASSERTED = /\b(?:lock(?:ed|ing)?[\s-]?out|loto|tag(?:ged)?[\s-]?out)\b/i;
const OPERATE =
  /\b(?:press(?:ing)? (?:the )?(?:start|run)|commanded to run|re-?issue (?:a )?run|run command|start the (?:motor|machine|drive)|power (?:it|the \w+) (?:back )?(?:on|up)|power-?up|re[\s-]?energi[sz]e|restore (?:the )?power|reconnect(?:ing)? (?:the )?power|reset (?:it|the (?:breaker|overload|fault))|watch (?:for|the handle)|trips? again|display|LEDs?|status (?:screen|indicator)|fault (?:code|screen|display)|jog\w*|(?<!de[\s-])energi[sz]e (?:the )?(?:\w+ )?circuit|apply (?:main |the )?(?:power|voltage)|bring (?:it|the \w+) back (?:up|on(?:line)?))\b/i;

/** Mechanical work scheduled for after power is back ("tighten only after the lockout is
 *  removed and power is restored") — the #4101 technician-flagged shape. */
/** A measurement made TO prove the circuit is dead is a dead check, not live work. */
const DEAD_PURPOSE =
  // Only a stated PURPOSE ("to confirm …"); "…and confirming the bus is dead" is a prior step.
  /\bto (?:confirm|verify|check|prove|ensure) (?:the )?(?:absence of voltage|zero (?:volts|voltage|energy)|no voltage (?:is )?present|(?:it|the \w+) (?:is|are) (?:dead|de-energized))\b/i;
/** A prohibition ("do not press start", "never measure the voltage") is not an instruction. */
// Ends at "but"/"then" so the instruction after it survives (Codex #4146 r2 F2);
// "do not forget to …" is an instruction, not a prohibition.
export const PROHIBITION = /\b(?:do not|don't|never|avoid|without)\b(?!\s+forget)[^,;.]*?(?=\s+(?:but|and then|then)\b|[,;.]|$)/gi;
/** Isolation stated as a CONDITION of the step ("with the machine locked out, …") — as
 *  opposed to a sequence ("lock out, remove the drive, restore power"). */
export const STATE_ISOLATED = /\b(?:with|while|keeping) (?:the )?(?:[\w-]+ ){0,2}(?:locked[\s-]?out|isolated|de[\s-]?energi[sz]ed)\b/i;
/** "noted the display, then proceed to lock out" — the observation happens BEFORE isolation. */
const OBSERVE_THEN_ISOLATE = /\b(?:display|LEDs?|status|fault)\b[^.]*?\b(?:then|proceed|before)\b[^.]*?\b(?:lock(?:ed)?[\s-]?out|lockout|LOTO|isolat\w*)\b/i;

/** Actions that move or power the machine — carried across prose sentences of one line. */
const MOTION = /\b(?:jog\w*|press(?:ing)? (?:the )?(?:start|run)|start the (?:motor|machine|drive)|run command|commanded to run|(?<!de[\s-])energi[sz]e|apply (?:main |the )?(?:power|voltage))\b/i;

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

/** Step texts in the same order `stepEnergyContradiction` walks them.
 *  List markers stay attached to their item; "1." is never a step of its own. */
export function stepTexts(text: string): string[] {
  return steps(text).map((s) => s.text).filter((t) => t.trim());
}

/** The first step that is both isolated and needs power, or null. */
export function stepEnergyContradiction(answerText: string): string | null {
  let scopeOpen = false;
  let listScope = false; // isolation stated just before a list carries into that list
  let lineIso = -1; // isolation stated earlier in this same line / list item
  for (const s of steps(answerText)) {
    const raw = s.text;
    // Codex #4146 F2: a prohibited action is not an instruction to do it.
    const t = raw.replace(PROHIBITION, " ");
    // r2 F3: "Do not tighten … after power is restored" is the correct caution.
    if (MECHANICAL_AFTER_RESTORE.test(t)) return raw;
    const inList = s.list;
    if (!inList && listScope && !ISOLATED.test(t)) listScope = false;
    const still = STILL_ISOLATED.test(t);
    const removed = LOCKOUT_REMOVED.test(t);
    const restored = RESTORE.test(t) || removed;
    if (restored) {
      // Codex #4146 F1: a restore in a step that states the lockout as its condition
      // ("with the machine locked out, reconnect power") is the contradiction itself.
      // A sequence ("…isolated and locked out, then restore power") is not simultaneous.
      // r2 F1: a lockout stated as CONTINUING ("still in place") is never ended by "then";
      // a lockout stated as a condition followed by a sequence is ("…locked out, then restore").
      if (!removed && (still || (STATE_ISOLATED.test(t) && !SEQUENCE_WORD.test(t)))) return raw;
      // Codex #4931 r2 F1 (BLOCKER): the restore ends isolation only from where it
      // is written. Work that needs power BEFORE it in this step ("…locked out,
      // energize the circuit and measure, then remove the lockout") is still
      // judged under the isolation in force.
      // Codex #4931 r3 F1 (BLOCKER): walk every restore in order. An earlier
      // restore does not mask a later lockout ("Restore power, then lock out the
      // circuit, energize the circuit and check the output frequency").
      if (isolatedPowerInOrder(t, scopeOpen || (listScope && inList) || lineIso === s.line)) return raw;
      // Otherwise it is the transition out of isolation: it closes every scope.
      scopeOpen = false; listScope = false; lineIso = -1;
      continue;
    }
    const isolatedHere = still || (ISOLATED.test(t) && !EXPLICITLY_POWERED.test(t) && !OBSERVE_THEN_ISOLATE.test(t));
    // A dead check ("confirm the bus is dead", "verify with a voltage tester") is
    // blanked out before looking for a live reading, so "confirm the bus is dead,
    // then measure the output" still counts and "verify it is de-energized" does not.
    // Codex #4146 r3 F4: a reading whose stated purpose is a dead check ("measure the
    // output voltage to confirm absence of voltage") is the correct LOTO verification.
    // Codex #4146 F5: blank only the measurement that states the dead-check purpose, so
    // another reading in the same step still counts. Pieces end at a comma/semicolon or
    // before the next measurement verb ("…and then measure the frequency"); "to confirm"
    // stays with its measurement. Split, not a leading-wildcard regex: that one was
    // quadratic on long unpunctuated text.
    const withoutDeadPurpose = t
      .split(/([,;])|(?<!\bto )(?=\b(?:measure|check|read|verify|confirm|test)\w*\b)/i)
      .map((c) => (c && DEAD_PURPOSE.test(c) ? " " : (c ?? "")))
      .join("");
    const liveReading = LIVE_READING.test(withoutDeadPurpose.replace(DEAD_CHECK, " "));
    const needsPower = operates(t) || liveReading;
    // Codex #4146 F3: isolation carries within one list item; in prose, only into a step
    // that moves or powers the machine ("Lock out first. Then reset the fault" is left alone).
    const sameItem = lineIso === s.line && (inList || MOTION.test(t));
    if ((isolatedHere || scopeOpen || sameItem || (listScope && inList)) && needsPower) return raw;
    if (isolatedHere) lineIso = s.line;
    else if (lineIso !== s.line) lineIso = -1;
    if (isolatedHere && s.lead) scopeOpen = true;
    if (isolatedHere && !inList) listScope = true;
  }
  return null;
}

/** Sequential "energize the circuit and measure …" using OPERATE's existing
 *  energize-circuit atom plus LIVE_READING. Simultaneous isolation
 *  (STILL_ISOLATED / STATE_ISOLATED without a sequence word) is not this
 *  shape — those stay A2a BLOCK. No new phrase list. */
export function sequentialEnergizeThenMeasure(step: string): boolean {
  if (STILL_ISOLATED.test(step)) return false;
  const energize = ENERGIZE_CIRCUIT.exec(step);
  if (energize === null) return false;
  // Codex #4931 r1 F1 / r2 F1 (BLOCKER): a sequence word does not end a lockout,
  // and neither does a removal written AFTER the energize. A step that asserts
  // lockout/tagout stays an A2a contradiction unless the lockout is removed
  // before the circuit is energized; only a bare de-energized state may warn.
  // r3: the LAST event before the energize decides: a lockout after the last
  // restore ("Restore power, then lock out the circuit, energize …") blocks.
  // "remove the lockout" is a removal, not a lockout: blank restore phrases
  // (same length, so indexes hold) before looking for the lockout.
  const blank = (x: string, re: RegExp) => x.replace(new RegExp(re.source, re.flags + "g"), (m) => " ".repeat(m.length));
  const lastLock = lastIndexBefore(LOCKOUT_ASSERTED, blank(blank(step, RESTORE), LOCKOUT_REMOVED), energize.index);
  const lastRestore = Math.max(lastIndexBefore(RESTORE, step, energize.index), lastIndexBefore(LOCKOUT_REMOVED, step, energize.index));
  if (lastLock >= 0 && !(lastRestore > lastLock)) return false;
  if (STATE_ISOLATED.test(step) && !SEQUENCE_WORD.test(step)) return false;
  // Ordered, not co-occurrence: the live reading must come after the energize.
  return LIVE_READING.test(step.slice(energize.index + energize[0].length));
}

/** The first restore / lockout removal written in a step, or null. */
function firstRestore(step: string): { index: number; end: number } | null {
  const hits = [RESTORE.exec(step), LOCKOUT_REMOVED.exec(step)].filter((m): m is RegExpExecArray => m !== null);
  if (!hits.length) return null;
  const m = hits.reduce((a, b) => (b.index < a.index ? b : a));
  return { index: m.index, end: m.index + m[0].length };
}

/** Where the first restore / lockout removal is written, or the step length. */
function restoreIndex(step: string): number {
  return firstRestore(step)?.index ?? step.length;
}

/** Ordered events within one step: each restore ends isolation, and a lockout
 *  written after it opens isolation again. True when work that needs power is
 *  written while isolation is in force. */
function isolatedPowerInOrder(step: string, isolatedAtStart: boolean): boolean {
  let iso = isolatedAtStart;
  let rest = step;
  for (;;) {
    const r = firstRestore(rest);
    const head = r ? rest.slice(0, r.index) : rest;
    const lock = iso ? null : ISOLATED.exec(head);
    if ((iso || (lock && !EXPLICITLY_POWERED.test(head)))) {
      const tail = lock ? head.slice(lock.index) : head;
      if (operates(tail) || LIVE_READING.test(tail.replace(DEAD_CHECK, " "))) return true;
    }
    if (!r) return false;
    rest = rest.slice(r.end);
    iso = false;
  }
}

/** Index of the last match of `re` that starts before `end`, or -1. */
function lastIndexBefore(re: RegExp, step: string, end: number): number {
  let last = -1;
  for (const m of step.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
    if (m.index >= end) break;
    last = m.index;
  }
  return last;
}
