/**
 * Ranking test for #5998: PowerFlex 525 overcurrent faults
 * 
 * Verifies that fault-table pages (161-162) reach the answer context
 * when retrieved, not just that they're returned by retrieval.
 */
import { describe, expect, it } from "vitest";
import { buildGroundedContext } from "../manual-rag";
import type { ManualChunk } from "../manual-rag";

function makeChunk(content: string, page: number, url = "pf525-manual.pdf"): ManualChunk {
  return {
    chunkId: `chunk-${page}`,
    content,
    manufacturer: "Rockwell Automation",
    modelNumber: "PowerFlex 525",
    title: "PowerFlex 525 User Manual",
    sourceUrl: url,
    sourcePage: page,
    chunkIndex: null,
    verified: false,
    retrievalScope: "tenant" as const,
  };
}

describe("PowerFlex 525 overcurrent ranking (#5998)", () => {
  it("fault-table pages reach answer context when retrieved", () => {
    // Simulate the scenario from #5998: retrieval returns pp.1, 665, 666, 672
    // but also fault-table pp.161-162 (which were missed in ranking)
    
    const page1 = makeChunk("PowerFlex 525 AC Drive User Manual\n\nF041 Phase UV Short, F012 HW Overcurrent mentioned.", 1);
    const page161 = makeChunk(
      "# Fault Codes\n\n| Code | Description | Causes |\n|------|-------------|--------|\n" +
      "| F012 | HW Overcurrent | Current limit, overhauling load, excessive motor load |\n" +
      "| F063 | SW OverCurrent | Verify connections between motor and load |",
      161
    );
    const page162 = makeChunk(
      "# Fault Codes (continued)\n\n| Code | Description | Causes |\n|------|-------------|--------|\n" +
      "| F063 | SW OverCurrent | Excessive acceleration, deceleration times too short |\n" +
      "| F064 | Ground Fault | Ground fault detected in motor circuit |",
      162
    );
    const page665 = makeChunk("Specifications: Input voltage 200-480V...", 665);
    const page666 = makeChunk("Wiring diagrams for typical installation...", 666);
    const page672 = makeChunk("Maintenance schedule and inspection...", 672);
    
    // All chunks retrieved (mix of relevant and less-relevant)
    const allChunks = [page1, page161, page162, page665, page666, page672];
    
    const question = "What causes overcurrent faults on a PowerFlex 525?";
    const context = buildGroundedContext(allChunks, question);
    
    // CRITICAL: Fault-table pages MUST be in the final context
    expect(context).toContain("F063");
    expect(context).toContain("SW OverCurrent");
    expect(context).toContain("F012");
    expect(context).toContain("HW Overcurrent");
    
    // Verify page numbers are cited
    expect(context).toMatch(/p\.161|p\.162/);
    
    // Verify causes are present
    expect(context).toContain("Current limit");
    expect(context).toContain("Verify connections");
  });

  it("overcurrent term is extracted from question for smart truncation", () => {
    // Even though "overcurrent" is not a fault code (F063) or parameter (P042),
    // the question terms should still help if the content mentions it
    
    const longFaultTable = makeChunk(
      "# Fault Codes\n\n" +
      Array.from({ length: 100 }, (_, i) => 
        `| F${String(i + 1).padStart(3, "0")} | Fault ${i + 1} | Various causes ${i + 1} |`
      ).join("\n") +
      "\n| F063 | SW OverCurrent | Excessive motor load causes overcurrent condition |",
      161
    );
    
    const question = "What causes overcurrent faults?";
    const context = buildGroundedContext([longFaultTable], question);
    
    // F063 should be preserved even if it's row 63 in a 100-row table
    // because it contains "overcurrent" which appears in the question
    expect(context).toContain("F063");
    expect(context).toContain("overcurrent condition");
  });

  it("when fault-table pages are ranked low but present, they survive", () => {
    // Simulate scenario where fault-table pages are retrieved but ranked
    // after less-relevant pages. Smart truncation should still keep them
    // because they match the question terms.
    
    const lessRelevant1 = makeChunk("Specifications and ratings...", 1);
    const lessRelevant2 = makeChunk("Installation instructions...", 10);
    const faultTable = makeChunk(
      "| F012 | HW Overcurrent | Current limit exceeded |\n" +
      "| F063 | SW OverCurrent | Software detected overcurrent |",
      161
    );
    
    // Fault table is last in retrieval order
    const chunks = [lessRelevant1, lessRelevant2, faultTable];
    
    const question = "What causes overcurrent faults on a PowerFlex 525?";
    const context = buildGroundedContext(chunks, question);
    
    // Even though fault table was ranked last, it should be in context
    expect(context).toContain("F012");
    expect(context).toContain("F063");
    expect(context).toContain("overcurrent");
  });

  it("without fault-table pages in retrieval, cannot answer", () => {
    // Control test: if fault-table pages aren't retrieved at all,
    // smart truncation can't help
    
    const page1 = makeChunk("PowerFlex 525 manual...", 1);
    const page665 = makeChunk("Specifications...", 665);
    
    const question = "What causes overcurrent faults?";
    const context = buildGroundedContext([page1, page665], question);
    
    // F063 should NOT be in context (can't be, wasn't retrieved)
    expect(context).not.toContain("F063");
  });
});
