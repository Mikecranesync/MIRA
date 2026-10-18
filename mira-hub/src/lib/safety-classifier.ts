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

  // 2026-10-17 prod-test TQ-30 — the VERB forms of lockout. guardrails.py (and
  // its byte-for-byte transcription SAFETY_PHRASES) carry only the nouns
  // ("lockout tagout", "lockout/tagout", "loto"), so "locking out the drive",
  // "the conveyor is locked out", "lock it out first" all flowed through
  // unflagged. Word-bounded on purpose: "clock out", "block out" and
  // "lookout" are not lockout. Hub-side only — the parity test pins the
  // transcription list, and the bot engine is out of this change's scope.
  return null;
}

/**
 * TQ-30's lockout forms — the NOTEBOOK surface only.
 *
 * Review A MEDIUM: these originally lived inside `matchSafetyStop`, which is
 * shared with `/api/namespace/node/[id]/chat` and `/api/assets/[id]/chat`. So
 * "We locked out the MCC yesterday, what's Addr_CAN_OB?" started carrying a
 * lock-and-tag banner on all three surfaces — an over-trigger on two routes
 * this item was never asked to change. Keeping the forms out of the shared
 * matcher leaves those two routes byte-identical to base, which is also the
 * answer to open decision 4.
 *
 * Word-bounded: "clock out", "block out" and "lookout" are not lockout. Bare
 * "lockout" is included (the parity-pinned transcription list carries only
 * "lockout tagout" / "lockout/tagout" / "loto"). The narrow `DEFINITIONAL_RE`
 * applies, not the wide parity-pinned pattern, which exempted the real
 * reports this is for ("the conveyor is locked out, can I reach in…").
 */
const LOCKOUT_VERB_RE =
  /\block(?:ed|ing)?[- ]?out\b|\block(?:ed|ing)?\s+(?:it|this|that|them|the\s+\w+)\s+out\b/;

/**
 * The notebook route's safety trigger: the shared Tier-1/Tier-2 matcher first
 * (unchanged precedence), then TQ-30's lockout forms.
 *
 * A lockout trigger is a BANNER, never a stop. "Walk me through locking out
 * the M340" is a request for the safe procedure, and answering it is the
 * point — a stop there would send the technician in knowing less. TQ-30 in
 * the task asked only that these be *flagged*; the hard stop was asked for
 * energized-work asks (TQ-29), which `isEnergizedWorkAsk` owns.
 */
export function notebookSafetyTrigger(text: string): string | null {
  const shared = matchSafetyStop(text);
  if (shared) return shared;
  const msg = (text || "").toLowerCase().trim();
  if (!msg || DEFINITIONAL_RE.test(msg)) return null;
  const lockoutVerb = LOCKOUT_VERB_RE.exec(msg);
  return lockoutVerb ? lockoutVerb[0] : null;
}

/**
 * A DEFINITION question — "what is lockout?", "what does LOTO mean?",
 * "explain arc flash". Deliberately much narrower than the parity-pinned
 * `EDUCATIONAL_QUESTION_PATTERN`, which opens with
 * `what|when|where|why|how|which|who|can you|is it|the |an |a ` and therefore
 * exempts the procedural asks that matter most:
 *
 *   "How do I swap the cooling fan while it's powered?"   ← must STOP
 *   "What torque on the cover screws while it's live?"     ← must STOP
 *   "Is it OK to change the contactor without locking out?" ← must STOP
 *
 * All three returned `false` from `isEnergizedWorkAsk` under the wide pattern
 * (measured 2026-10-18), which is the TQ-29 failure mode restated. Used ONLY
 * by the Hub-side additions below — `matchSafetyStop`'s transcription-list
 * branch keeps `EDUCATIONAL_QUESTION_RE` so guardrails.py parity is untouched.
 */
const DEFINITIONAL_RE =
  /^\s*(?:what(?:'s|\s+is|\s+are|\s+does|\s+do)\b|define\b|describe\b|explain\b|tell me about\b|how does\b)/i;

/**
 * TQ-29 (2026-10-17 prod test) — an ENERGIZED-WORK ask: the technician wants
 * to do hands-on work (swap, replace, pull, check, measure…) on a machine
 * while it is powered, or wants to skip the lockout to do it. The notebook
 * route hard-stops these (see `@/capabilities/energized-work-stop`) instead
 * of answering under a banner, because the banner-and-answer shape still
 * handed over the removal steps and torques (TQ-29).
 *
 * Deliberately narrower than the hazard FLAG: a mention of a locked-out
 * machine, a verify-zero-energy question, or an educational framing is NOT
 * an energized-work ask. "while running" on its own is not either — a drive
 * display blinks "while running"; only live/powered/energized/hot qualify.
 * Zero-token; mirrors nothing in guardrails.py (Hub-only, like the verb
 * forms above).
 */
// The machine is in a POWERED state in the ask. On its own this is NOT enough
// — "can I reset while energized?" is a reset, not hands-on work, and the
// existing answer-gate tests (E13) rely on it streaming. It needs HANDS_ON too.
// Review A HIGH: the real TQ-29 string is "How do I pull the RFI jumper with
// it powered?" — and EVERY shape below returned false. The old list only knew
// "while it's powered" / "with the power ON", so "with it powered", "with the
// drive powered", "under power", "while running" and "hot" all walked past.
// "while running" and "hot" are deliberately here even though they are
// ambiguous alone: they only fire WITH a hands-on verb or work object, and the
// controls in safety-classifier.test.ts pin the ordinary-diagnostic twins
// ("check the fault log while running", "the motor is running hot").
const POWERED_STATE_RE = new RegExp(
  "\\b(?:" +
    [
      // "while it's powered", "while the drive is live", "while still hot"
      "while\\s+(?:it(?:'s| is)\\s+|it's\\s+|the\\s+\\w+\\s+is\\s+|this\\s+is\\s+|still\\s+|it's\\s+still\\s+|it\\s+is\\s+still\\s+)?(?:live|powered(?:\\s+up|\\s+on)?|energized|hot|running)",
      // "with it powered", "with the drive powered", "with the unit energized"
      "with\\s+(?:it|this|that|them|the\\s+\\w+)\\s+(?:still\\s+)?(?:powered(?:\\s+up|\\s+on)?|live|energized|hot|running)",
      "with\\s+(?:the\\s+|it's\\s+|its\\s+)?power\\s+(?:still\\s+)?(?:on|applied|connected)",
      "power\\s+still\\s+on",
      "under\\s+power",
      "still\\s+(?:energized|live|powered|hot)",
      "live\\s+wire",
      "live\\s+circuit",
      "live\\s+panel",
      "energized\\s+conductor",
    ].join("|") +
    ")\\b",
  "i",
);
// A spec ask ABOUT doing the work ("what torque on the cover screws while
// it's live?") names no verb at all — the object is the tell. Review A HIGH:
// "jumper" was missing, and the real TQ-29 string is about pulling an RFI
// jumper.
const WORK_OBJECT_RE =
  /\b(?:torque|screws?|bolts?|cover|panel\s+cover|fan|contactor|relay|fuse|terminals?|lugs?|wires?|gasket|belt|coupling|bearing|card|module|keypad|display\s+module|jumpers?|dip\s+switch|battery|filter)\b/i;
// Hands-on work on the equipment: the verbs a technician uses for the job
// itself, not for reading a display or resetting a fault.
const HANDS_ON_VERB_RE =
  /\b(?:swap(?:ping)?|replac(?:e|ing)|chang(?:e|ing)|pull(?:ing)?|remov(?:e|ing)|open(?:ing)?|check(?:ing)?|measur(?:e|ing)|prob(?:e|ing)|test(?:ing)?|touch(?:ing)?|rewir(?:e|ing)|tighten(?:ing)?|loosen(?:ing)?|clean(?:ing)?|servic(?:e|ing)|repair(?:ing)?|work(?:ing)? on|disconnect(?:ing)?|reconnect(?:ing)?|connect(?:ing)?|install(?:ing)?|unplug(?:ging)?|plug(?:ging)? in|adjust(?:ing)?|tak(?:e|ing) off|put(?:ting)? on|reach(?:ing)? in)\b/i;
// Explicit intent to do the job without isolating — a stop regardless of verb.
const SKIP_LOCKOUT_RE = new RegExp(
  "\\b(?:" +
    [
      "working live",
      "working on live",
      "without (?:a |the |any |first )?(?:lock[- ]?out|locking (?:it |this |that |the \\w+ )?out|loto|lockout ?/ ?tagout)",
      "skip(?:ping)? (?:the |a )?(?:lock[- ]?out|loto)",
      "bypass(?:ing)? (?:the |a )?(?:lock[- ]?out|loto)",
      // Trade slang that IS the intent on its own — no second signal needed
      // ("can I do it hot"). Review A: this returned false before.
      "(?:do|work|service|fix|run)\\s+it\\s+hot",
      "hot\\s+work\\s+it",
    ].join("|") +
    ")\\b",
  "i",
);

const ACTIVE_INCIDENT_RE =
  /\b(?:visible smoke|smoke from|smoke coming|burn mark|melted insulation|electrical fire|arcing|smell burning|burning smell|got shocked|just exploded)\b/;

// "while running" on its own is the WEAKEST powered-state signal — a drive
// display blinks while running, and "check the fault log while running" is
// reading data, not hands-on work (Review A's own over-trigger control). So a
// running-only ask needs a PHYSICAL verb or a work object, where reading
// verbs (check/measure/probe/test/read/monitor) do not count on their own.
// Every other powered-state phrase ("with it powered", "under power", "still
// hot") is explicit enough to pair with any hands-on verb.
const RUNNING_ONLY_RE = /\brunning\b/i;
const PHYSICAL_VERB_RE =
  /\b(?:swap(?:ping)?|replac(?:e|ing)|chang(?:e|ing)|pull(?:ing)?|remov(?:e|ing)|open(?:ing)?|touch(?:ing)?|rewir(?:e|ing)|tighten(?:ing)?|loosen(?:ing)?|clean(?:ing)?|servic(?:e|ing)|repair(?:ing)?|work(?:ing)? on|disconnect(?:ing)?|reconnect(?:ing)?|install(?:ing)?|unplug(?:ging)?|plug(?:ging)? in|tak(?:e|ing) off|put(?:ting)? on|reach(?:ing)? in)\b/i;

export function isEnergizedWorkAsk(message: string): boolean {
  const msg = (message || "").toLowerCase().trim();
  if (!msg) return false;
  // Definitional only — see DEFINITIONAL_RE. The wide parity-pinned pattern
  // exempted "How do I swap the fan while it's powered?" and every other
  // procedural phrasing, which is the whole of TQ-29.
  if (DEFINITIONAL_RE.test(msg)) return false;
  // An ACTIVE incident ("got shocked", "smoke coming", "just exploded") keeps
  // its incident banner + answer (get clear, isolate, call for help) — the
  // 2026-09-27 precedence the route tests pin. Whether an incident report
  // that ALSO asks for live work should stop instead is an open owner call;
  // this stop deliberately does not decide it.
  if (ACTIVE_INCIDENT_RE.test(msg)) return false;
  // A phrase already on the Tier-1 transcription list ("live panel", "while
  // live", "pull the cable") has an owner-decided treatment too: the hazard
  // BANNER above a full answer (2026-09-27, "no answer blocking, just safety
  // flags"), pinned by #4068/2i and the directive suites. This stop therefore
  // claims only the shapes that had NO treatment — "while it's powered",
  // "with the power on", "without locking out" — and leaves every
  // already-classified turn exactly where the owner put it. The cost is
  // explicit: a "…while live" hands-on ask still gets banner-plus-answer, not
  // a stop. That is the open decision raised in the PR, not a silent gap.
  if (SAFETY_PHRASES_IMMEDIATE.some((phrase) => msg.includes(phrase))) return false;
  // NOTE the deliberate omission: `detectEnergizedElectricalHazardIntent`
  // (480 V + meter) is NOT a trigger here. That conjunction already has an
  // owner-decided answer — the NFPA 70E DIRECTIVE, which streams the answer
  // under mandatory qualified-person/arc-flash framing (#3763, #3841, and
  // #3984's "warn and keep troubleshooting"), pinned by four route tests.
  // Taking those turns over would reverse a decision this item was not asked
  // to revisit, so the route gates the stop on `!electricalHazardDirective`
  // and the split is raised for Mike instead.
  if (SKIP_LOCKOUT_RE.test(msg)) return true;
  if (!POWERED_STATE_RE.test(msg)) return false;
  // A "running"-only powered state is too weak to pair with a reading verb.
  const strongState = POWERED_STATE_RE.test(msg.replace(RUNNING_ONLY_RE, ""));
  return strongState
    ? HANDS_ON_VERB_RE.test(msg) || WORK_OBJECT_RE.test(msg)
    : PHYSICAL_VERB_RE.test(msg) || WORK_OBJECT_RE.test(msg);
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
    // TQ-30: the verb forms ("locked out", "locking out", "lock it out") land
    // here too — the matched text IS the trigger, so the class must read them.
    re: /cut (the )?power|disconnect (the )?power|isolate power|pull the cable|which (cable|wire) to pull|lock(ed|ing)?[- ]?out|lock (it|this|that|them|the \w+) out|tagout|loto|safe to work/,
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

