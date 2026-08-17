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

  for (const ch of chunks) {
    const page =
      typeof ch.page === "number" && Number.isFinite(ch.page) && ch.page > 0 ? ch.page : null;
    const dense = normalizeIdentifier(ch.content ?? "");
    const tokSet = new Set(tokensOf(ch.content ?? "").map(normalizeIdentifier));

    // Catalog numbers are long and punctuation-heavy — a dense (punctuation
    // stripped) containment test is the right shape for them.
    if (catalog && catalog.length >= 4 && dense.includes(catalog)) {
      hits.catalog++;
      if (page !== null) catalogPages.push(page);
    }
    if (model) {
      if (tokSet.has(model) || (model.length >= 4 && dense.includes(model))) {
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
