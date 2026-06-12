/**
 * Vendor-alias citation relevance / cross-vendor conflict strip.
 *
 * Ports the CROSS_VENDOR_FILTER from `mira-bots/shared/workers/rag_worker.py`
 * (≈ lines 585-610) to the Hub TS retrieval path. The bot drops BM25 chunks
 * whose manufacturer doesn't match the vendor the query resolved to — so a
 * Siemens manual chunk never grounds an answer to a Danfoss question — while
 * keeping untagged/generic chunks and never stripping the result set to empty.
 *
 * The alias table mirrors `VENDOR_ALIASES` in
 * `mira-bots/shared/uns_resolver.py`. Unlike the Python filter (which uses a
 * raw `query_vendor in chunk.manufacturer` substring test), this canonicalizes
 * BOTH the query vendor and each chunk's manufacturer through the alias table
 * before comparing. That fixes the alias-family case the substring test misses
 * (e.g. a chunk tagged "Allen-Bradley" is kept for a "Rockwell"/"PowerFlex"
 * query — both canonicalize to "Rockwell Automation").
 */

// alias substring → canonical manufacturer display name. Mirrors
// uns_resolver.VENDOR_ALIASES. Lowercase keys.
const VENDOR_ALIASES: Record<string, string> = {
  // Rockwell family
  powerflex: "Rockwell Automation",
  "allen-bradley": "Rockwell Automation",
  "allen bradley": "Rockwell Automation",
  "rockwell automation": "Rockwell Automation",
  rockwell: "Rockwell Automation",
  ab: "Rockwell Automation",
  pf525: "Rockwell Automation",
  pf527: "Rockwell Automation",
  pf520: "Rockwell Automation",
  pf40: "Rockwell Automation",
  pf70: "Rockwell Automation",
  pf753: "Rockwell Automation",
  pf755: "Rockwell Automation",
  // AutomationDirect family
  gs10: "AutomationDirect",
  gs20: "AutomationDirect",
  gs1: "AutomationDirect",
  gs2: "AutomationDirect",
  gs3: "AutomationDirect",
  gs4: "AutomationDirect",
  gs4p: "AutomationDirect",
  gs11: "AutomationDirect",
  gs21: "AutomationDirect",
  automationdirect: "AutomationDirect",
  "automation direct": "AutomationDirect",
  // Siemens family
  micromaster: "Siemens",
  sinamics: "Siemens",
  siemens: "Siemens",
  // Mitsubishi family
  "mitsubishi electric": "Mitsubishi Electric",
  mitsubishi: "Mitsubishi Electric",
  "fr-e": "Mitsubishi Electric",
  "fr-a": "Mitsubishi Electric",
  "fr-d": "Mitsubishi Electric",
  "fr-f": "Mitsubishi Electric",
  // Danfoss
  "aqua drive": "Danfoss",
  danfoss: "Danfoss",
  // Schneider
  "schneider electric": "Schneider Electric",
  schneider: "Schneider Electric",
  // Bosch Rexroth
  "bosch rexroth": "Bosch Rexroth",
  rexroth: "Bosch Rexroth",
  // SEW-Eurodrive
  "sew-eurodrive": "SEW-Eurodrive",
  sew: "SEW-Eurodrive",
  movitrac: "SEW-Eurodrive",
  movidrive: "SEW-Eurodrive",
  // Yaskawa
  a1000: "Yaskawa",
  v1000: "Yaskawa",
  j1000: "Yaskawa",
  ga500: "Yaskawa",
  ga700: "Yaskawa",
  p1000: "Yaskawa",
  e1000: "Yaskawa",
  yaskawa: "Yaskawa",
  // Singletons
  abb: "ABB",
  omron: "Omron",
  eaton: "Eaton",
  delta: "Delta Electronics",
  lenze: "Lenze",
  pilz: "Pilz",
};

// Longest aliases first so "rockwell automation" wins over "rockwell" and
// "allen bradley" is matched before any shorter fragment.
const SORTED_ALIASES = Object.keys(VENDOR_ALIASES).sort((a, b) => b.length - a.length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a manufacturer string OR free-text query to a canonical vendor
 * display name, or null if no known vendor is mentioned. Aliases are matched
 * on word boundaries so short aliases ("ab", "sew", "delta") don't fire on
 * substrings of unrelated words ("grab", "answered", "deltap").
 */
export function resolveVendor(text: string | null | undefined): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const alias of SORTED_ALIASES) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`, "i");
    if (re.test(lower)) return VENDOR_ALIASES[alias];
  }
  return null;
}

export interface VendorTaggable {
  manufacturer: string;
}

/**
 * Drop chunks whose manufacturer canonicalizes to a DIFFERENT known vendor
 * than the query. Mirrors rag_worker's CROSS_VENDOR_FILTER:
 *
 * - When the query resolves to no known vendor, return the chunks unchanged
 *   (we can't prove any conflict).
 * - Keep chunks with no manufacturer tag (generic content — fault-code tables,
 *   application notes).
 * - Keep chunks whose manufacturer doesn't resolve to a known vendor (can't
 *   prove a conflict — safer than the Python substring filter, which would
 *   drop them).
 * - Drop only chunks positively identified as a DIFFERENT vendor.
 * - Never strip to empty: if the filter would remove every chunk, return the
 *   original set (a wrong-vendor citation beats no citation at all, and the
 *   cite-or-refuse prompt still guards the answer).
 *
 * @param queryVendor the manufacturer the user selected, or the raw question
 *   text to infer the vendor from.
 */
export function stripConflictingVendors<T extends VendorTaggable>(
  chunks: T[],
  queryVendor: string | null | undefined,
): T[] {
  const canonical = resolveVendor(queryVendor);
  if (!canonical || chunks.length === 0) return chunks;

  const kept = chunks.filter((c) => {
    if (!c.manufacturer || !c.manufacturer.trim()) return true;
    const chunkVendor = resolveVendor(c.manufacturer);
    return chunkVendor === null || chunkVendor === canonical;
  });

  return kept.length > 0 ? kept : chunks;
}
