// Vitest coverage for work-packet document loading (#4982, agent D).
//
// stitchChunks: pure — largest 20..400-char overlap removed, "\n" fallback.
// loadNotebookDocTexts: listSources -> (kept bytes via unpdf) | (knowledge_entries
// chunks, grouped by page, IDOR-guarded, stitched). All fixtures here are
// synthetic strings — the real CAT Pumps documents are never read by this suite.
//
// Run: cd mira-hub && npx vitest run "src/capabilities/work-packet/__tests__/document-text.test.ts"

import { describe, it, expect, vi, beforeEach } from "vitest";

const { unpdfExtract, getDocumentProxyMock, poolQuery, tenantQuery, listSourcesMock } = vi.hoisted(() => ({
  unpdfExtract: vi.fn(),
  getDocumentProxyMock: vi.fn(async () => ({})),
  poolQuery: vi.fn(),
  tenantQuery: vi.fn(),
  listSourcesMock: vi.fn(),
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: getDocumentProxyMock,
  extractText: unpdfExtract,
}));

vi.mock("@/lib/db", () => ({ default: { query: (...args: unknown[]) => poolQuery(...args) } }));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenantId: string, fn: (c: { query: (...a: unknown[]) => unknown }) => unknown) =>
    fn({ query: (...args: unknown[]) => tenantQuery(...args) }),
  ),
}));

vi.mock("@/lib/equipment-notebooks", () => ({
  listSources: (...args: unknown[]) => listSourcesMock(...args),
}));

import { stitchChunks, loadNotebookDocTexts } from "../document-text";

const TENANT_ID = "tenant-aaaa";
const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const FILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const DOC_ID = "99999999-8888-7777-6666-555555555555";

function source(over: Partial<Record<string, unknown>> = {}) {
  return {
    docId: DOC_ID,
    filename: "9XP1000_data_sheet.pdf",
    status: "parsed",
    enabledByDefault: true,
    matchState: "user_confirmed",
    sourceRole: null,
    pages: null,
    fileId: FILE_ID,
    originFileId: null,
    matchEvidence: null,
    readiness: {} as never,
    ...over,
  };
}

describe("stitchChunks", () => {
  it("removes the largest overlap in the 20..400 window and joins the remainder", () => {
    const prefix = "A".repeat(30); // chunk-1-only content
    const overlap = "b".repeat(120); // the real ~120-char stored overlap
    const suffix = "C".repeat(40); // chunk-2-only content
    const head = prefix + overlap;
    const tail = overlap + suffix;
    expect(stitchChunks([head, tail])).toBe(prefix + overlap + suffix);
  });

  it("prefers the LARGEST valid overlap over a shorter spurious match", () => {
    // "AAAA" (4 chars) recurs near the join, but the real, longer, intended
    // overlap is the 30-char tail/head below it — the result must use that one.
    const real = "0123456789abcdefghijklmnopqrst"; // 30 chars
    const a = `start of page one AAAA ${real}`;
    const b = `${real} rest of page one text AAAA more`;
    const stitched = stitchChunks([a, b]);
    expect(stitched).toBe(a + b.slice(real.length));
  });

  it("joins with a bare newline when no overlap of 20+ chars exists", () => {
    const a = "Page text that ends here with nothing shared.";
    const b = "Completely unrelated next chunk content, no overlap at all.";
    expect(stitchChunks([a, b])).toBe(`${a}\n${b}`);
  });

  it("does not treat a short coincidental repeat (<20 chars) as an overlap", () => {
    const a = "...ending on the word torque";
    const b = "torque values are listed below in the chart";
    // shared prefix/suffix "torque" is only 6 chars — below OVERLAP_MIN (20)
    expect(stitchChunks([a, b])).toBe(`${a}\n${b}`);
  });

  it("passes a single chunk through unchanged", () => {
    expect(stitchChunks(["only one chunk here"])).toBe("only one chunk here");
  });

  it("returns an empty string for an empty chunk list", () => {
    expect(stitchChunks([])).toBe("");
  });

  it("stitches three consecutive chunks in order", () => {
    const shared1 = "PAGE_ONE_BOUNDARY_TEXT_OF_TWENTY_FIVE_CHARS";
    const shared2 = "PAGE_TWO_BOUNDARY_TEXT_OF_TWENTY_FIVE_CHARS";
    const c1 = `first chunk content ${shared1}`;
    const c2 = `${shared1} middle chunk content ${shared2}`;
    const c3 = `${shared2} last chunk content`;
    expect(stitchChunks([c1, c2, c3])).toBe(
      c1 + c2.slice(shared1.length) + c3.slice(shared2.length),
    );
  });
});

describe("loadNotebookDocTexts", () => {
  beforeEach(() => {
    unpdfExtract.mockReset();
    getDocumentProxyMock.mockReset().mockImplementation(async () => ({}));
    poolQuery.mockReset();
    tenantQuery.mockReset();
    listSourcesMock.mockReset();
  });

  it("filters out disabled and rejected sources before loading anything", async () => {
    listSourcesMock.mockResolvedValue([
      source({ enabledByDefault: false }),
      source({ docId: "22222222-2222-2222-2222-222222222222", matchState: "rejected" }),
    ]);
    const docs = await loadNotebookDocTexts(TENANT_ID, NOTEBOOK_ID);
    expect(docs).toEqual([]);
    expect(tenantQuery).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("extracts a kept file's bytes page-by-page via unpdf (via:'file')", async () => {
    listSourcesMock.mockResolvedValue([source()]);
    tenantQuery.mockResolvedValue({ rows: [{ content: Buffer.from("pdf-bytes") }] });
    unpdfExtract.mockResolvedValue({ text: ["PAGE ONE TEXT", "PAGE TWO TEXT"] });

    const docs = await loadNotebookDocTexts(TENANT_ID, NOTEBOOK_ID);

    expect(docs).toEqual([
      {
        docId: DOC_ID,
        fileId: FILE_ID,
        filename: "9XP1000_data_sheet.pdf",
        pages: [
          { page: 1, text: "PAGE ONE TEXT" },
          { page: 2, text: "PAGE TWO TEXT" },
        ],
        via: "file",
      },
    ]);
    expect(getDocumentProxyMock).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled(); // no chunk fallback needed
  });

  it("falls back to knowledge_entries chunks when the file row is gone", async () => {
    listSourcesMock.mockResolvedValue([source()]);
    tenantQuery.mockResolvedValue({ rows: [] }); // no namespace_direct_uploads row
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("equipment_notebook_sources")) return { rows: [{ "1": 1 }] };
      if (sql.includes("knowledge_entries")) {
        return {
          rows: [
            { source_page: 1, content: "chunk A of page one ", chunk_index: 0 },
            { source_page: 1, content: "age one continued", chunk_index: 1 },
            { source_page: 2, content: "page two whole text", chunk_index: 0 },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const docs = await loadNotebookDocTexts(TENANT_ID, NOTEBOOK_ID);
    expect(docs).toHaveLength(1);
    expect(docs[0].via).toBe("chunks");
    expect(docs[0].pages).toEqual([
      // overlap "age one " is below the 20-char floor, so page 1 falls back to
      // the "\n" join (stitchChunks is unit-tested separately above).
      { page: 1, text: "chunk A of page one \nage one continued" },
      { page: 2, text: "page two whole text" },
    ]);
    expect(unpdfExtract).not.toHaveBeenCalled();
  });

  it("falls back to chunks when unpdf throws on the kept file", async () => {
    listSourcesMock.mockResolvedValue([source()]);
    tenantQuery.mockResolvedValue({ rows: [{ content: Buffer.from("not-a-real-pdf") }] });
    unpdfExtract.mockRejectedValue(new Error("bad PDF structure"));
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("equipment_notebook_sources")) return { rows: [{ "1": 1 }] };
      return { rows: [{ source_page: 1, content: "fallback text", chunk_index: 0 }] };
    });

    const docs = await loadNotebookDocTexts(TENANT_ID, NOTEBOOK_ID);
    expect(docs[0].via).toBe("chunks");
    expect(docs[0].pages).toEqual([{ page: 1, text: "fallback text" }]);
  });

  it("loads straight from chunks when the source has no fileId at all", async () => {
    listSourcesMock.mockResolvedValue([source({ fileId: null })]);
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("equipment_notebook_sources")) return { rows: [{ "1": 1 }] };
      return { rows: [{ source_page: 1, content: "chunk-only doc text", chunk_index: 0 }] };
    });

    const docs = await loadNotebookDocTexts(TENANT_ID, NOTEBOOK_ID);
    expect(docs[0]).toEqual({
      docId: DOC_ID,
      fileId: null,
      filename: "9XP1000_data_sheet.pdf",
      pages: [{ page: 1, text: "chunk-only doc text" }],
      via: "chunks",
    });
    expect(tenantQuery).not.toHaveBeenCalled();
  });

  it("IDOR guard: a doc_id not attached to this notebook/tenant yields no pages", async () => {
    listSourcesMock.mockResolvedValue([source({ fileId: null })]);
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("equipment_notebook_sources")) return { rows: [] }; // not attached
      throw new Error("knowledge_entries must not be queried without membership");
    });

    const docs = await loadNotebookDocTexts(TENANT_ID, NOTEBOOK_ID);
    expect(docs[0].pages).toEqual([]);
  });

  it("groups an unanchored chunk row (source_page NULL) under page 0 instead of dropping it", async () => {
    listSourcesMock.mockResolvedValue([source({ fileId: null })]);
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("equipment_notebook_sources")) return { rows: [{ "1": 1 }] };
      return { rows: [{ source_page: null, content: "unanchored text", chunk_index: 0 }] };
    });

    const docs = await loadNotebookDocTexts(TENANT_ID, NOTEBOOK_ID);
    expect(docs[0].pages).toEqual([{ page: 0, text: "unanchored text" }]);
  });
});
