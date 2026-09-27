/**
 * Manufacturer name normalization at the Hub's KB write boundary (issue #1596).
 *
 * OCR / extraction noise fragments one real vendor into several catalog rows —
 * "Alien-Bradley" vs "Allen-Bradley", "Cofemo"/"Cofing"/"Cottins" vs "Coffing",
 * "Orldndo Rigging" vs "Orlando Rigging", "Deshaco"/"Desha"/... vs "Deshazo".
 * Because the Hub manufacturer catalog is `GROUP BY knowledge_entries.manufacturer`,
 * each variant mints its own catalog row. Collapsing variants at the insert
 * boundary keeps the catalog (and BM25 grouping) coherent.
 *
 * This is the TypeScript mirror of the crawler's
 * `mira-crawler/ingest/manufacturer_normalize.py::normalize_manufacturer`.
 * Semantics MUST stay in lockstep — the alias map lives in
 * `manufacturer-aliases.json` so a cross-surface consistency test can read it.
 */
import aliases from "./manufacturer-aliases.json";

const OCR_VARIANT_ALIASES: Record<string, string> = aliases;

/** Lowercase + collapse internal whitespace for stable lookup. Mirrors the
 * Python `_norm_key`. */
function normKey(value: string): string {
  return value.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export function normalizeManufacturer(
  raw: string | null | undefined,
): { canonical: string; method: "alias" | "identity" } {
  if (!raw || !raw.trim()) {
    return { canonical: "", method: "identity" };
  }

  const key = normKey(raw);
  const canonical = OCR_VARIANT_ALIASES[key];
  if (canonical !== undefined) {
    return { canonical, method: "alias" };
  }

  // Unknown vendor — pass through with whitespace cleaned only. We do NOT
  // impose a canonical of our own (matches the Python "Divergence safety").
  return { canonical: raw.trim().split(/\s+/).join(" "), method: "identity" };
}

/**
 * #4068 — every spelling the corpus may store for this manufacturer's vendor
 * group (the input, its canonical name, and every alias of that canonical),
 * reduced to the minimal set of ILIKE-substring needles: a name that contains
 * another listed name is dropped ("rockwell automation" ⊃ "rockwell").
 * Used only by the same-family retrieval fallback, where "Allen-Bradley" on a
 * notebook must still reach rows stored as "Rockwell Automation".
 */
export function manufacturerSearchNames(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  const { canonical } = normalizeManufacturer(raw);
  const group = new Set<string>([normKey(raw), normKey(canonical)]);
  for (const [alias, target] of Object.entries(OCR_VARIANT_ALIASES)) {
    if (normKey(target) === normKey(canonical)) group.add(normKey(alias));
  }
  const names = [...group].filter(Boolean);
  return names
    .filter((n) => !names.some((m) => m !== n && n.includes(m)))
    .sort();
}
