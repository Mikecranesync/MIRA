// TAG-001 — the cross-surface asset-tag grammar contract (CU-P1).
//
// docs/contracts/asset-tag-grammar.json is THE grammar. The Hub side is locked
// by mira-hub/src/lib/__tests__/asset-tag-grammar-contract.test.ts; this suite
// locks the mobile side. Mobile implements the SAME grammar plus exactly one
// deliberate extra restriction — the deep-link trust filter (absolute-URL
// inputs resolve only from https://app.factorylm.com/m/ or factorylm://m/) —
// captured per-case as `mobile_expect`.
//
// The shadow suite (tag-grammar-shadow.test.ts) additionally executes the
// REAL Hub implementation side by side and diffs the two over the corpus and
// a deterministic fuzz corpus, per convergence Gate 8.
import { describe, it, expect } from "vitest";
import { extractAssetTag } from "../tags";
import corpus from "../../../../docs/contracts/asset-tag-grammar.json";

interface GrammarCase {
  name: string;
  input: string;
  expect: string | null;
  mobile_expect?: string | null;
}

describe("TAG-001 asset-tag grammar contract — Mobile side", () => {
  for (const c of corpus.cases as GrammarCase[]) {
    const want = "mobile_expect" in c ? c.mobile_expect! : c.expect;
    it(c.name, () => {
      expect(extractAssetTag(c.input)).toBe(want);
    });
  }
});
