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

// #4469 F1 — resolveModelFromObservationText's single token exists to match
// ONE `model_number ILIKE '%<token>%'` column, so for the digit-only families
// (PowerFlex/PF, Micro, ACS) it deliberately keeps just the number: "ACS800"
// and "Micro800" both reduce to "800". That is correct for the ILIKE use —
// changing it would ripple into every caller that scopes retrieval by model —
// but it means "800" alone cannot tell an ACS800 manual from a Micro800
// manual apart for a document-applicability check. FAMILY_KEYS is index-
// aligned with MODEL_PATTERNS (one label per pattern, no second pattern list)
// so modelIdentitiesInText can tag each digit-only capture with its family.
// PowerFlex and PF share the label "PF" on purpose — they are the same
// product line written two ways and must still collide WITH EACH OTHER.
const FAMILY_KEYS: readonly string[] = [
  "PF", // powerflex
  "PF", // pf
  "MICRO", // micro
  "ACS", // acs
  "GS", // gs (capture already includes the letters — label unused)
  "X1000", // a/v/u/j 1000 (capture already includes the letter — label unused)
  "TP", // tp (capture already includes the letters — label unused)
  "KTP", // ktp (capture already includes the letters — label unused)
  "6AV", // 6av (capture already includes the letters — label unused)
  "V20", // sinamics v20 (aliased below)
  "V20", // v20 (capture already includes the letters — label unused)
  "COMFORT", // comfort (capture already includes the letters — label unused)
];

// The digit-only families whose siblings get listed after one family word.
// Group 1 is the tail of joined numbers ("and 525", "/525", ", 525 and 527").
// Bare numbers only: "PowerFlex 525 and 480V input" must not coin "PF480V",
// so a trailing unit letter breaks the join.
const JOINED = "(?:\\s*(?:,|and|&|or|/)\\s*\\d{2,4}\\b(?![a-z]))+";
const CONJOINED_DIGIT_FAMILIES: ReadonlyArray<readonly [family: string, head: RegExp]> = [
  ["PF", new RegExp(`\\b(?:powerflex|pf)\\s*\\d{2,4}[a-z]?(${JOINED})`, "gi")],
  ["MICRO", new RegExp(`\\bmicro\\s*8\\d{2}(${JOINED})`, "gi")],
  ["ACS", new RegExp(`\\bacs\\s*\\d{3,4}(${JOINED})`, "gi")],
];

/**
 * Family-qualified model identities named in `text` (#4469 F1), for document
 * APPLICABILITY checks only — never for `model_number ILIKE` matching (that
 * stays on resolveModelFromObservationText's plain token). Returns every
 * match found, each tagged so unrelated product families never collide: a
 * digit-only capture (PowerFlex/PF/Micro/ACS) becomes `${family}${digits}`
 * ("ACS800", "MICRO800", "PF525" — PowerFlex and PF alias to the same "PF525"
 * since they are the same model); a capture that already carries its family
 * in the matched letters (GS10, TP700, 6AV2124-0GC01-0AX0, V20, Comfort) is
 * used as-is, preserving its exact punctuation (catalog hyphens included —
 * #4469 F3 is a normalization bug in the CALLER's title string, not here).
 */
export function modelIdentitiesInText(text: string): Set<string> {
  const identities = new Set(modelMentionsInText(text).map((m) => m.id));
  // Mirror resolveModelFromObservationText's COMFORT-is-a-family-hint drop
  // (primary review, pass 2): "Comfort" alone names the PANEL FAMILY, not a
  // specific sibling model — a TP/KTP panel or 6AV order number is the
  // specific model. Without this, "TP700 Comfort" and a document titled
  // "TP1200 Comfort Operating Instructions" each carry COMFORT, so the two
  // sets would intersect on COMFORT ALONE even though TP700 ≠ TP1200 — the
  // exact cross-family false-grounding this detector exists to prevent.
  if (identities.size > 1 && [...identities].some((id) => /^(?:K?TP\d|6AV)/.test(id))) {
    identities.delete("COMFORT");
  }
  return identities;
}

/** One model mention: its identity (modelIdentitiesInText's shape) and where it sits in the text. */
export type ModelMention = { id: string; start: number; end: number };

/**
 * #5355 (Codex r2 on #5359): every model mention WITH its position, in text
 * order — modelIdentitiesInText is this list's identity set. Positions let a
 * caller read what sits BETWEEN two mentions ("SMC-50 or SMC Flex" vs
 * "Micro820 communicating with Micro850") instead of scanning the whole
 * question for cue words.
 */
export function modelMentionsInText(text: string): ModelMention[] {
  const mentions: ModelMention[] = [];
  MODEL_PATTERNS.forEach((pattern, i) => {
    const family = FAMILY_KEYS[i];
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const captured = (match[1] ?? match[0]).replace(/\s+/g, "").toUpperCase();
      const id = captured === "SINAMICSV20" ? "V20" : /^\d+$/.test(captured) ? `${family}${captured}` : captured;
      mentions.push({ id, start: match.index, end: match.index + match[0].length });
    }
  });
  // Round-2 review on #4484: a title that lists sibling numbers after ONE
  // family word — "PowerFlex 523 and 525", "Micro810 and 820", "ACS580/880" —
  // was credited to the first number only, so the 525 half of a "523 and 525"
  // manual was invisible to a PowerFlex 525 notebook. Each trailing number
  // joined by and/&/,/or/slash inherits the family of the number before it.
  // Applicability only: resolveModelFromObservationText (the single ILIKE
  // token) is deliberately untouched.
  for (const [family, head] of CONJOINED_DIGIT_FAMILIES) {
    for (const match of text.matchAll(head)) {
      const tailStart = match.index + match[0].length - match[1].length;
      for (const tail of match[1].matchAll(/\d{2,4}/g)) {
        const start = tailStart + tail.index;
        mentions.push({ id: `${family}${tail[0]}`, start, end: start + tail[0].length });
      }
    }
  }
  for (const [family, pattern] of APPLICABILITY_ONLY_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (isSpacedRating(match[1], match[2], text.slice(end))) continue;
      mentions.push({ id: `${family}${match[2].toUpperCase()}`, start: match.index, end });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

// #5355 — close-name families the single ILIKE token cannot carry. With the
// SMC Flex manual selected, an SMC-50 question was answered with SMC Flex fault
// codes: no MODEL_PATTERNS entry named either starter, so the question named
// "no model" and every manual looked model-free. PowerFlex 4 / 4M had the same
// gap (the PowerFlex pattern needs two digits, so "4M" read as nothing and a
// PowerFlex 40 manual answered a 4M question). These are APPLICABILITY ONLY,
// like CONJOINED_DIGIT_FAMILIES: they are deliberately not in MODEL_PATTERNS,
// whose token feeds `model_number ILIKE '%<token>%'` scoping — an "SMC-50"
// token of "50" would match a PowerFlex 750's model_number, and an
// identity-bound "SMC Flex" caller would narrow from '%SMC Flex%' to a
// spelling the column may not store. Each identity carries its family, so
// SMCFLEX ≠ SMC50 ≠ SMC3 and PF4 ≠ PF4M ≠ PF40 (the trailing \b keeps "40"
// from reading as "4").
// Codex r1+r2 on #5359: "SMC 3 phase starter" and "SMC 50 A soft starter" are
// ratings, not models — but "reset the SMC-50 a few times" and "SMC-50 phase
// loss" name SMC-50. So the joined spellings (SMC-50, SMC50, SMC-3, PF4M) are
// ALWAYS models, and only a SPACED number ("SMC 50", "PowerFlex 4") followed by
// a unit is a rating: a single-letter unit (A, V, W) must be upper-case (a
// lower-case "a" is the article), a unit word is any case, and "phase"/"ph"
// counts only after 3. Residual: all-lower-case "smc 50 a soft starter"
// reads as SMC-50.
function isSpacedRating(separator: string, model: string, after: string): boolean {
  if (!/^\s+$/.test(separator) || !/^\d+$/.test(model)) return false;
  if (/^[\s-]*(?:A|V|W)\b/.test(after)) return true;
  if (/^[\s-]*(?:amps?|amperes?|volts?|vac|vdc|hp|kw|hz)\b/i.test(after)) return true;
  return model === "3" && /^[\s-]*(?:phase|ph)\b/i.test(after);
}
const APPLICABILITY_ONLY_PATTERNS: ReadonlyArray<readonly [family: string, pattern: RegExp]> = [
  ["SMC", /\bsmc([\s-]*)(flex|50|3)\b/gi], // SMC Flex / SMC-Flex, SMC-50, SMC-3
  ["PF", /\b(?:powerflex|pf)(\s*)(4m?)\b/gi], // PowerFlex 4, PowerFlex 4M
];

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
