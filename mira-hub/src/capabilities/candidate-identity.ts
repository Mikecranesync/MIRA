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
import { unambiguousPartNumber } from "./photo-part-lookup";

export type CandidateIdentity = { manufacturer: string | null; part: string };

/** Maker names that are also everyday words: only an ALL-CAPS label print counts. */
const DICTIONARY_MAKERS = new Set(["sick", "banner", "parker", "eaton", "emerson", "phoenix"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The maker named in `text`, upper-cased as printed on a label, or null when
 *  none or more than one distinct maker is named. */
export function makerFromText(text: string): string | null {
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
