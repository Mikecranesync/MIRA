// TAG-001 — the cross-surface asset-tag grammar contract (CU-P1).
//
// docs/contracts/asset-tag-grammar.json is THE grammar both the Hub and
// mira-mobile must implement. This suite locks the Hub side: every corpus
// case, executed against the canonical resolver (scan-target.ts, which
// enforces ASSET_TAG_REGEX from asset-tag.ts).
//
// The mirror suite lives at mira-mobile/src/lib/__tests__/tag-grammar-contract.test.ts.
// If you change the corpus, you are changing a cross-surface contract:
// update BOTH consumers in the same PR.
import { describe, it, expect } from "vitest";
import { extractAssetTag } from "../scan-target";
import { ASSET_TAG_REGEX } from "../asset-tag";
import corpus from "../../../../docs/contracts/asset-tag-grammar.json";

interface GrammarCase {
  name: string;
  input: string;
  expect: string | null;
  mobile_expect?: string | null;
}

describe("TAG-001 asset-tag grammar contract — Hub side", () => {
  it("corpus canonical_regex matches the shipped ASSET_TAG_REGEX", () => {
    // The contract file must never drift from the code it claims to describe.
    expect(`^${ASSET_TAG_REGEX.source.replace(/^\^|\$$/g, "")}$`).toBe(corpus.canonical_regex);
  });

  for (const c of corpus.cases as GrammarCase[]) {
    it(c.name, () => {
      expect(extractAssetTag(c.input)).toBe(c.expect);
    });
  }

  it("every extracted tag satisfies ASSET_TAG_REGEX (no resolver bypass)", () => {
    for (const c of corpus.cases as GrammarCase[]) {
      const got = extractAssetTag(c.input);
      if (got !== null) expect(got).toMatch(ASSET_TAG_REGEX);
    }
  });
});
