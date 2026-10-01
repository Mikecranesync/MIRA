/**
 * Candidate identity extraction — Manual-First PRD R1 (#4160 S5).
 *
 * Reads a candidate (manufacturer, part) from a LOOK observation, falling back
 * to the technician's typed text, WITHOUT consulting the corpus (the old
 * corpus-circular maker lookup is root cause RC1: a maker with no rows could
 * never be recognised, so its manual was never searched for).
 *
 * - Part: the serial-safe photo reader (`unambiguousPartNumber`, #4150) — one
 *   unambiguous part/catalog code; anything near a serial label is excluded,
 *   dates and voltage/range strings never qualify.
 * - Maker: the shared OEM maker table (`oemMakerTable`, the same entries that
 *   decide a maker's own documentation hosts). A maker name that is also an
 *   ordinary English word counts only in capitals, the way it is printed on a
 *   label; two different makers in one text are ambiguous and yield none.
 *
 * The result is a CANDIDATE — never identity. It may key a search; it is never
 * written to the notebook and never grounds an answer until the technician
 * confirms it (R2/R3).
 */
import { oemMakerTable } from "@/lib/manual-discovery";
import { namesOnlyThisMachine } from "./identity-proposal";
import { mentionsAssetLabel, mentionsSerialLabel, partCodes, unambiguousPartNumber } from "./photo-part-lookup";

export type CandidateIdentity = { manufacturer: string | null; part: string };

/** Maker names that are also everyday words: only an ALL-CAPS label print counts. */
const DICTIONARY_MAKERS = new Set(["sick", "banner", "parker", "eaton", "emerson", "phoenix"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How far (in words, same sentence) a TYPED dictionary-word maker may sit
 *  before the part code it names ("Banner Q4X sensor, part Q4XTBLAF300-Q8"). */
const TYPED_MAKER_MAX_GAP_WORDS = 4;

/** Words allowed between a typed dictionary-word maker and its part code. */
const TYPED_MAKER_GAP_WORDS = new Set([
  "part", "pn", "p/n", "model", "series", "cat", "catalog", "no", "number", "type", "a", "an", "the",
  "sensor", "sensors", "photo", "eye", "photoeye", "photocell", "prox", "proximity", "switch", "valve",
  "valves", "cylinder", "regulator", "manifold", "fitting", "relay", "drive", "vfd", "inverter", "motor",
  "gearmotor", "gearbox", "encoder", "controller", "plc", "module", "hmi", "panel", "pump", "actuator",
  "light", "curtain", "breaker", "contactor", "starter", "supply", "transmitter", "gauge", "filter",
  "safety", "pneumatic", "hydraulic",
]);

/** #4160 gate NO-GO: in a technician's TYPED text a dictionary-word maker
 *  ("Banner", "Sick") counts when it is capitalised and the part code follows
 *  in the same sentence within a few words — the way people write a model,
 *  not the way a label prints one. Lowercase never counts ("a banner"). */
function typedMakerNamesPart(text: string, matched: string, matchIndex: number, part: string): boolean {
  if (!/^[A-Z]/.test(matched)) return false;
  const after = text.slice(matchIndex + matched.length);
  const at = after.toUpperCase().indexOf(part.toUpperCase());
  if (at < 0) return false;
  const gap = after.slice(0, at);
  if (/[.!?\n]/.test(gap)) return false;
  const words = gap.split(/[\s,;:()]+/).filter(Boolean);
  if (words.length > TYPED_MAKER_MAX_GAP_WORDS) return false;
  // Codex #4184 F1: only a maker-to-part phrase may sit between them — an
  // equipment word ("valve", "sensor", "part") or a code-like token with a
  // digit (the family, "Q4X"). Anything else ("Sick of this …", "Banner is
  // wrong on …") means the word is being used as an ordinary word.
  return words.every((w) => /\d/.test(w) || TYPED_MAKER_GAP_WORDS.has(w.toLowerCase().replace(/[.#]$/, "")));
}

/** Every maker group (the OEM table's first domain) named in `text`, mapped to the
 *  longest matched name. Aliases of one maker share a group. `typedPart`: the
 *  text is the technician's typed message and this is the part it names, which
 *  enables the typed-text rule for dictionary-word makers above. */
function makerGroups(text: string, typedPart?: string): Map<string, string> {
  const hits = new Map<string, string>(); // group (first domain) -> longest matched name
  for (const { name, domains } of oemMakerTable()) {
    const body = escape(name).replace(/\\-| /g, "[\\s-]+");
    const re = new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi");
    const dictionary = DICTIONARY_MAKERS.has(name);
    const named = [...text.matchAll(re)].some(
      (m) =>
        !dictionary ||
        m[0] === m[0].toUpperCase() ||
        (typedPart !== undefined && typedMakerNamesPart(text, m[0], m.index ?? 0, typedPart)),
    );
    if (!named) continue;
    const group = domains[0] ?? name;
    const prior = hits.get(group);
    if (!prior || name.length > prior.length) hits.set(group, name);
  }
  return hits;
}

/** The maker named in `text`, upper-cased as printed on a label, or null when
 *  none or more than one distinct maker is named. */
export function makerFromText(text: string, typedPart?: string): string | null {
  const hits = makerGroups(text, typedPart);
  if (hits.size !== 1) return null;
  return [...hits.values()][0].toUpperCase();
}

export function extractCandidateIdentity(observation: string, typed = ""): CandidateIdentity | null {
  const fromPhoto = unambiguousPartNumber(observation);
  const part = fromPhoto ?? (typed ? unambiguousPartNumber(typed) : null);
  if (!part) return null;
  // The typed text gets the typed-maker rule (#4160 gate); a label keeps the
  // capitals-only rule for dictionary-word makers.
  const own = fromPhoto ? makerFromText(observation) : makerFromText(typed, part);
  const other = fromPhoto ? makerFromText(typed, part) : makerFromText(observation);
  const manufacturer = own && other && own !== other ? null : (own ?? other);
  return { manufacturer, part };
}

/**
 * Does the technician's own typed text ask for the manual/documentation
 * itself, rather than a troubleshooting question about the part (#4160 S6,
 * PRD R2)? One half of the trigger for a candidate-basis background manual
 * search — the other half is the identity having come from a label read (a
 * photo observation), checked separately by the caller. Deterministic and
 * narrow by design (zero-token-architecture): this gates a background side
 * effect, not an answer, so a miss just means the search waits for the next
 * turn or an explicit ask — never a wrong answer.
 */
const MANUAL_INTENT_RE =
  /\b(?:manuals?|documentation|docs?|datasheet|data\s+sheet|spec\s+sheet|instructions?|user\s+guide|service\s+manual|install(?:ation)?\s+guide)\b/i;

export function wantsManualDocumentation(message: string): boolean {
  return MANUAL_INTENT_RE.test(message);
}

/**
 * May `part` leave MIRA as an automatic, pre-confirmation manual-search identity,
 * given the photo observation and the technician's typed text (#4172)? The ONE
 * gate every candidate-basis proposal and acquisition passes. Strict by owner
 * decision after six review rounds — all must hold, else no automatic search
 * (a confirmed identity still searches through the existing confirmed path):
 *  - no serial label and no asset-tag / customer-identifier label in EITHER
 *    text (ADR-0036: no serial or asset-tag egress, under any normalisation);
 *  - the serial-safe part codes across BOTH texts are exactly `part` — so the
 *    identity came from the serial-safe reader, and two codes are ambiguity,
 *    never absence;
 *  - the photo and typed text TOGETHER name no other machine
 *    (proposeIdentityFromText's multi-machine rejection);
 *  - neither text names a maker other than `manufacturer` (aliases of one maker
 *    share an OEM-table group); a proposed maker the table cannot place is
 *    never checked against a maker the text does name — fail closed.
 */
export function isSafeCandidateSearchIdentity(photoText: string, typed: string, part: string, manufacturer: string): boolean {
  const key = part.trim().toUpperCase();
  if (!key) return false;
  const texts = [photoText, typed].filter(Boolean);
  if (texts.some(mentionsSerialLabel)) return false;
  // A customer-assigned identifier anywhere (asset tag, unit id, …) is the
  // same fail-closed signal as a serial label (ADR-0036; Codex post-cap 14 F14).
  if (texts.some(mentionsAssetLabel)) return false;
  const codes = new Set(texts.flatMap((t) => partCodes(t).map((c) => c.toUpperCase())));
  if (codes.size !== 1 || !codes.has(key)) return false;
  const proposed = new Set(makerGroups(manufacturer).keys());
  const named = texts.flatMap((t) => [...makerGroups(t).keys()]);
  if (named.some((g) => !proposed.has(g))) return false;
  return namesOnlyThisMachine(texts.join("\n"), part);
}
