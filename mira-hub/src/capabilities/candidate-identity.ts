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
import { mentionsSerialLabel, partCodes, unambiguousPartNumber } from "./photo-part-lookup";

export type CandidateIdentity = { manufacturer: string | null; part: string };

/** Maker names that are also everyday words: only an ALL-CAPS label print counts. */
const DICTIONARY_MAKERS = new Set(["sick", "banner", "parker", "eaton", "emerson", "phoenix"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every maker group (the OEM table's first domain) named in `text`, mapped to the
 *  longest matched name. Aliases of one maker share a group. */
function makerGroups(text: string): Map<string, string> {
  const hits = new Map<string, string>(); // group (first domain) -> longest matched name
  for (const { name, domains } of oemMakerTable()) {
    const body = escape(name).replace(/\\-| /g, "[\\s-]+");
    const re = new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi");
    const dictionary = DICTIONARY_MAKERS.has(name);
    const named = [...text.matchAll(re)].some((m) => !dictionary || m[0] === m[0].toUpperCase());
    if (!named) continue;
    const group = domains[0] ?? name;
    const prior = hits.get(group);
    if (!prior || name.length > prior.length) hits.set(group, name);
  }
  return hits;
}

/** The maker named in `text`, upper-cased as printed on a label, or null when
 *  none or more than one distinct maker is named. */
export function makerFromText(text: string): string | null {
  const hits = makerGroups(text);
  if (hits.size !== 1) return null;
  return [...hits.values()][0].toUpperCase();
}

export function extractCandidateIdentity(observation: string, typed = ""): CandidateIdentity | null {
  const fromPhoto = unambiguousPartNumber(observation);
  const part = fromPhoto ?? (typed ? unambiguousPartNumber(typed) : null);
  if (!part) return null;
  const own = makerFromText(fromPhoto ? observation : typed);
  const other = makerFromText(fromPhoto ? typed : observation);
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
 *  - no serial label in EITHER text (ADR-0036: no serial egress, under any
 *    parser's normalisation);
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
  const codes = new Set(texts.flatMap((t) => partCodes(t).map((c) => c.toUpperCase())));
  if (codes.size !== 1 || !codes.has(key)) return false;
  const proposed = new Set(makerGroups(manufacturer).keys());
  const named = texts.flatMap((t) => [...makerGroups(t).keys()]);
  if (named.some((g) => !proposed.has(g))) return false;
  return namesOnlyThisMachine(texts.join("\n"), part);
}
