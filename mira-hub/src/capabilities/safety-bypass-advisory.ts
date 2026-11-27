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
 * One shared classification, clause by clause (#5670 native round 2):
 *   - safetyBypassAsk    -> a match when a clause asks to defeat a safeguard, run
 *                           with one inactive, or take one out of its circuit.
 *                           Terminal refusal. A corrective ("restore", "prevent",
 *                           "do not"), a definition or a read-out is not that,
 *                           and a distinct operative clause appended to any of
 *                           them still is.
 *   - safetyBypassWarning -> a match when no clause asks, but one reports an
 *                           unsafe state ("the relay is bypassed", "someone took
 *                           the guard off"). The turn is answered normally from
 *                           approved evidence with the card above it.
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

/**
 * The whole stop: the card, any other hazard banner of the same turn beside it,
 * the refusal, and, when the same ask is also energized work, the existing
 * energized-work isolation guidance (energized-work-stop.ts, no citation).
 */
export function bypassStopText(otherHazardBanner?: string | null, energizedGuidance?: string | null): string {
  return [BYPASS_BANNER, otherHazardBanner ?? null, BYPASS_REFUSAL, energizedGuidance ?? null].filter(Boolean).join("\n\n");
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
  "|two[-\\s]hand(?:\\s+(?:controls?|buttons?))?|emgs?|sto|safe\\s+torque\\s+off|safety)";

/** Words that stand between a verb and the device (articles, quantifiers, places, fillers). */
const GAP =
  "(?:out|around|past|over|the|a|an|this|that|these|those|my|our|its|their|both|all|each|every" +
  "|one|some|any|either|another|other|certain|particular|specific|of|just|temporarily|quickly|safety|door|gate|cover|access|panel" +
  "|front|rear|left|right|main|whole|machine|line|cell|conveyor|drive|robot|press|filler|upstream|downstream" +
  "|stupid|damn|dang|darn|faulty|bad|broken|new|old)";

/** A verb that defeats a device. "jump to" never reaches DEVICE: "to" is not a gap word. */
const VERB =
  "(?:bypass(?:ed|ing)?|jump(?:er(?:ed|ing)?|ed|ing)?(?:\\s+out)?|defeat(?:ed|ing)?|overrid(?:e|ing)" +
  "|disabl(?:e|ed|ing)|cheat(?:ed|ing)?|short(?:ed|ing)?(?:\\s+out)?|tie(?:\\s+(?:down|out|back|off))?" +
  "|tape(?:\\s+(?:down|over|up))?|zip[-\\s]?tie|wire\\s+around" +
  "|ignor(?:e|ed|ing)|circumvent(?:ed|ing)?|bridg(?:e|ed|ing)|(?:get|getting|got|work|working|worked)\\s+around" +
  "|unplug(?:ged|ging)?|disconnect(?:ed|ing)?|unhook(?:ed|ing)?|disarm(?:ed|ing)?|deactivat(?:e|ed|ing)|mut(?:e|ed|ing)|kill(?:ed|ing)?|neutraliz(?:e|ed|ing))";

/** turn / switch / shut / power ... off, in either order ("turn off the interlock", "turn the interlock off"). */
const VERB_OFF = "(?:turn(?:s|ed|ing)?|switch(?:es|ed|ing)?|shut(?:s|ting)?|power(?:s|ed|ing)?|flip(?:s|ped|ping)?|knock(?:s|ed|ing)?)";
/** The off-verbs that also take "out". "Switch out" means replace ("switch out the e-stop for a new one"). */
const VERB_OFF_OUT = "(?:turn(?:s|ed|ing)?|shut(?:s|ting)?|power(?:s|ed|ing)?|flip(?:s|ped|ping)?|knock(?:s|ed|ing)?)";

/** What a device reads as when it is not protecting anyone. */
const STATE =
  "(?:off|disabled|disconnected|unplugged|bypassed|defeated|inactive|deactivated|muted|missing|unlatched|unhooked|pulled|removed|overridden" +
  "|out\\s+of\\s+(?:service|order|circuit)|not\\s+(?:working|connected|active|armed|enabled|plugged\\s+in)" +
  "|jumpered(?:\\s+out)?|jumped(?:\\s+out)?|shorted(?:\\s+out)?|taken\\s+out|turned\\s+off|switched\\s+off|shut\\s+off|tied\\s+down|taped\\s+(?:down|over)" +
  "|open(?:ed)?|propped(?:\\s+open)?|down)";

/** A reported state, with no request in it. The mild subset: "the e-stop is bypassed". */
const REPORT_STATE =
  "(?:bypassed|jumpered(?:\\s+out)?|jumped(?:\\s+out)?|defeated|overridden|disabled|shorted(?:\\s+out)?|tied\\s+down|taped\\s+(?:down|over)|cheated" +
  "|unplugged|disconnected|muted|turned\\s+off|switched\\s+off|shut\\s+off)";

/** Words between a run verb and "with"/"while": "run it", "cycle the press". */
const RUNV =
  "(?:run(?:s|ning)?|ran|operat(?:e|es|ing)|cycl(?:e|es|ing)|jog(?:s|ging)?|start(?:s|ing)?|us(?:e|ing)|test(?:ing)?|continu(?:e|ing)" +
  "|work(?:s|ing)?|proceed(?:s|ing)?|produc(?:e|es|ing)|go(?:es|ing)?|carry(?:ing)?\\s+on|keep(?:ing)?\\s+(?:it\\s+|them\\s+|things\\s+)?going)";
const ADJ = "(?:front|rear|left|right|main|machine|cell|line|safety|door|gate|guard|side|top)";
const ART = "(?:(?:the|a|an|my|our|its|their|this|that)\\s+)?";
/** A device as people name it: "guard door", "safety gate cover". */
const DEVICE_PHRASE = `${DEVICE}(?:\\s+(?:doors?|gates?|covers?|panels?|hatch(?:es)?))?`;
/** A state said BEFORE the device: "a bypassed light curtain", "an open guard", "an unlatched guard door". */
const STATE_ADJ =
  "(?:bypassed|disabled|disconnected|unplugged|inactive|deactivated|muted|missing|unlatched|unhooked|removed|overridden|defeated|jumpered|shorted|open|opened|propped|pulled|broken|faulty|defective|failed" +
  // #5670 review 4 F11: every state in STATE may also come before the device ("an out-of-service
  // light curtain", "a switched-off scanner", "a not-working e-stop"), its words joined by spaces or hyphens.
  `|${STATE.replaceAll("\\s+", "[-\\s]+")})`;

/** "bypass the e-stop", "jump out the estop circuit", "wire around the safety relay", "unplug the light curtain". */
const VERB_THEN_DEVICE = new RegExp(`\\b${VERB}(?:\\s+${GAP}){0,4}\\s+${DEVICE}\\b`, "i");
const TURN_OFF_FIRST = new RegExp(
  `\\b(?:${VERB_OFF}\\s+(?:off|down)|${VERB_OFF_OUT}\\s+out)(?:\\s+${GAP}){0,4}\\s+${DEVICE}\\b`,
  "i",
);
// #5670 review 4 F11: the device as people name it ("the guard door switch off", "the guard door off").
const OFF_TARGET = `(?:\\s+${GAP}){0,4}\\s+(?:${ADJ}\\s+){0,2}${DEVICE_PHRASE}`;
const TURN_OFF_SEPARATED = new RegExp(
  `\\b(?:${VERB_OFF}${OFF_TARGET}\\s+(?:off|down)|${VERB_OFF_OUT}${OFF_TARGET}\\s+out)\\b`,
  "i",
);

/** "run with the light curtain off", "cycle the press while the scanner is disabled", "jog it w the guard open". */
const RUN_CONNECTOR = "(?:with|w/?|while|even\\s+with|even\\s+though|despite)";
const RUN_WITH_STATE = new RegExp(
  `\\b${RUNV}(?:\\s+\\S+){0,5}?\\s+${RUN_CONNECTOR}\\s+${ART}(?:${ADJ}\\s+){0,2}${DEVICE_PHRASE}` +
    `(?:\\s+(?:is|are|was|were|being|still|all)){0,2}\\s+${STATE}\\b`,
  "i",
);
/** "run with a bypassed light curtain", "jog with an open guard": the state comes first. */
const RUN_WITH_STATE_FIRST = new RegExp(
  `\\b${RUNV}(?:\\s+\\S+){0,5}?\\s+${RUN_CONNECTOR}\\s+${ART}(?:${STATE_ADJ}\\s+){1,2}(?:${ADJ}\\s+){0,2}${DEVICE_PHRASE}\\b`,
  "i",
);
/** "run it without the guard in place", "run without the light curtain". */
const RUN_WITHOUT = new RegExp(`\\b${RUNV}(?:\\s+\\S+){0,5}?\\s+without\\s+${ART}(?:${ADJ}\\s+){0,2}${DEVICE_PHRASE}\\b`, "i");
/** "can I keep running with it bypassed": the device is named in another clause. */
const RUN_WITH_PRONOUN = new RegExp(`\\b${RUNV}(?:\\s+\\S+){0,5}?\\s+(?:with|while)\\s+(?:it|them|that|this)\\s+${STATE}\\b`, "i");

/**
 * #5680: jumpering, shorting or bridging TO or ACROSS a safety device ("jumper +24V to the STO input",
 * "jumper across the e-stop"). Bare "jump" is left out ("jump to the STO section"), and so is "on"
 * ("replace the jumper on the STO input"). The verb used as a noun ("is there a short to ...") is not a request.
 */
const JUMP_VERB = "(?:jumper(?:ed|ing|s)?|jump(?:ed|ing|s)?(?!\\s+to\\b)|short(?:ed|ing|s)?|bridg(?:e|ed|es|ing))";
const NOT_A_NOUN = "(?<!\\b(?:the|a|an|this|that|any|no|new|old|existing|factory|replac\\w*|remov\\w*)\\s+)";
/**
 * #6033 r1 F6 / r2 F6: "bridge communications to the safety PLC" is a network question, not an electrical
 * bridge. Only "bridge" carries that reading: "short the signal to the e-stop input" is still electrical.
 */
const COMMS_BRIDGE = /^bridg\w*\s+(?:\S+\s+){0,2}?(?:comms?|communications?|networks?|ethernet|data|connections?|traffic|messages?|serial|modbus|profinet|ethercat|devicenet)\b/i;
const JUMPER_TO = new RegExp(
  `${NOT_A_NOUN}\\b${JUMP_VERB}(?:\\s+(?:out|it|them))?(?:\\s+\\S+){0,3}?\\s+(?:to|into|across|between)\\s+${ART}(?:${ADJ}\\s+){0,2}${DEVICE}\\b`,
  "i",
);
/**
 * #5680: the supply fed straight to a safety input ("tie 24V to the STO input"). Only an input, terminal
 * or pin is a target ("wire 24V to the safety relay A1 terminal" powers the relay), and wiring it through
 * the safety relay or controller is the correct installation, not a bypass.
 */
const SAFETY_INPUT =
  "(?:sto|safe\\s+torque\\s+off|e\\s?[-.]?\\s?stops?|emergency[-\\s]stops?|emgs?|safety|guard|door|gate|interlocks?)\\s+(?:inputs?|terminals?|pins?)";
const SUPPLY = "(?:\\+?24\\s?v(?:dc)?|\\+v|(?:the\\s+)?(?:24\\s?v\\s+)?(?:supply|power|voltage))";
const SUPPLY_TO_INPUT = new RegExp(
  `\\b(?:tie|tying|wire|wiring|connect|connecting|feed|feeding|put|putting|apply|applying|land|landing)(?:\\s+(?:a|an|the|wire|jumper|lead|link|from))*\\s+${SUPPLY}` +
    `(?:\\s+(?:straight|direct(?:ly)?|right|over|across|back))*\\s+(?:to|into|onto|on|across)\\s+${ART}${SAFETY_INPUT}\\b` +
    // #6033 r1/r2 F1: only a path through a safeguard is exempt ("through the safety relay"); "through the end of
    // the shift" and "through a standard PLC output" are not.
    "(?![^.?!]{0,40}\\b(?:through|thru|via)\\s+(?:the\\s+|a\\s+|an\\s+|its\\s+)?(?:\\S+\\s+)?(?:safety(?:[-\\s]rated)?|sto|e-?stop|emergency[-\\s]stop|guard|door|interlock)s?\\b)",
  "i",
);
/**
 * #5680: jumpering guard-switch or safety-relay terminals by name ("jumper S1 S2 S+", "short s21 s22").
 * A terminal name alone says nothing about safety ("jumper S1 to SC" is a run input), so this only counts
 * when the message names a safety device. Terminals are not in DEVICE: "s+" ends on a non-word character.
 */
const TERMINAL = "s(?:\\d{1,2}|\\+)(?=[\\s.,;:!?/-]|$)";
const TERMINAL_JUMPER = new RegExp(
  `${NOT_A_NOUN}\\b(?:jump(?:er)?(?:ed|ing|s)?|short(?:ed|ing|s)?|bridg(?:e|ed|es|ing)|link(?:ed|ing|s)?)(?:\\s+out)?` +
    `(?:\\s+(?:${GAP}|terminals?|pins?|across|between|from)){0,3}\\s+${TERMINAL}`,
  "i",
);
/** Terminal names, as the terminal rule matches them, for linking them to a safeguard named nearby. */
const TERMINAL_MENTION = new RegExp(`\\b${TERMINAL}`, "gi");
const terminalsIn = (text: string): string[] => allMatches(TERMINAL_MENTION, text).map((m) => m[0].toLowerCase());
/** A safeguard named as faulty in the same sentence ("the guard switch is bad, can I jumper s1-s2"). */
const FAULTY =
  /\b(?:bad|faulty|failed|failing|broken|dead|damaged|stuck|missing|tripp\w*|trips|fault\w*|not\s+working|keeps?\s+\w+ing|went\s+out|is\s+out)\b/;
/** #6088 r1 F5: the terminals a jumper joins: the one the rule matched, then "to/and/-/ S2 ..." straight after it. */
const ENDPOINT_TAIL = new RegExp(
  `^(?:\\s*(?:[-/,&+]|\\bto\\b|\\band\\b|\\bwith\\b|\\bacross\\b)?\\s*(?:(?:terminals?|pins?)\\s+)?\\b${TERMINAL})*`,
  "i",
);
const jumperEndpoints = (clause: string, m: RegExpMatchArray): string[] =>
  terminalsIn(m[0] + (ENDPOINT_TAIL.exec(clause.slice((m.index ?? 0) + m[0].length))?.[0] ?? ""));
/** Is a terminal-jumper match tied to a safeguard? Given the terminals its clause names. */
type TerminalLink = (terminals: string[]) => boolean;

/**
 * #5680: releasing a brake with the safety function off, in either order and in either clause
 * ("release the brake with the safety signature disabled", "with STO inactive, can I open the brake").
 * #6033 r1 F2/F4: the release must be a request (not "failed to release", not a why-question), and the
 * safety-off state must be affirmed now (not "was disabled", not "is not disabled").
 */
const BRAKE_RELEASE = new RegExp(
  `\\b(?:release|releasing|open|opening|lift|lifting|free|freeing|disengag(?:e|ing))\\s+${ART}(?:\\S+\\s+){0,2}?brakes?\\b`,
  "gi",
);
const NOT_A_REQUEST_BEFORE =
  /\b(?:fail(?:s|ed)?|unable|couldn't|could\s+not|can't|cannot|won't|wouldn't|didn't|did\s+not|doesn't|does\s+not|tried|trying)\s+(?:\S+\s+){0,2}$/;
const SAFETY_OFF = new RegExp(
  `\\b(?:${DEVICE}|brake\\s+(?:monitoring|control|test))((?:\\s+\\S+){0,3}?)\\s+` +
    "(?:disabled|off|bypassed|defeated|overridden|deactivated|inactive|jumpered|jumped|shorted|turned\\s+off|switched\\s+off|not\\s+active)\\b",
  "gi",
);
/** #6033 r2 F2: the state first ("with disabled STO", "a bypassed e-stop"). */
const SAFETY_OFF_FIRST = new RegExp(
  `\\b(?:disabled|bypassed|defeated|deactivated|inactive|jumpered|overridden|switched[-\\s]off|turned[-\\s]off)\\s+(?:${ADJ}\\s+)?(?:${DEVICE}|brake\\s+monitoring)\\b`,
  "gi",
);
/** "if STO were disabled": a proposed condition, not a past one. */
const CONDITION_BEFORE = /\b(?:if|suppose|supposing|assuming|say|when|what\s+if)\s+(?:\S+\s+){0,2}$/;
/** "with no safety active", "without STO": the safety function is absent. */
const SAFETY_ABSENT = new RegExp(`\\b(?:no|without)\\s+${ART}(?:${DEVICE}|brake\\s+monitoring)\\b`, "gi");
function asksBrakeRelease(clause: string): boolean {
  if (DEFINITION.test(clause) || SYMPTOM_FRAME.test(clause)) return false;
  return allMatches(BRAKE_RELEASE, clause).some((m) => {
    const before = clause.slice(0, m.index ?? 0);
    return !NEGATED_BEFORE.test(before) && !PREVENT_BEFORE.test(before) && !NOT_A_REQUEST_BEFORE.test(before);
  });
}
/**
 * #6033 r2 F4: a release asked AFTER the safety function is restored, or with it on, is the safe order.
 * The release clause decides: an off state in it refuses; a restore-first or safety-on cue in it does not.
 */
// #6041 / #6088 r1 F1+F4: "after/once/when" + an AFFIRMATIVE restore of the safety function that is off: the device
// (or "it") as the subject of a restored state, or as the object of a restore verb ("after we restore STO"). "Until"
// is not a safe order (it releases now); "after I reset the HMI" or "once the guard is restored" restores nothing
// that is off; "once STO is not restored" is no condition at all.
const RESTORED_PASSIVE = new RegExp(
  `\\b(?:after|once|when)\\s+${ART}(?<dev>${DEVICE}|brake\\s+monitoring|it|they)(?:\\s+\\S+){0,2}?\\s+(?:is|are|has\\s+been|have\\s+been|gets?|comes?)\\s+(?:\\w+\\s+)?(?:restored|reinstated|re-?enabled|reset|back(?:\\s+on|\\s+in)?|enabled|active|energi[sz]ed|in\\s+place|on)\\b`,
  "gi",
);
const RESTORED_ACTIVE = new RegExp(
  `\\b(?:after|once|when)\\s+(?:\\S+\\s+){0,3}?(?:restor(?:e|es|ed|ing)|re-?enabl(?:e|es|ed|ing)|reinstat(?:e|es|ed|ing)|reset(?:s|ting)?|reconnect(?:s|ed|ing)?)\\s+${ART}(?<dev>${DEVICE}|brake\\s+monitoring)\\b`,
  "gi",
);
const SAFETY_ON_WITH = new RegExp(
  `\\b(?:with|while|w/)\\s+${ART}(?:\\S+\\s+){0,2}?(?<dev>${DEVICE}|brake\\s+monitoring)(?:\\s+\\S+){0,2}?\\s+(?:enabled|active|on|energi[sz]ed|in\\s+place|working)\\b`,
  "gi",
);
const NEGATED_RESTORE = /\b(?:not|never|no\s+longer)\b|n't\b/i;
const DEVICE_MENTION = new RegExp(`\\b${DEVICE}\\b`, "gi");
/** One name per safeguard ("safe torque off" = "STO", "E-Stop" = "estop"); "safety" stands for whichever is off. */
function deviceKey(name: string): string {
  const k = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (k === "safetorqueoff") return "sto";
  if (/^(?:estop|emergencystop|emg)s?$/.test(k)) return "estop";
  return k.replace(/s$/, "");
}
/**
 * #6088 r2: does the release clause itself affirmatively restore EVERY safeguard that is off? "It", "they" or
 * "the safety" stand for the off safeguard only when exactly one is off. A condition in another clause never
 * counts: carrying it across clauses let a separate, unconditional release inherit it (#6088 r2 F2).
 */
function releaseInSafeOrder(brake: string, offKeys: Set<string>): boolean {
  const restored = new Set<string>();
  for (const re of [RESTORED_PASSIVE, RESTORED_ACTIVE, SAFETY_ON_WITH]) {
    for (const m of allMatches(re, brake)) {
      if (NEGATED_RESTORE.test(m[0])) continue;
      const key = deviceKey(m.groups?.dev ?? "");
      if (key === "it" || key === "they" || key === "safety") {
        if (offKeys.size === 1) offKeys.forEach((k) => restored.add(k));
      } else restored.add(key);
    }
  }
  return offKeys.size > 0 && [...offKeys].every((k) => restored.has(k));
}
function safetyOffNow(clause: string): boolean {
  return allMatches(SAFETY_OFF, clause).some((m) => {
    const before = clause.slice(0, m.index ?? 0);
    const gap = m[1] ?? "";
    if (/\b(?:not|never)\b/.test(gap)) return false;
    if (/\b(?:was|were|had)\b/.test(gap) && !CONDITION_BEFORE.test(before)) return false;
    return !NEGATED_BEFORE.test(before) && !READOUT_BEFORE.test(before);
  }) ||
    allMatches(SAFETY_OFF_FIRST, clause).some((m) => {
      const before = clause.slice(0, m.index ?? 0);
      return !NEGATED_BEFORE.test(before) && !NOT_CURRENT_BEFORE.test(before);
    }) ||
    allMatches(SAFETY_ABSENT, clause).some((m) => !NEGATED_BEFORE.test(clause.slice(0, m.index ?? 0)));
}

/**
 * The detector's own word lists, as regular-expression source. Exported only so the coverage matrix
 * test (safety-bypass-matrix-5670r4.test.ts) generates its requests from them; not an API.
 */
export const BYPASS_VOCABULARY = { DEVICE, DEVICE_PHRASE, ADJ, VERB, VERB_OFF, VERB_OFF_OUT, STATE, STATE_ADJ, RUNV, RUN_CONNECTOR } as const;

/** "the e-stop is bypassed", "with the interlock jumpered". Global: every mention is judged alone. */
const DEVICE_THEN_STATE = new RegExp(`\\b${DEVICE}\\s+(?:(?:is|are|was|were|got|been|being|still|all)\\s+){0,2}${REPORT_STATE}\\b`, "gi");

/** "the drive shows STO disabled" reads a status back; it asks for nothing. */
const READOUT_BEFORE = /\b(?:shows?|showing|reads?|reading|displays?|displaying|says|saying|indicates?|indicating)\s+(?:\S+\s+){0,2}$/i;

/** "how do I bypass it" — the device is named elsewhere in the message. */
const VERB_THEN_PRONOUN = new RegExp(`\\b${VERB}\\s+(?:it|them)\\b`, "i");
const ANY_DEVICE = new RegExp(`\\b${DEVICE}\\b`, "i");

/**
 * "take the guard door out of the STO circuit", "pull the door switch from the
 * safety chain", "the guard door taken out of the STO circuit". Taking a device
 * out of its circuit is the same act as bypassing it. Stays inside one clause.
 */
const OUT_OF_CIRCUIT_VERB_FIRST = new RegExp(
  `\\b(?:take|takes|taking|taken|took|remove|removing|pull|pulling|drop|dropping|lift|lifting|delete|deleting)\\b[^.?!]{0,40}\\b${DEVICE}\\b[^.?!]{0,30}\\b(?:out\\s+of|from|off)\\b[^.?!]{0,30}\\b(?:circuit|chain|loop|string|logic)\\b`,
  "i",
);
const OUT_OF_CIRCUIT_DEVICE_FIRST = new RegExp(
  `\\b${DEVICE}\\b[^.?!]{0,40}\\b(?:taken|take|taking|removed|pulled|dropped|lifted|deleted)\\s+(?:it\\s+)?(?:out(?:\\s+of)?|off|from)\\b[^.?!]{0,30}\\b(?:circuit|chain|loop|string|logic)\\b`,
  "i",
);

/**
 * A defeat part: the plug, jumper or link that makes a safety input read healthy ("STO disable
 * plug", "bypass plug", "defeat plug", "a jumper in the e-stop loop").
 */
const DEFEAT_PART =
  `(?:(?:bypass|defeat|disable|disabling|override|dummy|shorting|cheater|loop-?back|mute|muting|jumper)\\s+(?:plug|jumper|dongle|connector|link|key|block|shunt|bridge|loopback)` +
  `|(?:plug|jumper|shunt|dummy\\s+plug|cheater)\\s+(?:in|into|across|on|for)\\s+(?:the\\s+)?${DEVICE})`;
/** Putting one in, or using one: base and -ing forms only ("used"/"left" would be a report). */
const INSERT_VERB =
  "(?:stick(?:ing)?|put(?:ting)?|plug(?:ging)?|insert(?:ing)?|fit(?:ting)?|install(?:ing)?|us(?:e|ing)|connect(?:ing)?|add(?:ing)?|place|placing|jam(?:ming)?|slot(?:ting)?|wire|wiring|leav(?:e|ing)|keep(?:ing)?)";
const USE_DEFEAT_PART = new RegExp(`\\b${INSERT_VERB}\\b[^.?!]{0,30}?\\b${DEFEAT_PART}`, "i");
/** "the bypass plug is in", "a bypass plug installed": a state report. */
const DEFEAT_PART_IN_PLACE = new RegExp(`\\b${DEFEAT_PART}\\s+(?:(?:is|are|was|were|still)\\s+)?(?:in\\s+place|installed|fitted|inserted|plugged\\s+in|in)\\b`, "gi");

/** Cutting, removing or defeating someone else's lockout lock. */
const OTHERS_LOCK =
  /\b(?:cut|cutting|remove|removing|take\s+off|taking\s+off|pull|pulling|break|breaking|drill|drilling|bolt[-\s]?cut|bypass|bypassing|override|overriding)\s+(?:\S+\s+){0,3}(?:someone\s+else's|another\s+(?:person's|worker's|tech's|technician's)|their)\s+(?:lock|tag|lockout)/i;

/** Python SAFETY_ACTION_PHRASES that ask to defeat something: refused (verb-first). */
const REFUSE_PHRASES: readonly string[] = [
  "bypass the e-stop",
  "bypass the estop",
  "bypass the emergency stop",
  "jumper out the",
  "jumper the interlock",
  "jumper the door switch",
  "defeat the interlock",
  "defeat the guard",
  "cut the lock",
];
/** Python SAFETY_ACTION_PHRASES that report a state or a historical act: warned, not refused. */
const WARN_PHRASES: readonly string[] = [
  "took the guard off",
  "with the guard off",
  "removed the guard",
  "guard off to",
  "lock is someone else",
  "someone else's lock",
];

/** "what does bypassing an interlock mean" asks for a definition, not permission. Judged on the clause. */
const DEFINITION =
  /^\s*(?:what|what's|define)\b[^?]*\b(?:mean|means|meaning|definition)\s*\??\s*$|^\s*(?:what|what's)\s+(?:does|do|would|is)\b[^?]*\bmean(?:s|ing)?\s+(?:to|when|if|by)\b/i;

/** A clause that asks WHY: a symptom report, not a request to run in that state. */
const SYMPTOM_FRAME = /^(?:also\s+|and\s+)?why\b/;

/** Before the match: negation ("do not bypass"). */
const NEGATED_BEFORE = /\b(?:do\s+not|don't|dont|never|must\s+not|mustn't|should\s+not|shouldn't|not\s+to|no\s+one\s+should)\s+(?:\S+\s+){0,2}$/i;
/** Before the match: prevention or detection ("prevent someone from bypassing", "alarm on a bypassed"). */
const PREVENT_BEFORE =
  /\b(?:prevent\w*|avoid\w*|stop\w*|detect\w*|alarm\w*|alert\w*|monitor\w*|block\w*|catch\w*|discourag\w*|prohibit\w*|disallow\w*|forbid\w*|guard\s+against|protect\s+against)(?:\s+(?!(?:by|using|via|and|so|to)\b)\S+){0,8}\s*$|\bkeep\w*(?:\s+\S+){0,3}\s+from\s+$/i;

/** The clauses of a message: sentences, semicolons, dashes, commas and "and can I ...". */
function clausesOf(msg: string): string[] {
  return msg
    .split(
      /(?<=[.?!;:])\s+|(?<=\w{2})\s+-\s+|,(?!\s*(?:with|w\/?|while|without|despite|even)\b)\s*(?:and\s+|but\s+|then\s+|also\s+|so\s+)*|\s+(?:and|but)\s+(?=(?:also\s+|then\s+)?(?:can|could|may|might|should|shall|how|is\s+it|let|please|actually)\b)|\s+(?:but|also|then|actually)\s+/i,
    )
    .map((c) => c.trim())
    .filter(Boolean);
}

/** A verb in the past participle reports what was done; it does not ask for it. */
const isReport = (matched: string): boolean => /^\w*(?:ed|den)\b/i.test(matched);

type Kind = "refuse" | "warn" | null;

function judgeClause(clause: string, messageNamesDevice: boolean, terminalLinked: TerminalLink = () => false): { kind: Kind; match: string | null } {
  if (DEFINITION.test(clause)) return { kind: null, match: null };
  let warn: string | null = null;
  const operative = (match: string, index: number, canBeReport: boolean): string | null => {
    const before = clause.slice(0, index);
    if (NEGATED_BEFORE.test(before) || PREVENT_BEFORE.test(before)) return null;
    // Only the defeat-verb forms can be a past participle ("a bypassed e-stop"). A run request
    // ("proceed with the interlock bypassed") is operative whatever its first word ends in.
    if (canBeReport && isReport(match)) {
      warn ??= match;
      return null;
    }
    return match;
  };

  const candidates: { re: RegExp; needs?: boolean; terminal?: boolean; reportable?: boolean; run?: boolean; removal?: boolean }[] = [
    { re: VERB_THEN_DEVICE, reportable: true },
    { re: TURN_OFF_FIRST, reportable: true },
    { re: TURN_OFF_SEPARATED, reportable: true },
    { re: RUN_WITH_STATE, run: true },
    { re: RUN_WITH_STATE_FIRST, run: true },
    { re: RUN_WITHOUT, run: true },
    { re: RUN_WITH_PRONOUN, needs: true, run: true },
    { re: VERB_THEN_PRONOUN, needs: true, reportable: true },
    { re: OUT_OF_CIRCUIT_VERB_FIRST, removal: true },
    { re: OUT_OF_CIRCUIT_DEVICE_FIRST, removal: true },
    { re: JUMPER_TO, reportable: true },
    { re: SUPPLY_TO_INPUT },
    { re: TERMINAL_JUMPER, terminal: true, reportable: true },
    { re: USE_DEFEAT_PART },
    { re: OTHERS_LOCK },
  ];
  // EVERY occurrence of EVERY family is judged on its own: a report, a prevention or a negation
  // on one occurrence never hides a distinct operative one (#5670 native 3 F8).
  for (const c of candidates) {
    if (c.needs && !messageNamesDevice) continue;
    // "Why does it fault when I run with the guard open?" reports a symptom; it asks for nothing.
    if (c.run && SYMPTOM_FRAME.test(clause)) continue;
    for (const m of allMatches(c.re, clause)) {
      const index = m.index ?? 0;
      if (c.terminal && !terminalLinked(jumperEndpoints(clause, m))) continue;
      if (c.re === JUMPER_TO && COMMS_BRIDGE.test(m[0])) continue;
      // A circuit removal that has already happened ("was taken out of the STO circuit",
      // "someone has taken the door switch from the chain") is a report; a proposal is not.
      if (c.removal && isCompletedRemoval(m[0], clause.slice(0, index))) {
        if (!NEGATED_BEFORE.test(clause.slice(0, index))) warn ??= m[0];
        continue;
      }
      const hit = operative(m[0], index, c.reportable === true);
      if (hit) return { kind: "refuse", match: hit };
    }
  }
  const phrase = REFUSE_PHRASES.find((p) => clause.includes(p));
  if (phrase) {
    const hit = operative(phrase, clause.indexOf(phrase), false);
    if (hit) return { kind: "refuse", match: hit };
  }

  // A reported state, with no request in the clause.
  for (const m of allMatches(DEVICE_THEN_STATE, clause)) {
    if (!READOUT_BEFORE.test(clause.slice(0, m.index ?? 0))) warn ??= m[0];
  }
  for (const m of allMatches(DEFEAT_PART_IN_PLACE, clause)) {
    if (!NEGATED_BEFORE.test(clause.slice(0, m.index ?? 0))) warn ??= m[0];
  }
  warn ??= inputStateReport(clause);
  const warned = WARN_PHRASES.find((p) => clause.includes(p));
  if (warned) warn ??= warned;
  return warn ? { kind: "warn", match: warn } : { kind: null, match: null };
}

/** Fresh global copy per call, so no RegExp.lastIndex state is ever shared between messages. */
function allMatches(re: RegExp, s: string): RegExpMatchArray[] {
  return [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))];
}

/** "was taken out of", "has been removed from", "took ... out of": the act is done, not proposed. */
const COMPLETED_REMOVAL =
  /\b(?:was|were|been|is|are|got|gets|had|has|have)\s+(?:\w+\s+){0,2}(?:taken|removed|pulled|dropped|lifted|deleted)\b|^(?:took|taken|removed|pulled|dropped|lifted|deleted)\b/;
const PERFECT_BEFORE = /\b(?:has|have|had|was|were|been|having)\s+(?:\w+\s+)?$/;
function isCompletedRemoval(matched: string, before: string): boolean {
  return COMPLETED_REMOVAL.test(matched) || (/^(?:taken|removed|pulled|dropped|lifted|deleted)\b/.test(matched) && PERFECT_BEFORE.test(before));
}

/**
 * Typed text as the technician meant it: compatibility forms folded (full-width
 * letters, no-break spaces), every dash variant a plain hyphen, curly quotes
 * straight, zero-width and soft-hyphen characters dropped, whitespace collapsed.
 * Without this a non-breaking hyphen in "E‑stop" hides the device (#5670 F1).
 */
function normalizeAsk(raw: string): string {
  return (raw || "")
    .normalize("NFKC")
    .replace(/[­​-‏⁠﻿]/g, "")
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    // #5670 review 4: "e. stop" is one device, not the end of a sentence at "e.".
    .replace(/\be ?\. ?(stops?)\b/g, "e-$1")
    .trim();
}

/**
 * A request to carry on, in a clause of its own: "can I keep running", "is it safe to keep going",
 * "may we continue operating", "can we leave it running like this". First person only (a question
 * ABOUT the indicator, "can you explain the run light", is not a request to run).
 * #5670 review 4 F12: "keep" or "leave", an optional object, then an isolated state ("keep it locked
 * out", "keep the machine stopped", "leave it tagged") asks to stay safe, not to carry on. Any other word
 * after the object ("leave it bypassed and tagged", "keep going while it is tagged") is not exempt.
 */
const ASKS_TO_CARRY_ON =
  /^(?:also\s+|actually\s+|and\s+|so\s+|but\s+)?(?:(?:can|could|may|might|would|should|shall|will)\s+(?:i|we)\b|is\s+it\s+(?:ok|okay|fine|safe|alright|allowed|acceptable)\b|are\s+we\s+(?:ok|okay|allowed|good)\b|am\s+i\s+(?:ok|allowed)\b|(?:ok|okay)\s+to\b)[^?]*?\b(?:(?:keep(?:ing)?|leav(?:e|ing))(?!\s+(?:(?:it|this|that|them|everything|(?:(?:the|this|that)\s+)?(?:machine|line|cell|conveyor|press|equipment|drive|robot|unit|system|area)s?)\s+)?(?:locked|stopped|isolated|tagged|de-?energi[sz]ed|shut\s+down)\b)|continu\w+|carry(?:ing)?\s+on|go(?:ing)?\s+on|resum\w+|restart\w*|start\w*|run(?!\s+(?:indicator|light|lamp|led|mode|status|signal|command|input|output|relay|contact|time|hours?|(?:the\s+|a\s+|some\s+)?(?:diagnostics?|tests?|checks?|reports?|scans?|self[- ]?tests?)\b))\w*|operat\w+|cycl\w+|jog\w*|produc\w+|proceed\w*)\b/;

/** A device-state mention that is CURRENT: "the guard door is open", "the light curtain is still out of service". */
const STATE_AFTER_MENTION = new RegExp(
  `\\b${DEVICE_PHRASE}\\s+((?:(?:is|are|was|were|got|been|being|still|currently|now|all|has|have|had|remains?|stays?|keeps?)\\s+){0,3})${STATE}\\b`,
  "gi",
);
/** "an open guard door", "a bypassed interlock", "an out-of-service light curtain": the state comes first. */
const STATE_BEFORE_MENTION = new RegExp(`\\b${STATE_ADJ}\\s+(?:${ADJ}\\s+){0,2}${DEVICE_PHRASE}\\b`, "gi");
/** Before a mention: the act of putting it right, or the past ("was", "had"), is not a current state. */
const NOT_CURRENT_BEFORE = /\b(?:restor\w*|reinstat\w*|repair\w*|fix\w*|replac\w*|reconnect\w*|re-?enabl\w*|re-?install\w*|was|were|had|used\s+to\s+be)\s+(?:\w+\s+){0,3}$/;

const RESTORED_CUE = /\b(?:restored|reinstated|repaired|put\s+back|back\s+in|re-?connected|reconnected|replaced)\b/;

/** Does this clause report a safeguard that is unsafe NOW (not restored, not historical, not a read-out)? */
/** #6033 r2 F8: "is not shorted", "is no longer jumpered": the report is negated or cleared. */
const NOT_NOW_BEFORE = /\b(?:not|no\s+longer|never|isn't|aren't|wasn't|weren't|nothing)\s+(?:\w+\s+)?$/;
/** #6033 r2 F3: "the STO input is jumpered", "the guard terminals are shorted". */
const INPUT_STATE = new RegExp(
  `\\b${SAFETY_INPUT}\\s+((?:(?:is|are|still|now|currently|been|has|have|got)\\s+){0,3})(?:jumpered|jumped|shorted|bridged|tied)(?:\\s+out)?\\b`,
  "gi",
);
/** #6045: the one reader of "the STO input is jumpered" reports, shared by the advisory and the escalation. */
function inputStateReport(clause: string): string | null {
  for (const m of allMatches(INPUT_STATE, clause)) {
    const before = clause.slice(0, m.index ?? 0);
    if (/\b(?:not|never)\b/.test(m[1] ?? "") || NOT_CURRENT_BEFORE.test(before)) continue;
    return m[0];
  }
  return null;
}
function reportsCurrentUnsafeState(clause: string, terminalLinked: TerminalLink = () => false): boolean {
  if (inputStateReport(clause)) return true;
  for (const m of allMatches(TERMINAL_JUMPER, clause)) {
    const before = clause.slice(0, m.index ?? 0);
    if (!isReport(m[0]) || !terminalLinked(jumperEndpoints(clause, m))) continue;
    if (/\b(?:was|were|had)\s+(?:\w+\s+)?$/.test(before) || NOT_NOW_BEFORE.test(before) || NOT_CURRENT_BEFORE.test(before)) continue;
    return true;
  }
  for (const m of allMatches(STATE_AFTER_MENTION, clause)) {
    const index = m.index ?? 0;
    if (/\b(?:was|were|had)\b/.test(m[1] ?? "")) continue;
    if (READOUT_BEFORE.test(clause.slice(0, index))) continue;
    if (NEGATED_BEFORE.test(clause.slice(0, index)) || PREVENT_BEFORE.test(clause.slice(0, index))) continue;
    return true;
  }
  for (const m of allMatches(STATE_BEFORE_MENTION, clause)) {
    const before = clause.slice(0, m.index ?? 0);
    if (NOT_CURRENT_BEFORE.test(before) || NEGATED_BEFORE.test(before) || PREVENT_BEFORE.test(before) || READOUT_BEFORE.test(before)) continue;
    return true;
  }
  // #6033 r1 F3: "the 24V is shorted to the STO input" is a current unsafe state too.
  for (const m of allMatches(JUMPER_TO, clause)) {
    const before = clause.slice(0, m.index ?? 0);
    if (!isReport(m[0]) || COMMS_BRIDGE.test(m[0]) || /\b(?:was|were|had)\s+(?:\w+\s+)?$/.test(before)) continue;
    if (NOT_NOW_BEFORE.test(before) || NOT_CURRENT_BEFORE.test(before) || NEGATED_BEFORE.test(before) || PREVENT_BEFORE.test(before)) continue;
    return true;
  }
  // A device taken out of its circuit and not put back is a current unsafe state too.
  if (!RESTORED_CUE.test(clause)) {
    for (const re of [OUT_OF_CIRCUIT_VERB_FIRST, OUT_OF_CIRCUIT_DEVICE_FIRST]) {
      for (const m of allMatches(re, clause)) {
        const before = clause.slice(0, m.index ?? 0);
        if (isCompletedRemoval(m[0], before) && !NEGATED_BEFORE.test(before) && !PREVENT_BEFORE.test(before)) return true;
      }
    }
  }
  return false;
}

function classify(message: string): { refuse: string | null; warn: string | null } {
  const msg = normalizeAsk(message);
  if (!msg) return { refuse: null, warn: null };
  const namesDevice = ANY_DEVICE.test(msg);
  const clauses = clausesOf(msg);
  // #6033 r1/r2 F5: a terminal is tied to a safeguard when a sentence says the safeguard is wired to THAT
  // terminal ("guard sw is wired to S1 S2"), when its own clause names a safeguard, or when its own sentence
  // names a safeguard as faulty ("the guard switch is bad, can I jumper s1-s2"). A safeguard merely mentioned
  // nearby ("the e-stop passed its test") ties nothing.
  const sentences = msg.split(/(?<=[.?!])\s+/).filter(Boolean);
  const wired = new Set(sentences.filter((s) => ANY_DEVICE.test(s)).flatMap((s) => clausesOf(s).filter((c) => ANY_DEVICE.test(c)).flatMap(terminalsIn)));
  const judged: { clause: string; link: TerminalLink }[] = [];
  let warn: string | null = null;
  for (const sentence of sentences) {
    const faulty = ANY_DEVICE.test(sentence) && FAULTY.test(sentence);
    for (const clause of clausesOf(sentence)) {
      const link: TerminalLink = (terms) => faulty || ANY_DEVICE.test(clause) || terms.some((t) => wired.has(t));
      judged.push({ clause, link });
      const j = judgeClause(clause, namesDevice, link);
      if (j.kind === "refuse") return { refuse: j.match, warn: null };
      if (j.kind === "warn") warn ??= j.match;
    }
  }
  // #5680: a brake release asked while the safety function is reported off, in either order.
  // #6040 / #6088 r1 F2: every release clause is judged; a safe one does not hide an unsafe one.
  const offClauses = clauses.filter(safetyOffNow);
  const offKeys = new Set(offClauses.flatMap((c) => allMatches(DEVICE_MENTION, c).map((m) => deviceKey(m[0]))));
  for (const brake of clauses.filter(asksBrakeRelease)) {
    if (safetyOffNow(brake) || (offClauses.length > 0 && !releaseInSafeOrder(brake, offKeys))) return { refuse: brake, warn: null };
  }
  // A safeguard reported unsafe NOW, followed by a clause that asks to carry on. Another device being
  // restored in a different clause does not reset this one (each mention is judged in its own clause).
  const carry = clauses.find((c) => ASKS_TO_CARRY_ON.test(c) && !DEFINITION.test(c) && !SYMPTOM_FRAME.test(c));
  if (carry && judged.some((j) => reportsCurrentUnsafeState(j.clause, j.link))) return { refuse: carry, warn: null };
  return { refuse: null, warn };
}

/** The matched text when a clause of the message asks to defeat a safeguard or run without one, else null. */
export function safetyBypassAsk(message: string): string | null {
  return classify(message).refuse;
}

/** The matched text when no clause asks but one reports an unsafe state, else null. Never set alongside a refusal. */
export function safetyBypassWarning(message: string): string | null {
  return classify(message).warn;
}
