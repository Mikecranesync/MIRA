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
    VERB_SRC +
    // Whole verb only: "touches"/"opens" in a descriptive clause ("Anything that opens an
    // enclosure or touches the circuit follows your site's lockout procedure") is not an
    // instruction to touch it — that line is the alarm card's own lockout reminder.
    "\\b",
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

/** Codex #4867 F2: a software, record or parameter target is not physical
 *  maintenance — "Install the firmware update", "Change the fan speed
 *  parameter" (the physical noun is inside the parameter name), "Remove the
 *  fault from the alarm history". Physical twins ("Install the control card",
 *  "Change the fan") carry none of these words. */
const SOFTWARE_HEAD_RE =
  /^(?:firmware|software|updates?|patch(?:es)?|apps?|applications?|programs?|parameters?|settings?|setpoints?|menus?|history|logs?|records?|entry|entries|passwords?|licen[cs]es?|configurations?|config|profiles?|accounts?|faults?|alarms?|errors?|codes?)$/i;
/** Codex #4867 r3 F3: manner adverbs never name the object ("Measure voltage directly across …"). */
const MANNER_ADVERB_RE = /^(?:directly|carefully|safely|exactly|actually|quickly|slowly|again|first|now|then|also|only|still|here|there|immediately|properly|correctly)$/i;
/** Codex #4867 r2 F2: the exemption reads the object's HEAD noun only — the last word before a
 *  preposition — so "Replace the firmware module", "Disconnect the motor driver wires" and
 *  "Replace the fan with a model matching the drive configuration" stay physical work. */
function headNoun(window: string): string {
  // Codex #4867 r3 F5: a citation marker ("[1]", "[1, 2]") is not part of the object.
  const clean = window.replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, " ");
  const phrase = clean.split(/\s+(?:with|from|in|into|on|at|for|matching|via|using|under|by|of|across|between)\b/i)[0] ?? "";
  const words = phrase.replace(/[^\w\s-]/g, " ").trim().split(/\s+/).filter((w) => w && !/^\d+$/.test(w) && !MANNER_ADVERB_RE.test(w));
  return words[words.length - 1] ?? "";
}
function softwareTarget(window: string): boolean {
  return SOFTWARE_HEAD_RE.test(headNoun(window));
}
/** Owner decision 2026-10-31 (#5055): an answer that recommends a live test or measurement gets
 *  no disconnect-power notice — that is wrong advice for a reading that needs the circuit live.
 *  Live REPAIR is a separate category (the energized-work stop). Dead tests (resistance,
 *  continuity, insulation) are not in this set and keep the notice. */
const LIVE_MEASURAND_HEAD_RE = /^(?:voltages?|volts?|current|amps?|amperage|frequency|signal)$/i;
/** "Probe the terminals for voltage" — the measurand named as the purpose. */
const LIVE_MEASURAND_FOR_RE =
  /\bfor\s+(?:the\s+|any\s+)?(?:\w+\s+)?(?:voltage|volts|current|amps|frequency|signal)(?=\s*(?:$|[.,;:!]|\s+(?:at|on|across|between|with|in|from|to)\b))/i;
/** Dead tests (Codex #4867 r5 F8): "Measure the terminal resistance for the voltage sensor". */
const DEAD_MEASURAND_HEAD_RE = /^(?:resistance|continuity|insulation|ohms?|megger|impedance|capacitance)$/i;
/** The measurand must be what is measured (the head noun), so "Check the current transformer
 *  wiring" stays physical work. */
function liveMeasurement(window: string): boolean {
  const head = headNoun(window);
  if (DEAD_MEASURAND_HEAD_RE.test(head)) return false;
  return LIVE_MEASURAND_HEAD_RE.test(head) || LIVE_MEASURAND_FOR_RE.test(window);
}

/** Dual-use object window ends at the next coordinator or purpose "to".
 *  Codex #4867 r4 F7: "Replace the fuse after checking the parameters" — the object ends at a
 *  temporal clause, so a later software clause never becomes the repair's object. */
const OBJECT_WINDOW_CUT = /\s+(?:then|so|and(?:\s+then)?|or|after|before|while|when|once|until|unless|because|if)\b|,\s+(?:then|and|or)\b|[;.]|\bto\b/i;

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

/** Codex #4867 F1: shutting down a computer / HMI / app isolates nothing. */
const SOFTWARE_SHUTDOWN_POST =
  /^\s+(?:the\s+|your\s+)?(?:hmi|pc|computer|laptop|tablet|app|application|software|program|browser|engineering software|screen|monitor)\b/i;
/** Codex #4867 r4 F1: isolation counts only when it is affirmatively about equipment energy —
 *  an allowlist, not exclusions. The lockout NOUN counts only as an act ("Follow the lockout
 *  procedure", "Perform LOTO", "LOTO the drive", "under lockout"), never as a name ("the lockout
 *  timer", "the lockout procedure is in the manual"); "isolate" needs an equipment / energy object
 *  ("Isolate the drive", never "the fault" or "the control signal"); being locked out OF a
 *  screen or account is not isolation. */
const LOCKOUT_DOC_ACT_PRE = /\b(?:follow(?:ing)?|perform(?:ing)?|apply(?:ing)?|complet(?:e|ing)|carry(?:ing)? out|do|use|using|start)\b[^.;:]*$/i;
const LOCKOUT_NOUN_STATE_PRE = /\b(?:under|with|in)\s+(?:a\s+|the\s+)?$/i;
const DETERMINER_POST = /^\s+(?:the|your|this|that|these|those|each|every|all|it|them|everything)\b/i;
const ENERGY_OBJECT_RE = new RegExp(
  "^\\s+(?:the\\s+|your\\s+|this\\s+|that\\s+|all\\s+|each\\s+)?(?:[\\w-]+\\s+){0,2}?(?:" +
    "it|them|everything|power|supply|supplies|feeds?|feeders?|mains|energy|source|transformer|generator|air|hydraulics?|pneumatics?|steam|gas|equipment|machine|machinery|motor|drive|vfd|inverter|" +
    "circuit|breaker|disconnect|panel|cabinet|enclosure|unit|system|conveyor|pump|compressor|line|bus|load|" +
    WORK_OBJECT_RE.source.replace(/^\\b\(\?:/, "").replace(/\)\\b$/, "") +
    ")\\b",
  "i",
);
/** The lockout noun as the act ("Perform lockout.", "Follow the lockout procedure, then …"), not a
 *  modifier of another noun ("the lockout indicator", "the lockout timer") — Codex #4867 r5 F1. */
const LOCKOUT_NOUN_ACT_POST =
  /^(?:\/tagout)?(?:\s+(?:procedures?|process|program|steps?|plan|sequence|devices?|locks?|padlocks?|hasps?|tags?))?\s*(?:$|[.,;:!]|\s+(?:and|then|on|to|for|before|first|at|per|as|of|in)\b)/i;
/** "The HMI is powered off" — a software device switched off isolates no equipment energy. */
const SOFTWARE_DEVICE_STATE_PRE =
  /\b(?:hmi|pc|computer|laptop|tablet|app|application|software|program|screen|monitor|display|browser)\s+(?:is|are|was|were|has been|have been|gets?|got|stays?)\s+$/i;
const ACCOUNT_LOCKOUT_POST = /^\s+of\s+(?:the\s+|your\s+)?(?:hmi|app|application|software|account|system|program|laptop|pc|computer|screen|menu)\b/i;

function affirmativeIsolation(before: string, matched: string, after: string): boolean {
  const m = matched.toLowerCase();
  if (/^(?:lockout|loto)(?:\/tagout)?$/.test(m)) {
    if (DETERMINER_POST.test(after)) return true;
    return (LOCKOUT_DOC_ACT_PRE.test(before) || LOCKOUT_NOUN_STATE_PRE.test(before)) && LOCKOUT_NOUN_ACT_POST.test(after);
  }
  if (/^power/.test(m) && SOFTWARE_DEVICE_STATE_PRE.test(before)) return false;
  if (/^lock/.test(m)) return !ACCOUNT_LOCKOUT_POST.test(after);
  if (/^isolate$/.test(m)) return ENERGY_OBJECT_RE.test(after);
  return true;
}

function isolationIsVoid(text: string, index: number, matched = ""): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  const after = text.slice(index + matched.length);
  if (ISO_VOID_PRE.test(before)) return true;
  if (/^(?:shut|power)/i.test(matched) && SOFTWARE_SHUTDOWN_POST.test(after)) return true;
  if (/lock|loto|^isolate$|^power/i.test(matched) && !affirmativeIsolation(before, matched, after)) return true;
  return ISO_VOID_POST.test(after);
}

/** Isolation words that exist only as part of a restore / lockout-removed
 *  phrase ("the lockout is removed") are not isolation-in-force. */
function withoutRestores(step: string): string {
  let s = step;
  for (const re of [RESTORE, LOCKOUT_REMOVED]) {
    const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    s = s.replace(copy, (m) => " ".repeat(m.length));
  }
  return s;
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
  if (softwareTarget(window)) return false;
  if (/^(?:measur|test|check|prob)/i.test(verb) && liveMeasurement(window)) return false;
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

/** True when EVERY hands-on instruction (Codex #4867 r2 F4; was: the first) is under an isolation
 *  scope — isolation stated in a prior (non-prohibited) step, or in the
 *  same clause before / conditioning the work. A lockout the answer
 *  forbids, skips, or places after the work does not count. */
function allMatchIndices(re: RegExp, text: string, opts: { skipAdj?: boolean; skipVoid?: boolean } = {}): number[] {
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const out: number[] = [];
  for (const m of text.matchAll(copy)) {
    const idx = m.index ?? 0;
    if (opts.skipVoid && isolationIsVoid(text, idx, m[0])) continue;
    if (opts.skipAdj && isolatedIsAdjective(text, idx, m[0])) continue;
    out.push(idx);
  }
  return out;
}

function allHandsOnIndices(step: string): number[] {
  INSTRUCTION_RE.lastIndex = 0;
  try {
    const out: number[] = [];
    for (const m of step.matchAll(INSTRUCTION_RE)) {
      const after = step.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80);
      if (instructionIsHandsOn(m[0], after)) out.push(m.index ?? 0);
    }
    return out;
  } finally {
    INSTRUCTION_RE.lastIndex = 0;
  }
}

type EnergyEvent = { at: number; kind: "isolate" | "restore" | "work" };

/** Every isolation, restoration and hands-on instruction in one step, in textual order. */
function stepEvents(step: string): EnergyEvent[] {
  const blanked = withoutRestores(step);
  const restores = [
    ...allMatchIndices(RESTORE, step, { skipVoid: true }),
    ...allMatchIndices(LOCKOUT_REMOVED, step, { skipVoid: true }),
  ];
  const isolations = [
    ...allMatchIndices(ISOLATED, blanked, { skipAdj: true, skipVoid: true }),
    ...allMatchIndices(VERIFY_DEAD, blanked, { skipVoid: true }),
    ...allMatchIndices(ISOLATION_IMPERATIVE, blanked, { skipVoid: true }),
    // LOCKOUT_VERB_RE is applied to lowercased text in the classifier (no `i` flag).
    ...allMatchIndices(new RegExp(LOCKOUT_VERB_RE.source, "i"), blanked, { skipVoid: true }),
  ];
  // "measure … with the circuit isolated" conditions its own clause: it takes effect at the clause
  // start (after any restore earlier in that clause), not for an earlier "Replace the fuse, then…".
  const conditioned: number[] = [];
  const copy = new RegExp(STATE_ISOLATED.source, STATE_ISOLATED.flags.includes("g") ? STATE_ISOLATED.flags : `${STATE_ISOLATED.flags}g`);
  for (const m of blanked.matchAll(copy)) {
    const idx = m.index ?? 0;
    if (isolationIsVoid(blanked, idx, m[0])) continue;
    const isoWord = /isolated/i.exec(m[0]);
    if (isoWord && isolatedIsAdjective(blanked, idx + (isoWord.index ?? 0), isoWord[0])) continue;
    const start = clauseStartBefore(step, idx);
    const priorRestore = Math.max(-1, ...restores.filter((r) => r >= start && r < idx));
    conditioned.push(priorRestore >= 0 ? priorRestore + 0.5 : start - 0.5);
  }
  const events: EnergyEvent[] = [
    ...isolations.map((at) => ({ at, kind: "isolate" as const })),
    ...conditioned.map((at) => ({ at, kind: "isolate" as const })),
    ...restores.map((at) => ({ at, kind: "restore" as const })),
    ...allHandsOnIndices(step).map((at) => ({ at, kind: "work" as const })),
  ];
  const rank = { isolate: 0, restore: 1, work: 2 } as const;
  return events.sort((a, b) => a.at - b.at || rank[a.kind] - rank[b.kind]);
}

/** True when EVERY hands-on instruction is under isolation (Codex #4867 r4 F4): every isolation,
 *  restoration and hands-on instruction is walked in textual order across all steps — an
 *  isolation opens the scope, a restoration closes it, and work outside the scope needs the
 *  notice. A lockout the answer forbids, skips, or places after the work does not count. */
function firstHandsOnAlreadyIsolated(text: string): boolean {
  let isolated = false;
  let sawWork = false;
  for (const raw of stepTexts(text)) {
    for (const e of stepEvents(withoutProhibitions(raw))) {
      if (e.kind === "isolate") isolated = true;
      else if (e.kind === "restore") isolated = false;
      else if (!isolated) return false;
      else sawWork = true;
    }
  }
  return sawWork;
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
