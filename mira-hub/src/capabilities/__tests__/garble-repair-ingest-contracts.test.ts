/**
 * Codex r2 on #4486 — the ingest-side contracts of the garble repair:
 *
 * F2  The embed write is FENCED on the content the vector was computed from.
 *     Reproduced interleaving: the sweep SELECTs a cipher row and starts its
 *     HTTP call; the backfill rewrites `content` and clears `embedding`; the
 *     worker's UPDATE then stored a vector of the OLD text, and every later
 *     sweep skipped the row as embedded. The UPDATE now carries
 *     `md5(content) = <md5 of the embedded text>` so Postgres rejects it.
 *
 * F3  A page the decoder only PARTLY repairs is stamped `shift29_partial`, is
 *     still counted unrepaired, and still reaches the OCR seam — the old
 *     `continue` discarded the unresolved signal once any block decoded.
 *
 * Lives under capabilities/__tests__ (ungated); the lifecycle guard protects
 * src/lib/__tests__. Run: npx vitest run src/capabilities/__tests__/garble-repair-ingest-contracts.test.ts
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeShift29 } from "@/capabilities/garbled-text";

const PLC5_PAGE =
  "In addition, the PLC-5 processor stores the program in battery-backed RAM. " +
  "When the processor is in Program mode, the outputs are de-energized and the " +
  "program is not scanned. Install the battery before you connect power to the " +
  "chassis, and replace it when the BATT status indicator turns on. The fault " +
  "table lists the major fault code in word S:12 of the status file.";
/** Cipher no evidence reaches: decoded C0 bytes are still C0 bytes. */
const UNREACHABLE = "\u0001\u0002 QQQQ WWWW";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const captured: { sql: string; params: unknown[] }[] = [];
let selectQueue: Array<Array<{ id: string; content: string }>> = [];
const extracted = vi.hoisted(() => ({ pages: [] as string[] }));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ text: extracted.pages })),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (
      _tenantId: string,
      fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>,
    ) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          if (/^\s*SELECT/i.test(sql)) return { rows: selectQueue.shift() ?? [] };
          return { rows: [] };
        },
      }),
  ),
}));

const ocrSeam = vi.hoisted(() => ({ ocrExtractPage: vi.fn(async (): Promise<string | null> => null) }));
vi.mock("@/capabilities/garbled-text-ocr", () => ocrSeam);

function insertedRows(): Array<{ content: string; meta: Record<string, unknown> }> {
  const insert = captured.find((c) => c.sql.includes("INSERT INTO knowledge_entries"));
  if (!insert) return [];
  const rows: Array<{ content: string; meta: Record<string, unknown> }> = [];
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
    filename: "plc5.pdf",
    buffer: Buffer.from("%PDF-1.4 stub"),
  });
}

beforeEach(() => {
  captured.length = 0;
  selectQueue = [];
  fetchMock.mockReset();
  vi.clearAllMocks();
  vi.resetModules();
  process.env.NOTEBOOK_GARBLE_DECODE = "1";
  process.env.OLLAMA_BASE_URL = "http://embedder.test";
  delete process.env.NOTEBOOK_GARBLE_OCR_FALLBACK;
  delete process.env.NODE_EMBED_ON_WRITE;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.NOTEBOOK_GARBLE_DECODE;
  delete process.env.NOTEBOOK_GARBLE_OCR_FALLBACK;
  delete process.env.OLLAMA_BASE_URL;
});

describe("F2 — the embed write is fenced on the content it embedded", () => {
  it("the UPDATE carries md5(content) of the text the vector was computed from", async () => {
    selectQueue = [[{ id: "c1", content: "CIPHER ORIGINAL" }], []];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embedding: Array(768).fill(0.01) }) });
    const { embedPendingNodeChunks } = await import("@/lib/node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");
    expect(n.state).toBe("complete");
    const update = captured.find((c) => /UPDATE knowledge_entries SET embedding/.test(c.sql));
    expect(update).toBeDefined();
    expect(update!.sql).toMatch(/embedding IS NULL AND md5\(content\) = \$3/);
    expect(update!.params[2]).toBe(createHash("md5").update("CIPHER ORIGINAL").digest("hex"));
    // Precondition the fence rests on: the fenced value is NOT the md5 of some
    // other text, so a repair that rewrites `content` makes the predicate false.
    expect(update!.params[2]).not.toBe(createHash("md5").update("Repaired English").digest("hex"));
  });
});

describe("F3 — a partly repaired page is marked partial, counted unrepaired, and still offered to OCR", () => {
  it("stamps shift29_partial (not shift29) on a page where cipher remains after decoding", async () => {
    await ingest([`${encodeShift29(PLC5_PAGE)}\n${UNREACHABLE}`]);
    const rows = insertedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.content.includes("battery-backed RAM"))).toBe(true); // decoded text kept
    expect(rows.every((r) => r.meta.text_repair === "shift29_partial")).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/unrepaired on 1\/1 pages/));
  });

  it("control: a fully decoded page is still stamped shift29", async () => {
    await ingest([encodeShift29(PLC5_PAGE)]);
    const rows = insertedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.meta.text_repair === "shift29")).toBe(true);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringMatching(/unrepaired/));
  });

  it("behind NOTEBOOK_GARBLE_OCR_FALLBACK=1 the partly repaired page reaches the OCR seam with the ORIGINAL extraction, and OCR text wins", async () => {
    process.env.NOTEBOOK_GARBLE_OCR_FALLBACK = "1";
    const cipherPage = `${encodeShift29(PLC5_PAGE)}\n${UNREACHABLE}`;
    ocrSeam.ocrExtractPage.mockResolvedValueOnce("OCR text of the whole page.");
    await ingest([cipherPage]);
    expect(ocrSeam.ocrExtractPage).toHaveBeenCalledTimes(1);
    expect(ocrSeam.ocrExtractPage).toHaveBeenCalledWith(expect.objectContaining({ page: 1, extracted: cipherPage }));
    const rows = insertedRows();
    expect(rows.some((r) => r.content.includes("OCR text of the whole page."))).toBe(true);
    expect(rows.find((r) => r.content.includes("OCR text"))!.meta.text_repair).toBe("ocr");
  });

  it("control: OCR is NOT asked for a fully decoded page even with the flag on", async () => {
    process.env.NOTEBOOK_GARBLE_OCR_FALLBACK = "1";
    await ingest([encodeShift29(PLC5_PAGE)]);
    expect(ocrSeam.ocrExtractPage).not.toHaveBeenCalled();
  });
});
