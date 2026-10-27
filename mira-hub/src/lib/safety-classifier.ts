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
// Codex F1 (rounds 1–2): a definitional OPENER does not make a definitional
// ASK — "Explain how to pull the RFI jumper with it powered", "Describe
// replacing the fan without locking out", "What do I need to pull the RFI
// jumper with it powered?" all opened with an exempt word and reached
// generation. Round 1 enumerated procedural openers and lost to the next
// phrasing in round 2, so the test is now on INTENT, not the opener: the
// exemption holds only when the message shows no energized-work intent — a
// powered / skip-lockout state together with a hands-on verb, a work object,
// or powered contact. "Explain the lockout procedure" (no powered state) and
// "what is working live" (no verb or object) stay definitional.

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
// "powered" ONLY when not followed by off / down (space or hyphen) — the
// safe state (Codex F3, rounds 1–2: "with it powered off", "still powered
// off", "powered-off" were all classified energized). One token, used by
// every alternative below, so no alternative can forget it.
const PW = "powered(?![\\s-]+(?:off|down)\\b)";
const POWERED_STATE_RE = new RegExp(
  "\\b(?:" +
    [
      // "while it's powered", "while the drive is live", "while still hot"
      // "its" without the apostrophe is how technicians actually type it
      // (round-2 review: "pull the jumper while its powered" walked past).
      // Codex round 4: the copula was enumerated ("is", "'s") and "remains
      // energized", "stays powered", "is kept live", "turned on", "switched on"
      // all walked past. One alternative, with an OPTIONAL copula drawn from a
      // list of state verbs: <while|with|when> <subject> [copula] [still] <state>.
      `(?:while|with|when)\\s+(?:it|its|this|that|them|the\\s+\\w+(?:\\s+\\w+)?)(?:'s|\\s+is|\\s+remains|\\s+stays|\\s+is\\s+kept|\\s+is\\s+left)?\\s+(?:still\\s+)?(?:live|${PW}(?:\\s+up|\\s+on)?|energi[sz]ed|hot|running|turned\\s+on|switched\\s+on)`,
      // Codex round 5: "while the drive is on" — the plainest state of all.
      // "on" needs the copula ("with the cover on" is a cover, not a state).
      "(?:while|with|when)\\s+(?:it|this|that|they|the\\s+\\w+(?:\\s+\\w+)?)(?:'s|\\s+is|\\s+are|\\s+remains|\\s+stays)\\s+(?:still\\s+)?on\\b",
      // …and without the copula ONLY when the subject is the machine or its
      // power ("with the unit on"), never a part ("with the cover on").
      "(?:while|with|when)\\s+(?:the\\s+)?(?:power|drive|unit|machine|panel|system|line|breaker|controller|vfd|plc|motor|inverter|supply|mains?)\\s+(?:still\\s+)?on\\b",
      // Codex round 5: an affirmative state ASSERTION as its own sentence —
      // "The drive is energized. How do I remove the cover?" — no while/with/
      // when at all. Anchored to a sentence start so "the display is live"
      // mid-sentence prose is not a state. "on" is excluded here ("The cover
      // is on." names a cover) and so is "hot" ("the bearing is hot to the
      // touch" is temperature — the existing control).
      `(?:^|[.;!?]\\s+)(?:it|this|that|they|everything|the\\s+\\w+(?:\\s+\\w+)?)(?:'s|\\s+is|\\s+are|\\s+remains|\\s+stays)\\s+(?:still\\s+)?(?:live|energi[sz]ed|${PW}(?:\\s+up|\\s+on)?)\\b`,
      // "while still hot", "while powered" — no subject at all
      `while\\s+(?:still\\s+)?(?:live|${PW}(?:\\s+up|\\s+on)?|energi[sz]ed|hot|running)`,
      // "keep it running and swap the fan" — a running-only (weak) state, so
      // it still needs a PHYSICAL verb or a work object to stop.
      "keep\\s+(?:it|them|this|that|the\\s+\\w+(?:\\s+\\w+)?)\\s+running",
      "with\\s+(?:the\\s+|it's\\s+|its\\s+)?power\\s+(?:still\\s+)?(?:on|applied|connected)",
      // "while the power is still on", "while power is applied" — the `while …
      // is` form of the line above; it fell through until the 2026-10-18
      // scope pass (measured false on 24abb8e8a).
      "while\\s+(?:the\\s+)?power\\s+(?:is\\s+)?(?:still\\s+)?(?:on|applied|connected)",
      "power\\s+still\\s+on",
      // Codex round 6: "The drive is on. How do I remove the cover?" — the
      // standalone machine-is-on assertion. Only a MACHINE / power subject
      // ("The cover is on." names a cover) and only at a sentence start.
      "(?:^|[.;!?]\\s+)(?:the\\s+)?(?:power|drive|unit|machine|panel|system|line|breaker|controller|vfd|plc|motor|inverter|supply|mains?)(?:'s|\\s+is|\\s+remains|\\s+stays)\\s+(?:still\\s+)?on\\b",
      // Codex round 6: "while it has power", "if the drive still has power"
      "(?:while|with|when|if)\\s+(?:it|this|that|they|the\\s+\\w+(?:\\s+\\w+)?)\\s+(?:still\\s+)?(?:has|have)\\s+power\\b",
      // not "under power-loss conditions" (round-2 review)
      "under\\s+power(?!-)",
      `still\\s+(?:energized|live|${PW}|hot)`,
      "live\\s+wire",
      "live\\s+circuit",
      "live\\s+panel",
      "live\\s+bus(?:bar)?",
      "energized\\s+conductor",
    ].join("|") +
    ")\\b",
  "i",
);
// A spec ask ABOUT doing the work ("what torque on the cover screws while
// it's live?") names no verb at all — the object is the tell. Review A HIGH:
// "jumper" was missing, and the real TQ-29 string is about pulling an RFI
// jumper. "connector" was added in the 2026-10-18 scope pass for the same
// reason: a verb-less "is the connector safe to handle while it's powered?"
// had no object to fire on.
export const WORK_OBJECT_RE =
  /\b(?:torque|screws?|bolts?|cover|panel\s+cover|fan|contactor|relay|fuse|terminals?|lugs?|wires?|connectors?|gasket|belt|coupling|bearing|card|module|keypad|display\s+module|jumpers?|dip\s+switch|battery|filter)\b/i;
// Hands-on work on the equipment: the verbs a technician uses for the job
// itself, not for reading a display or resetting a fault.
export const HANDS_ON_VERB_RE =
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
      // Round-2 review — the live-work phrasings that still got answered:
      // "pull the RFI jumper hot" (verb + object + hot; "is running hot" and
      // "hot to the touch" carry no such verb and stay controls)
      "(?:pull|swap|replac|chang|remov|servic|fix|work\\s+on)\\w*\\s+(?:it|them|this|that|the\\s+\\w+(?:\\s+\\w+)?)\\s+hot",
      "hot[- ]?(?:swap|plug)\\w*",
      // "without killing power", "without shutting it down", "without de-energizing"
      "without\\s+(?:killing|cutting|dropping|removing|isolating|disconnecting)\\s+(?:the\\s+|all\\s+)?power",
      "without\\s+de-?energi[sz]ing",
      "without\\s+(?:powering|shutting|turning)\\s+(?:it|them|this|that|the\\s+\\w+(?:\\s+\\w+)?)?\\s*(?:down|off)",
      // "pull the card before I kill power" — the work is meant to come first
      "before\\s+(?:I|we|you)\\s+(?:kill|cut|drop|shut\\s+off|turn\\s+off|disconnect|remove)\\s+(?:the\\s+)?power",
      // Codex round 4: "before shutting the power off", "before powering it
      // down", "without doing lockout", "without performing LOTO"
      "before\\s+(?:shutting|turning|switching|powering|cutting|killing)\\s+(?:the\\s+|it\\s+|them\\s+)?(?:power\\s+)?(?:off|down)",
      // Codex round 5: the verb–object–particle order — "before I shut the
      // power off", "before I turn it off", "before we power the drive down".
      // The object is the power or the machine, never an arbitrary noun
      // ("before I turn the speed down" is a setting, not isolation).
      "before\\s+(?:I|we|you)\\s+(?:shut|turn|switch|power|cut|kill)\\s+(?:it|them|this|that|(?:the\\s+)?(?:power|supply|drive|machine|unit|line|panel|system|breaker|disconnect|main|mains|cell|conveyor))\\s+(?:off|down)",
      "without\\s+(?:doing|performing|applying|completing|running|following)\\s+(?:a\\s+|the\\s+|any\\s+|proper\\s+)?(?:lock[- ]?out|loto|lockout\\s*/\\s*tagout)",
      // "I can't shut the line down. How do I pull the RFI jumper?"
      "can'?t\\s+(?:shut|take|bring|power)\\s+(?:it|this|that|the\\s+\\w+(?:\\s+\\w+)?)\\s+(?:down|off(?:line)?)",
    ].join("|") +
    ")\\b",
  "i",
);

// Round-2 review: a STATUS report or reading question is a diagnosis turn,
// not a work ask, even when it names a powered machine and a part: "with the
// drive powered up, the keypad shows oL, what do I check?" and "fan running
// while powered, is that normal?" were both hard-stopping — the first on
// "check" + "keypad", the second on "fan". Neither asks to put hands on
// anything. So: a diagnostic marker with NO physical verb is not a stop. An
// explicit lockout skip (SKIP_LOCKOUT_RE) is checked first and still wins.
const DIAGNOSTIC_CONTEXT_RE = new RegExp(
  [
    "\\b(?:shows?|showing|displays?|displaying|reads?|reading|blink\\w*|flash\\w*|indicat\\w*|supposed\\s+to)\\b",
    "\\bis\\s+(?:that|this|it)\\s+normal\\b",
    "\\bnormal\\?", // "…, is that normal?" — no \b after '?' at end of string
    "\\bwhat\\s+(?:do|should|can)\\s+I\\s+(?:check|look|verify|monitor|watch|expect)\\b",
    "\\bwhat\\s+does\\s+.+\\s+(?:mean|indicate)\\b",
  ].join("|"),
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
// Codex round 6: "connect" is hands-on too ("The LED blinks; can I connect
// the jumper with it powered?" was exempted as a diagnostic prefix because
// connect was missing here while present in HANDS_ON_VERB_RE).
const PHYSICAL_VERB_RE =
  /\b(?:swap(?:ping)?|replac(?:e|ing)|chang(?:e|ing)|pull(?:ing)?|remov(?:e|ing)|open(?:ing)?|touch(?:ing)?|rewir(?:e|ing)|tighten(?:ing)?|loosen(?:ing)?|clean(?:ing)?|servic(?:e|ing)|repair(?:ing)?|work(?:ing)? on|connect(?:ing)?|disconnect(?:ing)?|reconnect(?:ing)?|install(?:ing)?|unplug(?:ging)?|plug(?:ging)? in|adjust(?:ing)?|meter(?:ing)?|prob(?:e|ing)|tak(?:e|ing) off|put(?:ting)? on|reach(?:ing)? in)\b/i;

/**
 * Codex round 7 F3: a sentence that NEGATES the hands-on work ("I will not
 * work on it while it is powered.", "Do not replace the fan while it is
 * powered.") is not a request to do it — but its powered-state words were
 * being combined with the next sentence's "How do I replace the fan after
 * locking out?" into an energized-work ask. Such sentences are dropped before
 * the whole-message checks. Only a negation of a HANDS-ON verb counts:
 * "Don't tell me to lock out, how do I pull it with it powered?" negates
 * "tell", keeps its powered-work ask, and still stops.
 */
const NEGATED_WORK_SENTENCE_RE = new RegExp(
  "^\\s*(?:i\\s+|we\\s+|you\\s+)?(?:will\\s+not|won't|do\\s+not|don't|never|am\\s+not\\s+going\\s+to|are\\s+not\\s+going\\s+to|must\\s+not|should\\s+not|shouldn't|would\\s+not|wouldn't)\\s+(?:ever\\s+|be\\s+)?" +
    HANDS_ON_VERB_RE.source.replace(/^\\b/, "").replace(/\\b$/, ""),
  "i",
);
function withoutNegatedWorkSentences(msg: string): string {
  const sentences = msg.split(/(?<=[.!?;])\s+/);
  const kept = sentences.filter((s) => !NEGATED_WORK_SENTENCE_RE.test(s));
  return kept.length === sentences.length ? msg : kept.join(" ");
}

/**
 * Codex round 6 F3: a skip/bypass phrase under NEGATION is the opposite intent
 * — "How do I replace the fan safely without skipping lockout?", "I do not
 * want to bypass the lockout" — and was being refused as energized work. A
 * SKIP_LOCKOUT match counts only when the words right before it do not negate
 * it. The "without lockout" alternatives START with their own "without" and
 * are untouched (the text before them is not a negation).
 */
const NEGATION_BEFORE_RE =
  /\b(?:without|not|never|avoid(?:ing)?|instead\s+of|rather\s+than|no\s+intention\s+of|(?:don't|do\s+not|won't|will\s+not|shouldn't|should\s+not)(?:\s+(?:want|plan|intend|need|have)\s+to)?)\s*$/i;
const SKIP_LOCKOUT_G = new RegExp(SKIP_LOCKOUT_RE.source, "gi");
function skipLockoutIntent(msg: string): boolean {
  for (const m of msg.matchAll(SKIP_LOCKOUT_G)) {
    const before = msg.slice(Math.max(0, m.index! - 40), m.index!);
    if (!NEGATION_BEFORE_RE.test(before)) return true;
  }
  return false;
}
// A reading verb aimed AT a work object is contact, not observation. Rounds
// 2–3 tried a proximity window between verb and object and lost to "measure
// the voltage between the two output terminals"; there is no window now. A
// message is powered CONTACT when it has (a) a meter/probe/touch verb, or a
// test/check verb with a measurand (voltage, current, continuity…), AND (b) a
// contact object — anywhere. "What do I check?" has no measurand and no
// object; "check the fault log" has no object; "the display reads 480 volts"
// has no contact verb.
const METER_VERB_RE = /\b(?:measur|prob|meter|touch)\w*\b/i;
const READ_VERB_RE = /\b(?:test|check)\w*\b/i;
const MEASURAND_RE = /\b(?:voltage|current|continuity|resistance|signal|amps?|volts?|ohms?)\b/i;
const CONTACT_OBJECT_RE =
  /\b(?:terminals?|lugs?|bus(?:\s*bar)?|connectors?|wires?|contactor|relay|fuse|screws?|bolts?|cover|card|module|jumpers?|board|pins?|contacts?)\b/i;
// A bare conductor: "check the bus bar" is contact even without a measurand,
// while "check the keypad" is reading a display.
const CONDUCTOR_RE = /\b(?:terminals?|lugs?|bus(?:\s*bar)?|wires?|connectors?|pins?|contacts?)\b/i;
function isPoweredContact(msg: string): boolean {
  if (METER_VERB_RE.test(msg) && CONTACT_OBJECT_RE.test(msg)) return true;
  return READ_VERB_RE.test(msg) && (MEASURAND_RE.test(msg) ? CONTACT_OBJECT_RE.test(msg) : CONDUCTOR_RE.test(msg));
}

/** A whole-message "what is X" / "what does X mean" definition — the one
 *  shape that stays definitional even when X is itself a skip-lockout phrase
 *  ("what is working live", "what does lockout tagout mean"). */
const PURE_DEFINITION_RE =
  /^\s*what(?:'s|\s+is|\s+are|\s+does)\s+(?:the\s+(?:term|phrase|word)\s+)?["']?(?:[\w/-]+\s*){1,4}["']?\s*(?:mean|means|stand\s+for|refer\s+to)?\s*\??\s*$/i;

/** Energized-work INTENT, opener-agnostic: a powered or skip-lockout state
 *  together with a hands-on verb, a work object, or powered contact. */
function hasEnergizedWorkIntent(msg: string): boolean {
  const state = skipLockoutIntent(msg) || POWERED_STATE_RE.test(msg);
  if (!state) return false;
  return HANDS_ON_VERB_RE.test(msg) || WORK_OBJECT_RE.test(msg) || isPoweredContact(msg);
}

export function isEnergizedWorkAsk(message: string): boolean {
  const msg = (message || "").toLowerCase().trim();
  if (!msg) return false;
  // Definitional only — see DEFINITIONAL_RE. The wide parity-pinned pattern
  // exempted "How do I swap the fan while it's powered?" and every other
  // procedural phrasing, which is the whole of TQ-29. An exempt opener on a
  // message that carries energized-work INTENT is not definitional (Codex F1),
  // and neither is one that explicitly asks to skip the lockout ("Explain how
  // to bypass the lockout" — Codex F1 round 3), unless the whole message is a
  // pure "what is X" definition ("what is working live").
  if (
    DEFINITIONAL_RE.test(msg) &&
    !hasEnergizedWorkIntent(msg) &&
    !(skipLockoutIntent(msg) && !PURE_DEFINITION_RE.test(msg))
  )
    return false;
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
  if (skipLockoutIntent(msg)) return true;
  // Codex round 7 F3: evaluate the powered state and the work ask only over
  // the sentences that do not NEGATE the work (see NEGATED_WORK_SENTENCE_RE).
  const msgEff = withoutNegatedWorkSentences(msg);
  if (!POWERED_STATE_RE.test(msgEff)) return false;
  // A status report / reading question with no hands-on verb is diagnosis,
  // not energized work (round-2 review false positives) — unless the message
  // also asks to put a meter or probe ON a work object ("…can I measure the
  // terminals with it powered?"): a symptom sentence in front of that request
  // does not make it observation-only (Codex F2).
  if (DIAGNOSTIC_CONTEXT_RE.test(msgEff) && !PHYSICAL_VERB_RE.test(msgEff) && !isPoweredContact(msgEff)) return false;
  // A "running"-only powered state is too weak to pair with a reading verb.
  // Codex round 7 F1: powered CONTACT ("meter the pins with it powered") is
  // sufficient on its own — it was computed for the exemption above and then
  // discarded here, so "meter" / "pins" fell through the verb / object lists.
  if (isPoweredContact(msgEff)) return true;
  const strongState = POWERED_STATE_RE.test(msgEff.replace(RUNNING_ONLY_RE, ""));
  return strongState
    ? HANDS_ON_VERB_RE.test(msgEff) || WORK_OBJECT_RE.test(msgEff)
    : PHYSICAL_VERB_RE.test(msgEff) || WORK_OBJECT_RE.test(msgEff);
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

