/**
 * Model scope fails closed (#5503), over the actual upload writer and the actual retrieval SQL.
 *
 * The captured Micro820 2080-IN009 pages 16-20 are a pinned file whose pages are NOT recorded as
 * reviewed, so the real gate must store their text withheld: a record holding a catalog number
 * gets none of their model-scoped passages, and the refusal names the page. The control re-runs
 * the same upload with the gate open (what a reviewed page stores) and shows the passages that
 * the gate is holding back are really there to be held back.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { retrieveNodeChunks } from "../manual-rag";
import fixture from "../../capabilities/__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import { excludedTablesRefusalText } from "@/capabilities/manual-applicability";
import { withheld, type ScopedRow } from "@/capabilities/model-scope-gate";

vi.hoisted(() => {
  process.env.NODE_EMBED_ON_WRITE = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
});
const db = vi.hoisted(() => ({ client: null as PoolClient | null, gateOpen: false }));
vi.mock("@/capabilities/model-scope-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/model-scope-gate")>();
  return { ...actual, gatePageRows: <Row extends Parameters<typeof actual.gatePageRows>[0][number]>(rows: readonly Row[], reviewed: string | null | undefined, held?: string | null) =>
    (db.gateOpen ? [...rows] : actual.gatePageRows(rows, reviewed, held)) };
});
// "These bytes are that manual": the page gets its source file's REAL pin, by real fingerprint.
vi.mock("@/capabilities/table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/table-rule-pins")>();
  const { pinsDouble } = await import("../../capabilities/__fixtures__/pinned-rules-double");
  return { ...actual, rulePinsForSha: () => pinsDouble(actual, fixture.pages, [fixture.sha256]) };
});
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    getPage: async (page: number) => ({
      getTextContent: async () => ({ items: (fixture.pages.find((p) => p.page === page)?.items ?? []).map((i) => ({ str: i.str, width: i.w, transform: [i.size, 0, 0, i.size, i.x, i.y] })) }),
      cleanup: () => true,
    }),
  })),
  extractText: vi.fn(async () => ({ text: Array.from({ length: 20 }, (_, i) => fixture.pages.find((p) => p.page === i + 1)?.text ?? "") })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenant: string, fn: (client: PoolClient) => Promise<unknown>) => fn(db.client!)),
}));

const TENANT = "55030000-0000-4000-8000-0000000000a1";
const DOCUMENT = "55030000-0000-4000-8000-0000000000a2";
const NODE = "55030000-0000-4000-8000-0000000000a3";
const RELAY = /Relay Contact Ratings|Relay Output Specifications|Maximum switching time|10,000,000 cycles|columns read from the page layout/;
let pool: Pool;
let client: PoolClient;

async function upload(gateOpen: boolean) {
  db.gateOpen = gateOpen;
  await client.query("DELETE FROM knowledge_entries WHERE tenant_id = $1", [TENANT]);
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode({ tenantId: TENANT, uploadId: DOCUMENT, nodeId: NODE, unsPath: null,
    filename: fixture.source, buffer: Buffer.from("%PDF source-bound fixture proxy") });
}
async function retrieve(model: string, question: string) {
  const diagnostics: { excludedTables?: Array<{ page: number | null; models: string[]; section?: true; unqualified?: true }> } = {};
  const chunks = await retrieveNodeChunks(client, TENANT, question, {
    nodeId: NODE, unsPath: null, docIds: [DOCUMENT], validatedDocScope: true, topK: 100,
    identity: { manufacturer: "Allen-Bradley", model: "Micro820" }, identityStatus: "user_confirmed",
    catalogNumber: `2080-LC20-${model}`, diagnostics,
  });
  return { chunks, diagnostics, text: chunks.map((c) => c.content).join("\n") };
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("A confirmed disposable TEST_DATABASE_URL is required");
  }
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 2000 });
  client = await pool.connect();
  db.client = client;
  await client.query("BEGIN");
  await client.query(`CREATE TEMP TABLE knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
    source_type text, content text NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    manufacturer text NOT NULL DEFAULT '', model_number text NOT NULL DEFAULT '',
    source_url text NOT NULL, source_page integer, doc_id uuid, ingest_route text,
    page_start integer, page_end integer, section_path text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, verified boolean NOT NULL DEFAULT true,
    is_private boolean NOT NULL DEFAULT true
  ) ON COMMIT DROP`);
  await client.query(`CREATE UNIQUE INDEX gate_temp_chunk_unique ON knowledge_entries
    (tenant_id, source_url, ((metadata->>'chunk_index')::int))
    WHERE (metadata->>'chunk_index') IS NOT NULL`);
});

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  db.client = null;
  if (pool) await pool.end();
});

describe("control: the same upload with the gate open (what a reviewed page would store)", () => {
  it("affirms model scope on these pages and gives 20QWB its relay ratings", async () => {
    await upload(true);
    const affirming = await client.query(`SELECT count(*)::int AS n FROM knowledge_entries WHERE tenant_id = $1
      AND (metadata->>'table_scope' IN ('section', 'shared') OR (metadata ? 'table_models' AND NOT metadata ? 'table_unqualified' AND NOT metadata ? 'table_scope'))`, [TENANT]);
    expect(affirming.rows[0].n).toBeGreaterThan(0);
    const qwb = await retrieve("20QWB", "relay contact ratings 120 V AC");
    expect(qwb.text).toMatch(RELAY);
  });
});

describe("the real gate: pages that are not reviewed affirm no model, over SQL", () => {
  beforeAll(async () => { await upload(false); });
  it("stores every page's text, and no row affirms a model", async () => {
    const all = await client.query(`SELECT metadata FROM knowledge_entries WHERE tenant_id = $1`, [TENANT]);
    expect(all.rows.length).toBeGreaterThan(0);
    const affirming = all.rows.filter(({ metadata: m }) => m.table_scope === "section" || m.table_scope === "shared" ||
      (Array.isArray(m.table_models) && m.table_models.length > 0 && m.table_unqualified !== true && m.table_scope === undefined));
    expect(affirming).toEqual([]);
  });
  for (const model of ["20QBB", "20QWB", "20AWB"]) {
    it(`${model} gets none of the relay passages, and the refusal names their pages`, async () => {
      const result = await retrieve(model, "relay contact ratings 120 V AC");
      expect(result.text).not.toMatch(RELAY);
      const pages = new Set((result.diagnostics.excludedTables ?? []).map((e) => e.page));
      expect(pages.has(18) || pages.has(19)).toBe(true);
      const withheldHere = (result.diagnostics.excludedTables ?? []).filter((e) => e.page === 19 || e.page === 18);
      const refusal = excludedTablesRefusalText(`2080-LC20-${model}`, withheldHere);
      expect(refusal).toMatch(/could not read which models/i);
      expect(refusal).toMatch(/pages? (?:\d+, )*1[89]\b/);
      expect(refusal).not.toMatch(/15 A|1\.5 A|safe to/i);
    });
  }
  it("20QBB is not given the DC-output passage either: nothing on these pages is model-specific until reviewed", async () => {
    const result = await retrieve("20QBB", "DC output specifications surge current per point");
    expect(result.text).not.toMatch(/Surge current per point/);
  });
});

describe("withholding never admits more than the row it replaces, over SQL", () => {
  // A shared-header passage: its header prints the whole family, its body is one sibling's. The
  // shared reading judges the body alone, so the 20QWB record is refused it. Withholding must not
  // turn it into untagged text, which would be judged by the header and admitted.
  const header = "Shared table: 2080-LC20-20QWB 2080-LC20-20QBB 2080-LC20-20AWB";
  const row: ScopedRow = { content: `${header}\nzzsharedprobe 2080-LC20-20QBB sourcing output leakage 0.1 mA`, tableScope: "shared", tableHeader: header };
  const admitted = async (r: ScopedRow, model: string) => {
    await client.query("DELETE FROM knowledge_entries WHERE tenant_id = $1 AND content LIKE '%zzsharedprobe%'", [TENANT]);
    // The probe is a copy of a real stored row of this upload (same columns the writer sets),
    // with only its text and model-scope fields replaced.
    const scope = { ...(r.tableModels ? { table_models: r.tableModels } : {}), ...(r.tableUnqualified ? { table_unqualified: true } : {}),
      ...(r.tableScope ? { table_scope: r.tableScope } : {}), ...(r.tableHeader ? { table_header: r.tableHeader } : {}), chunk_index: 9000 };
    const inserted = await client.query(`INSERT INTO knowledge_entries
        (tenant_id, source_type, content, source_url, source_page, doc_id, ingest_route, page_start, page_end, metadata, is_private)
      SELECT tenant_id, source_type, $2, source_url, source_page, doc_id, ingest_route, page_start, page_end,
        (metadata - 'table_models' - 'table_unqualified' - 'table_scope' - 'table_header' - 'chunk_index') || $3::jsonb, is_private
      FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $4 AND page_start = 20 ORDER BY (metadata->>'chunk_index')::int LIMIT 1`,
    [TENANT, r.content, JSON.stringify(scope), DOCUMENT]);
    expect(inserted.rowCount).toBe(1);
    return (await retrieve(model, "zzsharedprobe sourcing output leakage")).text.includes("zzsharedprobe");
  };
  // The manual itself is the real upload (gate closed); the probe passage is stored beside it.
  beforeAll(async () => { await upload(false); });
  it("the shared reading refuses 20QWB and admits 20QBB (the precondition)", async () => {
    expect(await admitted(row, "20QWB")).toBe(false);
    expect(await admitted(row, "20QBB")).toBe(true);
  });
  for (const model of ["20QWB", "20QBB", "20AWB"]) {
    it(`withheld, it is admitted for ${model} only if the shared row was`, async () => {
      const before = await admitted(row, model);
      const after = await admitted(withheld(row), model);
      expect(after && !before).toBe(false);
      expect(after).toBe(false);
    });
  }
});
