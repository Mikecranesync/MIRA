import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import fixture from "../__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import { COLUMN_LINE_MARK } from "../contact-ratings-table";
import { excludedTablesRefusalText } from "../manual-applicability";
import { retrieveNodeChunks } from "@/lib/manual-rag";

// Actual unpdf page text and positioned items, captured from the retained source hash.
// Only the PDF/SQL boundaries are simulated: upload parsing, chunking, the #5487
// column reader, retrieval admission and refusal wording are the production code.
vi.hoisted(() => { process.env.NODE_EMBED_ON_WRITE = "0"; });
const pdfPages = vi.hoisted(() => ({ failPage: null as number | null, current: null as null | Array<{ page: number; text: string; items: Array<{ str: string; x: number; y: number; w: number; size: number }> }> }));
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    getPage: async (page: number) => ({
      getTextContent: async () => {
        if (pdfPages.failPage === page) throw new Error("simulated page layout read failure");
        return { items: ((pdfPages.current ?? fixture.pages).find((p) => p.page === page)?.items ?? []).map((i) => ({
          str: i.str, width: i.w, transform: [i.size, 0, 0, i.size, i.x, i.y],
        })) };
      },
      cleanup: () => true,
    }),
  })),
  extractText: vi.fn(async () => ({ text: Array.from({ length: 20 }, (_, i) => (pdfPages.current ?? fixture.pages).find((p) => p.page === i + 1)?.text ?? "") })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
const captured = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>);
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenant: string, fn: (client: { query: (sql: string, params: unknown[]) => Promise<{ rows: never[] }> }) => Promise<unknown>) =>
    fn({ query: async (sql, params) => { captured.push({ sql, params }); return { rows: [] }; } })),
}));

type Row = Record<string, unknown> & { content: string; page_start: number };
let stored: Row[];
async function ingestFixture() {
  captured.length = 0;
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode({ tenantId: "tenant-a", uploadId: "d-1", nodeId: "n-1", unsPath: null,
    filename: fixture.source, buffer: Buffer.from("%PDF source-bound fixture proxy") });
  const rows: Row[] = [];
  for (const { sql, params } of captured) {
    if (!sql.includes("INSERT INTO knowledge_entries")) continue;
    for (let i = 3; i + 3 < params.length; i += 4) {
      const meta = JSON.parse(params[i + 3] as string);
      rows.push({ id: params[i], content: params[i + 1] as string, page_start: params[i + 2] as number,
        source_page: params[i + 2], source_url: params[1], doc_id: params[2], filename: fixture.source,
        document_heading: "Micro820 20-Point Programmable Controllers\n2080-LC20-20AWB(R), 2080-LC20-20QBB(R), 2080-LC20-20QWB(R)",
        section_path: null, rank: 0.4, table_models: meta.table_models ?? null,
        table_unqualified: meta.table_unqualified ?? null, table_scope: meta.table_scope ?? null });
    }
  }
  return rows;
}
beforeAll(async () => { stored = await ingestFixture(); });

async function retrieve(model: string, rows: Row[], question = "What are the contact ratings at 120 V AC?") {
  const scripted = [rows];
  const calls: string[] = [];
  const client = { query: vi.fn(async (sql: string) => {
    calls.push(sql);
    if (sql.includes("WITH ORDINALITY") || sql.includes("names_document") || sql.includes("quote_literal(lex)") || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) return { rows: [] };
    return { rows: scripted.shift() ?? [] };
  }) } as unknown as PoolClient;
  const diagnostics: { excludedTables?: Array<{ page: number | null; models: string[]; section?: true; unqualified?: true }> } = {};
  const chunks = await retrieveNodeChunks(client, "tenant-a", question, {
    nodeId: "n-1", unsPath: null, docIds: ["d-1"], validatedDocScope: true, topK: 100,
    identity: { manufacturer: "Allen-Bradley", model: "Micro820" }, identityStatus: "user_confirmed",
    catalogNumber: `2080-LC20-${model}`, diagnostics,
  });
  return { chunks, text: chunks.map((c) => c.content).join("\n"), diagnostics, calls };
}

const relay = (r: Row) => /Relay Output Specifications|Relay Contact Ratings|columns read from the page layout|Maximum switching time|10,000,000 cycles/.test(r.content);
const p18and19 = () => stored.filter((r) => r.page_start === 18 || r.page_start === 19);

describe("#5503: real Micro820 sections from upload through retrieval", () => {
  it("retains every positioned source text item on its own page while splitting sections", () => {
    const compact = (value: string) => value.replace(/\s+/g, "");
    for (const page of fixture.pages) {
      const written = compact(stored.filter((r) => r.page_start === page.page).map((r) => r.content).join("\n"));
      for (const item of page.items.filter((i) => i.str.trim())) {
        expect(written, `p${page.page} source item ${JSON.stringify(item.str)}`).toContain(compact(item.str));
      }
    }
  });

  it("keeps relay, shared analog output and shared DC input in separate passages", () => {
    expect(stored.some(relay)).toBe(true);
    for (const row of stored.filter(relay)) {
      expect(row.content).not.toMatch(/Analog Output Specifications|DC Input Specifications|DC Output Specifications/);
    }
  });

  it("QBB excludes every relay row and every #5487 column line from real pages 18–19", async () => {
    const rows = p18and19();
    expect(rows.some((r) => r.content.includes(COLUMN_LINE_MARK))).toBe(true);
    const result = await retrieve("20QBB", rows);
    expect(result.text).not.toMatch(/Relay Contact Ratings|Relay Output Specifications|Maximum switching time|10,000,000 cycles|columns read from the page layout/);
    expect(result.diagnostics.excludedTables).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 18, models: expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]) }),
      expect.objectContaining({ page: 19, models: expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]) }),
    ]));
  });

  for (const model of ["20QWB", "20AWB"]) {
    it(`${model} retains its valid relay specifications and extracted contact-rating columns`, async () => {
      const result = await retrieve(model, p18and19());
      expect(result.text).toContain("Maximum switching time");
      expect(result.text).toContain("10,000,000 cycles");
      expect(result.text).toContain("Relay Contact Ratings");
      expect(result.text).toContain(`${COLUMN_LINE_MARK}120 V AC row: make 15 A, break 1.5 A, continuous 2 A.`);
      // The p18 running header precedes the first caption and may retain p17's
      // AWB-only AC-input scope. That irrelevant header rejection is valid; the
      // relay section itself (both QWB/AWB models) must never be excluded.
      expect(result.diagnostics.excludedTables ?? []).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ page: 18, models: expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]) }),
      ]));
    });
  }

  for (const model of ["20QBB", "20QWB", "20AWB"]) {
    it(`${model} retains the shared analog-output section without relay evidence`, async () => {
      const rows = stored.filter((r) => r.page_start === 19 && /Analog Output Specifications|Output count range|Channel-to-channel isolation/.test(r.content));
      expect(rows.length).toBeGreaterThan(0);
      const result = await retrieve(model, rows, "What is the analog output voltage range?");
      expect(result.text).toContain("Output count range");
      expect(result.text).toContain("Channel-to-channel isolation");
      expect(result.text).not.toMatch(/Relay Contact Ratings|columns read from the page layout|DC Output Specifications/);
    });
    it(`${model} retains the shared DC-input section despite variant names within one header column`, async () => {
      const rows = stored.filter((r) => r.page_start === 18 && /DC Input Specifications|IEC input compatibility/.test(r.content));
      const result = await retrieve(model, rows, "What are the DC input specifications?");
      expect(result.text).toContain("DC Input Specifications");
      expect(result.text).toContain("IEC input compatibility");
      expect(result.text).not.toMatch(/Relay Output Specifications|Maximum switching time/);
    });
  }

  it("the QBB DC-output section is available to QBB and excluded for QWB/AWB", async () => {
    const rows = stored.filter((r) => r.page_start >= 19 && /DC Output Specifications|Surge current per point/.test(r.content));
    const own = await retrieve("20QBB", rows, "What are the DC output surge current specifications?");
    expect(own.text).toContain("DC Output Specifications");
    expect(own.text).toContain("Surge current per point");
    for (const model of ["20QWB", "20AWB"]) {
      const other = await retrieve(model, rows, "What are the DC output surge current specifications?");
      expect(other.text).not.toMatch(/DC Output Specifications|Surge current per point/);
    }
  });

  it("refusal explains other-variant section applicability and names the page without invented electrical advice", async () => {
    const result = await retrieve("20QBB", stored.filter(relay));
    expect(result.chunks).toEqual([]);
    const text = excludedTablesRefusalText("2080-LC20-20QBB", result.diagnostics.excludedTables ?? []);
    expect(text).toMatch(/section/i);
    expect(text).toMatch(/18/);
    expect(text).toMatch(/19/);
    expect(text).toMatch(/may not apply|does not apply|applicab/i);
    expect(text).not.toMatch(/read the 2080-LC20-20QBB column|\b15 A\b|interposing|rewire|safe to|can switch/i);
  });

  it("every chunk of a long relay section keeps the wrapped heading's scope", async () => {
    const extended = structuredClone(fixture.pages);
    const page = extended.find((p) => p.page === 18)!;
    const added = Array.from({ length: 30 }, (_, i) => `Endurance note ${i}: relay-contact endurance test conditions remain part of this output section.`).join("\n");
    page.text = page.text.replace("Life 10,000,000 cycles", `${added}\nLife 10,000,000 cycles`);
    page.items.push({ str: added, x: 148, y: 230, w: 200, size: 8 });
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    const continuation = rows.filter((r) => r.page_start === 18 && /Endurance note/.test(r.content));
    expect(continuation.length).toBeGreaterThan(2);
    for (const row of continuation) {
      expect(row.table_models).toEqual(expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]));
      expect(row.table_models).not.toContain("2080LC2020QBB");
    }
    const qbb = await retrieve("20QBB", continuation, "What are the endurance test conditions?");
    expect(qbb.chunks).toEqual([]);
    for (const model of ["20QWB", "20AWB"]) {
      const own = await retrieve(model, continuation, "What are the endurance test conditions?");
      expect(own.chunks).toHaveLength(continuation.length);
    }
  });

  it("relay body continued onto the next page keeps scope before its next caption", async () => {
    const extended = structuredClone(fixture.pages);
    const page = extended.find((p) => p.page === 19)!;
    const continuation = "Retained relay endurance continuation from the preceding page.";
    page.text = page.text.replace("Relay Contact Ratings", `${continuation}\nRelay Contact Ratings`);
    page.items.push({ str: continuation, x: 148, y: 640, w: 250, size: 8 });
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    const continued = rows.filter((r) => r.content.includes(continuation));
    expect(continued.length).toBeGreaterThan(0);
    for (const row of continued) {
      expect(row.table_models).toEqual(expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]));
      expect(row.table_models).not.toContain("2080LC2020QBB");
    }
    expect((await retrieve("20QBB", continued, "What are the endurance conditions?")).chunks).toEqual([]);
    expect((await retrieve("20QWB", continued, "What are the endurance conditions?")).text).toContain(continuation);
  });

  it("a failed page19 layout stays unresolved for every variant until page20's readable DC caption", async () => {
    pdfPages.failPage = 19;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.failPage = null; warning.mockRestore(); }
    const failedPage = rows.filter((r) => r.page_start === 19);
    expect(failedPage.length).toBeGreaterThan(0);
    expect(failedPage.some((r) => r.content.includes("Relay Contact Ratings"))).toBe(true);
    expect(failedPage.some((r) => r.content.includes("DC Output Specifications"))).toBe(true);
    for (const row of failedPage) {
      expect(row.table_unqualified).toBe(true);
      expect(row.table_models).toEqual(expect.arrayContaining(["2080LC2020QBB", "2080LC2020QWB", "2080LC2020AWB"]));
    }
    for (const model of ["20QBB", "20QWB", "20AWB"]) {
      const result = await retrieve(model, failedPage);
      expect(result.chunks).toEqual([]);
      expect(result.diagnostics.excludedTables).toEqual(expect.arrayContaining([
        expect.objectContaining({ page: 19, section: true, unqualified: true }),
      ]));
      const refusal = excludedTablesRefusalText(`2080-LC20-${model}`, result.diagnostics.excludedTables ?? []);
      expect(refusal).toMatch(/could not read which models/i);
      expect(refusal).toContain("page 19");
      expect(refusal).not.toMatch(/another model.s column|read the .* column|15 A|interposing|safe to/i);
    }
    const restored = rows.filter((r) => r.page_start === 20 && /DC Output Specifications/.test(r.content));
    expect(restored.length).toBeGreaterThan(0);
    expect((await retrieve("20QBB", restored, "What are the DC output specifications?")).text).toContain("DC Output Specifications");
    for (const model of ["20QWB", "20AWB"]) {
      expect((await retrieve(model, restored, "What are the DC output specifications?")).chunks).toEqual([]);
    }
  });

  it("retrieval fetches stored scope rather than relying on query wording", async () => {
    const result = await retrieve("20QBB", p18and19(), "Give me the switching time and mechanical life.");
    expect(result.text).not.toMatch(/Maximum switching time|10,000,000 cycles|Relay Contact Ratings|columns read from the page layout/);
    expect(result.calls.some((sql) => /metadata->>'table_scope'\s+AS table_scope/.test(sql))).toBe(true);
  });
});
