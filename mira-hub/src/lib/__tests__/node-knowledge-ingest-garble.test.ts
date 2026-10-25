/**
 * TQ-05 / TQ-06 (2026-10-17 prod test) — a PDF whose text extracts as the
 * fixed +29 cipher (the PLC-5 manual) is decoded BEFORE chunking, so the
 * knowledge_entries rows hold searchable English and carry an audit marker;
 * an ordinary page is written byte-for-byte as before; a garbled page that is
 * NOT the fixed shift is written as-is and only reaches the OCR seam behind
 * NOTEBOOK_GARBLE_OCR_FALLBACK=1. The decoder is default ON; NOTEBOOK_GARBLE_DECODE=0
 * is the kill switch.
 *
 * Run: npx vitest run src/lib/__tests__/node-knowledge-ingest-garble.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeShift29 } from "@/capabilities/garbled-text";
import realPage from "@/capabilities/__tests__/fixtures/plc5-1785-rm001-p238.json";

/** PDF p.238 (printed 15-8) of Rockwell's public 1785-rm001, as unpdf extracts it. */
const REAL_PLC5_P238 = (realPage as { page: string }).page;

const PLC5_PAGE =
  "In addition, the PLC-5 processor stores the program in battery-backed RAM. " +
  "When the processor is in Program mode, the outputs are de-energized and the " +
  "program is not scanned. Install the battery before you connect power to the " +
  "chassis, and replace it when the BATT status indicator turns on. The fault " +
  "table lists the major fault code in word S:12 of the status file.";
const PLAIN_PAGE =
  "Fault ZX-451 — recalibrate the PT-7 pressure transducer. Set the span to the value on the nameplate and verify the output at 4 mA and 20 mA.";
const SOUP_PAGE = "QXZKV JQPLX ZVKQJ XPLQZ VKJQX ".repeat(12);

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
  const { writePdfChunksForNode } = await import("../node-knowledge-ingest");
  return writePdfChunksForNode({
    tenantId: "tenant-a",
    uploadId: "upload-1",
    nodeId: "node-1",
    unsPath: null,
    filename: "plc5.pdf",
    buffer: Buffer.from("%PDF-1.4 stub"),
  });
}

beforeEach(() => {
  captured.length = 0;
  vi.clearAllMocks();
  delete process.env.NOTEBOOK_GARBLE_OCR_FALLBACK;
  // Release 2 Lane B (2026-10-18): the decoder is default-ON at ingest, so
  // every suite runs with the flag UNSET — the state staging and prod are in.
  // The kill switch (=0) has its own test below.
  delete process.env.NOTEBOOK_GARBLE_DECODE;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.NOTEBOOK_GARBLE_OCR_FALLBACK;
  delete process.env.NOTEBOOK_GARBLE_DECODE;
});

describe("NOTEBOOK_GARBLE_DECODE is default ON, =0 is the kill switch", () => {
  // Staging and prod never set the flag (Release 2 Lane B, traces
  // ee1494fcc921d964c48b27c70eca5c06 / fce2e5796fff061f8781822942642d54), so a
  // default-off decoder shipped inert: the real PLC-5 manual was stored as cipher.
  it("with the flag unset, a shifted page is decoded and marked repaired", async () => {
    expect(process.env.NOTEBOOK_GARBLE_DECODE).toBeUndefined();
    await ingest([encodeShift29(PLC5_PAGE), PLAIN_PAGE]);
    const rows = insertedRows();
    expect(rows.some((r) => r.content.includes("battery-backed RAM"))).toBe(true);
    expect(rows.some((r) => r.content.includes("DGGLWLRQ"))).toBe(false);
    expect(rows.some((r) => r.meta.text_repair === "shift29")).toBe(true);
  });

  it("with the flag unset, the real PLC-5 page 15-8 is written as English carrying both TQ answers", async () => {
    expect(process.env.NOTEBOOK_GARBLE_DECODE).toBeUndefined();
    await ingest([REAL_PLC5_P238]);
    const rows = insertedRows();
    const text = rows.map((r) => r.content).join(" ");
    expect(text).toContain("creates a default 64-word file");
    expect(text).toMatch(/the processor sets the \.ER bit\s+bit 12/);
    expect(rows.every((r) => r.meta.text_repair === "shift29")).toBe(true);
  });

  it("with the flag unset, a plain page is written byte-for-byte with no marker", async () => {
    expect(process.env.NOTEBOOK_GARBLE_DECODE).toBeUndefined();
    await ingest([PLAIN_PAGE]);
    const rows = insertedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe(PLAIN_PAGE);
    expect(rows[0].meta.text_repair).toBeUndefined();
  });

  it("NOTEBOOK_GARBLE_DECODE=0 writes a shifted page exactly as extracted and marks nothing", async () => {
    process.env.NOTEBOOK_GARBLE_DECODE = "0";
    await ingest([encodeShift29(PLC5_PAGE), PLAIN_PAGE]);
    const rows = insertedRows();
    // "addition" encodes to DGGLWLRQ; the cipher must survive verbatim.
    expect(rows.some((r) => r.content.includes("DGGLWLRQ"))).toBe(true);
    expect(rows.some((r) => r.content.includes("battery-backed RAM"))).toBe(false);
    expect(rows.every((r) => r.meta.text_repair === undefined)).toBe(true);
    expect(ocrSeam.ocrExtractPage).not.toHaveBeenCalled();
  });
});

describe("garbled extraction is decoded before chunking", () => {
  it("a +29-shifted page is written as English with a text_repair marker; the plain page beside it is untouched", async () => {
    await ingest([encodeShift29(PLC5_PAGE), PLAIN_PAGE]);
    const rows = insertedRows();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const page1 = rows.filter((r) => r.meta.chunk_index !== undefined && r.content.includes("PLC-5"));
    expect(page1.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.content.includes(",QDGGLWLRQ"))).toBe(false);
    expect(page1.every((r) => r.meta.text_repair === "shift29")).toBe(true);
    const plain = rows.find((r) => r.content.includes("ZX-451"));
    expect(plain).toBeDefined();
    expect(plain!.content).toBe(PLAIN_PAGE);
    expect(plain!.meta.text_repair).toBeUndefined();
  });

  it("the prod-test token is searchable after repair (TQ-05/06 shape)", async () => {
    await ingest([encodeShift29(PLC5_PAGE)]);
    const text = insertedRows().map((r) => r.content).join(" ");
    expect(text).toMatch(/battery-backed RAM/);
    expect(text).toMatch(/major fault code/);
  });

  it("a garbled page that is NOT the fixed shift is written as-is and the OCR seam is not called with the flag off", async () => {
    await ingest([SOUP_PAGE]);
    expect(insertedRows().some((r) => r.content.startsWith("QXZKV"))).toBe(true);
    expect(ocrSeam.ocrExtractPage).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/garbled.*unrepaired/i));
  });

  it("behind NOTEBOOK_GARBLE_OCR_FALLBACK=1 the OCR seam is asked, and its text replaces the page when it returns one", async () => {
    process.env.NOTEBOOK_GARBLE_OCR_FALLBACK = "1";
    ocrSeam.ocrExtractPage.mockResolvedValueOnce(PLAIN_PAGE);
    await ingest([SOUP_PAGE]);
    expect(ocrSeam.ocrExtractPage).toHaveBeenCalledTimes(1);
    const rows = insertedRows();
    expect(rows.some((r) => r.content.includes("ZX-451"))).toBe(true);
    expect(rows.some((r) => r.content.startsWith("QXZKV"))).toBe(false);
    expect(rows.find((r) => r.content.includes("ZX-451"))!.meta.text_repair).toBe("ocr");
  });

  it("behind the flag, a null from the OCR seam keeps the page as-is (never drops a page)", async () => {
    process.env.NOTEBOOK_GARBLE_OCR_FALLBACK = "1";
    ocrSeam.ocrExtractPage.mockResolvedValueOnce(null);
    await ingest([SOUP_PAGE]);
    expect(ocrSeam.ocrExtractPage).toHaveBeenCalledTimes(1);
    expect(insertedRows().some((r) => r.content.startsWith("QXZKV"))).toBe(true);
  });
});
