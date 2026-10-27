/**
 * #4858 — isolation-safety framing for an answer that directs hands-on
 * electrical or mechanical work (notebook chat, both lanes — the same
 * validateAnswer tail every other hazard warning uses).
 *
 * Staging D4 F005 (PF525 OverVoltage) at v3.419.28 / 92e892a48: the answer
 * said "extend the decel time or install the dynamic brake option [1]" with
 * no disconnect, lockout, or verify-dead line. Installing a brake resistor
 * is DC-bus work.
 *
 * This is an ADVISORY, not a safety trigger — same shape as restart-advisory:
 *   - It never stops a turn. The technician keeps the answer.
 *   - It never changes grounding. The route keeps it off `safetyTrigger`.
 *   - Its banner is fixed server text and cites no manual page: it is site
 *     safety practice (Mike, 2026-10-27: disconnect per the manual; lock out
 *     per site procedure), not a claim about the document.
 *
 * Detection reuses the settled pieces; it does not invent a new stack:
 *   - HANDS_ON_VERB_RE / WORK_OBJECT_RE from safety-classifier.ts
 *   - LOCKOUT_VERB_RE for "lock it out" (TQ-30 form; ISOLATED is participle)
 *   - ISOLATED + stepTexts from step-energy.ts, so a list marker is never
 *     its own step and isolation is scoped the way step-energy scopes it
 *   - the banner is prepended by validateAnswer the same way ENERGIZED_WARNING
 *     / hazard_warning already are (route.ts ~4324–4337).
 *
 * Isolation is ordered: a lockout the answer forbids, or one that comes
 * after the first hands-on instruction, does not count. The 80-char object
 * window stays inside one step so a later "Inspect the terminals" cannot
 * make an earlier dual-use "check" look like work.
 *
 * Zero-token, deterministic, Hub-only.
 */

import {
  HANDS_ON_VERB_RE,
  WORK_OBJECT_RE,
  LETHAL_VOLTAGE_CONTEXT,
  LOCKOUT_VERB_RE,
} from "@/lib/safety-classifier";
import { ISOLATED, STATE_ISOLATED, stepTexts } from "./step-energy";

/** Fixed banner shown above a hands-on answer. No page citation (see header). */
export const ISOLATION_BANNER =
  "⚠️ **Before hands-on work.** Disconnect power per the manual. Lock out per site procedure. Verify absence of voltage.";

/**
 * Discharge-wait line for VFD / DC-bus work. Never a number of minutes —
 * cite OEM text that is already in the answer, or say this.
 */
export const DISCHARGE_WAIT_LINE = "Follow the manual's discharge wait.";

/** Verify-dead half of step-energy's DEAD_CHECK — the phrases that mean the
 *  answer already told the tech to prove the circuit is dead. The rest of
 *  DEAD_CHECK blanks tester/resistance/insulation so they do not count as
 *  needing power; those are not "already isolated". */
const VERIFY_DEAD =
  /\b(?:absence of voltage|zero (?:volts|voltage|energy)|no voltage|confirmed dead|verif\w* (?:it is |they are )?dead)\b/i;

/** Imperative siblings of ISOLATED's participles — "Isolate the feeder" /
 *  "De-energize the drive" / Mike's "disconnect power" are isolation
 *  instructions, not the `isolated` / `de-energized` state words. */
const ISOLATION_IMPERATIVE =
  /\b(?:isolate|de[\s-]?energi[sz]e|disconnect(?:ing)?(?:\s+(?:the\s+)?power)?|shut(?:ting)?\s+(?:off|down)|power(?:ing)?\s+(?:off|down))\b/i;

/** Dual-use verbs: the same words edit a parameter or open a screen.
 *  They count only with a WORK_OBJECT. `work on` / connect / disconnect
 *  need the object so "work on the parameter set" and "connect the laptop"
 *  stay silent. */
const DUAL_USE_VERB_RE =
  /\b(?:chang(?:e|ing)|adjust(?:ing)?|check(?:ing)?|measur(?:e|ing)|prob(?:e|ing)|test(?:ing)?|work(?:ing)? on|connect(?:ing)?|disconnect(?:ing)?|reconnect(?:ing)?)\b/i;

const PROHIBITION_SENTENCE =
  /^\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:do not|don't|never|do\s+not)\b/i;

const VERB_SRC = HANDS_ON_VERB_RE.source.replace(/^\\b/, "").replace(/\\b$/, "");

/** A hands-on verb in instruction position: clause-initial (sentence, list
 *  item, or after a comma — "If that fails, install…") or coordinated /
 *  modal ("or install", "then replace", "you should replace"). Bare
 *  "to <verb>" is excluded — "not safe to open the cabinet" is a prohibition,
 *  not a work direction (pinned by answer-validation.test.ts). */
const INSTRUCTION_RE = new RegExp(
  "(?:" +
    "(?:^|[.!?:;,]\\s+|[—–]\\s*|\\n)\\s*(?:[-*•]\\s+|\\d+[.)]\\s+)?(?:then\\s+|next\\s+|now\\s+|first\\s+|simply\\s+|just\\s+|so\\s+|please\\s+)?" +
    "|" +
    "\\b(?:or|and(?:\\s+then)?|then|so|you\\s+(?:can|should|must|may|need\\s+to))\\s+" +
    ")" +
    VERB_SRC,
  "gi",
);

const ALREADY_DISCHARGE =
  /\b(?:discharge wait|wait(?:ing)? for (?:the )?(?:dc\s*)?bus|bus (?:to )?discharg)\b/i;

/** Opening a display / HMI / log is navigation, not enclosure work — the
 *  same object set A1 already excludes from `leave-on-then-act`
 *  (`open(?!…hmi|screen|alarm|…)` in answer-validation.ts). */
const DISPLAY_SURFACE_RE =
  /\b(?:hmi|screen|alarm|menu|page|display|tab|app|log|history|trend|faceplate)\b/i;

/** `isolated` as a prenominal adjective ("isolated analog input module")
 *  is not an isolation state. The state form is clause-final or copular
 *  ("is isolated", "with the terminals isolated"). */
function isolatedIsAdjective(text: string, index: number, matched: string): boolean {
  if (!/^isolated$/i.test(matched)) return false;
  const after = text.slice(index + matched.length);
  return /^\s+(?!and\b|then\b|or\b|but\b|with\b|while\b|so\b|is\b|are\b)/i.test(after);
}

function firstMatchIndex(re: RegExp, text: string, skipAdj = false): number {
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let best = -1;
  for (const m of text.matchAll(copy)) {
    if (skipAdj && isolatedIsAdjective(text, m.index ?? 0, m[0])) continue;
    const idx = m.index ?? 0;
    if (best < 0 || idx < best) best = idx;
  }
  return best;
}

/** Earliest isolation / verify-dead language in this step, or -1. */
function isolationIndex(step: string): number {
  const candidates = [
    firstMatchIndex(ISOLATED, step, true),
    firstMatchIndex(VERIFY_DEAD, step),
    firstMatchIndex(ISOLATION_IMPERATIVE, step),
    // LOCKOUT_VERB_RE is applied to lowercased text in the classifier
    // (no `i` flag). Same form, case-insensitive, for answer text.
    firstMatchIndex(new RegExp(LOCKOUT_VERB_RE.source, "i"), step),
  ].filter((n) => n >= 0);
  return candidates.length ? Math.min(...candidates) : -1;
}

function instructionIsHandsOn(match: string, after: string): boolean {
  const verbMatch = HANDS_ON_VERB_RE.exec(match);
  HANDS_ON_VERB_RE.lastIndex = 0;
  const verb = verbMatch?.[0] ?? "";
  const clause = `${verb} ${after}`;
  if (/^open/i.test(verb) && DISPLAY_SURFACE_RE.test(after) && !WORK_OBJECT_RE.test(after)) {
    return false;
  }
  return WORK_OBJECT_RE.test(clause) || Boolean(verb && !DUAL_USE_VERB_RE.test(verb));
}

/** Index of the first instruction-shaped hands-on verb in this step, or -1.
 *  The object window stays inside the step — it does not read the next item. */
function firstHandsOnIndex(step: string): number {
  INSTRUCTION_RE.lastIndex = 0;
  try {
    for (const m of step.matchAll(INSTRUCTION_RE)) {
      const after = step.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80);
      if (instructionIsHandsOn(m[0], after)) return m.index ?? 0;
    }
    return -1;
  } finally {
    INSTRUCTION_RE.lastIndex = 0;
  }
}

/** True when the first hands-on instruction is already under an isolation
 *  scope — isolation stated in a prior (non-prohibited) step, or in the
 *  same step before the work. A lockout the answer forbids, or one that
 *  comes after the work, does not count. */
function firstHandsOnAlreadyIsolated(text: string): boolean {
  let isolated = false;
  for (const step of stepTexts(text)) {
    if (PROHIBITION_SENTENCE.test(step)) continue;
    const isoAt = isolationIndex(step);
    // step-energy's condition form ("measure … with the circuit isolated")
    // scopes the whole step; word order puts the verb first.
    const conditioned = STATE_ISOLATED.test(step);
    const workAt = firstHandsOnIndex(step);
    if (workAt >= 0) {
      if (conditioned || (isoAt >= 0 && isoAt <= workAt)) return true;
      return isolated;
    }
    if (isoAt >= 0 || conditioned) isolated = true;
  }
  return false;
}

function isStoredEnergyWork(text: string): boolean {
  const msg = text.toLowerCase();
  // Bare "bus" is also CAN / Modbus / fieldbus. Stored energy is the
  // LETHAL_VOLTAGE_CONTEXT entries that are not a communications bus,
  // plus the D4 fault name "bus overvoltage".
  if (LETHAL_VOLTAGE_CONTEXT.includes("dc bus") && /\bdc\s*bus\b/.test(msg)) return true;
  if (LETHAL_VOLTAGE_CONTEXT.includes("panel interior") && /\bpanel interior\b/.test(msg)) return true;
  return /\bbus\s+overvoltage\b/.test(msg);
}

/** True when the answer directs hands-on work (not a parameter edit). */
export function directsHandsOnWork(answer: string): boolean {
  for (const step of stepTexts(answer || "")) {
    if (PROHIBITION_SENTENCE.test(step)) continue;
    if (firstHandsOnIndex(step) >= 0) return true;
  }
  return false;
}

/** Banner to prepend, or null when the first hands-on step is already
 *  isolated or the answer is not hands-on. */
export function isolationBannerFor(answer: string): string | null {
  const text = (answer || "").trim();
  if (!text) return null;
  if (!directsHandsOnWork(text)) return null;
  if (firstHandsOnAlreadyIsolated(text)) return null;
  if (!isStoredEnergyWork(text)) return ISOLATION_BANNER;
  if (ALREADY_DISCHARGE.test(text)) return ISOLATION_BANNER;
  return `${ISOLATION_BANNER} ${DISCHARGE_WAIT_LINE}`;
}
