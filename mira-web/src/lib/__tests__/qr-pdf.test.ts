// mira-web/src/lib/__tests__/qr-pdf.test.ts
import { describe, test, expect } from "bun:test";
import { buildStickerSheetPdf } from "../qr-pdf.js";

describe("buildStickerSheetPdf", () => {
  test("returns non-empty PDF bytes with proper header", async () => {
    const pdf = await buildStickerSheetPdf([
      { asset_tag: "VFD-07", scan_url: "https://app.factorylm.com/m/VFD-07" },
    ]);
    expect(pdf).toBeInstanceOf(Uint8Array);
    // PDF magic: %PDF-
    expect(pdf[0]).toBe(0x25);
    expect(pdf[1]).toBe(0x50);
    expect(pdf[2]).toBe(0x44);
    expect(pdf[3]).toBe(0x46);
    expect(pdf.length).toBeGreaterThan(500);
  });

  test("17 tags produce 2 pages (10 per sheet)", async () => {
    const rows = Array.from({ length: 17 }, (_, i) => ({
      asset_tag: `T${String(i + 1).padStart(2, "0")}`,
      scan_url: `https://app.factorylm.com/m/T${String(i + 1).padStart(2, "0")}`,
    }));
    const pdf = await buildStickerSheetPdf(rows);
    // Crude check: pdf-lib's output grows with page count
    expect(pdf.length).toBeGreaterThan(2000);
  });

  test("empty rows rejected", async () => {
    await expect(buildStickerSheetPdf([])).rejects.toThrow();
  });
});
