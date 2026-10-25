/**
 * The REAL TQ-05 / TQ-06 page, not a reconstruction (Release 2 Lane B,
 * 2026-10-18). The fixture is PDF page 238 (printed 15-8, "Values in the Block
 * Transfer Control Block") of Rockwell's public 1785-rm001 PLC-5 Instruction
 * Set Reference, extracted with unpdf exactly as `writePdfChunksForNode` does.
 * The same page was uploaded to staging and stored as cipher, because the
 * decoder was off (traces ee1494fc…, fce2e579…).
 *
 * Run: npx vitest run src/capabilities/__tests__/garbled-text-plc5-real-page.test.ts
 */
import { describe, expect, it } from "vitest";
import { repairExtractedPage } from "../garbled-text";
import fixture from "./fixtures/plc5-1785-rm001-p238.json";

const PAGE = (fixture as { page: string }).page;

describe("real PLC-5 page 15-8 (1785-rm001 p.238)", () => {
  it("is the cipher as extracted (precondition)", () => {
    expect(PAGE).toContain("7KLV\u0003LV\u0003WKH");
    expect(PAGE).not.toContain("the processor sets the .ER bit");
  });

  it("decodes fully, keeping the English heading lines byte-identical", () => {
    const v = repairExtractedPage(PAGE);
    expect(v.repair).toBe("shift29");
    expect(v.unrepaired).toBe(false);
    expect(v.text).toContain("15-8 Block-Transfer Instructions BTR and BTW ControlNet I/O Transfer Instruction CIO");
    expect(v.text).toContain("Requested Word Count (.RLEN)");
  });

  it("carries the TQ-05 answer (RLEN 0 = module decides, default 64-word file)", () => {
    const { text } = repairExtractedPage(PAGE);
    expect(text).toContain("If you specify a 0 when you enter the block transfer instruction");
    expect(text).toContain("creates a default 64-word file");
  });

  it("carries the TQ-06 answer (DLEN ≠ RLEN sets the .ER bit, bit 12)", () => {
    const { text } = repairExtractedPage(PAGE);
    expect(text).toContain("If these numbers do");
    expect(text).toMatch(/the processor sets the \.ER bit\s+bit 12/);
  });
});
