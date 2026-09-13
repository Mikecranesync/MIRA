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
export function detectEnergizedElectricalHazardIntent(message: string): boolean {
  const msg = (message || "").toLowerCase().trim();
  if (!msg) return false;

  const hasVoltageContext = LETHAL_VOLTAGE_CONTEXT.some((phrase) =>
    msg.includes(phrase)
  );
  const hasEnergizedIntent = ENERGIZED_WORK_INTENT.some((phrase) =>
    msg.includes(phrase)
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

