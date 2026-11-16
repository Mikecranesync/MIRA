import { beforeEach, describe, expect, it, vi } from "vitest";
import gs10p26 from "@/capabilities/__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import gs10p394 from "@/capabilities/__fixtures__/table-rows/gs10-p394-cable-length.json";
import { chunkText } from "@/lib/node-knowledge-ingest";
import { pageWithTables } from "@/capabilities/table-rows";

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
  /** Rules a test declares for a page it built itself (#5503 F14/F15); captured pages get their real pin. */
  rules: new Map<number, Array<{ x: number; y0: number; y1: number }>>(),
  getPageThrows: false,
  withoutGetPage: false,
}));

/** SHA-256 of the GS10 user manual rev B the page 26/27 fixtures were captured from. */
const GS10_SHA256 = vi.hoisted(() => "090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4");
const realPins = await vi.importActual<typeof import("@/capabilities/table-rule-pins")>("@/capabilities/table-rule-pins");
// Pinned table rules: the writer's bytes are a stub, so this stands in for "these bytes are that manual".
vi.mock("@/capabilities/table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/table-rule-pins")>();
  const { pinsDouble } = await import("../__fixtures__/pinned-rules-double");
  return { ...actual, rulePinsForSha: () => pinsDouble(actual, [...pdf.layout].map(([page, items]) => ({ page, items, rules: pdf.rules.get(page) })), [GS10_SHA256]) };
});
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
    pdf.rules = new Map();
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
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.some((row) => /Cooling Method/.test(row.content))).toBe(true);
    for (const row of flat) expect(row.metadata.table_models).toEqual(["GS11N20P2", "GS11N20P5", "GS11N21P0", "GS11N22P0", "GS11N23P0"]);
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
    // The unplaced Cooling Method line now ends positive grid ownership.
    // Preserve the following notes on their physical page without silently
    // restoring model applicability after that uncertainty.
    const notes = rows.filter((r) => r.page === 2 && /For use with three-phase motors only/.test(r.content));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((r) => r.metadata.table_unqualified === true)).toBe(true);
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

  const interrupted = (section = false) => {
    const item = (str: string, x: number, y: number, size = 8) => ({ str, x, y, size, w: str.length * size * 0.4 });
    return [...(section ? [item("Output Specifications for GS11N-10P2, GS11N-10P5", 100, 740, 12)] : []),
      item("Attribute", 100, 720), item("GS11N-10P2", 280, 720), item("GS11N-10P5", 420, 720),
      item("Original current", 100, 706), item("2 A", 280, 706), item("1 A", 420, 706),
      item("Original interval", 100, 692), item("10 ms", 280, 692), item("8 ms", 420, 692),
      item("Derating", 100, 680), item("Later current", 100, 668), item("9 A", 280, 668), item("11 A", 420, 668)];
  };

  it("F13 a fresh physical model header qualifies its own columns after earlier column-only uncertainty", async () => {
    const first = interrupted();
    pdf.pages = [first.map((item) => item.str).join("\n"), gs10p26.text];
    pdf.layout = new Map([[1, first], [2, gs10p26.items]]);
    pdf.rules = new Map();
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    await writePdfChunksForNode(opts);
    const own = insertedRows().filter((row) => row.page === 2 && (row.metadata.table_models as string[] | undefined)?.join() === "GS11N20P2");
    expect(own.some((row) => row.content.includes("GS11N-20P2: CT Rated Input Current 5.1 A") && !row.metadata.table_unqualified)).toBe(true);
    expect(insertedRows().filter((row) => row.page === 1 && row.content.includes("Later current")).every((row) => row.metadata.table_unqualified)).toBe(true);
  });

  it.each([{ section: false, aligned: true }, { section: true, aligned: true }, { section: false, aligned: false }])(
    "F13 an ordinary parameter grid bounds only column-local context: %j", async ({ section, aligned }) => {
      const first = interrupted(section);
      const item = (str: string, x: number, y: number) => ({ str, x, y, size: 8, w: str.length * 3 });
      const ordinary = [item("Type", 416.52, 720), item("Hex Addr", 457.02, 720), item("Dec Addr", 506.52, 720),
        ...["P01.12", "P01.13", "P01.14"].flatMap((key, index) => [item(key, 74, 706 - index * 14),
          item("zzordinaryparameter Acceleration time", 117, 706 - index * 14), item("R/W", 423, 706 - index * 14),
          item(["010C", "010D", "010E"][index], aligned ? 463 : 350, 706 - index * 14), item(String(40269 + index), 513, 706 - index * 14)])];
      expect(pageWithTables(ordinary)).toBeNull(); // parameter fields remain ordinary, never equipment/model chunks
      pdf.pages = [first.map((value) => value.str).join("\n"), ordinary.map((value) => value.str).join("\n")];
      pdf.layout = new Map([[1, first], [2, ordinary]]);
      pdf.rules = new Map();
      const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
      await writePdfChunksForNode(opts);
      const rows = insertedRows().filter((row) => row.page === 2 && row.content.includes("zzordinaryparameter"));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.metadata.table_unqualified === true)).toBe(section || !aligned);
      if (!section && aligned) expect(rows.every((row) => row.metadata.table_models === undefined)).toBe(true);
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
    // The glyph-garbled page is built here, so it declares the page's real pinned rules itself.
    pdf.rules = new Map([[2, [...realPins.rulePinsForSha(GS10_SHA256)!["26"].rules]]]);
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

describe("writePdfChunksForNode stores a model-keyed table (one model per line) as unqualified text only (#5450)", () => {
  beforeEach(() => {
    captured.length = 0;
    pdf.pages = [PROSE, gs10p394.text];
    pdf.layout = new Map([[2, gs10p394.items]]);
    pdf.rules = new Map();
    pdf.getPageThrows = false;
    pdf.withoutGetPage = false;
    vi.resetModules();
  });

  it("writes the GS10 p.394 cable-length table as one table_unqualified chunk tagged with all 22 models, and no per-model chunk", async () => {
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    await writePdfChunksForNode(opts);
    const rows = insertedRows().filter((r) => r.page === 2);
    const flat = rows.filter((r) => r.metadata.table_unqualified === true);
    expect(flat).toHaveLength(1);
    expect((flat[0].metadata.table_models as string[]).length).toBe(22);
    expect(flat[0].metadata.table_models).toContain("GS11N20P2");
    expect(flat[0].metadata.table_models).toContain("GS13N4010");
    expect(flat[0].content).toMatch(/Maximum Recommended Cable Length - GS10/);
    expect(flat[0].content).toMatch(/GS11N-20P2/);
    const perModel = rows.filter((r) => Array.isArray(r.metadata.table_models) && !r.metadata.table_unqualified);
    expect(perModel).toHaveLength(0);
    // The flat page remainder no longer carries the table's model lines (that is what answered the
    // output current as "rated input current" on staging build 5e79ca713).
    const remainder = rows.filter((r) => !r.metadata.table_models).map((r) => r.content).join("\n");
    expect(remainder).not.toMatch(/GS11N-20P2/);
    expect(remainder).toMatch(/Appendix A: Accessories/);
  });
});
