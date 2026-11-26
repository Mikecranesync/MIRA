/**
 * #5955 native review 1 — F2 (transaction ownership), F3 (row ordinal on every node lane),
 * F4 (safety-chapter per-row provenance) over ACTUAL SQL and the real retrieval functions.
 *
 * Fixture boundaries: hand-written SESSION TEMP tables (no RLS, grants, indexes, migrations) in the
 * owned loopback disposable database; documents are 4–12 rows with the real corruption shapes; the
 * vector (embedding) lane has no column here and is not exercised. Tenant/approval are the queries'
 * own predicates. Nothing here proves a physical PDF page.
 *
 * Run: TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/citation-integrity-native1.integration.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, type PoolClient } from "pg";
import { annotatePageTrust, displayPage, type PassageChunk } from "@/capabilities/citation-passages";
import { retrieveSafetyChapterChunks } from "@/capabilities/manual-safety-chapter";
import { citedPagesFor } from "@/capabilities/manual-safety-statement";
import { chunksToSources, retrieveNodeChunks, type ManualChunk } from "@/lib/manual-rag";

const CALLER = "59550000-0000-4000-8000-000000000001";
const D = (n: number) => `59550000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const QUESTION = "What does the UnderVoltage fault mean, DC bus voltage";
const FAULT = "UnderVoltage fault: the DC bus voltage fell below the minimum.";
let client: Client;

async function seed(o: { doc: string; page: number | null; pageStart?: number | null; chunk: number | null; content: string; pageLabel?: string }) {
  await client.query(
    `INSERT INTO knowledge_entries (tenant_id, doc_id, content, source_url, source_page, page_start, metadata, verified, is_private, ingest_route)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,false,true,'v2')`,
    [CALLER, o.doc, o.content, `hub://${o.doc}/m.pdf`, o.page, o.pageStart ?? null,
      JSON.stringify({ node_id: "n-5955", filename: "m.pdf", ...(o.chunk == null ? {} : { chunk_index: o.chunk }), ...(o.pageLabel ? { page_label: o.pageLabel } : {}) })],
  );
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") throw Error("Disposable local database required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (url.hostname !== "127.0.0.1" || url.port !== "55626" || url.pathname !== "/mira_citation_test_20261126") throw Error("Only the owned loopback citation database is permitted");
  client = new Client({ connectionString: url.href });
  await client.connect();
  // SESSION temp tables (not ON COMMIT DROP): the F2 tests need a real AUTOCOMMIT client.
  await client.query(`CREATE TEMP TABLE knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, doc_id uuid,
    content text NOT NULL, content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    manufacturer text DEFAULT '', model_number text DEFAULT '', source_url text NOT NULL,
    source_page integer, page_start integer, section_path text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    verified boolean NOT NULL DEFAULT false, is_private boolean NOT NULL DEFAULT false, ingest_route text)`);
  await client.query(`CREATE TEMP TABLE namespace_direct_uploads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, upload_id uuid, source text NOT NULL DEFAULT 'user_upload')`);

  // F2/F3 mixed documents: 8 valid UNANCHORED pages + ONE unanchored ordinal row (page 715 == chunk 715).
  const DIVERSE = D(1);
  for (let i = 0; i < 8; i++) await seed({ doc: DIVERSE, page: 3 + i, chunk: 20 + i, content: `${FAULT} Diverse row ${i}.` });
  await seed({ doc: DIVERSE, page: 715, chunk: 715, content: `${FAULT} Ordinal row 715.` });
  // control: an ANCHORED row whose page_start (715) coincides with its ordinal (715), same document shape
  const ANCHOR = D(2);
  for (let i = 0; i < 8; i++) await seed({ doc: ANCHOR, page: 3 + i, pageStart: 3 + i, chunk: 20 + i, content: `${FAULT} Anchored row ${i}.` });
  await seed({ doc: ANCHOR, page: 715, pageStart: 715, chunk: 715, content: `${FAULT} Anchored coincident row 715.` });
});
afterAll(async () => {
  await client?.end();
});
beforeEach(() => {
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
});
afterEach(() => {
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  vi.restoreAllMocks();
});

function recording() {
  const sqls: string[] = [];
  const wrapped = { query: (sql: string, p?: unknown[]) => { sqls.push(sql); return client.query(sql, p); } };
  return { wrapped: wrapped as unknown as PoolClient, sqls };
}
const node = (c: PoolClient, doc: string, question = QUESTION, extra: Record<string, unknown> = {}) =>
  retrieveNodeChunks(c, CALLER, question, {
    nodeId: "n-5955", unsPath: null, docIds: [doc], approvedSourceDocIds: [doc], validatedDocScope: true, rawQuery: question, topK: 12, ...extra,
  } as never);

describe("F2 — transaction ownership at the retrieveNodeChunks boundary", () => {
  it.each([["none"], [undefined]] as const)("a raw AUTOCOMMIT client keeps valid page facts (pageFactTransaction=%s)", async (mode) => {
    const { wrapped, sqls } = recording();
    const hits = await node(wrapped, D(1), QUESTION, { pageFactTransaction: mode });
    const diverse = hits.find((h) => h.content.includes("Diverse row 3"))!;
    expect(diverse).toMatchObject({ sourcePage: 6, pageTrust: "trusted" });
    expect(displayPage(diverse)).toBe(6);
    // precondition: this really was autocommit — no transaction was open on the session
    expect((await client.query("SELECT now() = statement_timestamp() AS autocommit")).rows[0].autocommit).toBe(true);
    if (mode === "none") expect(sqls.some((s) => /SAVEPOINT cit_page_facts/.test(s))).toBe(false);
  });
  it("control: inside an explicit transaction the SAME retrieval keeps the page and owns a savepoint", async () => {
    const { wrapped, sqls } = recording();
    await client.query("BEGIN");
    try {
      const hits = await node(wrapped, D(1), QUESTION, { pageFactTransaction: "owned" });
      expect(displayPage(hits.find((h) => h.content.includes("Diverse row 3"))!)).toBe(6);
      expect(sqls.some((s) => /^SAVEPOINT cit_page_facts/.test(s))).toBe(true);
    } finally {
      await client.query("ROLLBACK");
    }
  });
  it.each([["owned"], ["probe"]] as const)("a failed fact read inside a transaction (%s) does not poison it", async (mode) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const chunk: PassageChunk = { content: "x", sourceUrl: "hub://x", sourcePage: 6, chunkIndex: 20, docId: D(1) };
    await client.query("BEGIN");
    try {
      const out = await annotatePageTrust(client, CALLER, [chunk], { forDocs: () => "AND no_such_column = 1", docParams: [], forUrls: "" }, { transaction: mode });
      expect(out[0].pageTrust).toBe("unknown");
      expect((await client.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

describe("F3 — every node lane projects and maps the row's own chunk ordinal", () => {
  const f3 = async (question: string, expectSql: RegExp | null) => {
    const { wrapped, sqls } = recording();
    const hits = await node(wrapped, D(1), question);
    if (expectSql) expect(sqls.some((s) => expectSql.test(s))).toBe(true); // precondition: the lane under test ran
    return hits;
  };
  const ordinal = (hits: ManualChunk[]) => hits.find((h) => h.content.includes("Ordinal row 715"));
  it.each([
    ["AND lane", QUESTION, /^\s*SELECT\s+content,\s+doc_id::text AS doc_id[^]*ts_rank_cd\(content_tsv, plainto_tsquery/],
    ["OR fallback lane", `${QUESTION} zzzunmatched`, /^\s*SELECT\s+content,\s+doc_id::text AS doc_id[^]*ts_rank_cd\(content_tsv, to_tsquery/],
  ])("%s: the minority unanchored 715/715 row is withheld inside a page-diverse document; real pages stay", async (_n, question, laneSql) => {
    const hits = await f3(question, laneSql);
    const o = ordinal(hits);
    expect(o, "the ordinal row must be retrieved for this test to mean anything").toBeDefined();
    expect(o).toMatchObject({ sourcePage: 715, chunkIndex: 715, pageAnchored: false, pageTrust: "trusted" });
    expect(displayPage(o!)).toBeNull();
    expect(chunksToSources([o!])[0].page).toBeNull();
    const real = hits.find((h) => h.content.includes("Diverse row 3"))!;
    expect(displayPage(real)).toBe(6);
  });
  it.each([
    ["lexical-v2 IDF lane (NOTEBOOK_LEXICAL_V2=1)", QUESTION, /scored\.score::float8 AS rank/],
  ])("%s: the same minority row is withheld", async (_n, question, laneSql) => {
    process.env.NOTEBOOK_LEXICAL_V2 = "1";
    try {
      const hits = await f3(question, laneSql);
      const o = ordinal(hits);
      expect(o, "retrieved").toBeDefined();
      expect(o).toMatchObject({ sourcePage: 715, chunkIndex: 715, pageAnchored: false });
      expect(displayPage(o!)).toBeNull();
    } finally {
      delete process.env.NOTEBOOK_LEXICAL_V2;
    }
  });
  it("exact-token lane (ILIKE, reachable ONLY there): the same row is withheld when the exact lane is its only path", async () => {
    const DOC = D(3);
    for (let i = 0; i < 6; i++) await seed({ doc: DOC, page: 20 + i, chunk: 50 + i, content: `ModbusRTU gateway pinout ${i}.` });
    // "ModbusRTU" is one lexeme, so no tsquery lane can match it; only the ILIKE %MODBUS% exact token does.
    await seed({ doc: DOC, page: 715, chunk: 715, content: "ModbusRTU gateway ordinal row." });
    const { wrapped, sqls } = recording();
    const q = "what is the modbus";
    const hits = await retrieveNodeChunks(wrapped, CALLER, q, {
      nodeId: "n-5955", unsPath: null, docIds: [DOC], approvedSourceDocIds: [DOC], validatedDocScope: true, rawQuery: q, topK: 12,
    } as never);
    expect(sqls.some((s) => /0::float4 AS rank/.test(s))).toBe(true); // precondition: the exact lane ran
    const o = hits.find((h) => h.content.includes("ordinal row"));
    expect(o, "retrieved through the exact lane").toBeDefined();
    expect(o).toMatchObject({ sourcePage: 715, chunkIndex: 715 });
    expect(displayPage(o!)).toBeNull();
    expect(displayPage(hits.find((h) => h.content.includes("pinout 2"))!)).toBe(22);
  });
  it("every row-returning node lane that actually ran selects the chunk ordinal (rare-term and v2 lanes are not separately reachable by rows)", async () => {
    for (const v2 of [false, true]) {
      if (v2) process.env.NOTEBOOK_LEXICAL_V2 = "1";
      try {
        const { wrapped, sqls } = recording();
        await node(wrapped, D(1), `${QUESTION} zzzunmatched`);
        const rowLanes = sqls.filter((x) => /AS lexemes/.test(x) && /AS rank/.test(x)); // the row-returning lanes
        expect(rowLanes.length).toBeGreaterThan(v2 ? 0 : 1);
        for (const lane of rowLanes) expect(lane).toMatch(/metadata->>'chunk_index' AS chunk_index/);
      } finally {
        delete process.env.NOTEBOOK_LEXICAL_V2;
      }
    }
  });
  it("control: an ANCHORED row whose page_start coincides with its ordinal still renders its page", async () => {
    const hits = await node(client as unknown as PoolClient, D(2));
    const a = hits.find((h) => h.content.includes("Anchored coincident row 715"))!;
    expect(a).toMatchObject({ sourcePage: 715, chunkIndex: 715, pageAnchored: true });
    expect(displayPage(a)).toBe(715);
  });
});

describe("F4 — safety-chapter excerpts carry the WARNING ROW's own provenance", () => {
  const ref = "Read the instructions in chapter Safety on page 17.";
  const warning = "WARNING! Disconnect the supply and wait five minutes. Verify zero voltage with a multimeter before touching any terminal.";
  /** doc with a template page-10 row, a warning on page 17, and 6 other unanchored valid pages (so the unanchored verdict is "diverse"). */
  async function probe(n: number, templateAnchored: boolean, warningAnchored: boolean) {
    const doc = D(10 + n);
    await seed({ doc, page: 10, pageStart: templateAnchored ? 10 : null, chunk: 4, content: ref });
    await seed({ doc, page: 17, pageStart: warningAnchored ? 17 : null, chunk: warningAnchored ? 17 : 99, content: warning, pageLabel: "17" });
    for (let i = 0; i < 5; i++) await seed({ doc, page: 30 + i, chunk: 60 + i, content: `Filler page ${30 + i}.` });
    const template = { docId: doc, sourceUrl: `hub://${doc}/m.pdf`, content: ref, sourcePage: 10, chunkIndex: 4, pageAnchored: templateAnchored, pageTrust: "trusted", pageLabel: "10", title: "m.pdf", manufacturer: "", modelNumber: "", rank: 0 } as ManualChunk;
    const out = await retrieveSafetyChapterChunks(client, CALLER, [template], { approvedSourceDocIds: [doc] });
    return { out, doc, template };
  }
  it("anchored template, UNANCHORED ordinal warning (page 17 == chunk 17): the warning page is withheld", async () => {
    const doc = D(20);
    await seed({ doc, page: 10, pageStart: 10, chunk: 4, content: ref });
    await seed({ doc, page: 17, pageStart: null, chunk: 17, content: warning, pageLabel: "17" });
    for (let i = 0; i < 5; i++) await seed({ doc, page: 30 + i, chunk: 60 + i, content: `Filler page ${30 + i}.` });
    const template = { docId: doc, sourceUrl: `hub://${doc}/m.pdf`, content: ref, sourcePage: 10, chunkIndex: 4, pageAnchored: true, pageTrust: "trusted", pageLabel: "10", title: "m.pdf", manufacturer: "", modelNumber: "", rank: 0 } as ManualChunk;
    const out = await retrieveSafetyChapterChunks(client, CALLER, [template], { approvedSourceDocIds: [doc] });
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe(warning);
    expect(out[0]).toMatchObject({ sourcePage: 17, chunkIndex: 17, pageAnchored: false });
    expect(displayPage(out[0])).toBeNull();
    expect(chunksToSources(out)[0].page).toBeNull();
    // not eligible for the cited-page warning reread as "page 17"
    expect(citedPagesFor([{ citationId: "1", docId: doc, sourceTitle: "m.pdf", page: null }], out)).toEqual([]);
  });
  it("UNANCHORED template, genuinely ANCHORED warning (page_start 17): the warning keeps page 17 and is reread-eligible", async () => {
    const { out, doc } = await probe(1, false, true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourcePage: 17, chunkIndex: 17, pageAnchored: true, pageTrust: "trusted" });
    expect(displayPage(out[0])).toBe(17);
    expect(chunksToSources(out)[0].page).toBe(17);
    expect(citedPagesFor([{ citationId: "1", docId: doc, sourceTitle: "m.pdf", page: 17 }], out)).toEqual([{ docId: doc, sourceUrl: `hub://${doc}/m.pdf`, page: 17 }]);
  });
  it("unanchored template and unanchored valid-page warning: the ACTUAL document verdict (diverse) shows the page", async () => {
    const { out } = await probe(2, false, false);
    expect(out[0]).toMatchObject({ sourcePage: 17, pageAnchored: false, pageTrust: "trusted" });
    expect(displayPage(out[0])).toBe(17);
  });
  it("unanchored warning in an ALL-ONE-PAGE document (verdict unknown): the page is withheld even though it is not an ordinal", async () => {
    const doc = D(30);
    await seed({ doc, page: 17, chunk: 3, content: ref });
    await seed({ doc, page: 17, chunk: 40, content: warning, pageLabel: "17" });
    // every row of this document is stamped page 17 (one distinct page, no anchor): the document verdict is unknown
    const template = { docId: doc, sourceUrl: `hub://${doc}/m.pdf`, content: ref, sourcePage: 17, chunkIndex: 3, pageAnchored: false, pageTrust: "unknown", title: "m.pdf", manufacturer: "", modelNumber: "", rank: 0 } as ManualChunk;
    for (let i = 0; i < 4; i++) await seed({ doc, page: 17, chunk: 70 + i, content: `Same-page filler ${i}.` });
    const out = await retrieveSafetyChapterChunks(client, CALLER, [template], { approvedSourceDocIds: [doc] });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toMatchObject({ pageAnchored: false, pageTrust: "unknown" });
    expect(displayPage(out[0])).toBeNull();
  });
  it("control: anchored template and anchored warning render page 17 without any document read", async () => {
    const { out } = await probe(3, true, true);
    expect(displayPage(out[0])).toBe(17);
  });
});
