/**
 * Hard rule (Mike, 2026-11-19, #5232): every request to bypass safety gets a
 * warning card. Owner requirement (technician audit, #5721, 2026-11-21): an
 * operative request to defeat a safety device is REFUSED, not merely flagged.
 *
 * Supersedes the September "flags, not answer blocking" scope for this one
 * class. Ordinary safety flags still never block (owner decision 2026-09-27);
 * a request to take a guard door out of an STO circuit, jumper an interlock or
 * defeat an e-stop is an operative unsafe act, not a hazard to be answered
 * with a banner. Definitions ("what does bypassing an interlock mean?") and
 * status read-outs ("drive shows STO disabled") are not operative and are not
 * matched.
 *
 * Shape (same contract as the energized-work stop, one store, one stream):
 *   - The chat route ends the turn with BYPASS_STOP_TEXT before any source,
 *     machine, retrieval or provider step. A persisted terminal safety_stop
 *     plus safety_notice, replayed from storage on reload.
 *   - It calls no provider, no retrieval and no semantic judge. So a provider
 *     outage, a rejected draft or an undecided judge has nothing to release.
 *   - It is NOT a safetyTrigger: it never unlocks the evidence-free diagnostic
 *     lane and never feeds a diagnostic prompt. Any OTHER hazard on the same
 *     turn is shown beside it, not in place of it.
 *   - The text is fixed server copy with no manual page and no steps. It
 *     neither confirms the proposal nor cites the manual as permission; the
 *     authority is the site's written procedure and a qualified person.
 *
 * Zero-token, deterministic, Hub-only.
 */

/** Fixed card shown above the turn. No page citation (see header). */
export const BYPASS_BANNER =
  "⚠️ **Safety bypass.** Don't run or test with an e-stop, interlock, guard, STO or someone else's lock defeated. Find and fix why it tripped first. If a test truly needs a bypass, use your site's written bypass procedure with sign-off, and keep everyone clear of motion.";

/** Trigger recorded on the persisted stop. Deliberately not a `safetyTrigger` of the question classifier. */
export const BYPASS_STOP_TRIGGER = "safety-device-bypass";

/**
 * The refusal body. Fixed text; no steps, no energization instructions, no
 * page. It does not say the request is fine, and it names the only route.
 */
export const BYPASS_REFUSAL =
  "I can't help take a safety device out of service or work around it, and nothing here confirms that it is allowed. " +
  "That covers removing a guard door or interlock from an STO or e-stop circuit, jumpering it, or having the PLC stand in for it. " +
  "STO on a drive does not make it safe to work with a guard open, and a manual's description of a drive feature is not permission to change the machine's safety circuit. " +
  "A change to a safety function needs your site's written procedure, sign-off from a qualified safety person and the machine maker's own instructions. " +
  "Until then keep the guard and interlock in service, lock the machine out before anyone reaches in, and keep everyone clear of motion.";

/** The whole stop: the card, any other hazard banner of the same turn beside it, then the refusal. */
export function bypassStopText(otherHazardBanner?: string | null): string {
  return [BYPASS_BANNER, otherHazardBanner ?? null, BYPASS_REFUSAL].filter(Boolean).join("\n\n");
}

/**
 * The guardrails.py SAFETY_ACTION_PHRASES that name defeating a safety device
 * or someone else's lock, carried verbatim. Pinned to the Python source by
 * safety-bypass-advisory.test.ts.
 */
export const PYTHON_BYPASS_PHRASES: readonly string[] = [
  // Guards, interlocks, emergency stops
  "bypass the e-stop",
  "bypass the estop",
  "bypass the emergency stop",
  "jumper out the",
  "jumper the interlock",
  "jumper the door switch",
  "defeat the interlock",
  "defeat the guard",
  "took the guard off",
  "with the guard off",
  "removed the guard",
  "guard off to",
  // Someone else's lockout lock
  "cut the lock",
  "lock is someone else",
  "someone else's lock",
];

const ENERGIZED = "energized work, not a safety-device bypass: a separate hazard class the Hub has not carried yet";
const CONFINED = "confined-space entry, not a safety-device bypass: a separate hazard class the Hub has not carried yet";
const HOT_WORK = "hot work, not a safety-device bypass: a separate hazard class the Hub has not carried yet";
const FALL = "working at height, not a safety-device bypass: a separate hazard class the Hub has not carried yet";

/**
 * The rest of SAFETY_ACTION_PHRASES, with why this card does not carry it.
 * The lockout shortcuts ("skip the lockout", ...) are absent on purpose: the
 * Hub already flags them as safety triggers, and the parity test accepts that.
 */
export const NOT_CARRIED_PYTHON_ACTIONS: Readonly<Record<string, string>> = {
  "panel live": ENERGIZED,
  "measuring voltage while": ENERGIZED,
  "measure voltage while": ENERGIZED,
  "open the cabinet door while": ENERGIZED,
  "open the panel door while": ENERGIZED,
  "open the door while it": ENERGIZED,
  "inside the tank": CONFINED,
  "into the tank": CONFINED,
  "enter the tank": CONFINED,
  "inside the vessel": CONFINED,
  "inside the silo": CONFINED,
  "inside the hopper": CONFINED,
  "going to weld": HOT_WORK,
  "weld the": HOT_WORK,
  "welding on the": HOT_WORK,
  "no harness": FALL,
  "without a harness": FALL,
  "without harness": FALL,
};

/** A safety device. A bare "safety" counts too ("can I bypass safety"). */
const DEVICE =
  "(?:e\\s?[-.]?\\s?stops?|emergency[-\\s]stops?" +
  "|(?:[a-z-]+\\s+)?interlocks?" +
  "|(?:safety|guard|gate|door)\\s+(?:switch(?:es)?|relays?|circuits?|contacts?|inputs?|sensors?|loops?|chains?)" +
  "|safety\\s+(?:mats?|edges?|scanners?|gates?|doors?|plcs?|controllers?|devices?|systems?|functions?)" +
  "|guards?|light[-\\s]curtains?|(?:area|laser)\\s+scanners?|pull[-\\s]cords?|rope[-\\s]pulls?" +
  "|two[-\\s]hand(?:\\s+(?:controls?|buttons?))?|sto|safe\\s+torque\\s+off|safety)";

/** A verb that defeats a device. "jump to" never reaches DEVICE: "to" is not a gap word. */
const VERB =
  "(?:bypass(?:ed|ing)?|jump(?:er(?:ed|ing)?|ed|ing)?(?:\\s+out)?|defeat(?:ed|ing)?|overrid(?:e|ing)" +
  "|disabl(?:e|ed|ing)|cheat(?:ed|ing)?|short(?:ed|ing)?(?:\\s+out)?|tie(?:\\s+(?:down|out|back|off))?" +
  "|tape(?:\\s+(?:down|over|up))?|zip[-\\s]?tie|wire\\s+around" +
  "|ignor(?:e|ed|ing)|circumvent(?:ed|ing)?|bridg(?:e|ed|ing)|(?:get|getting|got|work|working|worked)\\s+around)";

/**
 * Words allowed between the verb and the device: articles, possessives,
 * quantifiers ("one of the", "some of"), places, fillers. A noun phrase of up
 * to four of them is read through (#5670 F1: "bypass one of the interlocks").
 */
const GAP =
  "(?:out|around|past|over|the|a|an|this|that|these|those|my|our|its|their|both|all|each|every" +
  "|one|some|any|either|another|other|certain|particular|specific|of|just|temporarily|quickly|safety|door|gate|cover|access|panel" +
  "|front|rear|left|right|main|whole|machine|line|cell|conveyor|drive|robot|press|filler|upstream|downstream" +
  "|stupid|damn|dang|darn|faulty|bad|broken|new|old)";

/** "bypass the e-stop", "jump out the estop circuit", "wire around the safety relay". */
const VERB_THEN_DEVICE = new RegExp(`\\b${VERB}(?:\\s+${GAP}){0,4}\\s+${DEVICE}\\b`, "i");

/** "the e-stop is bypassed", "with the interlock jumpered". Global: every state mention is judged alone. */
const DEVICE_THEN_STATE = new RegExp(
  `\\b${DEVICE}\\s+(?:(?:is|are|was|were|got|been|being|still|all)\\s+){0,2}` +
    "(?:bypassed|jumpered(?:\\s+out)?|jumped(?:\\s+out)?|defeated|overridden|disabled|shorted(?:\\s+out)?|tied\\s+down|taped\\s+(?:down|over)|cheated)\\b",
  "gi",
);

/** "the drive shows STO disabled" reads a status back; it asks for nothing. */
const READOUT_BEFORE = /\b(?:shows?|showing|reads?|reading|displays?|displaying|says|saying|indicates?|indicating)\s+(?:\S+\s+){0,2}$/i;

/** "how do I bypass it" — the device is named elsewhere in the message. */
const VERB_THEN_PRONOUN = new RegExp(`\\b${VERB}\\s+(?:it|them)\\b`, "i");
const ANY_DEVICE = new RegExp(`\\b${DEVICE}\\b`, "i");

/**
 * "take the guard door out of the STO circuit", "pull the door switch from the
 * safety chain", "the guard door taken out of the STO circuit". Taking a device
 * out of its circuit is the same act as bypassing it. Stays inside one sentence.
 */
const OUT_OF_CIRCUIT_VERB_FIRST = new RegExp(
  `\\b(?:take|takes|taking|taken|took|remove|removing|pull|pulling|drop|dropping|lift|lifting|delete|deleting)\\b[^.?!]{0,40}\\b${DEVICE}\\b[^.?!]{0,30}\\b(?:out\\s+of|from|off)\\b[^.?!]{0,30}\\b(?:circuit|chain|loop|string|logic)\\b`,
  "i",
);
const OUT_OF_CIRCUIT_DEVICE_FIRST = new RegExp(
  `\\b${DEVICE}\\b[^.?!]{0,40}\\b(?:taken|take|taking|removed|pulled|dropped|lifted|deleted)\\s+(?:it\\s+)?(?:out(?:\\s+of)?|off|from)\\b[^.?!]{0,30}\\b(?:circuit|chain|loop|string|logic)\\b`,
  "i",
);

/** "jog it w the guard open" (#5416). Needs a run/test verb: "faults with the guard open" is a symptom. */
const GUARD_OPEN = new RegExp(
  "\\b(?:with|w/?|while)\\s+(?:the\\s+|its\\s+|a\\s+|my\\s+)?" +
    "(?:(?:(?:safety|machine|front|rear|side|top)\\s+)?guards?(?:\\s+(?:doors?|gates?|panels?|covers?))?|safety\\s+(?:gates?|doors?|covers?)|interlocked\\s+(?:doors?|gates?|covers?))" +
    "\\s+(?:open(?:ed)?|off|removed|up|unlatched|missing|pulled|propped(?:\\s+open)?)\\b",
  "i",
);
const RUN_VERB = /\b(?:run|runs|running|ran|jog|jogs|jogging|test|testing|operate|operating|start|starting|cycle|cycling)\b/i;

/** "what does bypassing an interlock mean" asks for a definition, not permission. */
const WHAT_DOES_IT_MEAN = /^\s*what\b[^?]*\bmean\??\s*$/i;

/**
 * Typed text as the technician meant it: compatibility forms folded (full-width
 * letters, no-break spaces), every dash variant a plain hyphen, curly quotes
 * straight, zero-width and soft-hyphen characters dropped, whitespace collapsed.
 * Without this a non-breaking hyphen in "E\u2011stop" hides the device (#5670 F1).
 */
function normalizeAsk(raw: string): string {
  return (raw || "")
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, "-")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** The matched text when the message asks to defeat a safety device, else null. */
export function safetyBypassAsk(message: string): string | null {
  const msg = normalizeAsk(message);
  if (!msg || WHAT_DOES_IT_MEAN.test(msg)) return null;
  const phrase = PYTHON_BYPASS_PHRASES.find((p) => msg.includes(p));
  if (phrase) return phrase;
  const verbFirst = VERB_THEN_DEVICE.exec(msg);
  if (verbFirst) return verbFirst[0];
  // Each state mention is judged alone: a read-out ("shows STO disabled") before
  // one of them must not hide a different, operative mention later in the message.
  for (const m of msg.matchAll(DEVICE_THEN_STATE)) {
    if (!READOUT_BEFORE.test(msg.slice(0, m.index))) return m[0];
  }
  const outOfCircuit = OUT_OF_CIRCUIT_VERB_FIRST.exec(msg) ?? OUT_OF_CIRCUIT_DEVICE_FIRST.exec(msg);
  if (outOfCircuit) return outOfCircuit[0];
  const pronoun = VERB_THEN_PRONOUN.exec(msg);
  if (pronoun && ANY_DEVICE.test(msg)) return pronoun[0];
  const guardOpen = GUARD_OPEN.exec(msg);
  if (guardOpen && RUN_VERB.test(msg)) return guardOpen[0];
  return null;
}
