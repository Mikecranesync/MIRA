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
/**
 * ACTIVE INCIDENT — the ONLY thing that still stops a turn.
 *
 * Tier-1 conflated two different situations. Someone reporting "I got shocked"
 * or "smoke coming from the panel" is an emergency: answering their
 * troubleshooting question is the wrong response, and escalation is the right
 * one. But "cut power", "isolate power", "live panel", "safe to work" and
 * "which wire to pull" are ORDINARY TECHNICIAN SPEECH — stopping on them is
 * what made MIRA useless. "isolate power" triggering a refusal is perverse: it
 * is the safe action.
 *
 * So the split is by SITUATION, not by vocabulary:
 *   - something is burning / someone is hurt  -> stop and escalate
 *   - anything else                            -> banner, then the full answer
 *
 * Move a phrase between this list and the advisory set to change the policy;
 * nothing else needs to change.
 */
export const ACTIVE_INCIDENT_PHRASES: string[] = [
  "visible smoke",
  "smoke from",
  "smoke coming",
  "electrical fire",
  "smell burning",
  "burning smell",
  "just exploded",
  "got shocked",
  "is arcing",
  "arcing",
];

/** True when the message reports an incident IN PROGRESS, not a question about work. */
export function matchActiveIncident(text: string): string | null {
  const msg = (text || "").toLowerCase().trim();
  if (!msg) return null;
  for (const phrase of ACTIVE_INCIDENT_PHRASES) {
    if (msg.includes(phrase)) return phrase;
  }
  return null;
}

/**
 * A hazard the VISION model found in a photo is an incident on the same terms.
 * A picture of a panel that is arcing, smoking or burning is the equipment
 * failing right now — the technician is standing in front of it, and the right
 * response is "make it safe", not a troubleshooting walkthrough. #3788 made
 * these stop; that stays true.
 *
 * Triggers arrive prefixed (`visual:arcing`), so the bare phrase list is
 * matched against the suffix as well as the whole string.
 */
export function isIncidentTrigger(trigger: string | null | undefined): string | null {
  if (!trigger) return null;
  const t = trigger.toLowerCase();
  const bare = t.startsWith("visual:") ? t.slice("visual:".length) : t;
  for (const phrase of ACTIVE_INCIDENT_PHRASES) {
    if (t.includes(phrase) || bare.includes(phrase)) return trigger;
  }
  // A verified photo hazard is incident-shaped by construction (#3788): the
  // vision model only raises one for damage it can actually see.
  return t.startsWith("visual:") ? trigger : null;
}

/**
 * SAFETY PAUSE — the banner that REPLACES the old refusal.
 *
 * Owner decision 2026-09-22 (Mike): "remove safety stop and make it a safety
 * pause or advise, short and sweet with some graphics, but all of the advice
 * afterwards. Do not stop me or techs doing whatever they want, just warn them."
 *
 * A technician asking why a contactor chatters is going to open that panel
 * either way. Refusing does not remove the hazard — it removes the information
 * and sends them in less informed. So: name the hazard in two lines, then
 * answer in full. The answer carries its own inline isolation conditions
 * (MIRA_CORE "ENERGY STATE"), which is where that guidance actually helps.
 *
 * These are PREPENDED to a real answer. They never replace one.
 */
export const HAZARD_BANNERS: Record<string, string> = {
  "arc flash": "⚡ **ARC FLASH** — arc-rated PPE, face shield, and a live-work permit. Qualified person only.",
  loto: "🔒 **LOCKOUT/TAGOUT** — isolate, lock, tag, and verify zero energy before contact.",
  "confined space": "🕳️ **CONFINED SPACE** — permit, atmospheric test, and an attendant before entry.",
  "hot work": "🔥 **HOT WORK** — permit, fire watch, and clear the area of combustibles.",
  pressure: "💥 **STORED PRESSURE** — bleed down and verify zero pressure; stored energy injures after shutdown.",
  chemical: "☣️ **CHEMICAL EXPOSURE** — check the SDS and wear the specified protection.",
  fall: "🪜 **FALL HAZARD** — tie off above 4 ft / 1.2 m, or use a proper platform.",
  rotating: "⚙️ **ROTATING MACHINERY** — guards in place, or locked out before reaching in.",
  energized: "⚡ **ENERGIZED** — assume live until you have verified it dead at the point of work.",
};

/** Default banner when the class is unknown but a hazard was detected. */
export const HAZARD_BANNER_GENERIC =
  "⚠️ **SAFETY-CRITICAL** — this touches stored or live energy. Verify isolation at the point of work.";

/**
 * Two-line banner for a detected hazard trigger. Never empty when a hazard
 * fired, so a detected hazard is always visible to the technician.
 */
/**
 * ADVISORY-ONLY hazard cues. These NEVER gate a turn — they only decide which
 * banner rides above an answer that is being served anyway.
 *
 * Why a second vocabulary: `SAFETY_PHRASES_IMMEDIATE` is the STOP list, and
 * widening it to get better banner coverage would widen what stops. Hardening
 * round 2 (staging, 2026-09-22, SHA a32a73130) measured the cost of not having
 * this: all six hazardous questions — megger a 480 V motor, lockout order on a
 * hydraulic accumulator, clean the inside of a mix tank, weld near hydraulic
 * lines, take a live reading in a 480 V panel — were answered in full with NO
 * banner at all. The answers were right; the warning half of "warn, do not
 * withhold" simply was not firing.
 *
 * First match wins, so the most specific class is listed first. Cues are
 * deliberately narrow: a conceptual question ("why would a contactor chatter")
 * must NOT collect a banner it did not earn.
 */
const HAZARD_ADVISORY_CUES: readonly (readonly [string, readonly string[]])[] = [
  ["confined space", ["confined space", "inside the tank", "inside the vessel", "inside the silo",
                      "inside the mix tank", "inside the hopper", "enter the tank", "enter the vessel",
                      "manway", "manhole", "clean the inside"]],
  ["hot work", ["hot work", "weld", "welding", "cutting torch", "oxy-acetylene", "brazing",
                "grinding sparks", "torch cut"]],
  ["pressure", ["accumulator", "pressurized", "pressure vessel", "air receiver", "stored pressure",
                "bleed down", "hydraulic line", "charged line"]],
  ["chemical", ["caustic", "solvent", "sulfuric", "acid ", "sds sheet", "safety data sheet",
                "cleaning fluid", "degreaser", "ammonia"]],
  ["fall", ["scaffold", "step ladder", "extension ladder", "catwalk", "mezzanine", "work at height",
            "on the roof", "tie off"]],
  ["rotating", ["reach into", "reach in while", "rotating shaft", "rotating machinery", "coupling guard",
                "remove the guard", "drive chain", "sheave", "nip point"]],
  // NO bare voltage classes here. "The 480V supply to the MCC reads low on the
  // display" is an observation, not hazardous work, and a banner on it is the
  // boy-who-cried-wolf failure that makes technicians stop reading banners.
  ["arc flash", ["arc flash", "arc rated", "switchgear", "bus bar", "busbar"]],
  ["energized", ["energized", "energised", "live panel", "live circuit", "megger", "megohmmeter",
                 "insulation resistance", "voltage reading", "while it is running", "while running"]],
  ["loto", ["lockout", "lock out", "tagout", "tag out", "loto", "zero energy", "isolation procedure"]],
];

/**
 * Which hazard banner, if any, belongs above this answer. Advisory only — it
 * never stops a turn and never changes what MIRA says.
 */
export function detectHazardAdvisory(text: string | null | undefined): string | null {
  const t = (text || "").toLowerCase();
  if (!t) return null;
  for (const [cls, cues] of HAZARD_ADVISORY_CUES) {
    if (cues.some((c) => t.includes(c))) return cls;
  }
  return null;
}

export function hazardBanner(trigger: string | null | undefined): string {
  if (!trigger) return "";
  const t = trigger.toLowerCase();
  for (const [key, banner] of Object.entries(HAZARD_BANNERS)) {
    if (t.includes(key)) return banner;
  }
  return HAZARD_BANNER_GENERIC;
}

/**
 * @deprecated Retained ONLY so stored turns written before 2026-09-22 still
 * render. Nothing may assign this to a new answer — MIRA advises, it does not
 * refuse. Use `hazardBanner()` and keep the answer.
 */
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

