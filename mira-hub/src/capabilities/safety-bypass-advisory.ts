/**
 * Hard rule (Mike, 2026-11-19, #5232): every request to bypass safety gets a
 * warning card.
 *
 * The Python bot already treats defeating a safety device as an unsafe action
 * (mira-bots/shared/guardrails.py SAFETY_ACTION_PHRASES). The Hub carried none
 * of those phrases, so "can i bypass the e-stop to test it" got an ordinary
 * answer with no warning, and a refused turn showed nothing at all (#5416).
 *
 * This is an ADVISORY, not a safety trigger. It has the same shape as
 * restart-advisory (#4645):
 *   - It never stops a turn and never unlocks one. A safety trigger lets a
 *     turn be answered with no retrieved evidence; this does not. A bypass ask
 *     is refused or answered exactly as it would be without the card.
 *   - It adds no prompt directive. What the answer may say is unchanged (owner
 *     decision 2026-09-27: flags, not answer blocking).
 *   - Its banner is fixed server text with no manual page. It is site safety
 *     practice, not a claim about the document.
 *   - The chat route puts it on every way the turn ends: an answer, a refusal,
 *     an approved-context 412, a Machine Memory error, a stopped stream.
 *
 * Zero-token, deterministic, Hub-only.
 */

/** Fixed card shown above the turn. No page citation (see header). */
export const BYPASS_BANNER =
  "⚠️ **Safety bypass.** Don't run or test with an e-stop, interlock, guard, STO or someone else's lock defeated. Find and fix why it tripped first. If a test truly needs a bypass, use your site's written bypass procedure with sign-off, and keep everyone clear of motion.";

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
  "(?:e-?\\s?stops?|emergency[-\\s]stops?" +
  "|(?:[a-z-]+\\s+)?interlocks?" +
  "|(?:safety|guard|gate|door)\\s+(?:switch(?:es)?|relays?|circuits?|contacts?|inputs?|sensors?|loops?|chains?)" +
  "|safety\\s+(?:mats?|edges?|scanners?|gates?|doors?|plcs?|controllers?|devices?|systems?|functions?)" +
  "|guards?|light[-\\s]curtains?|(?:area|laser)\\s+scanners?|pull[-\\s]cords?|rope[-\\s]pulls?" +
  "|two[-\\s]hand(?:\\s+(?:controls?|buttons?))?|sto|safe\\s+torque\\s+off|safety)";

/** A verb that defeats a device. "jump to" never reaches DEVICE: "to" is not a gap word. */
const VERB =
  "(?:bypass(?:ed|ing)?|jump(?:er(?:ed|ing)?|ed|ing)?(?:\\s+out)?|defeat(?:ed|ing)?|overrid(?:e|ing)" +
  "|disabl(?:e|ed|ing)|cheat(?:ed|ing)?|short(?:ed|ing)?(?:\\s+out)?|tie(?:\\s+(?:down|out|back|off))?" +
  "|tape(?:\\s+(?:down|over|up))?|zip[-\\s]?tie|wire\\s+around)";

/** Words allowed between the verb and the device: articles, possessives, places, fillers. */
const GAP =
  "(?:out|around|past|over|the|a|an|this|that|these|those|my|our|its|their|both|all|each|every" +
  "|front|rear|left|right|main|whole|machine|line|cell|conveyor|drive|robot|press|filler" +
  "|stupid|damn|dang|darn|faulty|bad|broken|new|old)";

/** "bypass the e-stop", "jump out the estop circuit", "wire around the safety relay". */
const VERB_THEN_DEVICE = new RegExp(`\\b${VERB}(?:\\s+${GAP}){0,3}\\s+${DEVICE}\\b`, "i");

/** "the e-stop is bypassed", "with the interlock jumpered". */
const DEVICE_THEN_STATE = new RegExp(
  `\\b${DEVICE}\\s+(?:(?:is|are|was|were|got|been|being|still|all)\\s+){0,2}` +
    "(?:bypassed|jumpered(?:\\s+out)?|jumped(?:\\s+out)?|defeated|overridden|disabled|shorted(?:\\s+out)?|tied\\s+down|taped\\s+(?:down|over)|cheated)\\b",
  "i",
);

/** "how do I bypass it" — the device is named elsewhere in the message. */
const VERB_THEN_PRONOUN = new RegExp(`\\b${VERB}\\s+(?:it|them)\\b`, "i");
const ANY_DEVICE = new RegExp(`\\b${DEVICE}\\b`, "i");

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

/** The matched text when the message asks to defeat a safety device, else null. */
export function safetyBypassAsk(message: string): string | null {
  const msg = (message || "").toLowerCase().trim();
  if (!msg || WHAT_DOES_IT_MEAN.test(msg)) return null;
  const phrase = PYTHON_BYPASS_PHRASES.find((p) => msg.includes(p));
  if (phrase) return phrase;
  const hit = VERB_THEN_DEVICE.exec(msg) ?? DEVICE_THEN_STATE.exec(msg);
  if (hit) return hit[0];
  const pronoun = VERB_THEN_PRONOUN.exec(msg);
  if (pronoun && ANY_DEVICE.test(msg)) return pronoun[0];
  const guardOpen = GUARD_OPEN.exec(msg);
  if (guardOpen && RUN_VERB.test(msg)) return guardOpen[0];
  return null;
}
