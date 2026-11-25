/**
 * #5864: two hazards that no notebook safety detector recognised, so they got
 * no card at all, and on a notebook whose search found nothing only the canned
 * "add the manual" reply:
 *
 *   - cleaning an operator touch screen that is on (a touch while wiping can
 *     start the machine), and
 *   - an electrical cabinet or enclosure left open or unlocked (dangerous
 *     voltage behind the door).
 *
 * Owner decision (Mike, 2026-11-24, on #5864): a FIXED card above the turn,
 * the same shape as the reported-bypass warning in `safety-bypass-advisory.ts`.
 * It is an advisory, never a `safetyTrigger`: it adds no prompt directive and
 * unlocks no evidence-free answer. A turn with evidence is answered under it; a
 * turn with no evidence at all gets the card over an honest no-manual reply.
 *
 * DETECTION IS BY TOPIC, NOT BY INTENT (#5905, after three Codex rounds). The
 * first design tried to read the unsafe intent: a state ("on", "open") bound to
 * the right object, pronouns resolved, negations honoured. Every round found new
 * wordings it missed, which is the dangerous direction, and the only harm of
 * its false matches was one more caution. So the cards are now standing
 * cautions, the kind a manual prints next to every cleaning or cabinet section,
 * and they fire on the topic:
 *
 *   - screen: a cleaning word within a few words of a screen, HMI or operator
 *     panel. Whether the screen is on is not read at all; the card is true either way.
 *   - enclosure: an electrical enclosure named near a word for it being open,
 *     unlocked, unlatched or not closing.
 *
 * Matching is on normalised whole tokens (case, hyphens, apostrophes and plural
 * folded), so "touch-screen" is "touch screen" and "opening" is not "open".
 *
 * EXCLUSIONS LOOK ONLY AT THE NEXT-DOOR WORD (#5905 Codex r4 F12, F13). Rules that
 * scanned several words ahead ("clean up the alarm log", "leave the breaker open",
 * "open the drawing") also ate real hazards ("wipe the HMI while alarms are
 * active", "the cabinet door is open beside the disconnect"). A missed card is the
 * dangerous direction and a spare one is still true, so those rules are gone: the
 * only exclusions left read the word right beside the trigger (strainer screen,
 * CIP wash cycle, open circuit, tool cabinet, "monitor" as a verb).
 * Precision contract and recall corpus: `__fixtures__/unsafe-practice-corpus.json`.
 * Zero-token, deterministic, Hub-only.
 */

export const LIVE_SCREEN_CLEANING_CARD =
  "⚠️ **Switch the panel off before you clean it.** A touch screen that is on can start the machine when it is wiped or taped. Switch the HMI off first; never tape it and leave it live.";

/** The reply under the card when no search ran at all (an empty project in general mode). */
export const UNSAFE_PRACTICE_NO_EVIDENCE_TEXT =
  "This project has no manual for me to answer from, so I won't guess at a procedure. Add the manual for this equipment, or the page that covers it, and ask again.";

export const OPEN_ENCLOSURE_CARD =
  "⚠️ **Keep the electrical cabinet closed and locked.** There is dangerous voltage inside; only trained staff with the key or tool may open it. Don't prop the door open. Get a replacement key or lock from your supervisor.";

/** Fold a word to its matching form: plural and possessive "s" off ("hmis", "cabinet's", "boxes", "switches"). */
function stem(w: string): string {
  if (w.length > 4 && /(?:xes|ches|shes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** A clause boundary. No phrase contains it, and no exclusion window reaches past it. */
const BREAK = "|";

/**
 * Lowercase whole tokens; apostrophes dropped ("won't" is "wont"); clause punctuation kept
 * as BREAK; any other non-alphanumeric ("touch-screen", "j-box") only separates words.
 */
function tokenize(message: string): string[] {
  return (message || "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[.,;:!?()\n…—–]+|\s-\s/g, ` ${BREAK} `)
    .split(/[^a-z0-9|]+/)
    .filter(Boolean)
    .map((w) => (w === BREAK ? w : stem(w)));
}

/** The tokens after position i, up to n of them, stopping at a clause break. */
function clauseAfter(toks: string[], i: number, n: number): string[] {
  const out: string[] = [];
  for (let k = i + 1; k < toks.length && out.length < n && toks[k] !== BREAK; k++) out.push(toks[k]);
  return out;
}

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean).map(stem));
const phrases = (list: string[]) => list.map((p) => p.split(" ").map(stem));

/** Every [start, end) where one of the phrases occurs; longest phrase wins at a position. */
function find(toks: string[], list: string[][]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const sorted = [...list].sort((a, b) => b.length - a.length);
  for (let i = 0; i < toks.length; i++) {
    const p = sorted.find((ph) => ph.every((w, k) => toks[i + k] === w));
    if (p) {
      out.push([i, i + p.length]);
      i += p.length - 1;
    }
  }
  return out;
}

const near = (a: number, b: number, span: number) => Math.abs(a - b) <= span;

// ── Screen cleaning ──────────────────────────────────────────────────────────
const CLEANING = words(`
  wipe wiped wiping clean cleaned cleaning cleaner wash washed washing washdown
  spray sprayed spraying scrub scrubbed scrubbing dust dusted dusting polish polished polishing
  disinfect disinfected disinfecting disinfectant sanitize sanitized sanitizing sanitise sanitised sanitising
  degrease degreaser rag cloth towel windex lysol isopropyl squeegee`);
const SCREEN = phrases([
  "touch screen", "touchscreen", "touch panel", "touch display", "hmi", "screen", "display",
  "operator panel", "operator terminal", "operator station", "operator interface", "operator screen",
  "oit", "panelview", "keypad", "touch pad", "touchpad", "monitor",
  "human machine interface", "operator console", "console",
]);
/** A bare "screen" that is a strainer or filter, not a display. */
const NOT_A_DISPLAY_BEFORE = words("trash intake inlet suction strainer filter mesh wire vibrating bug fly insect window sieve trommel bar drum rotary basket");
const NOT_A_DISPLAY_AFTER = words("filter mesh door basket pack changer");
const MONITOR_NOUN_BEFORE = words("the a an that this hmi touch operator screen machine line their our");
/** A cleaning word naming a cycle or a setting, not a cloth on the glass: "CIP wash cycle", "clean filter". */
const NOT_PHYSICAL_AFTER = words("filter cycle mode program recipe");
const SCREEN_SPAN = 12;

function screenCleaning(toks: string[]): boolean {
  const screens = find(toks, SCREEN).filter(([s, e]) => {
    // "monitor" is a screen only as a noun ("the monitor"), never the verb ("monitor the pressure").
    if (e - s === 1 && toks[s] === "monitor") return MONITOR_NOUN_BEFORE.has(toks[s - 1] ?? "");
    if (e - s !== 1 || toks[s] !== "screen") return true;
    return !NOT_A_DISPLAY_BEFORE.has(toks[s - 1] ?? "") && !NOT_A_DISPLAY_AFTER.has(toks[e] ?? "");
  });
  if (!screens.length) return false;
  const physical = (i: number) => !NOT_PHYSICAL_AFTER.has(toks[i + 1] ?? "") && toks[i - 1] !== "cip";
  return toks.some((t, i) => CLEANING.has(t) && physical(i) && screens.some(([s, e]) => near(i, s, SCREEN_SPAN) || near(i, e - 1, SCREEN_SPAN)));
}

// ── Electrical enclosure open or unsecured ───────────────────────────────────
const ENCLOSURE = phrases([
  "electrical cabinet", "control cabinet", "panel cabinet", "drive cabinet", "vfd cabinet", "plc cabinet", "starter cabinet",
  "electrical enclosure", "enclosure", "cabinet",
  "mcc", "motor control center", "motor control centre", "switchgear",
  "electrical panel", "main panel", "service panel", "electrical box", "breaker panel", "distribution panel", "control panel", "plc panel", "drive panel", "power panel",
  "panel door", "panel lid", "panel cover",
  "breaker box", "fuse box", "junction box", "jbox", "j box",
]);
/** A bare "cabinet" that holds tools, files or flammables, not wiring. */
const NOT_ELECTRICAL_BEFORE = words("tool storage file filing flammable supply part kitchen medicine aid chemical paint safety locker");
const OPEN_STATE = words("open opened ajar unlock unlocked unlatch unlatched unsecure unsecured prop propped wedge wedged");
/** "won't close", "isn't locked", "without locking", "can't get it to latch". */
const NEGATION = words("not isnt wont cant cannot doesnt dont without never aint wouldnt couldnt");
const SECURE = words("lock locked locking close closed closing shut latch latched latching");
const BROKEN = words("broken broke busted missing lost damaged jammed bent failed failing gone");
const FASTENER = words("lock latch key handle padlock");
const COVER = words("door lid cover");
const GONE = words("off missing removed gone");
/** "Open" naming an electrical condition, not a door: open circuit, open wire fault. */
const OPEN_CONDITION = words("neutral ground conductor leg circuit loop phase collector wire fault frame type source contact end ended transition");
const ENCLOSURE_SPAN = 20;

function unsecuredSignals(toks: string[]): number[] {
  const at: number[] = [];
  const window = (i: number, span: number, set: Set<string>) => clauseAfter(toks, i, span).some((t) => set.has(t));
  toks.forEach((t, i) => {
    if (OPEN_STATE.has(t)) {
      if ((t === "open" || t === "opened") && OPEN_CONDITION.has(toks[i + 1] ?? "")) return;
      at.push(i);
    } else if ((NEGATION.has(t) && window(i, 6, SECURE)) || (t === "no" && window(i, 2, SECURE))) {
      at.push(i);
    } else if (BROKEN.has(t) && toks.some((w, j) => near(i, j, 3) && FASTENER.has(w))) {
      at.push(i);
    } else if (COVER.has(t) && window(i, 2, GONE)) {
      at.push(i);
    }
  });
  return at;
}

function enclosureUnsecured(toks: string[]): boolean {
  const enclosures = find(toks, ENCLOSURE).filter(([s, e]) => {
    if (e - s !== 1 || toks[s] !== "cabinet") return true;
    if (toks[s - 1] === "supply" && toks[s - 2] === "power") return true;
    return !NOT_ELECTRICAL_BEFORE.has(toks[s - 1] ?? "");
  });
  if (!enclosures.length) return false;
  const signals = unsecuredSignals(toks);
  return signals.some((i) => enclosures.some(([s, e]) => near(i, s, ENCLOSURE_SPAN) || near(i, e - 1, ENCLOSURE_SPAN)));
}

export type UnsafePractice = "live-screen-cleaning" | "open-electrical-enclosure";

/** The hazard topics this message raises, in a fixed order. Empty when none. */
export function unsafePractices(message: string): UnsafePractice[] {
  const toks = tokenize(message);
  if (!toks.length) return [];
  const out: UnsafePractice[] = [];
  if (screenCleaning(toks)) out.push("live-screen-cleaning");
  if (enclosureUnsecured(toks)) out.push("open-electrical-enclosure");
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
