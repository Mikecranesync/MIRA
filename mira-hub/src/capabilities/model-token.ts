/**
 * The model-token detector: which drive / controller / panel model a span of
 * text names, as a token to match against `knowledge_entries.model_number`.
 *
 * Extracted from `@/lib/manual-rag` (Codex r7 on #4360) so the query expander
 * (`@/lib/notebook-query`) can canonicalize a candidate fault code against the
 * notebook's bound identity without importing manual-rag, which imports the
 * expander. manual-rag re-exports `resolveModelFromObservationText`, so its
 * existing callers (the notebook chat route, identity-proposal, tests) are
 * unchanged.
 */

// #2178 — model-number detector. Extracts the drive/controller model the user is
// asking about so retrieval can scope to THAT model's manuals, not every chunk
// from the same vendor (a "PowerFlex 753 F005" question was citing PowerFlex 525
// pages because the vendor-wide pass surfaced the nearest sibling). Mirrors the
// families in mira-bots/shared/neon_recall._PRODUCT_NAME_RE. The captured token is
// the discriminating substring (the number for PowerFlex/PF/Micro/ACS, the full
// alphanumeric for GS/x1000) so `model_number ILIKE '%<token>%'` matches whether
// the column stores "753" or "PowerFlex 753". Returns null when no model is named
// — in which case retrieval behaves exactly as before (vendor/tenant scope only).
export const MODEL_PATTERNS: RegExp[] = [
  /\bpowerflex\s*(\d{2,4}[a-z]?)\b/i, // PowerFlex 753 → 753
  /\bpf\s*(\d{2,4}[a-z]?)\b/i, //         PF525 → 525
  /\bmicro\s*(8\d{2})\b/i, //             Micro820 → 820
  /\bacs\s*(\d{3,4})\b/i, //              ACS355 → 355
  /\b(gs\d{1,2}[a-z]?)\b/i, //            GS10 → GS10
  /\b([auvj]1000)\b/i, //                 A1000/V1000/U1000/J1000
  // #3966 — HMI / Comfort / Siemens catalog + SINAMICS V20 family tokens.
  // Capture the discriminating token (TP700, 6AV…, COMFORT, V20) so identity-
  // bound OEM retrieval can scope (or refuse) instead of manufacturer-only BM25.
  /\b(tp\s*\d{3,4})\b/i, //              TP700 / TP 1200
  /\b(ktp\s*\d{2,4})\b/i, //             KTP700
  /\b(6av[0-9a-z.-]+)\b/i, //             6AV2124-0GC01-0AX0
  /\b(sinamics\s*v\s*20)\b/i, //        SINAMICS V20
  /\b(v20)\b/i, //                        V20 (drive family)
  /\b(comfort)\b/i, //                    Comfort panel family
];

/** Resolve model tokens within ONE observation, refusing to pick between
 * different specific models. Comfort is a family hint; a TP/KTP panel and its
 * 6AV order number can describe the same nameplate. */
export function resolveModelFromObservationText(text: string): { model: string | null; ambiguous: boolean } {
  const found = new Set<string>();
  for (const pattern of MODEL_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      let token = (match[1] ?? match[0]).replace(/\s+/g, "").toUpperCase();
      if (token === "SINAMICSV20") token = "V20";
      found.add(token);
    }
  }
  if (found.size > 1 && [...found].some((token) => /^(?:K?TP\d|6AV)/.test(token))) {
    found.delete("COMFORT");
  }
  const tokens = [...found];
  if (tokens.length === 0) return { model: null, ambiguous: false };
  if (tokens.length === 1) return { model: tokens[0], ambiguous: false };
  const panel = tokens.filter((token) => /^K?TP\d/.test(token));
  const catalog = tokens.filter((token) => /^6AV/.test(token));
  if (tokens.length === 2 && panel.length === 1 && catalog.length === 1) {
    return { model: panel[0], ambiguous: false };
  }
  return { model: null, ambiguous: true };
}

/**
 * One key per model, however it was written (Codex r7 on #4360): "PF525",
 * "PowerFlex 525", "POWERFLEX 525", "powerflex 525" and the identity-proposal
 * parser's own "525" are all "525"; "gs10" is "GS10". A span the detector does
 * not recognize keys as itself, upper-cased and stripped of punctuation, so an
 * unknown label still matches its own spelling. Empty for no text. Pure.
 */
export function canonicalModelKey(span: string | null | undefined): string {
  const s = (span ?? "").trim();
  if (!s) return "";
  const { model } = resolveModelFromObservationText(s);
  return (model ?? s).toUpperCase().replace(/[^A-Z0-9]/g, "");
}
