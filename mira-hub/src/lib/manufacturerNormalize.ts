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
