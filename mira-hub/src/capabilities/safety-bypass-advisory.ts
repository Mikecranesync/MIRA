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
  "|two[-\\s]hand(?:\\s+(?:controls?|buttons?))?|sto|safe\\s+torque\\s+off|safety)";

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
  "(?:bypassed|disabled|disconnected|unplugged|inactive|deactivated|muted|missing|unlatched|unhooked|removed|overridden|defeated|jumpered|shorted|open|opened|propped|pulled|broken|faulty|defective|failed)";

/** "bypass the e-stop", "jump out the estop circuit", "wire around the safety relay", "unplug the light curtain". */
const VERB_THEN_DEVICE = new RegExp(`\\b${VERB}(?:\\s+${GAP}){0,4}\\s+${DEVICE}\\b`, "i");
const TURN_OFF_FIRST = new RegExp(`\\b${VERB_OFF}\\s+(?:off|down|out)(?:\\s+${GAP}){0,4}\\s+${DEVICE}\\b`, "i");
const TURN_OFF_SEPARATED = new RegExp(`\\b${VERB_OFF}(?:\\s+${GAP}){0,4}\\s+${DEVICE}\\s+(?:off|down|out)\\b`, "i");

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
  /\b(?:prevent\w*|avoid\w*|stop\w*|detect\w*|alarm\w*|alert\w*|monitor\w*|block\w*|catch\w*|discourag\w*|prohibit\w*|disallow\w*|forbid\w*|guard\s+against|protect\s+against)(?:\s+(?!(?:by|using|via|and|so|to)\b)\S+){0,5}\s*$|\bkeep\w*(?:\s+\S+){0,3}\s+from\s+$/i;

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

function judgeClause(clause: string, messageNamesDevice: boolean): { kind: Kind; match: string | null } {
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

  const candidates: { re: RegExp; needs?: boolean; reportable?: boolean; run?: boolean }[] = [
    { re: VERB_THEN_DEVICE, reportable: true },
    { re: TURN_OFF_FIRST, reportable: true },
    { re: TURN_OFF_SEPARATED, reportable: true },
    { re: RUN_WITH_STATE, run: true },
    { re: RUN_WITH_STATE_FIRST, run: true },
    { re: RUN_WITHOUT, run: true },
    { re: RUN_WITH_PRONOUN, needs: true, run: true },
    { re: VERB_THEN_PRONOUN, needs: true, reportable: true },
    { re: OUT_OF_CIRCUIT_VERB_FIRST },
    { re: OUT_OF_CIRCUIT_DEVICE_FIRST },
    { re: OTHERS_LOCK },
  ];
  for (const c of candidates) {
    if (c.needs && !messageNamesDevice) continue;
    // "Why does it fault when I run with the guard open?" reports a symptom; it asks for nothing.
    if (c.run && SYMPTOM_FRAME.test(clause)) continue;
    const m = c.re.exec(clause);
    if (!m) continue;
    const hit = operative(m[0], m.index, c.reportable === true);
    if (hit) return { kind: "refuse", match: hit };
  }
  const phrase = REFUSE_PHRASES.find((p) => clause.includes(p));
  if (phrase) {
    const hit = operative(phrase, clause.indexOf(phrase), false);
    if (hit) return { kind: "refuse", match: hit };
  }

  // A reported state, with no request in the clause.
  for (const m of clause.matchAll(DEVICE_THEN_STATE)) {
    if (!READOUT_BEFORE.test(clause.slice(0, m.index))) warn ??= m[0];
  }
  const warned = WARN_PHRASES.find((p) => clause.includes(p));
  if (warned) warn ??= warned;
  return warn ? { kind: "warn", match: warn } : { kind: null, match: null };
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
    .trim();
}

/** "can we keep running", asked in a clause of its own: a permission to carry on. */
const ASKS_TO_CARRY_ON =
  /^(?:also\s+|actually\s+)?(?:can|could|may|might|is\s+it\s+(?:ok|okay|fine|safe|alright|allowed))\b[^?]*\b(?:keep|keeping|continue|continuing|leave|leaving)\s+(?:it\s+|them\s+|this\s+|the\s+\w+\s+)?(?:running|operating|going|like\s+(?:that|this))\b/;

function classify(message: string): { refuse: string | null; warn: string | null } {
  const msg = normalizeAsk(message);
  if (!msg) return { refuse: null, warn: null };
  const namesDevice = ANY_DEVICE.test(msg);
  const clauses = clausesOf(msg);
  let warn: string | null = null;
  for (const clause of clauses) {
    const j = judgeClause(clause, namesDevice);
    if (j.kind === "refuse") return { refuse: j.match, warn: null };
    if (j.kind === "warn") warn ??= j.match;
  }
  // A reported unsafe state followed by a clause that asks to carry on with it.
  if (warn) {
    const carry = clauses.find((c) => ASKS_TO_CARRY_ON.test(c));
    if (carry) return { refuse: carry, warn: null };
  }
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
