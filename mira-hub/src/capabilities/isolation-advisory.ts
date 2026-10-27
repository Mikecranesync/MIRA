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
 *   - HANDS_ON_VERB_RE / WORK_OBJECT_RE / LOCKOUT_VERB_RE from safety-classifier.ts
 *   - ISOLATED, STATE_ISOLATED, PROHIBITION, stepTexts from step-energy.ts
 *     (same step split, same prohibition strip, same condition form)
 *   - the banner is prepended by validateAnswer the same way ENERGIZED_WARNING
 *     / hazard_warning already are (route.ts ~4324–4337).
 *
 * Isolation is ordered and polarity-aware: a lockout the answer forbids,
 * skips, or places after the first hands-on instruction does not count.
 * STATE_ISOLATED scopes only its own clause. Dual-use object windows cut
 * at the next coordinator / purpose "to", so they cannot read a later
 * WORK_OBJECT. `disconnect` is isolation only with `power` (Mike's wording).
 *
 * Zero-token, deterministic, Hub-only.
 */

import {
  HANDS_ON_VERB_RE,
  WORK_OBJECT_RE,
  LETHAL_VOLTAGE_CONTEXT,
  LOCKOUT_VERB_RE,
} from "@/lib/safety-classifier";
import {
  ISOLATED,
  LOCKOUT_REMOVED,
  PROHIBITION,
  RESTORE,
  STATE_ISOLATED,
  stepTexts,
} from "./step-energy";

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
  /\b(?:absence of voltage|confirmed dead|verif\w* (?:it is |they are )?dead|(?:verif\w*|confirm(?:ed|ing)?)\s+(?:the )?(?:absence of voltage|zero (?:volts|voltage|energy)|no voltage))\b/i;

/** Imperative siblings of ISOLATED's participles. `disconnect` counts only
 *  with a bare `power` (Mike: disconnect power) — "disconnect the power
 *  wires" is the work, so `power` must not start a longer noun phrase. */
const ISOLATION_IMPERATIVE =
  /\b(?:isolate|de[\s-]?energi[sz]e|disconnect(?:ing)?\s+(?:the\s+)?power(?!\s+(?!then\b|and\b|or\b|to\b)\w)|shut(?:ting)?\s+(?:off|down)|power(?:ing)?\s+(?:off|down))\b/i;

/** Dual-use verbs: the same words edit a parameter or open a screen.
 *  They count only with a WORK_OBJECT. `work on` / connect / disconnect
 *  need the object so "work on the parameter set" and "connect the laptop"
 *  stay silent. */
const DUAL_USE_VERB_RE =
  /\b(?:chang(?:e|ing)|adjust(?:ing)?|check(?:ing)?|measur(?:e|ing)|prob(?:e|ing)|test(?:ing)?|work(?:ing)? on|connect(?:ing)?|disconnect(?:ing)?|reconnect(?:ing)?)\b/i;

const VERB_SRC = HANDS_ON_VERB_RE.source.replace(/^\\b/, "").replace(/\\b$/, "");

/** A hands-on verb in instruction position: clause-initial (sentence, list
 *  item, or after a comma — "If that fails, install…") or coordinated /
 *  modal ("or install", "then replace", "you should replace"). Bare
 *  "to <verb>" is excluded — "not safe to open the cabinet" is a prohibition,
 *  not a work direction (pinned by answer-validation.test.ts). */
const INSTRUCTION_RE = new RegExp(
  "(?:" +
    "(?:^|[.!?:;,]\\s+|[—–]\\s*|\\n)\\s*(?:[-*•]\\s+|\\d+[.)]\\s+)?(?:then\\s+|next\\s+|now\\s+|first\\s+|simply\\s+|just\\s+|so\\s+|please\\s+|also\\s+)?" +
    "|" +
    "\\b(?:or|and(?:\\s+then)?|then|so|also|otherwise|you\\s+(?:can|should|must|may|need\\s+to|have\\s+to|will\\s+need\\s+to))\\s+" +
    ")" +
    VERB_SRC,
  "gi",
);

const ALREADY_DISCHARGE =
  /\b(?:discharge wait|wait(?:ing)? for (?:the )?(?:dc[\s-]*)?bus|bus (?:to )?discharg)\b/i;

/** Opening a display / HMI / log is navigation, not enclosure work — the
 *  same object set A1 already excludes from `leave-on-then-act`
 *  (`open(?!…hmi|screen|alarm|…)` in answer-validation.ts). */
const DISPLAY_SURFACE_RE =
  /\b(?:hmi|screen|alarm|menu|page|display|tab|app|log|history|trend|faceplate)\b/i;

/** Isolation mention is void when a negation / skip / "before you" governs it. */
const ISO_VOID_PRE =
  /(?:\b(?:do\s+not|don't|never|not|cannot|can't|can\s+not|skip(?:ping)?|without|until(?:\s+you)?|before(?:\s+you)?)\s+|\b(?:is|are|was|were|be)\s+not\s+(?:possible\s+)?)$/i;

const ISO_VOID_POST =
  /^\s+(?:is|are)\s+not\s+(?:possible|required|needed|present)\b/i;

/** Dual-use object window ends at the next coordinator or purpose "to". */
const OBJECT_WINDOW_CUT = /\s+(?:then|so|and(?:\s+then)?)\b|,\s+(?:then|and|or)\b|[;.]|\bto\b/i;

function withoutProhibitions(text: string): string {
  // Em-dash / colon are the same clause cut PROHIBITION already makes at comma.
  const normalized = text.replace(/[—–:]/g, ",");
  const copy = new RegExp(PROHIBITION.source, PROHIBITION.flags);
  return normalized.replace(copy, " ");
}

/** `isolated` as a prenominal adjective ("isolated analog input module")
 *  is not an isolation state. The state form is clause-final or copular
 *  ("is isolated", "with the terminals isolated"). */
function isolatedIsAdjective(text: string, index: number, matched: string): boolean {
  if (!/^isolated$/i.test(matched)) return false;
  const after = text.slice(index + matched.length);
  return /^\s+(?!and\b|then\b|or\b|but\b|with\b|while\b|so\b|is\b|are\b)/i.test(after);
}

function isolationIsVoid(text: string, index: number, matched = ""): boolean {
  if (ISO_VOID_PRE.test(text.slice(Math.max(0, index - 48), index))) return true;
  return ISO_VOID_POST.test(text.slice(index + matched.length));
}

function firstMatchIndex(
  re: RegExp,
  text: string,
  opts: { skipAdj?: boolean; skipVoid?: boolean } = {},
): number {
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let best = -1;
  for (const m of text.matchAll(copy)) {
    const idx = m.index ?? 0;
    if (opts.skipVoid && isolationIsVoid(text, idx, m[0])) continue;
    if (opts.skipAdj && isolatedIsAdjective(text, idx, m[0])) continue;
    if (best < 0 || idx < best) best = idx;
  }
  return best;
}

function stateIsolatedIndex(step: string): number {
  const copy = new RegExp(STATE_ISOLATED.source, STATE_ISOLATED.flags.includes("g") ? STATE_ISOLATED.flags : `${STATE_ISOLATED.flags}g`);
  let best = -1;
  for (const m of step.matchAll(copy)) {
    const idx = m.index ?? 0;
    if (isolationIsVoid(step, idx, m[0])) continue;
    const isoWord = /isolated/i.exec(m[0]);
    if (isoWord && isolatedIsAdjective(step, idx + (isoWord.index ?? 0), isoWord[0])) continue;
    if (best < 0 || idx < best) best = idx;
  }
  return best;
}

function restoreIndex(step: string): number {
  const candidates = [
    firstMatchIndex(RESTORE, step, { skipVoid: true }),
    firstMatchIndex(LOCKOUT_REMOVED, step, { skipVoid: true }),
  ].filter((n) => n >= 0);
  return candidates.length ? Math.min(...candidates) : -1;
}

/** Earliest live isolation / verify-dead language in this step, or -1. */
function isolationIndex(step: string): number {
  const candidates = [
    firstMatchIndex(ISOLATED, step, { skipAdj: true, skipVoid: true }),
    firstMatchIndex(VERIFY_DEAD, step, { skipVoid: true }),
    firstMatchIndex(ISOLATION_IMPERATIVE, step, { skipVoid: true }),
    // LOCKOUT_VERB_RE is applied to lowercased text in the classifier
    // (no `i` flag). Same form, case-insensitive, for answer text.
    firstMatchIndex(new RegExp(LOCKOUT_VERB_RE.source, "i"), step, { skipVoid: true }),
  ].filter((n) => n >= 0);
  return candidates.length ? Math.min(...candidates) : -1;
}

function objectWindow(after: string): string {
  return after.split(OBJECT_WINDOW_CUT)[0] ?? after;
}

function instructionIsHandsOn(match: string, after: string): boolean {
  const verbMatch = HANDS_ON_VERB_RE.exec(match);
  HANDS_ON_VERB_RE.lastIndex = 0;
  const verb = verbMatch?.[0] ?? "";
  const window = objectWindow(after);
  const clause = `${verb} ${window}`;
  if (/^open/i.test(verb) && DISPLAY_SURFACE_RE.test(window) && !WORK_OBJECT_RE.test(window)) {
    return false;
  }
  return WORK_OBJECT_RE.test(clause) || Boolean(verb && !DUAL_USE_VERB_RE.test(verb));
}

/** Index of the first instruction-shaped hands-on verb in this step, or -1.
 *  The object window stays inside the clause — it does not read the next
 *  coordinator or a purpose "to …". */
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

/** Start of the clause that contains `index` — after the last `then` / `;`. */
function clauseStartBefore(text: string, index: number): number {
  const head = text.slice(0, index);
  const cut = Math.max(head.lastIndexOf(";"), ...[" then ", " then,", ", then "].map((s) => {
    const at = head.toLowerCase().lastIndexOf(s);
    return at < 0 ? -1 : at + s.length;
  }));
  return cut < 0 ? 0 : cut;
}

/** True when the first hands-on instruction is already under an isolation
 *  scope — isolation stated in a prior (non-prohibited) step, or in the
 *  same clause before / conditioning the work. A lockout the answer
 *  forbids, skips, or places after the work does not count. */
function firstHandsOnAlreadyIsolated(text: string): boolean {
  let isolated = false;
  for (const raw of stepTexts(text)) {
    const step = withoutProhibitions(raw);
    const isoAt = isolationIndex(step);
    const conditionedAt = stateIsolatedIndex(step);
    const restoredAt = restoreIndex(step);
    const workAt = firstHandsOnIndex(step);
    if (workAt >= 0) {
      const restoredBeforeWork = restoredAt >= 0 && restoredAt <= workAt
        && (isoAt < 0 || restoredAt > isoAt);
      if (restoredBeforeWork) isolated = false;
      else if (isoAt >= 0 && isoAt <= workAt) return true;
      // Trailing "measure … with the circuit isolated" conditions only
      // the clause it attaches to, not an earlier "Replace the fuse, then…".
      else if (conditionedAt >= 0 && workAt >= clauseStartBefore(step, conditionedAt)
        && (restoredAt < 0 || restoredAt < conditionedAt || restoredAt > workAt)) {
        return true;
      }
      return isolated;
    }
    if (restoredAt >= 0 && (isoAt < 0 || restoredAt > isoAt)) isolated = false;
    else if (isoAt >= 0 || conditionedAt >= 0) isolated = true;
  }
  return false;
}

function dischargeAlreadyStated(text: string): boolean {
  const kept = withoutProhibitions(text);
  const copy = new RegExp(ALREADY_DISCHARGE.source, "gi");
  for (const m of kept.matchAll(copy)) {
    if (!isolationIsVoid(kept, m.index ?? 0, m[0])) return true;
  }
  return false;
}

function isStoredEnergyWork(text: string): boolean {
  const msg = text.toLowerCase();
  // Bare "bus" is also CAN / Modbus / fieldbus. Stored energy is the
  // LETHAL_VOLTAGE_CONTEXT entries that are not a communications bus,
  // plus the D4 fault name "bus overvoltage". Hyphenated DC-bus / bus-
  // overvoltage survive foldForDetection (unicode hyphen → ASCII '-').
  if (LETHAL_VOLTAGE_CONTEXT.includes("dc bus") && /\bdc[\s-]*bus\b/.test(msg)) return true;
  if (LETHAL_VOLTAGE_CONTEXT.includes("panel interior") && /\bpanel interior\b/.test(msg)) return true;
  return /\bbus[\s-]+overvoltage\b/.test(msg);
}

/** True when the answer directs hands-on work (not a parameter edit). */
export function directsHandsOnWork(answer: string): boolean {
  for (const raw of stepTexts(answer || "")) {
    if (firstHandsOnIndex(withoutProhibitions(raw)) >= 0) return true;
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
  if (dischargeAlreadyStated(text)) return ISOLATION_BANNER;
  return `${ISOLATION_BANNER} ${DISCHARGE_WAIT_LINE}`;
}
