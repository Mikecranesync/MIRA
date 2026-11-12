/**
 * Garage pilot L2 (plan row 5-A) — a page whose numbers carry a replacement
 * character between two digits ("5�1" for 5.1 A: the PDF's ToUnicode map
 * has no entry for the decimal-point glyph; the auto-acquired GS10 chapter
 * file) is FLAGGED at upload, never repaired: `metadata.text_repair =
 * "unmapped_glyph"` on every chunk of that page, the text stored exactly as
 * extracted, no decode, no OCR, and independent of NOTEBOOK_GARBLE_DECODE.
 * A replacement character used as a table-of-contents leader dot (spaces
 * around it, no digit on both sides) is not a number and is not flagged.
 *
 * Harness mirrors src/lib/__tests__/node-knowledge-ingest-garble.test.ts
 * (that file is a guarded legacy path; new tests live here).
 *
 * Run: npx vitest run src/capabilities/__tests__/node-knowledge-ingest-unmapped-glyph.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAIN_PAGE =
  "Fault ZX-451 — recalibrate the PT-7 pressure transducer. Set the span to the value on the nameplate and verify the output at 4 mA and 20 mA.";
// ch1.pdf (the auto-acquired GS10 chapter file) page 12 as unpdf extracts it:
// ToUnicode code 0011 (the decimal point) maps to nothing, so 5.1 A is "5�1".
const GLYPH_PAGE =
  "GS10 230V Class Specifications; Frame Size A, B, C1\nModel Name: GS11N-20P2 GS11N-20P5\n" +
  "kW 0�2 0�4\nInput Rating2 CT Rated Input Current A 5�1 7�3";
// ch1.pdf page 1: the same character used as a table-of-contents leader dot.
const LEADER_DOTS =
  "Table of Contents\nChapter 1: Getting Started\nUser Manual Overview � � � � � 1–2\nTechnical Support � � � 1–3";

const captured: { sql: string; params: unknown[] }[] = [];
const extracted = vi.hoisted(() => ({ pages: [] as string[] }));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ text: extracted.pages })),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (_tenantId: string, fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: [] }> }) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          return { rows: [] as [] };
        },
      }),
  ),
}));

const ocrSeam = vi.hoisted(() => ({ ocrExtractPage: vi.fn(async (): Promise<string | null> => null) }));
vi.mock("@/capabilities/garbled-text-ocr", () => ocrSeam);

/** Every (content, metadata) pair the INSERT carried, in order. */
function insertedRows(): Array<{ content: string; meta: Record<string, unknown> }> {
  const insert = captured.find((c) => c.sql.includes("INSERT INTO knowledge_entries"));
  if (!insert) return [];
  const rows: Array<{ content: string; meta: Record<string, unknown> }> = [];
  // params: [tenant, sourceUrl, uploadId, (id, content, page, metadata)*]
  for (let i = 3; i + 3 < insert.params.length; i += 4) {
    rows.push({ content: String(insert.params[i + 1]), meta: JSON.parse(String(insert.params[i + 3])) });
  }
  return rows;
}

async function ingest(pages: string[]) {
  extracted.pages = pages;
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  return writePdfChunksForNode({
    tenantId: "tenant-a",
    uploadId: "upload-1",
    nodeId: "node-1",
    unsPath: null,
    filename: "ch1.pdf",
    buffer: Buffer.from("%PDF-1.4 stub"),
  });
}

beforeEach(() => {
  captured.length = 0;
  vi.clearAllMocks();
  delete process.env.NOTEBOOK_GARBLE_OCR_FALLBACK;
  delete process.env.NOTEBOOK_GARBLE_DECODE;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.NOTEBOOK_GARBLE_OCR_FALLBACK;
  delete process.env.NOTEBOOK_GARBLE_DECODE;
});

describe("garage pilot L2 — a replacement character between two digits is flagged, never repaired", () => {
  it("stamps text_repair: unmapped_glyph on every chunk of the page and stores the text exactly as extracted", async () => {
    await ingest([GLYPH_PAGE, PLAIN_PAGE]);
    const rows = insertedRows();
    const glyphRows = rows.filter((r) => r.content.includes("�"));
    expect(glyphRows.length).toBeGreaterThan(0);
    expect(glyphRows.some((r) => r.content.includes("5�1"))).toBe(true);
    for (const r of glyphRows) expect(r.meta.text_repair).toBe("unmapped_glyph");
    const plainRows = rows.filter((r) => r.content.includes("ZX-451"));
    expect(plainRows.length).toBeGreaterThan(0);
    for (const r of plainRows) expect(r.meta.text_repair).toBeUndefined();
    expect(ocrSeam.ocrExtractPage).not.toHaveBeenCalled();
  });

  it("control: a replacement character used as a leader dot (no digit on both sides) is not flagged", async () => {
    await ingest([LEADER_DOTS]);
    const rows = insertedRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.meta.text_repair).toBeUndefined();
  });

  it("is detection, not repair: the flag is set even with the shift-29 decoder switched off", async () => {
    process.env.NOTEBOOK_GARBLE_DECODE = "0";
    await ingest([GLYPH_PAGE]);
    const rows = insertedRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.meta.text_repair).toBe("unmapped_glyph");
  });
});
