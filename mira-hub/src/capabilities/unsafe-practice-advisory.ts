/**
 * #5864: two unsafe practices that no notebook safety detector recognised, so
 * they got no card at all, and on a notebook whose search found nothing only
 * the canned "add the manual" reply:
 *
 *   - keeping an operator touch screen live while it is wiped or cleaned
 *     (a touch while wiping can start the machine), and
 *   - leaving an electrical cabinet or enclosure open or unlocked
 *     (dangerous voltage behind the door).
 *
 * Owner decision (Mike, 2026-11-24, on #5864): a FIXED WARNING CARD above the
 * turn, the same shape as the reported-bypass warning in
 * `safety-bypass-advisory.ts`. The turn is still answered from approved
 * evidence when the search finds it; when it does not, the canned reply
 * follows the card. It is an advisory, never a `safetyTrigger`: it unlocks no
 * evidence-free answer and adds no prompt directive, so a zero-hit notebook
 * can never produce a model-written "that's fine". An answer with evidence is
 * never blocked; a turn with no evidence at all, including an empty project in
 * general mode, gets the card and an honest no-manual reply instead of a
 * model answer (#5905 Codex r1 F2).
 *
 * Detection is by class (a practice, an object and an unsafe state together),
 * not by the two reported sentences. Zero-token, deterministic, Hub-only.
 */

export const LIVE_SCREEN_CLEANING_CARD =
  "⚠️ **Switch the panel off before you clean it.** A touch screen that is on can start the machine when it is wiped or taped. Switch the HMI off first; never tape it and leave it live.";

/** The reply under the card when no search ran at all (an empty project in general mode). */
export const UNSAFE_PRACTICE_NO_EVIDENCE_TEXT =
  "This project has no manual for me to answer from, so I won't guess at a procedure. Add the manual for this equipment, or the page that covers it, and ask again.";

export const OPEN_ENCLOSURE_CARD =
  "⚠️ **Keep the electrical cabinet closed and locked.** There is dangerous voltage inside; only trained staff with the key or tool may open it. Don't prop the door open. Get a replacement key or lock from your supervisor.";

/** Cleaning: wipe, clean, wash, spray, scrub, dust. */
const CLEANING = "(?:wip(?:e|es|ed|ing)|clean(?:s|ed|ing)?|wash(?:es|ed|ing)?|spray(?:s|ed|ing)?|scrub(?:s|bed|bing)?|dust(?:s|ed|ing)?)";

/** The operator panel being cleaned. A bare "panel" is not enough: it is also an electrical panel. */
const SCREEN = "(?:touch[-\\s]?(?:screens?|panels?|displays?)|hmis?|screens?|displays?|operator\\s+(?:panels?|terminals?|stations?)|keypads?)";

/**
 * The SCREEN is what is cleaned: the two words within three of each other ("wipe the touch screen",
 * "the hmi needs cleaning"). "The display flickers while the drive runs, should I clean the contacts"
 * names a display and a cleaning, but not a cleaning of the display.
 */
const SCREEN_CLEANING = new RegExp(`\\b(?:${CLEANING}(?:\\s+\\S+){0,3}?\\s+${SCREEN}|${SCREEN}(?:\\s+\\S+){0,3}?\\s+${CLEANING})\\b`);

/** Words that, just before a state, make it the safe one ("don't leave it on", "never keep it running"). */
const NEGATED = /\b(?:don'?t|do\s+not|never|not|shouldn'?t|should\s+not|can'?t|cannot|won'?t)\s+(?:\S+\s+){0,2}$/;

/**
 * What a live state may be about: the screen, the machine or line it runs, or a pronoun for one of
 * them. Never any noun: "leave the exhaust fan on" says nothing about the screen.
 */
const LIVE_OBJECT =
  "(?:it|them|that|this|they|(?:the|that|this|our|their|your)\\s+(?:\\w+\\s+)?(?:touch\\s?screens?|screens?|hmis?|displays?|panels?|terminals?|keypads?|machines?|lines?|conveyors?|equipment|press(?:es)?|units?|systems?|drives?|motors?|power))";

/** "on" as a state, not a place: "leave it on", never "the HMI is on the left". */
const ON = "on(?!\\s+(?:the|a|an|top|my|our|its|their|this|that|to|of|it|break|hold|standby|lunch)\\b)";
/**
 * #5905 r2 F3: "powered" is a live state only as a complete one: "powered on", "powered up", or a
 * bare "powered" that ends its clause ("it's powered, can I wipe it"). "Powered off" is the safe
 * state, and "powered by 24 V" or "powered from the panel" says where the power comes from.
 */
const POWERED = `powered(?:\\s+(?:up|${ON})|(?=\\s*(?:[.,;:!?)]|$)|\\s+(?:and|but|so|while|when|still|now|right\\s+now)\\b))`;
const LIVE_ON = `(?:${ON}|running|live|${POWERED}|energi[sz]ed|switched\\s+${ON}|turned\\s+${ON})`;
/** The states that can stand with no subject ("while powered on", "while running"). Never a bare "on": "while on shift". */
const LIVE_PARTICIPLE = `(?:running|live|${POWERED}|energi[sz]ed|switched\\s+${ON}|turned\\s+${ON})`;

/** The screen or the machine stays live while it is cleaned. */
const LIVE_STATE = new RegExp(
  "\\b(?:" +
    [
      // "leave it on", "keep the hmi on", "leave the screen running"
      `(?:leav(?:e|es|ing)|left|keep(?:s|ing)?|kept)\\s+${LIVE_OBJECT}\\s+${LIVE_ON}`,
      // "while it's on", "while the line runs", "while the machine is running", "with it on"
      `(?:while|with|when)\\s+${LIVE_OBJECT}(?:'s|\\s+is|\\s+are|\\s+stays|\\s+remains)?\\s+(?:still\\s+)?(?:${LIVE_ON}|runs)`,
      // The subject left out: "wipe the hmi while powered on", "clean it while running" (#5905 r2 F1).
      `(?:while|when)\\s+(?:it'?s\\s+|still\\s+)?${LIVE_PARTICIPLE}`,
      // A direct report: "the line is running. can I wipe the hmi now?"
      `${LIVE_OBJECT}(?:'s|\\s+is|\\s+are|\\s+stays|\\s+remains)\\s+(?:still\\s+)?${LIVE_ON}`,
      // "without switching it off", "without turning off the panel"
      "without\\s+(?:switching|turning|shutting|powering)\\s+(?:(?:it|them|the\\s+\\w+(?:\\s+\\w+)?)\\s+)?(?:off|down)\\b",
    ].join("|") +
    ")",
);

/** An electrical cabinet or enclosure. A bare "panel" counts only as a door or cabinet ("panel door", "panel cabinet"). */
const ENCLOSURE =
  /\b(?:(?:electrical|control|panel|drive|vfd|plc|mcc|breaker|starter|disconnect)\s+(?:cabinets?|enclosures?|boxes|box|rooms?)|cabinets?|enclosures?|panel\s+doors?|mccs?|motor\s+control\s+centers?|switchgear|(?:breaker|electrical|distribution)\s+panels?|junction\s+box(?:es)?|j-?box(?:es)?)\b/;

/** Enclosures that are themselves what is left open: "leave the MCC open", "the electrical panel" (#5905 r2 F1). */
const ENCLOSURE_HEAD =
  "(?:mccs?|motor\\s+control\\s+centers?|switchgear|(?:breaker|electrical|distribution)\\s+panels?|junction\\s+box(?:es)?|j-?box(?:es)?)";

/** The only words that may qualify a door here: "the panel door", never "the shop door". */
const ENC_QUAL = "(?:electrical|control|panel|cabinet|enclosure|drive|vfd|plc|mccs?|breaker|starter|disconnect|junction|box|switchgear|j-?box)";
const DETERMINER = "(?:the|that|this|its|their|our|your|his|her|my|a|an)";

/** What a verb leaves open: the enclosure, its own door, lid or cover, or a pronoun. */
const LEFT_OBJECT =
  `(?:(?:${DETERMINER}\\s+)?(?:(?:${ENC_QUAL}(?:'s)?\\s+){0,2}(?:doors?|lids?|covers?|hatch(?:es)?|cabinets?|enclosures?|box(?:es)?)|${ENCLOSURE_HEAD})|it|them)`;

/** LEFT_OBJECT without the pronouns. */
const ENCLOSED_OBJECT =
  `(?:(?:${DETERMINER}\\s+)?(?:(?:${ENC_QUAL}(?:'s)?\\s+){0,2}(?:doors?|lids?|covers?|hatch(?:es)?|cabinets?|enclosures?|box(?:es)?)|${ENCLOSURE_HEAD}))`;

/** A verb followed straight by a pronoun object: "prop it open", "close them without locking". */
const PRONOUN_OBJECT = /^\S+\s+(?:open\s+)?(?:it|them)\b/;

/** A switching device: open is its safe state ("leave the MCC breaker open"), so it never stands for the enclosure. */
const SWITCH_DEVICE = "(?:breakers?|disconnects?|switch(?:es)?|isolators?|fuses?|mains|contactors?)";
/** The word between the object and "open" may not be a switching device: "leave the MCC breaker open" is the safe state. */
const NOT_A_SWITCH = `(?!${SWITCH_DEVICE}\\b)`;

/** What a pronoun can point back to: an enclosure, an openable part, or something else that opens. */
const REFERENT = new RegExp(
  `\\b(?:(${ENCLOSURE.source.slice(2, -2)})|(doors?|lids?|covers?|hatch(?:es)?)|(windows?|gates?|valves?|hoods?|guards?|trunks?|tailgates?|fridges?|freezers?|lockers?|${SWITCH_DEVICE}))\\b`,
  "g",
);

/**
 * #5905 r2 F3: does the pronoun at `index` stand for the enclosure? It points to the nearest thing
 * named before it (or, with nothing before, the first after). An enclosure, or a door with no
 * qualifier or an enclosure one ("the door", "the cabinet door"), is the enclosure. A door qualified
 * by anything else ("the shop door"), or a window, gate or valve, is not.
 */
function pronounIsEnclosure(msg: string, index: number, length: number): boolean {
  const before = [...msg.slice(0, index).matchAll(REFERENT)];
  let ref: RegExpMatchArray | undefined = before[before.length - 1];
  let offset = 0;
  if (!ref) {
    offset = index + length;
    ref = msg.slice(offset).matchAll(REFERENT).next().value;
  }
  if (!ref) return true;
  if (ref[1]) return true;
  if (ref[3]) return false;
  return subjectStartsHere(msg, offset + (ref.index ?? 0));
}

/** The subject of a report. Its own qualifier is checked by `subjectStartsHere`. */
const REPORT_SUBJECT = `(?:(?:${ENC_QUAL}(?:'s)?\\s+){0,2}(?:doors?|lids?|covers?|hatch(?:es)?)|${ENCLOSURE.source.slice(2, -2)})`;
/** Leading whitespace included: "the cabinet's been open" has none before the verb. */
const COPULA =
  "(?:'s(?:\\s+been)?|\\s+(?:is|are|was|were|has\\s+been|have\\s+been|had\\s+been|been|stays|stayed|remains|remained|got|gets|keeps\\s+getting|is\\s+sitting|sits|sat))";
/** Not a state but the name of a signal: "the cabinet door is open alarm". */
const NOT_A_LABEL = "(?!\\s+(?:alarm|fault|warning|message|signal|indicator|status|bit|input|switch|sensor|light|code|event|error|popup|contact|limit|tag)\\b)";

/** The enclosure is left open or unsecured. "Leave the breaker open" (or the disconnect) is the safe state. */
const OPEN_STATE = new RegExp(
  "\\b(?:" +
    [
      // "leave the door propped open", "keep it open", "left the cabinet unlocked", "prop the door open"
      "(?:leav(?:e|es|ing)|left|keep(?:s|ing)?|kept|prop(?:s|ped|ping)?|wedg(?:e|es|ed|ing)|block(?:s|ed|ing)?|hold(?:s|ing)?|held|tie(?:s|d)?|tying|tap(?:e|es|ed|ing))" +
        `\\s+${LEFT_OBJECT}\\s+(?:${NOT_A_SWITCH}\\S+\\s+)?(?:open|unlocked|ajar|unlatched)${NOT_A_LABEL}`,
      // "prop open the cabinet"
      `(?:prop(?:s|ping)?|wedg(?:e|es|ing))\\s+open\\s+${LEFT_OBJECT}`,
      // "close the door without locking it", "without locking the cabinet"
      `(?:clos(?:e|es|ed|ing)|shut(?:s|ting)?|leav(?:e|es|ing)|left)\\s+${LEFT_OBJECT}\\s+without\\s+(?:locking|latching)`,
      // A pronoun here could be any door ("close the shop door without locking it"), so name the enclosure.
      `without\\s+(?:locking|closing|latching)\\s+${ENCLOSED_OBJECT}`,
    ].join("|") +
    ")",
);

/**
 * A report that the enclosure is unsecured: "the electrical cabinet is open and unlocked", "the MCC
 * door was left open", "the cabinet's been open all night". A bare "is open" is not enough: the
 * cabinet is open while a technician works in it.
 */
const OPEN_REPORT = new RegExp(
  `\\b${REPORT_SUBJECT}${COPULA}\\s+(?:still\\s+)?(?:` +
    [
      `(?:(?:wide\\s+)?open\\s+(?:and|&)\\s+)?(?:unlocked|ajar|unlatched)${NOT_A_LABEL}`,
      `(?:left|propped|wedged|tied|taped|blocked|held|hanging)\\s+(?:wide\\s+)?open${NOT_A_LABEL}`,
      `(?:wide\\s+)?open\\s+(?:all\\s+(?:night|day|shift|weekend)|overnight|unattended|for\\s+(?:the\\s+)?(?:night|weekend|shift|days?|hours))`,
    ].join("|") +
    ")",
);

/** Words that may stand just before a report subject. Anything else qualifies it ("the shop door"). */
const SUBJECT_PREV = new RegExp(`^(?:${DETERMINER}|${ENC_QUAL}|and|but|so|or|because|since|if|now|then|also|plus|still|cause|cuz)$`);

/** Is the subject at `index` unqualified, or qualified only by an enclosure word? */
function subjectStartsHere(msg: string, index: number): boolean {
  const prev = msg.slice(0, index).match(/([a-z'-]+)\s+$/);
  return !prev || SUBJECT_PREV.test(prev[1]);
}

/** The first non-negated match of `re` in `msg` (that `ok` accepts), or null. */
function liveMatch(re: RegExp, msg: string, ok: (index: number, text: string) => boolean = () => true): string | null {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of msg.matchAll(g)) {
    if (!NEGATED.test(msg.slice(0, m.index)) && ok(m.index, m[0])) return m[0];
  }
  return null;
}

export type UnsafePractice = "live-screen-cleaning" | "open-electrical-enclosure";

/** The unsafe practices this message names, in a fixed order. Empty when none. */
export function unsafePractices(message: string): UnsafePractice[] {
  const msg = (message || "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  if (!msg) return [];
  const out: UnsafePractice[] = [];
  if (SCREEN_CLEANING.test(msg) && liveMatch(LIVE_STATE, msg)) out.push("live-screen-cleaning");
  if (
    ENCLOSURE.test(msg) &&
    (liveMatch(OPEN_STATE, msg, (i, t) => !PRONOUN_OBJECT.test(t) || pronounIsEnclosure(msg, i, t.length)) ||
      liveMatch(OPEN_REPORT, msg, (i) => subjectStartsHere(msg, i)))
  ) {
    out.push("open-electrical-enclosure");
  }
  return out;
}

const CARD: Record<UnsafePractice, string> = {
  "live-screen-cleaning": LIVE_SCREEN_CLEANING_CARD,
  "open-electrical-enclosure": OPEN_ENCLOSURE_CARD,
};

/** The fixed card(s) for this message, joined, or null. No page citation: site safety practice, not a manual claim. */
export function unsafePracticeWarning(message: string): string | null {
  const cards = unsafePractices(message).map((p) => CARD[p]);
  return cards.length ? cards.join("\n\n") : null;
}
