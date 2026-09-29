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
 * #4113: an IMPROVISED lockout — a valve, knob, regulator or override that
 * people rely on instead of the machine's energy-control procedure, or air
 * turned off and a part then moved by hand. Hub-only sentinel (like the
 * energized-work one); it FLAGS the turn (banner + directive), never stops it.
 * A genuine lockout question ("lock out the air supply valve", "how do I
 * perform lockout tagout") is NOT this shape and stays unflagged.
 */
export const IMPROVISED_LOCKOUT = "improvised-lockout";

const LOCKOUT_TERM = "(?:lock[-\\s]?out|loto)";
// Devices that are NOT energy-isolating devices when relied on as a lockout.
// An approved disconnect, breaker or isolation valve with a padlock is a real
// lockout and is deliberately absent (#4114 review round 2 F5).
const IMPROVISED_DEVICE =
  "(?:knob|button|regulator|override|selector|push[-\\s/]?lock|e[-\\s]?stop|stop\\s+button|interlock|gate\\s+switch|guard\\s+switch|solenoid|(?:check|control|pilot|dump|manual)\\s+valve|valve)";
const USED_AS_LOCKOUT = new RegExp(
  "\\b" + IMPROVISED_DEVICE + "\\b[^.?!]{0,40}?\\b(?:as|for)\\s+(?:a|an|the|their|our|my)?\\s*" + LOCKOUT_TERM + "\\b" +
    "|\\b" + IMPROVISED_DEVICE + "\\b[^.?!]{0,40}?\\binstead\\s+of\\s+(?:a\\s+|the\\s+)?" + LOCKOUT_TERM + "\\b" +
    "|\\b" + LOCKOUT_TERM + "\\s+(?:with|using|by)\\s+(?:the\\s+|a\\s+|its\\s+)?(?:red\\s+)?" + IMPROVISED_DEVICE + "\\b",
  "i",
);
// Stored-energy source turned off / vented, then a PERSON moves something by
// hand. #4114 review F2: a machine moving on its own ("the cylinder moves
// slowly") is not this shape — the move must be a person's or explicitly manual.
const OFF_THEN_MOVE_BY_HAND = new RegExp(
  "\\b(?:regulator|air|pressure|supply)\\b[^.?!]{0,40}?\\b(?:off|closed|shut|bled|dumped|vented|exhausted)\\b[^?!]{0,80}?" +
    "(?:\\b(?:we|they|people|operators?|i|you|someone|he|she|techs?|technicians?|workers?)\\b[^.?!]{0,25}?\\b(?:push|pull|move|lift|shove|open|close|reach|climb)(?:es|ed|ing|s)?\\b" +
    "|\\b(?:by\\s+hand|manually|hand[-\\s]?push(?:es|ed|ing)?)\\b)",
  "i",
);

export function detectImprovisedLockout(message: string): boolean {
  const msg = (message || "").toLowerCase();
  return USED_AS_LOCKOUT.test(msg) || OFF_THEN_MOVE_BY_HAND.test(msg);
}

/**
 * The phrase that triggers a safety stop, or null when the message should
 * take the normal chat path. Mirrors Python's two-tier short-circuit on the
 * lowercased, trimmed message.
 */
export function matchSafetyStop(text: string): string | null {
  const msg = (text || "").toLowerCase().trim();
  if (!msg) return null;

  // Tier-1 immediate phrases keep absolute precedence, and the energized
  // sentinel keeps its place after them, exactly as before #4113: this change
  // never displaces an existing primary trigger. When an improvised lockout is
  // ALSO present, its directive is appended to whichever directive wins, via
  // improvisedLockoutAddendum (#4114 review round 2 F1).
  for (const phrase of SAFETY_PHRASES_IMMEDIATE) {
    if (msg.includes(phrase)) return phrase;
  }

  // Energized-electrical hazard-intent detection (NFPA 70E, issue #3763).
  // Conjunction gate: high-voltage context + work-while-energized intent.
  // Returns special sentinel so caller can route to directive (not SAFETY_STOP).
  if (detectEnergizedElectricalHazardIntent(msg)) {
    return ENERGIZED_ELECTRICAL_HAZARD;
  }

  // #4113: an improvised lockout is a flag even when the message opens like a
  // question — "what position should I leave it in?" is still the hazard.
  if (detectImprovisedLockout(msg)) {
    return IMPROVISED_LOCKOUT;
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
    re: /^improvised-lockout$/,
    banner:
      "⚠️ **Not a lockout.** A valve, knob, regulator or manual override does not isolate energy for people. Use the machine's authorized lockout procedure: lock every energy source, release or block stored air pressure, springs and gravity, verify zero energy — and keep out of the path of anything that can move.",
  },
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
/** The improvised-lockout directive, appended to whichever directive owns the
 *  turn when the message ALSO describes an improvised lockout (#4114 round 2
 *  F1). Empty when it is already the primary trigger or not present. */
export function improvisedLockoutAddendum(message: string | null | undefined, trigger: string | null | undefined): string {
  if (!message || trigger === IMPROVISED_LOCKOUT || !detectImprovisedLockout(message)) return "";
  return `\n\n${IMPROVISED_LOCKOUT_DIRECTIVE}`;
}

export function safetyFlagDirective(trigger: string, message = ""): string {
  if (trigger === IMPROVISED_LOCKOUT) return IMPROVISED_LOCKOUT_DIRECTIVE;
  return genericFlagDirective(trigger) + improvisedLockoutAddendum(message, trigger);
}

function genericFlagDirective(trigger: string): string {
  return `## SAFETY FLAG: ${trigger}

The question touches a hazard. Answer it fully and specifically — a technician
who asks this is going to do the work either way, and a refusal sends them in
less informed. State the isolation / zero-energy / PPE condition inline, at the
step it applies to. One line of hazard framing at most; never a lecture in
place of the answer. The UI already shows a safety banner above your answer.`;
}

/** #4113 directive: answer the component question, but never endorse an
 *  improvised device as personnel protection or tell anyone to move a part. */
export const IMPROVISED_LOCKOUT_DIRECTIVE = `## SAFETY FLAG: improvised lockout

The message suggests a control (valve, knob, regulator, override…) is being
relied on as a lockout, or that air is turned off and a part then moved by hand.
- Answer what the component is and what it does, from the evidence you have; say
  plainly what you could not confirm.
- State directly that such a control (or a regulator position) is NOT a
  personnel lockout unless the site's procedure names it as an energy-isolating
  device, and that the machine's authorized energy-control procedure governs:
  lock every energy source, release or block stored pressure, springs and
  gravity, and verify zero energy.
- NEVER instruct them to push, pull or move the gate/part, press an override, or
  bleed air "to test" it. Stored pressure or gravity can move it.
- If they are relying on it as a lockout today, say to stop and escalate to
  their supervisor / safety lead before anyone works in the path.
The UI already shows a safety banner above your answer.`;

/** A flagged turn shows its banner on EVERY outcome, including errors and
 *  refusals (a 412, a 503, a stopped stream): prefix a user-visible message. */
export function withSafetyFlag(text: string, trigger: string | null | undefined): string {
  return trigger ? `${hazardBanner(trigger)}\n\n${text}` : text;
}

/** Response header naming the flag, for observability on non-answer outcomes. */
export function safetyFlagHeaders(trigger: string | null | undefined): Record<string, string> | undefined {
  return trigger ? { "X-Safety-Flag": trigger } : undefined;
}

/** Prompt directive for a flagged turn: the NFPA 70E directive for the
 *  energized-work sentinel, the generic flag directive for everything else. */
export function flagDirectiveFor(trigger: string, message = ""): string {
  return trigger === ENERGIZED_ELECTRICAL_HAZARD
    ? ELECTRICAL_HAZARD_DIRECTIVE + improvisedLockoutAddendum(message, trigger)
    : safetyFlagDirective(trigger, message);
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

