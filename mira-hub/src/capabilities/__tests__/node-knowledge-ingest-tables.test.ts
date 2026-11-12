import { beforeEach, describe, expect, it, vi } from "vitest";
import gs10p26 from "@/capabilities/__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import { chunkText } from "@/lib/node-knowledge-ingest";

/**
 * Table rows at upload — the ingest side (garage pilot plan row 1-A; ledger L3/L5).
 *
 * `writePdfChunksForNode` reads each page's positioned text items through the PDF's own
 * `getPage(n).getTextContent()` (the same call the work packet's caption reader makes), hands them
 * to `pageWithTables`, and writes:
 *   - for a page with a qualified model-column table: the page remainder chunked as today, plus ONE
 *     chunk per model column (`metadata.table_models = [<exact key>]`) and one chunk of unqualified
 *     lines (`metadata.table_models = [all keys]`, `metadata.table_unqualified = true`);
 *   - for every other page: exactly the chunks it writes today;
 *   - on EVERY chunk (PDF or text): `metadata.extraction_version = EXTRACTION_VERSION`, so a stored
 *     document can be told apart from one written by the old flat extraction (reprocessing, plan row 16).
 * The layout read is per page, inside the existing page loop, so peak memory stays one page. A PDF
 * proxy without `getPage` (the older tests' `{}`), a page whose layout read throws, or a page the
 * garble repair touched is stored flat, as today — never a half-read table.
 */

const captured: { sql: string; params: unknown[] }[] = [];
const pdf = vi.hoisted(() => ({
  pages: [] as string[],
  layout: new Map<number, Array<{ str: string; x: number; y: number; w: number; size: number }>>(),
  getPageThrows: false,
  withoutGetPage: false,
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => {
    if (pdf.withoutGetPage) return {};
    return {
      numPages: pdf.pages.length,
      getPage: vi.fn(async (n: number) => {
        if (pdf.getPageThrows) throw new Error("layout read failed");
        const items = (pdf.layout.get(n) ?? []).map((i) => ({
          str: i.str,
          transform: [i.size, 0, 0, i.size, i.x, i.y],
          width: i.w,
        }));
        return { getTextContent: vi.fn(async () => ({ items })), cleanup: () => true };
      }),
    };
  }),
  extractText: vi.fn(async () => ({ text: pdf.pages })),
}));

vi.mock("@/capabilities/pdf-page-label-reader", () => ({
  readPageLabelsBounded: vi.fn(async () => null),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (
      _tenantId: string,
      fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: never[] }> }) => Promise<unknown>,
    ) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          return { rows: [] as never[] };
        },
      }),
  ),
}));

type Row = { content: string; page: number; metadata: Record<string, unknown> };

/** Every knowledge_entries row the writer inserted: params are [tenant, source_url, upload_id, (id, content, page, metadata)*]. */
function insertedRows(): Row[] {
  const rows: Row[] = [];
  for (const { sql, params } of captured) {
    if (!/INSERT INTO knowledge_entries/.test(sql)) continue;
    for (let i = 3; i + 3 < params.length; i += 4) {
      rows.push({ content: params[i + 1] as string, page: params[i + 2] as number, metadata: JSON.parse(params[i + 3] as string) });
    }
  }
  return rows;
}

const PROSE = "Chapter 2: Installation and Wiring\n\nDisconnect power before servicing. Wait 5 minutes for the capacitors to discharge. Follow lockout/tagout procedures before opening the cover.";

const opts = { tenantId: "11111111-1111-4111-8111-111111111111", uploadId: "up-1", nodeId: "node-1", unsPath: null, filename: "gs10usermanual.pdf", buffer: Buffer.from("%PDF-1.4 stub") };

describe("writePdfChunksForNode stores a model-column table as one chunk per model", () => {
  beforeEach(() => {
    captured.length = 0;
    pdf.pages = [PROSE, gs10p26.text];
    pdf.layout = new Map([[2, gs10p26.items]]);
    pdf.getPageThrows = false;
    pdf.withoutGetPage = false;
    vi.resetModules();
  });

  it("writes a GS11N-20P2 chunk holding only its own column, tagged with its exact key", async () => {
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    await writePdfChunksForNode(opts);
    const rows = insertedRows();
    const own = rows.filter((r) => Array.isArray(r.metadata.table_models) && (r.metadata.table_models as string[]).join() === "GS11N20P2");
    expect(own).toHaveLength(1);
    expect(own[0].page).toBe(2);
    expect(own[0].content).toContain("GS11N-20P2: CT Rated Input Current 5.1 A");
    expect(own[0].content).toContain("GS11N-20P2: VT Rated Input Current 5.8 A");
    expect(own[0].content).not.toContain("7.3");
    expect(own[0].content).not.toContain("GS11N-20P5");
    expect(own[0].metadata.table_unqualified).toBeUndefined();
    // Five model chunks for the five header models.
    const tagged = rows.filter((r) => Array.isArray(r.metadata.table_models) && !r.metadata.table_unqualified);
    expect(tagged.map((r) => (r.metadata.table_models as string[])[0]).sort()).toEqual(["GS11N20P2", "GS11N20P5", "GS11N21P0", "GS11N22P0", "GS11N23P0"]);
  });

  it("keeps the unqualified lines as flat text tagged with every model of the table", async () => {
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    await writePdfChunksForNode(opts);
    const flat = insertedRows().filter((r) => r.metadata.table_unqualified === true);
    expect(flat).toHaveLength(1);
    expect(flat[0].content).toMatch(/Cooling Method/);
    expect(flat[0].metadata.table_models).toEqual(["GS11N20P2", "GS11N20P5", "GS11N21P0", "GS11N22P0", "GS11N23P0"]);
  });

  it("stores the table page's prose remainder without the flat table lines, and the prose page exactly as today", async () => {
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    await writePdfChunksForNode(opts);
    const rows = insertedRows();
    const page1 = rows.filter((r) => r.page === 1).map((r) => r.content);
    expect(page1).toEqual(chunkText(PROSE));
    for (const r of rows.filter((r) => r.page === 1)) expect(r.metadata.table_models).toBeUndefined();
    const remainder = rows.filter((r) => r.page === 2 && !r.metadata.table_models);
    expect(remainder.length).toBeGreaterThan(0);
    expect(remainder.map((r) => r.content).join("\n")).toMatch(/For use with three-phase motors only/);
    expect(remainder.map((r) => r.content).join("\n")).not.toMatch(/5\.1\s+7\.3\s+10\.8/);
  });

  it("stamps extraction_version on every chunk, and the version is at least 2", async () => {
    const mod = await import("@/lib/node-knowledge-ingest");
    expect(mod.EXTRACTION_VERSION).toBeGreaterThanOrEqual(2);
    await mod.writePdfChunksForNode(opts);
    const rows = insertedRows();
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(r.metadata.extraction_version).toBe(mod.EXTRACTION_VERSION);
    captured.length = 0;
    await mod.writeTextChunksForNode({ ...opts, filename: "notes.txt", buffer: Buffer.from(PROSE) });
    for (const r of insertedRows()) expect(r.metadata.extraction_version).toBe(mod.EXTRACTION_VERSION);
  });

  it("falls back to today's flat chunks when the PDF proxy has no getPage, or the layout read throws", async () => {
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    pdf.withoutGetPage = true;
    await writePdfChunksForNode(opts);
    let rows = insertedRows();
    expect(rows.filter((r) => r.page === 2).map((r) => r.content)).toEqual(chunkText(gs10p26.text));
    expect(rows.some((r) => r.metadata.table_models)).toBe(false);

    captured.length = 0;
    pdf.withoutGetPage = false;
    pdf.getPageThrows = true;
    await writePdfChunksForNode(opts);
    rows = insertedRows();
    expect(rows.filter((r) => r.page === 2).map((r) => r.content)).toEqual(chunkText(gs10p26.text));
    expect(rows.some((r) => r.metadata.table_models)).toBe(false);
  });
});

describe("garage pilot L2 — a page whose numbers carry an unmapped glyph still gets its table read, and every row is flagged", () => {
  beforeEach(() => {
    captured.length = 0;
    // ch1.pdf's p.12 shape: the same table, every decimal point extracted as U+FFFD
    // ("5�1" for 5.1 A) in both the page text and the positioned items.
    const glyph = (s: string) => s.replace(/(\d)\.(\d)/g, "$1�$2");
    pdf.pages = [PROSE, glyph(gs10p26.text)];
    pdf.layout = new Map([[2, gs10p26.items.map((i) => ({ ...i, str: glyph(i.str) }))]]);
    pdf.getPageThrows = false;
    pdf.withoutGetPage = false;
    vi.resetModules();
  });

  it("writes the model row chunks (positions are reliable) and stamps text_repair: unmapped_glyph on the page's rows only", async () => {
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    await writePdfChunksForNode(opts);
    const rows = insertedRows();
    const own = rows.filter((r) => Array.isArray(r.metadata.table_models) && (r.metadata.table_models as string[]).join() === "GS11N20P2");
    expect(own).toHaveLength(1);
    expect(own[0].content).toContain("GS11N-20P2: CT Rated Input Current 5�1 A");
    const page2 = rows.filter((r) => r.page === 2);
    expect(page2.length).toBeGreaterThan(1);
    for (const r of page2) expect(r.metadata.text_repair).toBe("unmapped_glyph");
    for (const r of rows.filter((r) => r.page === 1)) expect(r.metadata.text_repair).toBeUndefined();
  });
});
