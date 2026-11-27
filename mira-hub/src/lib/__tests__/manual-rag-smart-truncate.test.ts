/**
 * Smart truncation tests for table-aware content limits (#5677, #5710, #5998)
 */
import { describe, expect, it } from "vitest";
import { buildGroundedContext } from "../manual-rag";
import { makeChunk } from "./test-fixtures";

describe("smartTruncate — table-aware content limits", () => {
  it("preserves complete table rows in fault tables", () => {
    // F9 FIX: Generate F001-F100 to include F081
    const rows = Array.from({ length: 100 }, (_, i) => 
      `| F${String(i + 1).padStart(3, "0")} | Fault ${i + 1} | Type ${i % 2 + 1} | Description ${i + 1} |`
    );
    const tableContent = "# Fault Table\n\n| Code | Name | Type | Description |\n|------|------|------|-------------|\n" + rows.join("\n");
    const chunk = makeChunk(tableContent, 162);
    
    const context = buildGroundedContext([chunk], "What does F081 mean?");
    
    // F081 at row 81 should be preserved even though table is ~4000 chars
    expect(context).toContain("F081");
    expect(context).toContain("Fault 81");
  });

  it("preserves matching row even when far past the limit", () => {
    // F081 at row 81 — with ~40 chars/row, that's row 81 * 40 = ~3240 chars
    // Well beyond the 2400 char limit, but should be kept because it matches the question
    const rows = Array.from({ length: 100 }, (_, i) => 
      `| F${String(i + 1).padStart(3, "0")} | Fault ${i + 1} | Type ${i % 2 + 1} | Auto ${i % 3 === 0 ? "Yes" : "No"} |`
    );
    const tableContent = "# Fault Codes\n\n| Code | Name | Type | Auto-Reset |\n|------|------|------|------------|\n" + rows.join("\n");
    const chunk = makeChunk(tableContent, 1);
    
    const context = buildGroundedContext([chunk], "PowerFlex 525 showing F081, does it auto-reset?");
    
    // F081 must be present even though it's at row 81 (~3240 chars from start)
    expect(context).toContain("F081");
    expect(context).toContain("Fault 81");
    // Should have header
    expect(context).toContain("Code | Name | Type");
    // Should have some context rows near F081
    expect(context).toContain("F080"); // row before
    expect(context).toContain("F082"); // row after
  });

  it("preserves LED status table rows with color indicators", () => {
    const ledTable = `# Status LEDs

| LED | State | Meaning |
|-----|-------|---------|
| STOP/RUN | Off | CPU has no power |
| STOP/RUN | Green | CPU in RUN mode |
| STOP/RUN | Yellow solid | CPU in STOP mode |
| STOP/RUN | Yellow flashing | Startup mode |
| ERROR | Off | No error |
| ERROR | Red solid | Hardware fault |
| ERROR | Red flashing | Software error |`;

    const chunk = makeChunk(ledTable, 1);
    const context = buildGroundedContext([chunk], "the plc has a yellow light on");
    
    // Yellow solid row must be preserved
    expect(context).toContain("Yellow solid");
    expect(context).toContain("STOP mode");
  });

  it("preserves parameter table rows", () => {
    // Simulate a GS10 parameter table with P06.53 somewhere in the middle
    const params = Array.from({ length: 100 }, (_, i) => 
      `| P06.${String(i).padStart(2, "0")} | Parameter ${i} | Range: 0-100 | Default: ${i % 10} |`
    );
    const paramTable = "# Parameter Group 06\n\n" + params.join("\n");
    const chunk = makeChunk(paramTable, 1);
    
    const context = buildGroundedContext([chunk], "What is parameter P06.53?");
    
    // P06.53 should be preserved
    expect(context).toContain("P06.53");
    expect(context).toContain("Parameter 53");
  });

  it("uses higher limit for table-heavy content", () => {
    // Create content with 50% table rows (above 30% threshold)
    const tableRows = Array.from({ length: 30 }, (_, i) => 
      `| Row ${i} | Data ${i} | Value ${i} |`
    );
    const textLines = Array.from({ length: 30 }, (_, i) => 
      `Plain text line ${i}.`
    );
    const mixed = [...tableRows, ...textLines].join("\n");
    const chunk = makeChunk(mixed, 1);
    
    const context = buildGroundedContext([chunk], "What is in Row 15?");
    
    // With higher limit (2400), more content should be preserved
    // Count how many rows are in the output
    const outputRows = context.split("\n").filter(l => l.includes("| Row"));
    expect(outputRows.length).toBeGreaterThan(15); // Should preserve many rows
  });

  it("falls back to simple truncation for non-table content", () => {
    const longText = "A".repeat(1500); // Exceeds 1200 char limit
    const chunk = makeChunk(longText, 1);
    
    const context = buildGroundedContext([chunk]);
    
    // Should be truncated with ellipsis
    expect(context).toContain("…");
    expect(context.length).toBeLessThan(1500);
  });

  it("does not truncate short content", () => {
    const shortText = "Short answer about terminal 07.";
    const chunk = makeChunk(shortText, 1);
    
    const context = buildGroundedContext([chunk]);
    
    expect(context).toContain(shortText);
    expect(context).not.toContain("…");
  });
});
