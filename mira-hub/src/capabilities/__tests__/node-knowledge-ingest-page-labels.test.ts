/**
 * #4508 — a PDF upload records each page's OWN printed label (the PDF
 * /PageLabels tree, as pdfjs `getPageLabels()` returns it) on every chunk of
 * that page as `metadata.page_label`. The manual's Safety chapter reader maps
 * "Safety ... page 17" through this stored label instead of guessing an
 * offset from page headers. A PDF without labels, or with a label list that
 * does not line up with the extracted pages, writes no `page_label` at all —
 * never a guess.
 *
 * Run: npx vitest run src/capabilities/__tests__/node-knowledge-ingest-page-labels.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: { sql: string; params: unknown[] }[] = [];
const pdf = vi.hoisted(() => ({
  pages: [] as string[],
  labels: null as unknown,
  labelsThrow: false,
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    getPageLabels: async () => {
      if (pdf.labelsThrow) throw new Error("bad /PageLabels tree");
      return pdf.labels;
    },
  })),
  extractText: vi.fn(async () => ({ text: pdf.pages })),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (_t: string, fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: [] }> }) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          return { rows: [] as [] };
        },
      }),
  ),
}));

/** (page, metadata) for every row the INSERTs carried, in order. */
function insertedRows(): Array<{ page: number; meta: Record<string, unknown> }> {
  const rows: Array<{ page: number; meta: Record<string, unknown> }> = [];
  for (const ins of captured.filter((c) => c.sql.includes("INSERT INTO knowledge_entries"))) {
    // params: [tenant, sourceUrl, uploadId, (id, content, page, metadata)*]
    for (let i = 3; i + 3 < ins.params.length; i += 4) {
      rows.push({ page: Number(ins.params[i + 2]), meta: JSON.parse(String(ins.params[i + 3])) });
    }
  }
  return rows;
}

const PAGE = (n: number) => `Page ${n} body text about the drive terminals and parameters.`;

async function ingest(pages: string[], labels: unknown) {
  pdf.pages = pages;
  pdf.labels = labels;
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  return writePdfChunksForNode({
    tenantId: "tenant-a",
    uploadId: "upload-1",
    nodeId: "node-1",
    unsPath: null,
    filename: "manual.pdf",
    buffer: Buffer.from("%PDF-1.4 stub"),
  });
}

beforeEach(() => {
  captured.length = 0;
  pdf.labelsThrow = false;
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("writePdfChunksForNode stores the PDF's own page labels", () => {
  it("writes each page's printed label on that page's chunks", async () => {
    await ingest([PAGE(1), PAGE(2), PAGE(3)], ["i", "ii", "1"]);
    const rows = insertedRows();
    expect(rows.map((r) => [r.page, r.meta.page_label])).toEqual([
      [1, "i"],
      [2, "ii"],
      [3, "1"],
    ]);
  });

  it("keeps the PDF page index in page/source_page, so links still open the right PDF page", async () => {
    await ingest([PAGE(1), PAGE(2)], ["17", "18"]);
    expect(insertedRows().map((r) => r.page)).toEqual([1, 2]);
  });

  it("trims labels and omits a blank one rather than storing an empty string", async () => {
    await ingest([PAGE(1), PAGE(2)], ["  5 ", "   "]);
    const rows = insertedRows();
    expect(rows[0].meta.page_label).toBe("5");
    expect(rows[1].meta).not.toHaveProperty("page_label");
  });

  it("writes no page_label when the PDF has no label tree", async () => {
    await ingest([PAGE(1), PAGE(2)], null);
    const rows = insertedRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !("page_label" in r.meta))).toBe(true);
  });

  it("writes no page_label when the label count does not match the extracted pages", async () => {
    await ingest([PAGE(1), PAGE(2), PAGE(3)], ["1", "2"]);
    const rows = insertedRows();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !("page_label" in r.meta))).toBe(true);
  });

  it("still ingests the PDF when reading the label tree throws", async () => {
    pdf.labelsThrow = true;
    const n = await ingest([PAGE(1)], ["1"]);
    expect(n).toBe(1);
    expect(insertedRows()[0].meta).not.toHaveProperty("page_label");
  });

  it("ignores a non-string label entry instead of coercing it", async () => {
    await ingest([PAGE(1), PAGE(2)], ["1", 2]);
    const rows = insertedRows();
    expect(rows[0].meta.page_label).toBe("1");
    expect(rows[1].meta).not.toHaveProperty("page_label");
  });
});

describe("writeTextChunksForNode never writes a page_label", () => {
  it("a text upload has no page labels", async () => {
    const { writeTextChunksForNode } = await import("@/lib/node-knowledge-ingest");
    await writeTextChunksForNode({
      tenantId: "tenant-a",
      uploadId: "upload-2",
      nodeId: "node-1",
      unsPath: null,
      filename: "notes.txt",
      buffer: Buffer.from("plain text notes about the conveyor"),
    });
    const rows = insertedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).not.toHaveProperty("page_label");
  });
});
