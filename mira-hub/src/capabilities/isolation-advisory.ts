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
 * Simple rule (owner GO "do 1", 2026-10-31; supersedes the 2026-10-27 "already-isolated
 * stays silent" parsing — the state-form consequence is pending owner OK): only a plain
 * lockout INSTRUCTION, or a verify-dead statement, silences the notice — an
 * allowlisted imperative in instruction position, outside any if / unless /
 * when / whether / in-case clause. Any other described state ("the drive is
 * isolated", "with the drive locked out") does not silence; the notice is
 * cheap and the state may be wrong. Isolation, restoration and hands-on work
 * are walked in textual order; a restore closes the scope. Dual-use object
 * windows cut at the next coordinator / purpose "to", so they cannot read a
 * later WORK_OBJECT.
 *
 * Zero-token, deterministic, Hub-only.
 */

import {
  HANDS_ON_VERB_RE,
  WORK_OBJECT_RE,
  LETHAL_VOLTAGE_CONTEXT,
} from "@/lib/safety-classifier";
import { LOCKOUT_REMOVED, PROHIBITION, RESTORE, stepTexts } from "./step-energy";

/** Fixed banner shown above a hands-on answer. No page citation (see header). */
export const ISOLATION_BANNER =
  "⚠️ **Before hands-on work.** Disconnect power per the manual. Lock out per site procedure. Verify absence of voltage.";

/**
 * Discharge-wait line for VFD / DC-bus work. Never a number of minutes —
 * cite OEM text that is already in the answer, or say this.
 */
export const DISCHARGE_WAIT_LINE = "Follow the manual's discharge wait.";

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
    // Codex #4867 r8 F13: stepTexts folds an em dash to " - ", so the spaced ASCII dash is a clause cut too.
    "(?:^|[.!?:;,]\\s+|[—–]\\s*|\\s-\\s+|\\n)\\s*(?:[-*•]\\s+|\\d+[.)]\\s+)?(?:then\\s+|next\\s+|now\\s+|first\\s+|simply\\s+|just\\s+|so\\s+|please\\s+|also\\s+)?" +
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
const OBJECT_WINDOW_CUT = /\s+(?:then|so|and(?:\s+then)?|or|but|after|before|while|when|once|until|unless|because|if)\b|,|\s[-–—/]\s|[;.]|\bto\b/i;

function withoutProhibitions(text: string): string {
  // Em-dash / colon are the same clause cut PROHIBITION already makes at comma.
  const normalized = text.replace(/[—–:]/g, ",");
  const copy = new RegExp(PROHIBITION.source, PROHIBITION.flags);
  return normalized.replace(copy, " ");
}

const ENERGY_NOUNS =
  "it|them|everything|power|supply|supplies|feeds?|feeders?|mains|energy|source|transformer|generator|air|hydraulics?|pneumatics?|steam|gas|equipment|machine|machinery|motor|drive|vfd|inverter|" +
  "circuit|breaker|disconnect|panel|cabinet|enclosure|unit|system|conveyor|pump|compressor|line|bus|load|" +
  WORK_OBJECT_RE.source.replace(/^\\b\(\?:/, "").replace(/\)\\b$/, "");
const ENERGY_HEAD_RE = new RegExp("^(?:" + ENERGY_NOUNS + ")$", "i");
/** Heads a "shut off / turn off / remove / kill" may take and still mean isolation. */
const SUPPLY_HEAD_RE = /^(?:power|supply|supplies|mains|breakers?|disconnects?|feeds?|feeders?|electricity)$/i;

/** Isolation mention is void when a negation / skip / "before you" governs it
 *  (restores and discharge statements; isolation instructions are positional). */
const ISO_VOID_PRE =
  /(?:\b(?:do\s+not|don't|never|not|cannot|can't|can\s+not|skip(?:ping)?|without|until(?:\s+you)?|before(?:\s+you)?)\s+|\b(?:is|are|was|were|be)\s+not\s+(?:possible\s+)?)$/i;
const ISO_VOID_POST = /^\s+(?:is|are)\s+not\s+(?:possible|required|needed|present)\b/i;

function isolationIsVoid(text: string, index: number, matched = ""): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  return ISO_VOID_PRE.test(before) || ISO_VOID_POST.test(text.slice(index + matched.length));
}

/** Simple rule ("do 1"): the isolation allowlist, matched only in instruction position
 *  (clause start, or after and / then / first / "you must"). `kind` says which object test applies. */
const ISO_POSITION =
  "(?:(?:^|[.!?:;,]\\s+|[—–]\\s*|\\s-\\s+|\\n)\\s*(?:[-*•]\\s+|\\d+[.)]\\s+)?(?:(?:then|next|now|first|always|please|also|so)\\s+)?" +
  "|\\b(?:and(?:\\s+then)?|then|first|you\\s+(?:should|must|need\\s+to|have\\s+to|will\\s+need\\s+to))\\s+)";
const ISO_FORMS: ReadonlyArray<{ re: RegExp; object: "energy" | "supply" | "none" | "lockout_noun" }> = [
  { re: /lock(?:ing)?[\s-]?out(?:\s*(?:and|\/|&)\s*tag(?:[\s-]?out)?)?|loto|isolate|de[\s-]?energi[sz]e/iy, object: "energy" },
  { re: /(?:follow|perform|apply|complete|carry\s+out|do|use)\s+(?:the\s+|your\s+|a\s+)?(?:(?:site|plant)(?:'s)?\s+)?(?:lock[\s-]?out|loto)(?:[\s/-]*tag[\s-]?out)?/iy, object: "lockout_noun" },
  { re: /(?:disconnect|remove|kill|cut|shut\s+off|turn\s+off|switch\s+off|open)\b/iy, object: "supply" },
  {
    re: /(?:verify|confirm|check\s+for|test\s+for|ensure)\s+(?:that\s+)?(?:there\s+is\s+)?(?:the\s+)?(?:absence\s+of\s+voltage|zero\s+(?:volts|voltage|energy)|no\s+voltage|(?:it\s+is|they\s+are)\s+(?:dead|de-?energi[sz]ed))/iy,
    object: "none",
  },
  { re: /lock\s+(?:it|them|everything)\s+out/iy, object: "none" },
];
/** The lockout noun as the act ("Perform lockout.", "Follow the lockout procedure, then …"), not a
 *  modifier of another noun ("the lockout indicator", "the lockout timer") — Codex #4867 r5 F1. */
const LOCKOUT_NOUN_ACT_POST =
  /^(?:\s+(?:procedures?|process|program|steps?|plan|sequence|devices?|locks?|padlocks?|hasps?|tags?))?\s*(?:$|[.,;:!]|\s+(?:and|then|on|to|for|before|first|at|per|as|of|in)\b)/i;
/** No object at all ("De-energize, lock out per site procedure …", "Lock out first"). */
const NO_OBJECT_POST = /^\s*(?:$|[.,;:!]|(?:per|before|first|now|then|and|according|as)\b)/i;
/** Codex #4867 r7 F11 / r8 F11–F12: an isolation stated inside a condition never opens a scope. */
const CONDITIONAL_PRE = /\b(?:if|when|whenever|whether|unless|assuming|provided(?:\s+that)?|in\s+case)\b[^,.;:]*$/i;

function isolationObjectOk(kind: (typeof ISO_FORMS)[number]["object"], after: string): boolean {
  if (kind === "none") return true;
  if (kind === "lockout_noun") return LOCKOUT_NOUN_ACT_POST.test(after);
  if (NO_OBJECT_POST.test(after)) return kind === "energy";
  const head = headNoun(objectWindow(after));
  return kind === "energy" ? ENERGY_HEAD_RE.test(head) : SUPPLY_HEAD_RE.test(head);
}

/** The one state that silences: a verify-dead statement is self-evidencing (no one confirms a
 *  circuit dead without isolating it), and it is the form MIRA's prompts teach ("with the drive
 *  locked out and the DC bus confirmed dead with a meter, check …" — ISOLATION_STEP_RULE and the
 *  notebook MIRA_CORE prompt). Still void when negated / skipped and when stated as a condition.
 *  A bare mention of "absence of voltage" is not a verification (#5060: "… has not been verified"). */
const VERIFY_DEAD =
  /\b(?:confirmed dead|verif\w* (?:it is |they are )?dead|(?:verif\w*|confirm(?:ed|ing)?)\s+(?:the )?(?:absence of voltage|zero (?:volts|voltage|energy)|no voltage))\b/gi;

function verifyDeadStatements(step: string): number[] {
  return allMatchIndices(VERIFY_DEAD, step).filter((at) => !CONDITIONAL_PRE.test(step.slice(0, at)));
}

/** Start indices of every plain isolation instruction in `step`. */
function isolationInstructions(step: string): number[] {
  const out: number[] = [];
  const pos = new RegExp(ISO_POSITION, "gi");
  for (const m of step.matchAll(pos)) {
    const at = (m.index ?? 0) + m[0].length;
    if (CONDITIONAL_PRE.test(step.slice(0, at))) continue;
    for (const form of ISO_FORMS) {
      form.re.lastIndex = at;
      const hit = form.re.exec(step);
      if (!hit) continue;
      const end = at + hit[0].length;
      if (/^\w/.test(step.slice(end))) continue;
      if (isolationObjectOk(form.object, step.slice(end))) { out.push(at); break; }
    }
    if (pos.lastIndex === m.index) pos.lastIndex++;
  }
  return out;
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

function allMatchIndices(re: RegExp, text: string): number[] {
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const out: number[] = [];
  for (const m of text.matchAll(copy)) {
    const idx = m.index ?? 0;
    if (!isolationIsVoid(text, idx, m[0])) out.push(idx);
  }
  return out;
}

function allHandsOnIndices(step: string): number[] {
  INSTRUCTION_RE.lastIndex = 0;
  try {
    const out: number[] = [];
    for (const m of step.matchAll(INSTRUCTION_RE)) {
      const after = step.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80);
      // The verb's own index, so it orders against an isolation instruction at the same spot.
      if (instructionIsHandsOn(m[0], after)) out.push((m.index ?? 0) + (new RegExp(VERB_SRC, "i").exec(m[0])?.index ?? 0));
    }
    return out;
  } finally {
    INSTRUCTION_RE.lastIndex = 0;
  }
}

type EnergyEvent = { at: number; kind: "isolate" | "restore" | "work" };
/** #5061: an alternative branch ("otherwise", "else", "if not") does not inherit an isolation
 *  given in the other branch, so it closes the scope the same way a restore does. */
const ALTERNATIVE_BRANCH = /\b(?:otherwise|else|if\s+not)\b/gi;

/** Every isolation instruction, restoration and hands-on instruction in one step, in textual order. */
function stepEvents(step: string): EnergyEvent[] {
  const events: EnergyEvent[] = [
    ...[...isolationInstructions(withoutRestores(step)), ...verifyDeadStatements(withoutRestores(step))].map((at) => ({
      at,
      kind: "isolate" as const,
    })),
    ...[...allMatchIndices(RESTORE, step), ...allMatchIndices(LOCKOUT_REMOVED, step), ...[...step.matchAll(ALTERNATIVE_BRANCH)].map((m) => m.index ?? 0)].map(
      (at) => ({ at, kind: "restore" as const }),
    ),
    ...allHandsOnIndices(step).map((at) => ({ at, kind: "work" as const })),
  ];
  const rank = { isolate: 0, restore: 1, work: 2 } as const;
  return events.sort((a, b) => a.at - b.at || rank[a.kind] - rank[b.kind]);
}

/** True when EVERY hands-on instruction comes after a plain isolation instruction with no
 *  restoration in between, walking all steps in textual order (Codex #4867 r4 F4). A lockout the
 *  answer forbids, skips, conditions, or places after the work does not count. */
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
