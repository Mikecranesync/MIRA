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
 * can never produce a model-written "that's fine". No answer is blocked
 * (owner decision 2026-09-27).
 *
 * Detection is by class (a practice, an object and an unsafe state together),
 * not by the two reported sentences. Zero-token, deterministic, Hub-only.
 */

export const LIVE_SCREEN_CLEANING_CARD =
  "⚠️ **Switch the panel off before you clean it.** A touch screen that is on can start the machine when it is wiped or taped. Switch the HMI off first; never tape it and leave it live.";

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

/** The screen or the machine stays live while it is cleaned. */
const LIVE_STATE = new RegExp(
  "\\b(?:" +
    [
      // "leave it on", "keep the hmi on", "leave the screen running", "leave it live"
      "(?:leav(?:e|es|ing)|left|keep(?:s|ing)?|kept)\\s+(?:it|them|that|this|the\\s+\\w+(?:\\s+\\w+)?)\\s+(?:on|running|live|powered(?:\\s+(?:up|on))?|energi[sz]ed|switched\\s+on|turned\\s+on)\\b",
      // "while it's on", "while the line runs", "while the machine is running", "with it on"
      "(?:while|with|when)\\s+(?:it|its|it's|this|that|they|the\\s+\\w+(?:\\s+\\w+)?)(?:'s|\\s+is|\\s+are|\\s+stays|\\s+remains)?\\s+(?:still\\s+)?(?:on|runs|running|live|powered(?:\\s+(?:up|on))?|energi[sz]ed|switched\\s+on|turned\\s+on)\\b",
      // "without switching it off", "without turning off the panel", "without shutting it down"
      "without\\s+(?:switching|turning|shutting|powering)\\s+(?:(?:it|them|the\\s+\\w+(?:\\s+\\w+)?)\\s+)?(?:off|down)\\b",
      "without\\s+(?:switching|turning|shutting|powering)\\s+(?:off|down)\\b",
    ].join("|") +
    ")",
);

/** An electrical cabinet or enclosure. A bare "panel" counts only as a door or cabinet ("panel door", "panel cabinet"). */
const ENCLOSURE =
  /\b(?:(?:electrical|control|panel|drive|vfd|plc|mcc|breaker|starter|disconnect)\s+(?:cabinets?|enclosures?|boxes|box|rooms?)|cabinets?|enclosures?|panel\s+doors?|mccs?|motor\s+control\s+centers?|switchgear|breaker\s+panels?|junction\s+box(?:es)?|j-?box(?:es)?)\b/;

/**
 * The enclosure is left open or unsecured. What is left open must be the door, lid, cover or the
 * enclosure itself: "leave the breaker open" (or the disconnect) is the safe, de-energized state.
 */
const OPEN_STATE = new RegExp(
  "\\b(?:" +
    [
      // "leave the door propped open", "keep it open", "left the cabinet unlocked", "prop the door open"
      "(?:leav(?:e|es|ing)|left|keep(?:s|ing)?|kept|prop(?:s|ped|ping)?|wedg(?:e|es|ed|ing)|block(?:s|ed|ing)?|hold(?:s|ing)?|held|tie(?:s|d)?|tying|tap(?:e|es|ed|ing))" +
        "\\s+(?:\\S+\\s+){0,3}?(?:doors?|lids?|covers?|hatch(?:es)?|cabinets?|enclosures?|box|boxes|it|them)\\s+(?:\\S+\\s+)?(?:open|unlocked|ajar|unlatched)\\b",
      // "door propped open", "prop open the door"
      "(?:propped|wedged|tied|taped|blocked)\\s+open\\b",
      "(?:prop(?:s|ping)?|wedg(?:e|es|ing))\\s+open\\b",
      // "without locking it", "without closing the door"
      "without\\s+(?:locking|closing|latching)\\b",
    ].join("|") +
    ")",
);

/** A definition question: "what is an enclosure rating?", "explain the cleaning screen". */
const DEFINITIONAL = /^\s*(?:what(?:'s|\s+is|\s+are|\s+does|\s+do)\b|define\b|describe\b|explain\b|tell me about\b)/i;

/** The first non-negated match of `re` in `msg`, or null. */
function liveMatch(re: RegExp, msg: string): string | null {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of msg.matchAll(g)) {
    if (!NEGATED.test(msg.slice(0, m.index))) return m[0];
  }
  return null;
}

export type UnsafePractice = "live-screen-cleaning" | "open-electrical-enclosure";

/** The unsafe practices this message names, in a fixed order. Empty when none. */
export function unsafePractices(message: string): UnsafePractice[] {
  const msg = (message || "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  if (!msg || DEFINITIONAL.test(msg)) return [];
  const out: UnsafePractice[] = [];
  if (SCREEN_CLEANING.test(msg) && liveMatch(LIVE_STATE, msg)) out.push("live-screen-cleaning");
  if (ENCLOSURE.test(msg) && liveMatch(OPEN_STATE, msg)) out.push("open-electrical-enclosure");
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
