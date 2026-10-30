/**
 * Tests for `tools/investigator/ingest.ts` (BENCH-A lane). See
 * `bench-openai-model.test.ts` for why these live here instead of under
 * `tools/investigator/`. All pure functions — no DB, no network, no files.
 */
import { describe, expect, it } from "vitest";
import {
  RESERVED_SETS,
  assertSetAllowed,
  checkCompleteness,
  docIdFor,
  tenantIdFor,
  uuidOf,
} from "../../../../../tools/investigator/ingest";

describe("RESERVED_SETS / assertSetAllowed", () => {
  it("refuses every one of the 8 named reserved sets", () => {
    expect(RESERVED_SETS).toHaveLength(8);
    for (const set of RESERVED_SETS) {
      expect(() => assertSetAllowed(set)).toThrow(/refusing/);
    }
  });

  it("allows a new, non-reserved set name", () => {
    expect(() => assertSetAllowed("investigator-dev-set-1")).not.toThrow();
  });
});

describe("uuidOf / tenantIdFor / docIdFor", () => {
  it("is deterministic (same input -> same output, every time)", () => {
    expect(uuidOf("hyb-tenant-forum-fresh")).toBe(uuidOf("hyb-tenant-forum-fresh"));
  });

  it("produces a well-formed v4-shaped UUID string", () => {
    const id = uuidOf("anything");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("tenantIdFor/docIdFor are thin wrappers over the SAME uuidOf prefixing scheme the pinned harness uses", () => {
    expect(tenantIdFor("forum-fresh")).toBe(uuidOf("hyb-tenant-forum-fresh"));
    expect(docIdFor("gs10-manual")).toBe(uuidOf("bench-doc-gs10-manual"));
  });
});

describe("checkCompleteness", () => {
  it("returns \"empty\" when no rows exist for the tenant", () => {
    expect(checkCompleteness([], ["doc-a", "doc-b"])).toBe("empty");
  });

  it("returns \"complete\" when every expected doc has only fully-embedded rows", () => {
    const rows = [
      { docId: "doc-a", hasEmbedding: true },
      { docId: "doc-a", hasEmbedding: true },
      { docId: "doc-b", hasEmbedding: true },
    ];
    expect(checkCompleteness(rows, ["doc-a", "doc-b"])).toBe("complete");
  });

  it('returns "incomplete" when one expected doc is MISSING ENTIRELY, even though the ' +
      "tenant-wide total vs embedded count would look complete (the exact bug a tenant-wide-only check misses)", () => {
    // doc-a is fully embedded; doc-b (also expected) has ZERO rows. A naive
    // tenant-wide `count(*) === count(embedding)` check (the pinned harness's
    // own check) would see 2/2 and call this "complete" — wrong, because the
    // whole second manual is absent.
    const rows = [
      { docId: "doc-a", hasEmbedding: true },
      { docId: "doc-a", hasEmbedding: true },
    ];
    expect(checkCompleteness(rows, ["doc-a", "doc-b"])).toBe("incomplete");
  });

  it("returns \"incomplete\" when an expected doc has a partially-embedded row", () => {
    const rows = [
      { docId: "doc-a", hasEmbedding: true },
      { docId: "doc-a", hasEmbedding: false },
    ];
    expect(checkCompleteness(rows, ["doc-a"])).toBe("incomplete");
  });
});

/**
 * MUTATION CHECK:
 *
 * Mutated `ingest.ts`'s `RESERVED_SETS` array, removing the `"robust"` entry
 * (per the review-advisor's own suggested target for this file). Named test
 * that failed: "RESERVED_SETS / assertSetAllowed > refuses every one of the 8
 * named reserved sets" — first by `expect(RESERVED_SETS).toHaveLength(8)`
 * (7 !== 8), and even with that assertion removed, `assertSetAllowed("robust")`
 * would no longer throw. Restored the entry and reran — test passed again.
 */
