import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import fixture from "../__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import ml1100Ratings from "../__fixtures__/table-rows/ml1100-p114-p120-ratings-scope.json";
import { COLUMN_LINE_MARK } from "../contact-ratings-table";
import { excludedTablesRefusalText, modelNumbersIn } from "../manual-applicability";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { SectionTableScope, sectionTableLayout } from "../section-table-scope";
import { pageWithTables } from "../table-rows";

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
  extractText: vi.fn(async () => ({ text: Array.from({ length: Math.max(20, ...(pdfPages.current ?? fixture.pages).map((page) => page.page)) }, (_, i) => (pdfPages.current ?? fixture.pages).find((p) => p.page === i + 1)?.text ?? "") })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
const captured = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>);
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenant: string, fn: (client: { query: (sql: string, params: unknown[]) => Promise<{ rows: never[] }> }) => Promise<unknown>) =>
    fn({ query: async (sql, params) => { captured.push({ sql, params }); return { rows: [] }; } })),
}));

type Row = Record<string, unknown> & { content: string; page_start: number };
let stored: Row[];
async function ingestFixture(filename = fixture.source) {
  captured.length = 0;
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode({ tenantId: "tenant-a", uploadId: "d-1", nodeId: "n-1", unsPath: null,
    filename, buffer: Buffer.from("%PDF source-bound fixture proxy") });
  const rows: Row[] = [];
  for (const { sql, params } of captured) {
    if (!sql.includes("INTO knowledge_entries")) continue;
    for (let i = 3; i + 3 < params.length; i += 4) {
      const meta = JSON.parse(params[i + 3] as string);
      rows.push({ id: params[i], content: params[i + 1] as string, page_start: params[i + 2] as number,
        source_page: params[i + 2], source_url: params[1], doc_id: params[2], filename: fixture.source,
        document_heading: "Micro820 20-Point Programmable Controllers\n2080-LC20-20AWB(R), 2080-LC20-20QBB(R), 2080-LC20-20QWB(R)",
        section_path: null, rank: 0.4, table_models: meta.table_models ?? null,
        table_unqualified: meta.table_unqualified ?? null, table_scope: meta.table_scope ?? null, table_header: meta.table_header ?? null });
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

  it("unread output-type evidence is stored unresolved with an operator warning instead of losing applicability", async () => {
    const extended = structuredClone(fixture.pages);
    const inventory = extended.find((p) => p.page === 16)!;
    inventory.text = inventory.text.replace("24V DC source", "24V DC sourcing");
    const cell = inventory.items.find((item) => item.str === "24V DC source")!;
    expect(cell).toBeDefined();
    cell.str = "24V DC sourcing";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    pdfPages.current = extended;
    let rows: Row[];
    let warnings: string[];
    try {
      rows = await ingestFixture();
      warnings = warning.mock.calls.map((args) => args.map(String).join(" "));
    } finally { pdfPages.current = null; warning.mockRestore(); }
    const relay = rows.filter((r) => r.page_start === 19 && /Relay Contact Ratings/.test(r.content));
    expect(relay.length).toBeGreaterThan(0);
    expect(relay.every((r) => r.table_unqualified === true && r.table_scope === "unresolved")).toBe(true);
    expect(warnings.some((message) => /output|applicab|scope|unresolved/i.test(message) && message.includes(fixture.source))).toBe(true);
    expect((await retrieve("20QBB", relay)).chunks).toEqual([]);
  });

  it("a bare shared tag cannot override sibling-only prose, while own-catalog prose remains available", async () => {
    const sibling = { ...stored[0], page_start: 18, table_models: null, table_unqualified: null, table_scope: "shared", table_header: null,
      content: "2080-LC20-20QWB(R) only: relay output switching time is specified here." };
    const own = { ...sibling, page_start: 19, content: "2080-LC20-20QBB(R): DC source output current is specified here." };
    const result = await retrieve("20QBB", [sibling, own], "What is the output current and switching time?");
    expect(result.text).not.toContain(sibling.content);
    expect(result.text).toContain(own.content);
  });

  it("a blank zero-item page makes following unheaded text unresolved until the next readable caption", async () => {
    const extended = structuredClone(fixture.pages);
    const blank = extended.find((p) => p.page === 17)!;
    blank.text = ""; blank.items = [];
    const continuation = extended.find((p) => p.page === 18)!;
    continuation.text = "Unheaded controller output continuation without a model caption.";
    continuation.items = [{ str: continuation.text, x: 148, y: 650, w: 250, size: 8 }];
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    const unresolved = rows.filter((r) => r.page_start === 18);
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.every((r) => r.table_unqualified === true)).toBe(true);
    for (const model of ["20QBB", "20QWB", "20AWB"]) expect((await retrieve(model, unresolved)).chunks).toEqual([]);
    const recovered = rows.filter((r) => r.page_start === 20 && /DC Output Specifications/.test(r.content));
    expect((await retrieve("20QBB", recovered)).text).toContain("DC Output Specifications");
  });

  it("unrelated plain pages retain their original bytes before and after an output-type page", async () => {
    const extended = structuredClone(fixture.pages);
    const plain = { page: 15, text: "Second line stays  here.\n\nLocal Maintenance Notes\nFirst line  stays  here.", items: [
      { str: "Local Maintenance Notes", x: 148, y: 700, w: 160, size: 12 },
      { str: "First line  stays  here.", x: 148, y: 680, w: 150, size: 8 },
      { str: "Second line stays  here.", x: 148, y: 660, w: 150, size: 8 },
    ] };
    extended.push(plain);
    const after = extended.find((p) => p.page === 17)!;
    after.text = plain.text; after.items = structuredClone(plain.items);
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    expect(rows.filter((r) => r.page_start === 15).map((r) => r.content)).toEqual([plain.text]);
    expect(rows.filter((r) => r.page_start === 17).map((r) => r.content)).toEqual([plain.text]);
    const columnLines = (rs: Row[]) => rs.filter((r) => r.page_start === 19).flatMap((r) => r.content.split("\n").filter((line) => line.startsWith(COLUMN_LINE_MARK)));
    expect(columnLines(rows)).toEqual(columnLines(stored));
  });

  it("mixed section and unresolved refusals report both page problems without inventing a QBB column", () => {
    const refusal = excludedTablesRefusalText("2080-LC20-20QBB", [
      { page: 18, models: ["2080LC2020QWB", "2080LC2020AWB"], section: true },
      { page: 19, models: ["2080LC2020QBB", "2080LC2020QWB", "2080LC2020AWB"], section: true, unqualified: true },
    ]);
    expect(refusal).toMatch(/other variants/i);
    expect(refusal).toMatch(/could not read which models/i);
    expect(refusal).toMatch(/18/);
    expect(refusal).toMatch(/19/);
    expect(refusal).not.toMatch(/read the .*QBB column|QBB relay column|15 A|interposing|rewire|safe to/i);
  });

  it("a real contact-ratings layout renamed Relay Outputs stays unresolved without an invented Attribute header", async () => {
    const extended = structuredClone(fixture.pages);
    const page = extended.find((p) => p.page === 19)!;
    page.text = page.text.replace("Relay Contact Ratings", "Relay Outputs");
    const title = page.items.find((item) => item.str === "Relay Contact Ratings")!;
    expect(title).toBeDefined();
    title.str = "Relay Outputs";
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    const relay = rows.filter((r) => r.page_start === 19 && /Relay Outputs|columns read from the page layout/.test(r.content));
    expect(relay.length).toBeGreaterThan(0);
    expect(relay.some((r) => r.content.includes(COLUMN_LINE_MARK))).toBe(true);
    const result = await retrieve("20QBB", relay, "What are the relay contact ratings at 120 V AC?");
    expect(result.text).not.toMatch(/Relay Outputs|columns read from the page layout/);
    expect(relay.every((r) => r.table_unqualified === true && r.table_scope === "unresolved")).toBe(true);
  });

  it("a smaller-font indented sibling body cannot be stripped as a shared table header", async () => {
    const item = (str: string, x: number, y: number, size: number) => ({ str, x, y, size, w: str.length * size * 0.4 });
    const siblingBody = "2080-LC20-20QWB relay-rating evidence";
    const layout = sectionTableLayout([
      item("DC Input Specifications", 100, 700, 10),
      item("Attribute", 100, 680, 9), item("Normal", 200, 680, 9), item("Isolated", 300, 680, 9),
      item(siblingBody, 200, 650, 8),
    ])!;
    const scope = new SectionTableScope(new Map([["2080LC2020AWB", true], ["2080LC2020QBB", false], ["2080LC2020QWB", true]]));
    const section = scope.split(layout.text, layout).find((s) => s.text.includes(siblingBody))!;
    const row = { ...stored[0], page_start: 18, content: section.text, table_models: section.models ?? null,
      table_scope: section.scope ?? null, table_header: section.sharedHeader ?? null, table_unqualified: null };
    const result = await retrieve("20QBB", [row], "What is the relay-rating evidence?");
    expect(result.chunks).toEqual([]);
    expect(section.sharedHeader ?? "").not.toContain(siblingBody);
  });

  it("failed layout on the output-inventory page cannot make later relay evidence unscoped", async () => {
    pdfPages.failPage = 16;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    let rows: Row[];
    let warnings: string[];
    try {
      rows = await ingestFixture();
      warnings = warning.mock.calls.map((args) => args.map(String).join(" "));
    } finally { pdfPages.failPage = null; warning.mockRestore(); }
    const relay = rows.filter((r) => r.page_start >= 18 && r.page_start <= 19 && /Relay Output Specifications|Relay Contact Ratings|columns read from the page layout/.test(r.content));
    expect(relay.length).toBeGreaterThan(0);
    expect(warnings.some((message) => message.includes(fixture.source) && /16/.test(message))).toBe(true);
    const result = await retrieve("20QBB", relay, "What are the relay output contact ratings?");
    expect(result.text).not.toMatch(/Relay Output Specifications|Relay Contact Ratings|columns read from the page layout/);
    expect(relay.filter((r) => r.page_start === 19).every((r) => r.table_scope === "unresolved" && r.table_unqualified === true)).toBe(true);
  });

  it("a next-page heading interruption cannot attribute a raw-before-heading QBB body to the prior relay scope", async () => {
    const extended = structuredClone(fixture.pages);
    const page = extended.find((p) => p.page === 19)!;
    const body = "2080-LC20-20QBB(R): transistor-only output evidence.";
    page.text = `${body}\nDC Output Data`;
    page.items = [
      { str: "DC Output Data", x: 144, y: 623, w: 100, size: 10 },
      { str: body, x: 148, y: 605, w: 220, size: 8 },
    ];
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    const bodyRows = rows.filter((r) => r.page_start === 19 && r.content.includes(body));
    expect(bodyRows.length).toBeGreaterThan(0);
    const sibling = await retrieve("20QWB", bodyRows, "What is the transistor-only output evidence?");
    expect(sibling.text).not.toContain(body);
    const own = await retrieve("20QBB", bodyRows, "What is the transistor-only output evidence?");
    expect(own.text.includes(body) || bodyRows.every((r) => r.table_unqualified === true)).toBe(true);
  });

  it("real Make/Break/Continuous geometry remains relay evidence when the title is only Contact Ratings", async () => {
    const extended = structuredClone(fixture.pages);
    const page = extended.find((p) => p.page === 19)!;
    page.text = page.text.replace("Relay Contact Ratings", "Contact Ratings");
    page.items.find((item) => item.str === "Relay Contact Ratings")!.str = "Contact Ratings";
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    const ratings = rows.filter((r) => r.page_start === 19 && /Contact Ratings|columns read from the page layout/.test(r.content));
    expect(ratings.some((r) => r.content.includes(COLUMN_LINE_MARK))).toBe(true);
    const result = await retrieve("20QBB", ratings, "What are the relay contact ratings at 120 V AC?");
    expect(result.text).not.toMatch(/Contact Ratings|columns read from the page layout/);
  });

  it("same-font contiguous sibling prose is not a catalog-only shared-header continuation", async () => {
    const item = (str: string, x: number, y: number, size: number) => ({ str, x, y, size, w: str.length * size * 0.4 });
    const siblingBody = "2080-LC20-20QWB(R) relay-rating evidence";
    const layout = sectionTableLayout([
      item("DC Input Specifications", 100, 700, 10),
      item("Attribute", 100, 680, 9), item("Normal", 200, 680, 9), item("Isolated", 300, 680, 9),
      item(siblingBody, 200, 671, 9),
    ])!;
    const scope = new SectionTableScope(new Map([["2080LC2020AWB", true], ["2080LC2020QBB", false], ["2080LC2020QWB", true]]));
    const section = scope.split(layout.text, layout).find((s) => s.text.includes(siblingBody))!;
    const row = { ...stored[0], page_start: 18, content: section.text, table_models: section.models ?? null,
      table_scope: section.scope ?? null, table_header: section.sharedHeader ?? null, table_unqualified: null };
    const result = await retrieve("20QBB", [row], "What is the relay-rating evidence?");
    expect(result.chunks).toEqual([]);
    expect(section.sharedHeader ?? "").not.toContain(siblingBody);
  });

  it.each(["Output Specifications", "Electrical Data"])("actual contact-table geometry under title %s cannot become unscoped QBB evidence", async (caption) => {
    const extended = structuredClone(fixture.pages);
    const page = extended.find((p) => p.page === 19)!;
    page.text = page.text.replace("Relay Contact Ratings", caption);
    page.items.find((item) => item.str === "Relay Contact Ratings")!.str = caption;
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    const ratings = rows.filter((r) => r.page_start === 19 && r.content.includes(COLUMN_LINE_MARK));
    expect(ratings.length).toBeGreaterThan(0);
    const result = await retrieve("20QBB", ratings, "What are the relay contact ratings at 120 V AC?");
    expect(result.text).not.toContain(COLUMN_LINE_MARK);
    expect(ratings.every((r) => r.table_scope === "unresolved" && r.table_unqualified === true)).toBe(true);
  });

  it("compact model-bearing prose is checked before granting shared-header exclusion", async () => {
    const item = (str: string, x: number, y: number, size: number) => ({ str, x, y, size, w: str.length * size * 0.4 });
    const siblingBody = "Only 2080LC2020QWB: do not apply this value to other variants.";
    expect(modelNumbersIn(siblingBody).map((model) => model.key)).toContain("2080LC2020QWB");
    const layout = sectionTableLayout([
      item("DC Input Specifications", 100, 700, 10),
      item("Attribute", 100, 680, 9), item("Normal", 200, 680, 9), item("Isolated", 300, 680, 9),
      item(siblingBody, 200, 671, 9),
    ])!;
    const scope = new SectionTableScope(new Map([["2080LC2020AWB", true], ["2080LC2020QBB", false], ["2080LC2020QWB", true]]));
    const section = scope.split(layout.text, layout).find((s) => s.text.includes(siblingBody))!;
    const row = { ...stored[0], page_start: 18, content: section.text, table_models: section.models ?? null,
      table_scope: section.scope ?? null, table_header: section.sharedHeader ?? null, table_unqualified: null };
    const result = await retrieve("20QBB", [row], "What is the output value?");
    expect(result.chunks).toEqual([]);
    expect(section.sharedHeader ?? "").not.toContain(siblingBody);
  });

  it("real ML1100 model-table removal preserves relay ratings through the full writer", async () => {
    pdfPages.current = structuredClone(ml1100Ratings.pages);
    let rows: Row[];
    try { rows = await ingestFixture("1763-UM001G-EN-P.pdf"); } finally { pdfPages.current = null; }
    const page = rows.filter((row) => row.page_start === 114);
    expect(page.length).toBeGreaterThan(0);
    expect(page.some((row) => row.content.includes("Relay Contact Ratings"))).toBe(true);
    expect(page.some((row) => row.table_scope === "unresolved")).toBe(false);
    const modelRows = rows.filter((row) => row.page_start === 111 && Array.isArray(row.table_models));
    expect(modelRows.length).toBeGreaterThan(4);
  });

  it("actual model-table removal cannot relocate derived relay columns after a later QBB section", async () => {
    const extended = structuredClone(fixture.pages);
    const page = extended.find((p) => p.page === 19)!;
    // Add a two-model header over the existing VA columns. This makes the real
    // model-table reader extract the rating grid while the contact reader still
    // sees the unchanged Make/Break/Continuous heads and ampere cells.
    // A clear vertical gap keeps the later analog/QBB sections outside that grid.
    for (const item of page.items) if (item.y <= 500) item.y -= 80;
    page.items.push(
      { str: "2080-LC20-20QWB(R)", x: 359.94, y: 610, w: 50, size: 8 },
      { str: "2080-LC20-20AWB(R)", x: 418.44, y: 610, w: 50, size: 8 },
    );
    page.text = page.text.replace("Relay Contact Ratings", "Relay Contact Ratings\n2080-LC20-20QWB(R) 2080-LC20-20AWB(R)");
    const extracted = pageWithTables(page.items);
    expect(extracted).not.toBeNull();
    expect(extracted!.remainder).not.toContain("120 V AC");
    expect(extracted!.remainder).toContain("DC Output Specifications");
    pdfPages.current = extended;
    let rows: Row[];
    try { rows = await ingestFixture(); } finally { pdfPages.current = null; }
    const derived = rows.filter((r) => r.page_start === 19 && r.content.includes(COLUMN_LINE_MARK));
    expect(derived.length).toBeGreaterThan(0);
    for (const row of derived) {
      expect(row.table_models).toEqual(expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]));
      expect(row.table_models).not.toContain("2080LC2020QBB");
      expect(row.content).not.toContain("DC Output Specifications");
    }
    expect((await retrieve("20QBB", derived)).chunks).toEqual([]);
    for (const model of ["20QWB", "20AWB"]) {
      expect((await retrieve(model, derived)).text).toContain(`${COLUMN_LINE_MARK}120 V AC row: make 15 A, break 1.5 A, continuous 2 A.`);
    }
  });

  it("retrieval fetches stored scope rather than relying on query wording", async () => {
    const result = await retrieve("20QBB", p18and19(), "Give me the switching time and mechanical life.");
    expect(result.text).not.toMatch(/Maximum switching time|10,000,000 cycles|Relay Contact Ratings|columns read from the page layout/);
    expect(result.calls.some((sql) => /metadata->>'table_scope'\s+AS table_scope/.test(sql))).toBe(true);
  });
});
