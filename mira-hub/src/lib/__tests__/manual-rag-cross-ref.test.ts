/**
 * Cross-reference following tests: "see page N" → fetch page N chunks
 */
import { describe, expect, it } from "vitest";
import { buildGroundedContext } from "../manual-rag";
import type { ManualChunk } from "../manual-rag";

function makeChunk(content: string, page: number, url = "test.pdf"): ManualChunk {
  return {
    chunkId: `c${page}`,
    content,
    manufacturer: "Test",
    modelNumber: "T100",
    title: "Test Manual",
    sourceUrl: url,
    sourcePage: page,
    chunkIndex: null,
    verified: false,
    retrievalScope: "tenant" as const,
  };
}

describe("followCrossReferences — see page N", () => {
  it("follows 'see page N' reference to include that page", () => {
    const chunk1 = makeChunk("For wiring details, see page 40.", 10);
    const chunk40 = makeChunk("# Wiring\n\nConnect STO terminals 1 and 2 to safety relay.", 40);
    const allChunks = [chunk1, chunk40];
    
    const context = buildGroundedContext([chunk1], "How do I wire STO?", allChunks);
    
    // Should include both original chunk and referenced page 40
    expect(context).toContain("see page 40");
    expect(context).toContain("Connect STO terminals");
    expect(context).toContain("safety relay");
  });

  it("follows 'refer to page N' reference", () => {
    const chunk1 = makeChunk("Parameter details: refer to page 223", 50);
    const chunk223 = makeChunk("P06.53 — Motor overload protection\nRange: 0-200%", 223);
    const allChunks = [chunk1, chunk223];
    
    const context = buildGroundedContext([chunk1], "What is P06.53?", allChunks);
    
    expect(context).toContain("refer to page 223");
    expect(context).toContain("P06.53");
    expect(context).toContain("Motor overload");
  });

  it("follows multiple page references", () => {
    const chunk1 = makeChunk("See page 15 for specs and page 20 for wiring.", 5);
    const chunk15 = makeChunk("Specifications: 24VDC supply", 15);
    const chunk20 = makeChunk("Wiring: terminals 1-4", 20);
    const allChunks = [chunk1, chunk15, chunk20];
    
    const context = buildGroundedContext([chunk1], "What are the specs?", allChunks);
    
    expect(context).toContain("24VDC supply");
    expect(context).toContain("terminals 1-4");
  });

  it("dedupes already-retrieved pages", () => {
    const chunk1 = makeChunk("Details on page 10.", 5);
    const chunk10 = makeChunk("Important information here.", 10);
    const allChunks = [chunk1, chunk10];
    
    // chunk10 is already retrieved
    const context = buildGroundedContext([chunk1, chunk10], "Tell me more", allChunks);
    
    // Should appear only once
    const matches = context.match(/Important information here/g);
    expect(matches?.length).toBe(1);
  });

  it("handles 'check section N' and 'consult page N'", () => {
    const chunk1 = makeChunk("For calibration, check section 7 and consult page 100.", 1);
    const chunk7 = makeChunk("Section 7: Calibration steps", 7);
    const chunk100 = makeChunk("Page 100: Advanced calibration", 100);
    const allChunks = [chunk1, chunk7, chunk100];
    
    const context = buildGroundedContext([chunk1], "How to calibrate?", allChunks);
    
    expect(context).toContain("Calibration steps");
    expect(context).toContain("Advanced calibration");
  });

  it("limits cross-ref additions to avoid context explosion", () => {
    const chunk1 = makeChunk("See pages 10, 20, 30, 40, 50, 60, 70 for details.", 1);
    const extraChunks = Array.from({ length: 10 }, (_, i) => 
      makeChunk(`Page ${(i + 1) * 10} content`, (i + 1) * 10)
    );
    const allChunks = [chunk1, ...extraChunks];
    
    const context = buildGroundedContext([chunk1], "Details?", allChunks);
    
    // Should add some but not all (limited to 5 cross-ref chunks)
    const pageMatches = context.match(/Page \d+ content/g);
    expect(pageMatches).toBeTruthy();
    expect(pageMatches!.length).toBeLessThanOrEqual(6); // 5 cross-refs + maybe 1 original
  });

  it("does not follow cross-refs when no 'see page' pattern", () => {
    const chunk1 = makeChunk("The drive operates at 480V.", 10);
    const chunk40 = makeChunk("Page 40 content not referenced.", 40);
    const allChunks = [chunk1, chunk40];
    
    const context = buildGroundedContext([chunk1], "What voltage?", allChunks);
    
    // Should NOT include page 40 (not referenced)
    expect(context).toContain("480V");
    expect(context).not.toContain("Page 40 content");
  });

  it("only follows one hop (no recursive following)", () => {
    const chunk1 = makeChunk("See page 10 for more.", 1);
    const chunk10 = makeChunk("Details here. Also see page 20.", 10);
    const chunk20 = makeChunk("Page 20 final details.", 20);
    const allChunks = [chunk1, chunk10, chunk20];
    
    const context = buildGroundedContext([chunk1], "Tell me", allChunks);
    
    // Should follow first hop (1 → 10) but not second hop (10 → 20)
    expect(context).toContain("Details here");
    expect(context).not.toContain("Page 20 final details");
  });
});
