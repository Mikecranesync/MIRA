/** #5503: the upload's real INSERT and raw retrieval SQL on a confirmed disposable PG.
 * Source PDF decoding is a portable unpdf text/layout proxy bound to the retained PDF hash.
 * No search rows are scripted; all tables are connection-local TEMP tables rolled back.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import fixture from "../__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import { COLUMN_LINE_MARK } from "../contact-ratings-table";
import { excludedTablesRefusalText } from "../manual-applicability";
import { retrieveNodeChunks } from "@/lib/manual-rag";

vi.hoisted(() => {
  process.env.NODE_EMBED_ON_WRITE = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
});
const db = vi.hoisted(() => ({ client: null as PoolClient | null, failLayoutPage: null as number | null }));
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    getPage: async (page: number) => ({
      getTextContent: async () => {
        if (db.failLayoutPage === page) throw new Error("simulated page layout read failure");
        return { items: (fixture.pages.find((p) => p.page === page)?.items ?? []).map((i) => ({
          str: i.str, width: i.w, transform: [i.size, 0, 0, i.size, i.x, i.y],
        })) };
      },
      cleanup: () => true,
    }),
  })),
  extractText: vi.fn(async () => ({ text: Array.from({ length: 20 }, (_, i) => fixture.pages.find((p) => p.page === i + 1)?.text ?? "") })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenant: string, fn: (client: PoolClient) => Promise<unknown>) => fn(db.client!)),
}));

const TENANT = "55030000-0000-4000-8000-000000000001";
const OTHER_TENANT = "55030000-0000-4000-8000-000000000002";
const DOCUMENT = "55030000-0000-4000-8000-000000000010";
const NODE = "55030000-0000-4000-8000-000000000020";
let pool: Pool;
let client: PoolClient;

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
  await client.query(`CREATE UNIQUE INDEX f31_temp_chunk_unique ON knowledge_entries
    (tenant_id, source_url, ((metadata->>'chunk_index')::int))
    WHERE (metadata->>'chunk_index') IS NOT NULL`);
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode({ tenantId: TENANT, uploadId: DOCUMENT, nodeId: NODE, unsPath: null,
    filename: fixture.source, buffer: Buffer.from("%PDF source-bound fixture proxy") });
  // Same document/node identifiers on another tenant must not supply either a hit
  // or the header from which the current tenant's manual applicability is judged.
  await client.query(`INSERT INTO knowledge_entries
    (tenant_id, content, source_url, doc_id, ingest_route, page_start, metadata, is_private)
    VALUES ($1, 'foreignscope sentinel Micro810 relay contact ratings switching time analog output DC input surge current',
      'node-doc/foreign/manual.pdf', $2, 'v2', 1, $3::jsonb, true)`,
  [OTHER_TENANT, DOCUMENT, JSON.stringify({ node_id: NODE, filename: fixture.source })]);
});

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  db.client = null;
  if (pool) await pool.end();
});

async function retrieve(model: string, question: string) {
  const diagnostics: { excludedTables?: Array<{ page: number | null; models: string[]; section?: true; unqualified?: true }> } = {};
  const chunks = await retrieveNodeChunks(client, TENANT, question, {
    nodeId: NODE, unsPath: null, docIds: [DOCUMENT], validatedDocScope: true, topK: 100,
    identity: { manufacturer: "Allen-Bradley", model: "Micro820" }, identityStatus: "user_confirmed",
    catalogNumber: `2080-LC20-${model}`, diagnostics,
  });
  return { chunks, diagnostics, text: chunks.map((c) => c.content).join("\n") };
}

describe("#5503 actual upload INSERT through raw retrieval SQL", () => {
  it("the actual writer persists separated sections and #5487 lines with model scope", async () => {
    const result = await client.query(`SELECT content, page_start, metadata FROM knowledge_entries
      WHERE tenant_id = $1 AND page_start IN (18, 19)`, [TENANT]);
    const rows = result.rows.filter((r) => /Relay Output Specifications|Relay Contact Ratings|columns read from the page layout/.test(r.content));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.content.includes(COLUMN_LINE_MARK))).toBe(true);
    for (const row of rows) {
      expect(row.metadata.table_models).toEqual(expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]));
      expect(row.metadata.table_scope).toBe("section");
      expect(row.content).not.toMatch(/Analog Output Specifications|DC Input Specifications|DC Output Specifications/);
    }
  });
  it("QBB receives no relay-only rows or contact-rating columns and SQL reports their source pages", async () => {
    const contact = await retrieve("20QBB", "relay contact ratings 120 V AC");
    const output = await retrieve("20QBB", "relay output specifications switching time mechanical life");
    for (const result of [contact, output]) {
      expect(result.text).not.toMatch(/Relay Contact Ratings|Relay Output Specifications|Maximum switching time|10,000,000 cycles|columns read from the page layout/);
    }
    expect(contact.diagnostics.excludedTables).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 19, section: true, models: expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]) }),
    ]));
    expect(output.diagnostics.excludedTables).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 18, section: true, models: expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]) }),
    ]));
  });
  for (const model of ["20QWB", "20AWB"]) {
    it(`${model} retains valid relay output and contact-rating evidence through actual SQL`, async () => {
      const contact = await retrieve(model, "relay contact ratings 120 V AC");
      const output = await retrieve(model, "relay output specifications switching time mechanical life");
      expect(contact.text).toContain(`${COLUMN_LINE_MARK}120 V AC row: make 15 A, break 1.5 A, continuous 2 A.`);
      expect(output.text).toContain("Maximum switching time");
      expect(output.text).toContain("10,000,000 cycles");
    });
  }
  for (const model of ["20QBB", "20QWB", "20AWB"]) {
    it(`${model} keeps shared analog-output evidence through actual SQL`, async () => {
      const result = await retrieve(model, "analog output voltage range");
      const analog = result.chunks.find((c) => /Analog Output Specifications/.test(c.content));
      expect(analog?.content).toContain("Output count range");
      expect(analog?.content).toContain("Channel-to-channel isolation");
      expect(analog?.content).not.toMatch(/Relay Contact Ratings|columns read from the page layout/);
    });
    it(`${model} keeps shared DC-input evidence despite sibling names in a subcolumn`, async () => {
      const result = await retrieve(model, "DC input specifications voltage category IEC compatibility");
      const input = result.chunks.find((c) => /DC Input Specifications/.test(c.content));
      expect(input?.content).toContain("IEC input compatibility");
      expect(input?.content).not.toMatch(/Relay Output Specifications|Maximum switching time/);
    });
  }
  it("DC-output evidence is available for QBB and excluded for QWB/AWB over SQL", async () => {
    const own = await retrieve("20QBB", "DC output specifications surge current per point");
    expect(own.text).toContain("DC Output Specifications");
    expect(own.text).toContain("Surge current per point");
    for (const model of ["20QWB", "20AWB"]) {
      const other = await retrieve(model, "DC output specifications surge current per point");
      expect(other.text).not.toMatch(/DC Output Specifications|Surge current per point/);
    }
  });
  it("a parser layout failure withholds the mixed page over SQL until readable page20 restores QBB scope", async () => {
    await client.query("SAVEPOINT f31_layout_failure");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await client.query("DELETE FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $2", [TENANT, DOCUMENT]);
      const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
      db.failLayoutPage = 19;
      try {
        await writePdfChunksForNode({ tenantId: TENANT, uploadId: DOCUMENT, nodeId: NODE, unsPath: null,
          filename: fixture.source, buffer: Buffer.from("%PDF source-bound fixture proxy") });
      } finally { db.failLayoutPage = null; }
      const unresolved = await client.query(`SELECT metadata FROM knowledge_entries
        WHERE tenant_id = $1 AND doc_id = $2 AND page_start = 19`, [TENANT, DOCUMENT]);
      expect(unresolved.rows.length).toBeGreaterThan(0);
      expect(unresolved.rows.every((r) => r.metadata.table_unqualified === true && r.metadata.table_scope === "unresolved")).toBe(true);
      for (const model of ["20QBB", "20QWB", "20AWB"]) {
        for (const question of ["relay contact ratings 120 V AC", "DC output specifications surge current per point"]) {
          const result = await retrieve(model, question);
          expect(result.chunks.some((c) => c.sourcePage === 19)).toBe(false);
          const failedPage = (result.diagnostics.excludedTables ?? []).filter((e) => e.page === 19);
          expect(failedPage).toEqual(expect.arrayContaining([
            expect.objectContaining({ section: true, unqualified: true }),
          ]));
          const refusal = excludedTablesRefusalText(`2080-LC20-${model}`, failedPage);
          expect(refusal).toMatch(/could not read which models/i);
          expect(refusal).toContain("page 19");
          expect(refusal).not.toMatch(/another model.s column|read the .* column|15 A|interposing|safe to/i);
        }
      }
      const recovered = await retrieve("20QBB", "DC output specifications resistive load");
      expect(recovered.chunks.some((c) => c.sourcePage === 20 && c.content.includes("DC Output Specifications"))).toBe(true);
    } finally {
      db.failLayoutPage = null;
      warning.mockRestore();
      await client.query("ROLLBACK TO SAVEPOINT f31_layout_failure");
      await client.query("RELEASE SAVEPOINT f31_layout_failure");
    }
  });
  it("a foreign tenant cannot contribute matching passages or its earlier document heading", async () => {
    for (const model of ["20QBB", "20QWB", "20AWB"]) {
      const result = await retrieve(model, "foreignscope sentinel analog output relay contact ratings");
      expect(result.text).not.toContain("foreignscope sentinel");
      expect(result.chunks.length).toBeGreaterThan(0);
    }
  });
});
