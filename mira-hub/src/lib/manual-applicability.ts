/**
 * manual-applicability — does this downloaded manual actually apply to the
 * component the technician confirmed?
 *
 * PURE functions, no I/O. The judgement is made from the MATERIALIZED CHUNKS of
 * that exact document — the text we can cite. A search-result title, a filename,
 * or a URL is NEVER sufficient evidence: those are claims about a document, not
 * the document. If the chunks do not contain the identifier, the source stays a
 * `candidate` the technician must confirm; it does not enter chat by default.
 *
 * This is the "materialized evidence, candidate until proven" discipline applied
 * at the smallest useful scale (.claude/rules/materialized-evidence.md rule 9):
 * a model/search result never self-promotes to verified.
 */

export interface ApplicabilityChunk {
  content: string;
  page: number | null;
}

export interface ApplicabilityIdentity {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
}

export interface ApplicabilityVerdict {
  state: "verified" | "candidate";
  /** Machine-readable decision method, persisted in match_evidence. */
  method: string;
  matchedTokens: string[];
  evidencePages: number[];
  /** Pages whose text names the exact catalog number or model — never pages
   *  that only name the manufacturer (`evidencePages` includes those). Set on a
   *  verified verdict; what the chat cites as "covers this exact model". */
  identifierPages?: number[];
  /** The identifier those pages actually print, and which one it is — so a
   *  page verified by the catalog number is never described as naming the
   *  model (Codex #5706 r2 F8). Set with identifierPages. */
  identifier?: { kind: "catalog_number" | "model"; text: string };
  confidence: number;
  reason: string;
}

/**
 * Uppercase, strip everything that is not a letter or digit. "PF-525" and
 * "pf 525" both normalize to "PF525", so identifier comparison survives the
 * punctuation drift between a nameplate, a search result, and a manual.
 */
export function normalizeIdentifier(s: string): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Alphanumeric runs of a chunk, normalized — the token universe of the text. */
function tokensOf(content: string): string[] {
  return (content ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

function sharedPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * A family-prefix relative of the model: same leading characters, different
 * tail — "PowerFlex 520-series" against a 525, or "25B-D010" against
 * "25B-D010N104". Real evidence that we are in the right neighbourhood, and
 * explicitly NOT proof that this document covers this exact unit.
 */
function isFamilyPrefix(model: string, token: string): boolean {
  if (model.length < 3 || token.length < 3) return false;
  if (model === token) return false;
  const shared = sharedPrefixLength(model, token);
  if (shared < 2) return false;
  // Either the token is a strict prefix/extension of the model (25B-D010 vs
  // 25B-D010N104), or they diverge only in the final character(s) (520 vs 525).
  if (shared === model.length || shared === token.length) return true;
  return shared >= model.length - 1 && Math.abs(model.length - token.length) <= 2;
}

/**
 * The identifier as a whole token of the text, case-insensitive (2026-11-20).
 * Separator drift is tolerated only where the identifier itself has a
 * separator or changes between letters and digits ("25B-D010N104" matches
 * "25B D010 N104"; "PowerFlex525" matches "PowerFlex 525"; PDF dashes such as
 * U+2013 and the non-breaking hyphen count as separators). Both ends must be
 * token boundaries, and a separator followed by a letter or digit continues
 * the identifier ("GS11N-20P2-EX" is not GS11N-20P2). A match that spans
 * whitespace counts only when it prints no punctuation separator at all
 * ("25B D010 N104", "PowerFlex 40"), so a neighbouring table cell
 * ("GS11N-20P2 N/A", "GS11N-20P2 230V") never completes a longer identifier.
 * Plain punctuation-stripped containment let a table row "GS11N-20P2 5.1"
 * (GS10 manual p.383) verify a misread "GS11N-20P25", and let the stems
 * "GS11N-20" / "GS11N-2" verify as the exact model.
 */
const ID_SEP = "[-._/\\u2010-\\u2015]";
function identifierMatcher(raw: string): ((text: string, samePage?: readonly string[]) => boolean) | null {
  const chars: string[] = [];
  const breakBefore: boolean[] = [];
  // Which breaks the identity itself writes with a separator ("GS11N-20P2-230":
  // N|2 and 2|2), in the order their capture groups appear below.
  const rawSepGaps: boolean[] = [];
  // Which breaks the identity itself writes with whitespace ("PowerFlex 40").
  const rawSpaceGaps: boolean[] = [];
  let sep = false;
  let sepSpace = false;
  for (const ch of (raw ?? "").toUpperCase()) {
    if (!/[A-Z0-9]/.test(ch)) {
      sep = chars.length > 0;
      if (sep && /\s/.test(ch)) sepSpace = true;
      continue;
    }
    const prev = chars[chars.length - 1];
    const change = prev !== undefined && /[0-9]/.test(prev) !== /[0-9]/.test(ch);
    const brk = chars.length > 0 && (sep || change);
    breakBefore.push(brk);
    if (brk) {
      rawSepGaps.push(sep);
      rawSpaceGaps.push(sepSpace);
    }
    chars.push(ch);
    sep = false;
    sepSpace = false;
  }
  if (chars.length === 0) return null;
  const body = chars.map((c, i) => (breakBefore[i] ? "([ \\t\\u00a0._/\\u2010-\\u2015-]{0,2})" : "") + c).join("");
  const re = new RegExp(
    `(?<![A-Za-z0-9])(?<![A-Za-z0-9]${ID_SEP})${body}(?![A-Za-z0-9])(?!${ID_SEP}[A-Za-z0-9])`,
    "gi",
  );
  const sepChar = new RegExp(`^${ID_SEP}$`);
  // Codex #5706 r7 F16: a chunk edge is not always a token boundary. A window
  // cut right after "GS11N-20P2" may be cutting "GS11N-20P2-EX" (and one that
  // starts at it may have lost "X-"). A match is at an edge when the chunk
  // shows fewer than two characters beside it, or just a separator. The
  // chunker's overlapping neighbour window holds what the cut removed, so an
  // edge match is refuted when another chunk of the same page prints that
  // same text continuing into a longer identifier. An edge nothing refutes —
  // a page start, a table-row break, the end of the text — still counts.
  const bordered = (side: string) => side.length >= 2 || (side.length === 1 && !sepChar.test(side));
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text: string, samePage: readonly string[] = []) => {
    const t = text ?? "";
    for (const m of t.matchAll(re)) {
      const at = m.index ?? 0;
      const lit = esc(m[0]);
      if (!bordered(t.slice(at + m[0].length, at + m[0].length + 2))) {
        const continued = new RegExp(`${lit}${ID_SEP}?[A-Za-z0-9]`, "i");
        if (samePage.some((o) => continued.test(o))) continue;
      }
      if (!bordered(t.slice(Math.max(0, at - 2), at))) {
        const preceded = new RegExp(`[A-Za-z0-9]${ID_SEP}?${lit}`, "i");
        if (samePage.some((o) => preceded.test(o))) continue;
      }
      // Owner decision 2026-11-20 (Codex #5706 r4 F4): whitespace may stand in
      // for a break only where the identity itself writes whitespace. Flattened
      // PDF text cannot show where a table cell ends, so "GS11N 20P2 230" never
      // completes GS11N-20P2-230; a hyphenated identifier printed with spaces
      // ("25B D010 N104") goes to candidate review instead of verifying, while
      // "PowerFlex 40" still verifies for the model that writes the space.
      if (rawSpaceGaps.some((isSpace, g) => !isSpace && /[ \t\u00a0]/.test(m[g + 1] ?? ""))) continue;
      // (Codex #5706 r2 F4's "no space beside punctuation" rule is subsumed by
      // the per-break rule above, which keeps literal mixed spellings such as
      // "SLC 5/03" exact — r5 F12 — while "GS11N-20P2 230V" still never
      // completes a longer identifier.)
      // Every break the identity writes with a separator is spelled the same
      // way in the match: all omitted, all punctuation, or all whitespace. A
      // spelling that omits one and spaces another is the identifier's prefix
      // followed by the next table cell — "GS11N20P2 230" never completes
      // GS11N-20P2-230 — while "25B D010 N104" and "PowerFlex 40" still verify
      // (Codex #5706 r3 F4).
      // Only the breaks the identity writes with PUNCTUATION are compared; a
      // break it writes with a space is checked by the rule above (r5 F12).
      const kinds = new Set(
        rawSepGaps.flatMap((isSep, g) => {
          if (!isSep || rawSpaceGaps[g]) return [];
          const gap = m[g + 1] ?? "";
          return [gap === "" ? "none" : /[ \t\u00a0]/.test(gap) ? "space" : "punct"];
        }),
      );
      if (kinds.size <= 1) return true;
    }
    return false;
  };
}

function uniqSorted(nums: number[]): number[] {
  return [...new Set(nums)].sort((a, b) => a - b);
}

/**
 * Decide applicability from the document's own chunks.
 *
 * Rules, in priority order:
 *   1. Exact normalized CATALOG NUMBER in the text            → verified (0.95)
 *   2. Exact normalized MODEL + (manufacturer in text OR OEM host) → verified (0.85)
 *   3. Exact MODEL with no manufacturer attribution           → candidate (0.55)
 *   4. Family-prefix relative of the model only               → candidate (0.4)
 *   5. No identifier evidence at all                          → candidate (0.05)
 *
 * A verdict is NEVER "verified" on zero chunk evidence.
 */
export function assessApplicability(input: {
  identity: ApplicabilityIdentity;
  chunks: ApplicabilityChunk[];
  oemHost: boolean;
}): ApplicabilityVerdict {
  const chunks = Array.isArray(input.chunks) ? input.chunks : [];
  const model = normalizeIdentifier(input.identity.model ?? "");
  const catalog = normalizeIdentifier(input.identity.catalogNumber ?? "");
  const modelMatches = identifierMatcher(input.identity.model ?? "");
  const catalogMatches = identifierMatcher(input.identity.catalogNumber ?? "");
  const mfrFull = normalizeIdentifier(input.identity.manufacturer ?? "");
  // Longest word of a multi-word manufacturer ("Allen-Bradley" → ALLENBRADLEY,
  // but also match a document that only says "BRADLEY" or "ROCKWELL").
  const mfrWords = (input.identity.manufacturer ?? "")
    .split(/[^A-Za-z0-9]+/)
    .map(normalizeIdentifier)
    .filter((w) => w.length >= 4);

  if (chunks.length === 0) {
    return {
      state: "candidate",
      method: "no_chunk_evidence",
      matchedTokens: [],
      evidencePages: [],
      confidence: 0,
      reason:
        "the document produced no readable text, so it could not be checked against the confirmed identity",
    };
  }

  // Hits are counted independently of pages: a chunk with a null page still
  // proves the match, it just contributes no page citation.
  const hits = { catalog: 0, model: 0, family: 0, manufacturer: 0 };
  const catalogPages: number[] = [];
  const modelPages: number[] = [];
  const familyPages: number[] = [];
  const mfrPages: number[] = [];
  const familyTokens = new Set<string>();
  const mfrTokens = new Set<string>();

  const pageOf = (c: ApplicabilityChunk) =>
    typeof c.page === "number" && Number.isFinite(c.page) && c.page > 0 ? c.page : null;
  const byPage = new Map<number | null, ApplicabilityChunk[]>();
  for (const c of chunks) byPage.set(pageOf(c), [...(byPage.get(pageOf(c)) ?? []), c]);
  for (const ch of chunks) {
    const page = pageOf(ch);
    // The other windows of this chunk's page: what a chunk edge may have cut (r7 F16).
    const samePage = (byPage.get(page) ?? []).filter((o) => o !== ch).map((o) => o.content ?? "");
    const dense = normalizeIdentifier(ch.content ?? "");
    const tokSet = new Set(tokensOf(ch.content ?? "").map(normalizeIdentifier));

    // Catalog numbers are long and punctuation-heavy, so separators may
    // drift — but only inside the number, never across a neighbouring token
    // (identifierMatcher).
    if (catalog && catalog.length >= 4 && catalogMatches?.(ch.content ?? "", samePage)) {
      hits.catalog++;
      if (page !== null) catalogPages.push(page);
    }
    if (model) {
      // The whole-identifier matcher for every spelling, compact ones included:
      // a token-set hit let "GS11N20P2" verify against "GS11N20P2-EX".
      if (modelMatches?.(ch.content ?? "", samePage)) {
        hits.model++;
        if (page !== null) modelPages.push(page);
      } else {
        for (const t of tokSet) {
          if (isFamilyPrefix(model, t)) {
            familyTokens.add(t);
            hits.family++;
            if (page !== null) familyPages.push(page);
            break;
          }
        }
      }
    }
    if (mfrFull && dense.includes(mfrFull)) {
      mfrTokens.add(mfrFull);
      hits.manufacturer++;
      if (page !== null) mfrPages.push(page);
    } else {
      for (const w of mfrWords) {
        if (tokSet.has(w) || dense.includes(w)) {
          mfrTokens.add(w);
          hits.manufacturer++;
          if (page !== null) mfrPages.push(page);
          break;
        }
      }
    }
  }

  const mfrEvident = hits.manufacturer > 0;

  // 1 — exact catalog number is the strongest possible evidence.
  if (hits.catalog > 0) {
    return {
      state: "verified",
      method: "catalog_number_exact",
      matchedTokens: uniq([catalog, ...(mfrEvident ? [...mfrTokens] : [])]),
      evidencePages: uniqSorted([...catalogPages, ...(mfrEvident ? mfrPages : [])]),
      identifierPages: uniqSorted(catalogPages),
      identifier: { kind: "catalog_number", text: (input.identity.catalogNumber ?? "").trim() },
      confidence: 0.95,
      reason: `the document text contains the confirmed catalog number ${input.identity.catalogNumber}`,
    };
  }

  // 2 — exact model plus attribution (manufacturer in text, or an OEM host).
  if (hits.model > 0 && (mfrEvident || input.oemHost === true)) {
    return {
      state: "verified",
      method: mfrEvident ? "model_exact_with_manufacturer" : "model_exact_on_oem_host",
      matchedTokens: uniq([model, ...mfrTokens]),
      evidencePages: uniqSorted([...modelPages, ...mfrPages]),
      identifierPages: uniqSorted(modelPages),
      identifier: { kind: "model", text: (input.identity.model ?? "").trim() },
      confidence: mfrEvident ? 0.85 : 0.8,
      reason: mfrEvident
        ? `the document text names both ${input.identity.manufacturer} and model ${input.identity.model}`
        : `the document text contains model ${input.identity.model} and came from the manufacturer's own site`,
    };
  }

  // 3 — model present but unattributed: right number, unproven provenance.
  if (hits.model > 0) {
    return {
      state: "candidate",
      method: "model_exact_unattributed",
      matchedTokens: uniq([model]),
      evidencePages: uniqSorted(modelPages),
      confidence: 0.55,
      reason: `the document mentions model ${input.identity.model} but does not name ${
        input.identity.manufacturer || "the manufacturer"
      }, and it did not come from the manufacturer's own site`,
    };
  }

  // 4 — family relative only. Never auto-verified: a 520-series manual is not
  // proof of 525 coverage.
  if (hits.family > 0) {
    return {
      state: "candidate",
      method: "family_prefix_only",
      matchedTokens: uniq([...familyTokens]),
      evidencePages: uniqSorted(familyPages),
      confidence: 0.4,
      reason: `the document covers the ${[...familyTokens].join(", ")} family but never names ${
        input.identity.model
      } exactly`,
    };
  }

  // 5 — nothing. Name what was missing so the technician can judge.
  const missing: string[] = [];
  if (input.identity.catalogNumber) missing.push(`catalog number ${input.identity.catalogNumber}`);
  if (input.identity.model) missing.push(`model ${input.identity.model}`);
  if (!input.identity.model && !input.identity.catalogNumber) missing.push("any model or catalog number");
  if (!mfrEvident && input.identity.manufacturer) missing.push(`manufacturer ${input.identity.manufacturer}`);
  return {
    state: "candidate",
    method: "no_identifier_evidence",
    matchedTokens: [],
    evidencePages: [],
    confidence: 0.05,
    reason: `the document text does not contain ${missing.join(" or ")}`,
  };
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}
