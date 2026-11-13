import { beforeEach, describe, expect, it, vi } from "vitest";
import p19 from "@/capabilities/__fixtures__/contact-ratings/micro820-in009b-p19.json";
import gs10p26 from "@/capabilities/__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import { COLUMN_LINES_HEAD } from "@/capabilities/contact-ratings-table";
import { ratingColumnFinding } from "@/capabilities/rating-column";
import { chunkText } from "@/lib/node-knowledge-ingest";

/**
 * #5474 item 5 — the upload side. `writePdfChunksForNode` reads a contact-ratings table's make /
 * break / continuous columns from the page's positioned text items and writes them as lines under
 * the table in the page text. The flat rows stay. A page without such a table, a page whose
 * layout read fails, and a PDF proxy without `getPage` are stored exactly as before.
 *
 * The fixture is the real page: Rockwell 2080-IN009B-EN-P page 19, its positioned items and its
 * flat text as unpdf returns them. Harness copied from node-knowledge-ingest-tables.test.ts.
 *
 * Run: npx vitest run src/capabilities/__tests__/node-knowledge-ingest-contact-ratings.test.ts
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
        const items = (pdf.layout.get(n) ?? []).map((i) => ({ str: i.str, transform: [i.size, 0, 0, i.size, i.x, i.y], width: i.w }));
        return { getTextContent: vi.fn(async () => ({ items })), cleanup: () => true };
      }),
    };
  }),
  extractText: vi.fn(async () => ({ text: pdf.pages })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (_tenantId: string, fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: never[] }> }) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          return { rows: [] as never[] };
        },
      }),
  ),
}));

type Row = { content: string; page: number; metadata: Record<string, unknown> };
function insertedRows(): Row[] {
  const rows: Row[] = [];
  for (const { sql, params } of captured) {
    if (!/INSERT INTO knowledge_entries/.test(sql)) continue;
    for (let i = 3; i + 3 < params.length; i += 4) rows.push({ content: params[i + 1] as string, page: params[i + 2] as number, metadata: JSON.parse(params[i + 3] as string) });
  }
  return rows;
}

const PROSE = "Chapter 2: Installation and Wiring\n\nDisconnect power before servicing. Wait 5 minutes for the capacitors to discharge.";
const opts = { tenantId: "11111111-1111-4111-8111-111111111111", uploadId: "up-1", nodeId: "node-1", unsPath: null, filename: "2080-IN009B-EN-P.pdf", buffer: Buffer.from("%PDF-1.4") };
const write = async () => {
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode(opts);
  return insertedRows();
};

describe("writePdfChunksForNode writes a contact-ratings table's columns under the table", () => {
  beforeEach(() => {
    captured.length = 0;
    pdf.pages = [PROSE, p19.text];
    pdf.layout = new Map([[2, p19.items]]);
    pdf.getPageThrows = false;
    pdf.withoutGetPage = false;
    vi.resetModules();
  });

  it("the chunk that holds the flat rows also holds the column lines, each figure under the head the page prints it under", async () => {
    const rows = await write();
    const chunk = rows.filter((r) => r.page === 2 && r.content.includes("120 V AC 15 A 1.5 A 2 A 1800 180"));
    expect(chunk).toHaveLength(1);
    const lines = chunk[0].content.split("\n");
    const at = lines.indexOf(COLUMN_LINES_HEAD);
    expect(lines[at - 1]).toBe("125 V DC 0.22 A");
    expect(lines.slice(at + 1, at + 5)).toEqual([
      "120 V AC: make 15 A, break 1.5 A, continuous 2 A",
      "240 V AC: make 7.5 A, break 0.75 A",
      "24 V DC: continuous 1 A (column not read: 1.0 A)",
      "125 V DC: (column not read: 0.22 A)",
    ]);
    expect(lines[at + 5]).toBe("Analog Output Specifications");
  });

  it("the head is written once for the page, and every chunk is stamped extraction version 4", async () => {
    const rows = await write();
    expect(rows.filter((r) => r.content.includes(COLUMN_LINES_HEAD))).toHaveLength(1);
    for (const r of rows) expect(r.metadata.extraction_version).toBe(4);
  });

  it("nothing of the page's own text is lost or changed: without the column lines it chunks as before", async () => {
    const rows = await write();
    const stored = rows.filter((r) => r.page === 2).map((r) => r.content).join("\n");
    for (const line of p19.text.split("\n").map((l: string) => l.trim()).filter(Boolean)) expect(stored).toContain(line);
    expect(rows.filter((r) => r.page === 1).map((r) => r.content)).toEqual(chunkText(PROSE));
  });

  it("end to end, no model call: the stored chunk lets the answer check catch the answer served on staging, and pass a correct one", async () => {
    const rows = await write();
    const passages = rows.filter((r) => r.page === 2).map((r) => ({ content: r.content, title: opts.filename, page: 19, cited: true }));
    const q = "Can I switch a 5 A, 120 V AC motor contactor coil load directly from a Micro820 relay output?";
    const served = "No — a 5 A, 120 V AC motor contactor coil exceeds the relay output’s 120 V AC make rating of 1.5 A and break rating of 2 A, so it should not be switched directly [2].";
    const correct = "No. At 120 V AC the relay contacts are rated 15 A make, 1.5 A break and 2 A continuous [2], so a 5 A coil load is over the continuous rating.";
    expect(ratingColumnFinding(q, served, passages)).toMatchObject({ rule: "wrong_column", figure: "2 A" });
    expect(ratingColumnFinding(q, correct, passages)).toBeNull();
  });

  it.each([
    ["the layout read throws", () => { pdf.getPageThrows = true; }],
    ["the PDF proxy has no getPage", () => { pdf.withoutGetPage = true; }],
    ["the page has no positioned items", () => { pdf.layout = new Map(); }],
  ])("control: %s — the page is stored as flat text, exactly as before", async (_name, arrange) => {
    arrange();
    const rows = await write();
    expect(rows.filter((r) => r.page === 2).map((r) => r.content)).toEqual(chunkText(p19.text));
    expect(rows.some((r) => r.content.includes(COLUMN_LINES_HEAD))).toBe(false);
  });

  it("control: a page with a model-column table and no contact-ratings table gets no column lines", async () => {
    pdf.pages = [PROSE, gs10p26.text];
    pdf.layout = new Map([[2, gs10p26.items]]);
    const rows = await write();
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.some((r) => r.content.includes(COLUMN_LINES_HEAD))).toBe(false);
  });
});
