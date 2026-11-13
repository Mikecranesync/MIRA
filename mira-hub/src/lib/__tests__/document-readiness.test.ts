import { describe, it, expect } from "vitest";
import {
  deriveReadiness,
  deriveSearchable,
  meetsBasicReady,
  type ReadinessFacts,
} from "../document-readiness";

/**
 * The readiness contract (PRD §14). The load-bearing assertion in this file is
 * the "embeddings can never gate chat" property test at the bottom — that is
 * the invariant the 42501 outage violated in spirit, and the one a future
 * refactor is most likely to break.
 */

/** A text-native manual that has fully materialized. */
const ready: ReadinessFacts = {
  bytesDurable: true,
  chunkCount: 746,
  hasPageAnchors: true,
  scopeValidated: true,
  originalResolvable: true,
};

describe("meetsBasicReady — the §14.1 hard definition", () => {
  it("accepts a materialized, page-anchored, in-scope document", () => {
    expect(meetsBasicReady(ready)).toBe(true);
  });

  it.each([
    ["bytes not durable", { bytesDurable: false }],
    ["zero chunks", { chunkCount: 0 }],
    ["no page anchors", { hasPageAnchors: false }],
    ["scope not validated", { scopeValidated: false }],
    ["original bytes gone", { originalResolvable: false }],
    ["parse failed", { parseFailed: true }],
    ["no extractable text", { noExtractableText: true }],
  ])("rejects when %s", (_label, patch) => {
    expect(meetsBasicReady({ ...ready, ...patch })).toBe(false);
  });

  it("does NOT consider embeddings — a fully dark document is still basic-ready", () => {
    // This is the PowerFlex/Micro820 dogfood case: 1,371 chunks, zero vectors,
    // correct page-exact cited answers.
    expect(meetsBasicReady({ ...ready, embeddedChunkCount: 0 })).toBe(true);
  });
});

describe("deriveReadiness — state machine", () => {
  it("uploading while bytes are not durable", () => {
    const r = deriveReadiness({ ...ready, bytesDurable: false });
    expect(r.state).toBe("uploading");
    expect(r.canChat).toBe(false);
  });

  it("stored when durable but no citable chunks yet", () => {
    const r = deriveReadiness({ ...ready, chunkCount: 0 });
    expect(r.state).toBe("stored");
    expect(r.canChat).toBe(false);
    expect(r.label).toMatch(/preparing text/i);
  });

  it("needs_ocr for an image-only PDF — and never claims searchable", () => {
    const r = deriveReadiness({ ...ready, chunkCount: 0, noExtractableText: true });
    expect(r.state).toBe("needs_ocr");
    expect(r.canChat).toBe(false);
    expect(r.label).toMatch(/text recognition/i);
  });

  it("needs_ocr wins over a stray chunk count (a scan must never be askable)", () => {
    const r = deriveReadiness({ ...ready, noExtractableText: true });
    expect(r.state).toBe("needs_ocr");
    expect(r.canChat).toBe(false);
  });

  it("failed for a terminal parse error", () => {
    const r = deriveReadiness({ ...ready, parseFailed: true });
    expect(r.state).toBe("failed");
    expect(r.canChat).toBe(false);
  });

  it("chat_ready_basic when embedding facts are unknown", () => {
    const r = deriveReadiness(ready);
    expect(r.state).toBe("chat_ready_basic");
    expect(r.canChat).toBe(true);
    expect(r.embeddingCoverage).toBeNull();
  });

  it("enhancing while vectors are partially written", () => {
    const r = deriveReadiness({ ...ready, chunkCount: 100, embeddedChunkCount: 48 });
    expect(r.state).toBe("enhancing");
    expect(r.canChat).toBe(true);
    expect(r.embeddingCoverage).toBeCloseTo(0.48);
    expect(r.label).toMatch(/improving search/i);
  });

  it("chat_ready_enhanced at full coverage", () => {
    const r = deriveReadiness({ ...ready, chunkCount: 73, embeddedChunkCount: 73 });
    expect(r.state).toBe("chat_ready_enhanced");
    expect(r.canChat).toBe(true);
    expect(r.embeddingCoverage).toBe(1);
  });

  it("enhancement_degraded stays askable and shows no scary copy to the tech", () => {
    const r = deriveReadiness({
      ...ready,
      embeddedChunkCount: 0,
      enhancementPermanentlyFailed: true,
    });
    expect(r.state).toBe("enhancement_degraded");
    expect(r.canChat).toBe(true);
    expect(r.label).toBe("Ready to ask");
  });

  it("kill switch reports basic, not degraded — disabled is deliberate", () => {
    const r = deriveReadiness({ ...ready, embeddedChunkCount: 0, enhancementDisabled: true });
    expect(r.state).toBe("chat_ready_basic");
    expect(r.canChat).toBe(true);
  });

  it("never leaks internal retrieval vocabulary to the technician", () => {
    const states: ReadinessFacts[] = [
      ready,
      { ...ready, bytesDurable: false },
      { ...ready, chunkCount: 0 },
      { ...ready, noExtractableText: true },
      { ...ready, parseFailed: true },
      { ...ready, chunkCount: 10, embeddedChunkCount: 3 },
      { ...ready, chunkCount: 10, embeddedChunkCount: 10 },
      { ...ready, enhancementPermanentlyFailed: true },
    ];
    for (const f of states) {
      expect(deriveReadiness(f).label).not.toMatch(/BM25|vector|embedding|pgvector|tsv/i);
    }
  });

  it("clamps a nonsensical coverage ratio instead of reporting >100%", () => {
    const r = deriveReadiness({ ...ready, chunkCount: 10, embeddedChunkCount: 999 });
    expect(r.embeddingCoverage).toBe(1);
  });
});

describe("THE invariant: embeddings can never gate chat", () => {
  /**
   * Property test over the full cross-product of embedding facts. If any
   * embedding-related input can flip `canChat`, this fails. That is the
   * architectural lesson of the 42501 outage, encoded as a permanent test.
   */
  it("canChat is identical for every possible embedding fact", () => {
    const embeddingVariants: Partial<ReadinessFacts>[] = [
      {},
      { embeddedChunkCount: 0 },
      { embeddedChunkCount: 1 },
      { embeddedChunkCount: 745 },
      { embeddedChunkCount: 746 },
      { enhancementPermanentlyFailed: true },
      { enhancementDisabled: true },
      { embeddedChunkCount: 0, enhancementPermanentlyFailed: true },
      { embeddedChunkCount: 0, enhancementDisabled: true },
    ];

    // A basic-ready document stays askable no matter what enrichment did.
    for (const v of embeddingVariants) {
      const r = deriveReadiness({ ...ready, ...v });
      expect(r.canChat, `canChat flipped for ${JSON.stringify(v)}`).toBe(true);
    }

    // ...and a NOT-ready document is never rescued by enrichment either.
    for (const v of embeddingVariants) {
      const r = deriveReadiness({ ...ready, chunkCount: 0, ...v });
      expect(r.canChat, `canChat wrongly true for ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("a scanned PDF is never rescued by a full embedding coverage report", () => {
    const r = deriveReadiness({
      ...ready,
      noExtractableText: true,
      chunkCount: 100,
      embeddedChunkCount: 100,
    });
    expect(r.state).toBe("needs_ocr");
    expect(r.canChat).toBe(false);
  });
});

/**
 * deriveSearchable — #5456. `readiness` above is text readiness ONLY by
 * design; it is "true" (label "Ready to ask") for a source that is OFF
 * (candidate, not enabled) or a known-partial manual (manual-completeness.ts:
 * one chapter file, or pages whose numbers didn't read). The legacy Sources
 * sheet let an OFF partial candidate be ticked on with no warning. This is
 * the pure projection any renderer must read instead of recomputing the gate
 * (or showing `readiness.label` raw).
 */
describe("deriveSearchable — the #5456 off/partial projection", () => {
  /** The exact staging shape from #5456: GS10 ch1.pdf — a chapter-only
   *  candidate the auto-search saved OFF, with 10 unreadable pages. */
  const offPartialCandidate = {
    matchState: "candidate" as const,
    enabledByDefault: false,
    canChat: true, // text readiness says "Ready to ask" — that's the bug surface
    completenessComplete: false, // manual-completeness: chapter_start + unmapped_glyphs
  };

  it("an OFF partial candidate is NOT searchable, even though canChat/readiness says ready", () => {
    const s = deriveSearchable(offPartialCandidate);
    expect(s.searchable).toBe(false);
  });

  it("an OFF partial candidate's label says it is off or partial — never bare 'Ready to ask'", () => {
    const s = deriveSearchable(offPartialCandidate);
    expect(s.searchableLabel).toMatch(/off|partial|not turned on/i);
    expect(s.searchableLabel).not.toBe("Ready to ask");
  });

  it("not text-ready yet ⇒ not searchable, regardless of approval/enable state", () => {
    const s = deriveSearchable({
      matchState: "verified",
      enabledByDefault: true,
      canChat: false,
    });
    expect(s.searchable).toBe(false);
  });

  it("candidate (not yet approved) is not searchable even when enabled", () => {
    const s = deriveSearchable({
      matchState: "candidate",
      enabledByDefault: true,
      canChat: true,
    });
    expect(s.searchable).toBe(false);
    expect(s.searchableLabel).toMatch(/not turned on/i);
  });

  it("verified + enabled but switched off is not searchable", () => {
    const s = deriveSearchable({
      matchState: "verified",
      enabledByDefault: false,
      canChat: true,
    });
    expect(s.searchable).toBe(false);
  });

  it("rejected is never searchable", () => {
    const s = deriveSearchable({
      matchState: "rejected",
      enabledByDefault: true,
      canChat: true,
    });
    expect(s.searchable).toBe(false);
  });

  it("control: verified + enabled + canChat + complete IS searchable, plain 'Ready to ask'", () => {
    const s = deriveSearchable({
      matchState: "verified",
      enabledByDefault: true,
      canChat: true,
      completenessComplete: true,
    });
    expect(s.searchable).toBe(true);
    expect(s.searchableLabel).toBe("Ready to ask");
  });

  it("control: user_confirmed + enabled + canChat is searchable (no completeness judgement recorded)", () => {
    const s = deriveSearchable({
      matchState: "user_confirmed",
      enabledByDefault: true,
      canChat: true,
    });
    expect(s.searchable).toBe(true);
    expect(s.searchableLabel).toBe("Ready to ask");
  });

  it("approved + enabled + canChat but a known-partial manual stays searchable — labeled, not hidden", () => {
    const s = deriveSearchable({
      matchState: "verified",
      enabledByDefault: true,
      canChat: true,
      completenessComplete: false,
    });
    expect(s.searchable).toBe(true);
    expect(s.searchableLabel).toMatch(/partial/i);
  });
});
