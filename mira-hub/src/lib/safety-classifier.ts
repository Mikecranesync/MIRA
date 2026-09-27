/**
 * Shared Hub safety classifier — faithful port of the safety short-circuit in
 * `mira-bots/shared/guardrails.py` `classify_intent`.
 *
 * SOURCE OF TRUTH: guardrails.py. Three components, each parity-pinned:
 *   - `SAFETY_PHRASES` (general keywords)          → safety-phrases.ts (+ its test)
 *   - `SAFETY_PHRASES_IMMEDIATE`                   → pinned by safety-classifier.test.ts
 *   - `EDUCATIONAL_QUESTION_PATTERN`               → pinned by safety-classifier.test.ts
 *
 * Two-tier semantics (must match Python exactly):
 *   Tier 1 — IMMEDIATE: active, observable hazards and live-work actions.
 *   Always stop, regardless of framing ("which cable to pull" is never a
 *   conceptual question).
 *   Tier 2 — general keywords: stop ONLY when the message is NOT framed as an
 *   educational question ("what is arc flash?" routes to normal handling;
 *   "arc flash just occurred" stops).
 *
 * The Hub previously matched SAFETY_PHRASES unconditionally, so
 * "What is an exploded view?" hard-stopped on the Hub (substring "exploded")
 * while Python routed it to industrial/educational handling (2026-08-04).
 */

import { SAFETY_PHRASES } from "./safety-phrases";

/**
 * Transcription of guardrails.py `SAFETY_KEYWORDS_IMMEDIATE` — do NOT
 * hand-edit without changing guardrails.py (or vice versa); the parity test
 * parses the Python source and fails on any drift.
 */
export const SAFETY_PHRASES_IMMEDIATE: string[] = [
  // Physical observations (reporting, not asking)
  "exposed wire",
  "visible smoke",
  "smoke from",
  "burn mark",
  "melted insulation",
  "electrical fire",
  "live wire",
  "live circuit",
  "live panel",
  "was live",
  "while live",
  // Active isolation attempts — technician is about to act on live equipment
  "which cable to pull",
  "which wire to pull",
  "pull the cable",
  "cut the power",
  "cut power",
  "disconnect power",
  "disconnect the power",
  "isolate power",
  // Active electrical arc/spark observations — never educational
  "arcing",
  "is arcing",
  // Active incidents — never educational
  "smell burning",
  "burning smell",
  "smoke coming",
  "got shocked",
  "just exploded",
  // Live-work permission ask — must STOP, not educate
  "safe to work",
];

/**
 * Byte-identical transcription of guardrails.py `_EDUCATIONAL_QUESTION_RE`'s
 * pattern (case-insensitive). Messages matching this are asking *about* a
 * safety concept, not reporting an active hazard.
 */
export const EDUCATIONAL_QUESTION_PATTERN =
  "^(what|when|where|why|how|which|who|can you|could you|" +
  "is it|are there|does|do you|the |an |a[\\s']|during |per |under |" +
  "define|explain|describe|list|what'?s)\\b";

const EDUCATIONAL_QUESTION_RE = new RegExp(EDUCATIONAL_QUESTION_PATTERN, "i");

/**
 * Energized-electrical hazard-intent detection (NFPA 70E compliance, issue #3763).
 * Mirrors `_LETHAL_VOLTAGE_CONTEXT` in guardrails.py.
 * Parity-pinned: changes must sync between Python and TypeScript.
 */
export const LETHAL_VOLTAGE_CONTEXT = [
  "480v",
  "460v",
  "600v",
  "mcc",
  "motor control center",
  "feeder",
  "switchgear",
  "switchboard",
  "panel interior",
  "bus",
  "dc bus",
  "main panel",
  "service entrance",
  "disconnect switch",
];

/**
 * Energized-electrical hazard-intent detection (NFPA 70E compliance, issue #3763).
 * Mirrors `_ENERGIZED_WORK_INTENT` in guardrails.py.
 * Parity-pinned: changes must sync between Python and TypeScript.
 */
export const ENERGIZED_WORK_INTENT = [
  "while running",
  "while energized",
  "while live",
  "while active",
  "clamp meter",
  "multimeter",
  "voltmeter",
  "ammeter",
  "wattmeter",
  "ohmmeter",
  "megohmmeter",
  "clampmeter",
  "fluke",
  "meter",
  "measure",
  "measure voltage",
  "measure current",
  "check voltage",
  "check current",
  "probe",
  "probing",
  "open the door while",
  "open the panel while",
  "open the cabinet while",
  "open it while",
  "open while",
];

/**
 * Detect intent to work on energized high-voltage equipment.
 * Returns true if the message contains BOTH:
 * - High/lethal voltage context (480V, 460V, 600V, MCC, feeder, etc.)
 * - Work-while-energized intent (clamp meter, measure, probe while running/energized/live)
 *
 * Conjunction gate: both conditions must be true for a dangerous hazard.
 * Deterministic (no LLM) — blocks dangerous prompts before chat routing.
 * Mirrors Python's `detect_energized_electrical_hazard_intent()`.
 */
function startsAtWord(msg: string, phrase: string): boolean {
  let i = msg.indexOf(phrase);
  while (i !== -1) {
    // A phrase that starts with a digit ("480v") may follow letters ("3ph480v",
    // "at480v") — only a preceding digit ("1480v") makes it a different number.
    const blocker = /^[0-9]/.test(phrase) ? /[0-9]/ : /[a-z0-9]/;
    if (i === 0 || !blocker.test(msg[i - 1])) return true;
    i = msg.indexOf(phrase, i + 1);
  }
  return false;
}

export function detectEnergizedElectricalHazardIntent(message: string): boolean {
  const msg = (message || "").toLowerCase().trim();
  if (!msg) return false;

  // A phrase must start at a word boundary: plain substring matching read
  // "modbus" as "bus" (voltage context) and "parameter" as "meter" (energized
  // intent), so "read a parameter over Modbus" hard-stopped as energized work.
  const hasVoltageContext = LETHAL_VOLTAGE_CONTEXT.some((phrase) =>
    startsAtWord(msg, phrase)
  );
  const hasEnergizedIntent = ENERGIZED_WORK_INTENT.some((phrase) =>
    startsAtWord(msg, phrase)
  );

  return hasVoltageContext && hasEnergizedIntent;
}

/**
 * Sentinel returned by matchSafetyStop for the energized-electrical
 * hazard-intent conjunction (#3763). Callers route it to the NFPA 70E
 * directive (answer streams, framed) instead of the terminal SAFETY_STOP.
 */
export const ENERGIZED_ELECTRICAL_HAZARD = "energized-electrical-hazard";

/**
 * The phrase that triggers a safety stop, or null when the message should
 * take the normal chat path. Mirrors Python's two-tier short-circuit on the
 * lowercased, trimmed message.
 */
export function matchSafetyStop(text: string): string | null {
  const msg = (text || "").toLowerCase().trim();
  if (!msg) return null;

  // Tier-1 immediate phrases keep absolute precedence: a message that matches
  // one must hard-stop exactly as before — the hazard-intent sentinel below
  // only ADDS protection for prompts that previously flowed through unguarded.
  for (const phrase of SAFETY_PHRASES_IMMEDIATE) {
    if (msg.includes(phrase)) return phrase;
  }

  // Energized-electrical hazard-intent detection (NFPA 70E, issue #3763).
  // Conjunction gate: high-voltage context + work-while-energized intent.
  // Returns special sentinel so caller can route to directive (not SAFETY_STOP).
  if (detectEnergizedElectricalHazardIntent(msg)) {
    return ENERGIZED_ELECTRICAL_HAZARD;
  }

  for (const phrase of SAFETY_PHRASES) {
    if (msg.includes(phrase)) {
      return EDUCATIONAL_QUESTION_RE.test(msg) ? null : phrase;
    }
  }
  return null;
}

/**
 * OWNER DECISION 2026-09-27 (Mike): "no answer blocking, just safety flags".
 * A detected hazard FRAMES the answer; it never replaces it. Detection is
 * unchanged (it picks the banner). SAFETY_STOP below is kept only so turns
 * persisted before this decision still render on reload.
 *
 * The banner names the specific hazard in one or two lines, then the answer
 * follows. Classes are matched on the trigger the detector returned.
 */
const HAZARD_BANNER_CLASSES: Array<{ re: RegExp; banner: string }> = [
  {
    re: /smoke|fire|burning|burn mark|melted|exploded|shocked|arcing/,
    banner:
      "⚠️ **Possible active incident.** If anything is smoking, arcing or burning, or someone was shocked: get clear, isolate power from a safe distance and call for help first. The steps below are for once the scene is safe.",
  },
  {
    re: /energized-electrical-hazard|live|energized|exposed wire|480|600v|arc flash/,
    banner:
      "⚠️ **Energized electrical work.** Qualified person, arc-flash PPE and an energized-work permit (NFPA 70E). De-energize and verify zero energy whenever the task allows.",
  },
  {
    re: /cut (the )?power|disconnect (the )?power|isolate power|pull the cable|which (cable|wire) to pull|lockout|tagout|loto|safe to work/,
    banner:
      "⚠️ **Isolation.** Lock and tag every energy source (electrical, pneumatic, hydraulic, gravity) and verify zero energy before hands-on work.",
  },
  { re: /confined/, banner: "⚠️ **Confined space.** Entry permit, atmosphere test and an attendant before entry." },
  {
    re: /pressure|hydraulic|pneumatic|bleed/,
    banner: "⚠️ **Stored pressure.** Bleed and block hydraulic/pneumatic energy and verify zero pressure first.",
  },
  { re: /chemical|ammonia|chlorine|acid|caustic/, banner: "⚠️ **Chemical hazard.** Check the SDS and wear the PPE it lists." },
  { re: /fall|height|ladder|lift/, banner: "⚠️ **Working at height.** Fall protection and a stable platform." },
  {
    re: /rotating|guard|moving|conveyor|pinch|entangle/,
    banner: "⚠️ **Moving machinery.** Lock out motion and block gravity-loaded parts before reaching in.",
  },
  { re: /hot work|weld|torch|grind/, banner: "⚠️ **Hot work.** Hot-work permit and a fire watch." },
];

/** One-to-two-line hazard banner shown ABOVE the full answer. */
export function hazardBanner(trigger: string): string {
  const t = (trigger || "").toLowerCase();
  for (const c of HAZARD_BANNER_CLASSES) if (c.re.test(t)) return c.banner;
  return "⚠️ **Safety flag.** This task involves a hazard. Isolate and verify zero energy before hands-on work.";
}

/** Prompt directive for a flagged (non-electrical) turn: answer fully, keep
 *  isolation conditions inline at the step they apply, no lecture. */
export function safetyFlagDirective(trigger: string): string {
  return `## SAFETY FLAG: ${trigger}

The question touches a hazard. Answer it fully and specifically — a technician
who asks this is going to do the work either way, and a refusal sends them in
less informed. State the isolation / zero-energy / PPE condition inline, at the
step it applies to. One line of hazard framing at most; never a lecture in
place of the answer. The UI already shows a safety banner above your answer.`;
}

/** Prompt directive for a flagged turn: the NFPA 70E directive for the
 *  energized-work sentinel, the generic flag directive for everything else. */
export function flagDirectiveFor(trigger: string): string {
  return trigger === ENERGIZED_ELECTRICAL_HAZARD ? ELECTRICAL_HAZARD_DIRECTIVE : safetyFlagDirective(trigger);
}

/** Shared hard-stop reply — one copy, both chat routes render it. */
export const SAFETY_STOP = `⛔ SAFETY STOP

This question involves a safety-critical topic. Do not proceed without:

1. Following your site's lockout/tagout (LOTO) procedure
2. Confirming all energy sources are isolated and verified zero-energy
3. Consulting a qualified person or supervisor before continuing

MIRA will not provide guidance that bypasses safety controls.
Contact your safety officer or supervisor immediately.`;

/**
 * Energized-electrical hazard-intent directive (NFPA 70E compliance, issue #3763).
 * Injected into system prompt for hazard-intent cases — NOT a hard stop.
 * The answer still streams, but framed with mandatory qualified-person + arc-flash/PPE elements.
 */
export const ELECTRICAL_HAZARD_DIRECTIVE = `## ELECTRICAL SAFETY: High-Voltage Energized Work

The question involves working on or measuring equipment energized at lethal voltage
(480V+). NFPA 70E requires:

- **Qualified Person Only**: Only a person trained in electrical safety and shock hazards can perform this work
- **Arc Flash Boundary**: An arc flash boundary exists around energized equipment. Never enter it without proper PPE
- **Required PPE**: Arc-rated clothing, face shield, and insulating gloves rated for the voltage
- **Live-Work Permit**: A live-work permit and supervisor approval are mandatory
- **De-Energize First**: When possible, de-energize and verify zero-energy before work (preferred path)

MIRA will answer with mandatory framing: this work requires a qualified person,
arc-flash awareness, and proper isolation or PPE. Do not proceed without these controls.`;

