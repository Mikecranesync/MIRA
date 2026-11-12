// Garage pilot PR-6 — `reprocessNodeDocument` against a REAL disposable Postgres.
//
// The unit test scripts the pool and proves the statement order; this proves
// the database agrees: the partial unique index (tenant_id, source_url,
// chunk_index) + `ON CONFLICT … DO NOTHING` is live, so "insert the new rows,
// then delete the old" would have dropped EVERY new row — the reason the swap
// is delete-then-insert in one transaction. After the swap exactly the new rows
// remain, every one stamped with the current extraction_version, is_private,
// and the second run is a no-op.
//
// The PDF parse is mocked (two pages of text): the parse path is covered by the
// upload suites; this file is about the rows. The embed pass runs with the kill
// switch OFF (`NODE_EMBED_ON_WRITE=0`) because the integration fixture has no
// `embedding` column (no pgvector on the local Postgres); the awaited-embed
// behaviour is proven by the unit test.
//
// Requires (local/disposable only — never staging/prod):
//   TEST_DATABASE_URL      postgres
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
// Schema: `node scripts/setup-integration-db.mjs` (fixture + default migrations incl. 045/068/072),
// plus 003's chunk-dedup index, applied here in beforeAll.
// Run: npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/node-document-reprocess.integration.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";

const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");

const { testPool, PAGES } = vi.hoisted(() => {
  // The kill switch is read once at module load; set it before the ingest module imports.
  process.env.NODE_EMBED_ON_WRITE = "0";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool,
    PAGES: [
      "GS10 Series AC Drive User Manual. Chapter 1: Getting Started. Read all safety warnings before installing the drive.",
      "Specifications. Rated input current is listed per model in the table on the next page. Frame A drives weigh 1.2 kg.",
    ],
  };
});

vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ text: [...PAGES] })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
vi.mock("@/capabilities/pdf-layout-items", () => ({ pageLayoutItems: vi.fn(async () => []) }));

import { EXTRACTION_VERSION, reprocessNodeDocument } from "@/lib/node-knowledge-ingest";

const TENANT = randomUUID();
const NODE = randomUUID();
const FILENAME = "gs10usermanual.pdf";
const LOCAL_PDF = Buffer.from("%PDF-1.4 the uploaded bytes (parse is mocked)");
const SHA = createHash("sha256").update(LOCAL_PDF).digest("hex");
const hubRoot = path.resolve(__dirname, "..", "..", "..");
const OLD_ROWS = 12;

let docId = "";
const sourceUrl = () => `node-doc/${docId}/${FILENAME}`;

async function versionReadBack(): Promise<{ n: number; version: number | null; old: number }> {
  // The same shape listSources reports (its SQL is pinned by the unit test).
  const { rows } = await testPool.query<{ n: number; version: number | null; old: number }>(
    `SELECT count(*)::int AS n,
            (CASE WHEN count(*) FILTER (WHERE metadata->>'extraction_version' IS NULL) > 0 THEN NULL
                  ELSE min((metadata->>'extraction_version')::int) END)::int AS version,
            count(*) FILTER (WHERE content LIKE 'old flat row %')::int AS old
       FROM knowledge_entries
      WHERE tenant_id = $1::uuid AND doc_id = $2::uuid AND source_type = 'node_attachment'`,
    [TENANT, docId],
  );
  return { n: Number(rows[0].n), version: rows[0].version == null ? null : Number(rows[0].version), old: Number(rows[0].old) };
}

describe.skipIf(!READY)("reprocessNodeDocument swaps a stored document's chunks (real Postgres)", () => {
  beforeAll(async () => {
    for (const f of ["045_knowledge_entries_chunk_anchors.sql", "068_hub_uploads.sql", "072_hub_uploads_content_sha256.sql"]) {
      await testPool.query(fs.readFileSync(path.join(hubRoot, "db", "migrations", f), "utf8"));
    }
    // 003's chunk-dedup index — the target of the writer's ON CONFLICT clause.
    await testPool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_chunk_dedup
         ON knowledge_entries (tenant_id, source_url, ((metadata->>'chunk_index')::int))
         WHERE (metadata->>'chunk_index') IS NOT NULL`,
    );
    const { rows } = await testPool.query<{ id: string }>(
      `INSERT INTO hub_uploads
         (tenant_id, provider, filename, status, kb_chunk_count, kind, kg_entity_id, uns_path, ingest_route, content_sha256)
       VALUES ($1, 'local', $2, 'parsed', $3, 'document', $4, 'enterprise.garage.demo_cell.cv_101', 'v2', $5)
       RETURNING id::text AS id`,
      [TENANT, FILENAME, OLD_ROWS, NODE, SHA],
    );
    docId = rows[0].id;
    // Twelve pre-PR-1 flat rows: no extraction_version, chunk_index 0..11.
    for (let i = 0; i < OLD_ROWS; i++) {
      await testPool.query(
        `INSERT INTO knowledge_entries
           (id, tenant_id, source_type, content, source_url, source_page, doc_id, ingest_route, page_start, page_end, metadata, is_private)
         VALUES ($1, $2::uuid, 'node_attachment', $3, $4, $5, $6::uuid, 'v2', $5, $5, $7::jsonb, true)`,
        [randomUUID(), TENANT, `old flat row ${i}`, sourceUrl(), 1 + (i % 3), docId, JSON.stringify({ filename: FILENAME, node_id: NODE, chunk_index: i, source: "hub_node_attachment" })],
      );
    }
  });
  afterAll(async () => {
    await testPool.query("DELETE FROM knowledge_entries WHERE tenant_id = $1::uuid", [TENANT]);
    await testPool.query("DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid", [TENANT]);
    await testPool.query("DELETE FROM hub_uploads WHERE tenant_id = $1", [TENANT]);
    await testPool.end();
  });

  it("precondition: with the old rows present, the writer's INSERT collides on chunk_index and inserts NOTHING (why delete comes first)", async () => {
    expect(await versionReadBack()).toEqual({ n: OLD_ROWS, version: null, old: OLD_ROWS });
    const res = await testPool.query(
      `INSERT INTO knowledge_entries
         (id, tenant_id, source_type, content, source_url, source_page, doc_id, ingest_route, page_start, page_end, metadata, is_private)
       VALUES ($1, $2::uuid, 'node_attachment', 'a new row under the old plan', $3, 1, $4::uuid, 'v2', 1, 1, $5::jsonb, true)
       ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))
         WHERE (metadata->>'chunk_index') IS NOT NULL
         DO NOTHING`,
      [randomUUID(), TENANT, sourceUrl(), docId, JSON.stringify({ chunk_index: 0, extraction_version: EXTRACTION_VERSION })],
    );
    expect(res.rowCount).toBe(0);
    expect(await versionReadBack()).toEqual({ n: OLD_ROWS, version: null, old: OLD_ROWS });
  });

  it("reprocess: exactly the new rows remain, every one at the current version, private, with distinct chunk indexes", async () => {
    const r = await reprocessNodeDocument({ tenantId: TENANT, uploadId: docId, bytes: LOCAL_PDF });
    expect(r.action).toBe("reprocessed");
    if (r.action !== "reprocessed") return;
    expect(r).toMatchObject({ reason: "recomputed_algorithm_changed", from: null, to: EXTRACTION_VERSION, deleted: OLD_ROWS });
    expect(r.inserted).toBe(PAGES.length); // each mocked page is under one chunk window
    expect(r.embed).toEqual({ embedded: 0, state: "disabled", permanent: false });

    expect(await versionReadBack()).toEqual({ n: r.inserted, version: EXTRACTION_VERSION, old: 0 });
    const { rows } = await testPool.query<{ content: string; idx: number; is_private: boolean; page: number }>(
      `SELECT content, (metadata->>'chunk_index')::int AS idx, is_private, source_page AS page
         FROM knowledge_entries
        WHERE tenant_id = $1::uuid AND doc_id = $2::uuid
        ORDER BY (metadata->>'chunk_index')::int`,
      [TENANT, docId],
    );
    expect(rows.map((x) => x.idx)).toEqual([0, 1]);
    expect(rows.map((x) => x.page)).toEqual([1, 2]);
    expect(rows.every((x) => x.is_private)).toBe(true);
    expect(rows[0].content).toContain("Chapter 1: Getting Started");
    expect(rows[1].content).toContain("Rated input current");

    const up = await testPool.query<{ kb_chunk_count: number; status: string }>(
      "SELECT kb_chunk_count, status FROM hub_uploads WHERE id = $1::uuid AND tenant_id = $2",
      [docId, TENANT],
    );
    expect(up.rows[0]).toEqual({ kb_chunk_count: r.inserted, status: "parsed" });
  });

  it("second run: a no-op that reports the same count and changes nothing", async () => {
    const before = await versionReadBack();
    expect(await reprocessNodeDocument({ tenantId: TENANT, uploadId: docId, bytes: LOCAL_PDF })).toEqual({
      action: "noop",
      version: EXTRACTION_VERSION,
      chunkCount: before.n,
    });
    expect(await versionReadBack()).toEqual(before);
  });

  it("parked original: with no local bytes the stored copy in namespace_direct_uploads is read under the tenant role (RLS + grant live) and reprocessed", async () => {
    // The parked copy the Hub keeps (migration 059: content BYTEA, upload_id -> hub_uploads.id), read
    // through withTenantContext -> SET LOCAL ROLE factorylm_app, so a missing GRANT or a mis-cast RLS
    // policy on the real table would surface here, not on staging.
    await testPool.query(
      `INSERT INTO namespace_direct_uploads (tenant_id, node_id, filename, mime_type, size_bytes, source, upload_id, content)
       VALUES ($1::uuid, NULL, $2, 'application/pdf', $3, 'user_upload', $4::uuid, $5)`,
      [TENANT, FILENAME, LOCAL_PDF.length, docId, LOCAL_PDF],
    );
    // Precondition: every row is already current, so only a forced run may touch them.
    expect((await versionReadBack()).version).toBe(EXTRACTION_VERSION);
    expect(await reprocessNodeDocument({ tenantId: TENANT, uploadId: docId })).toMatchObject({ action: "noop" });

    expect(await reprocessNodeDocument({ tenantId: TENANT, uploadId: docId, force: true, dryRun: true })).toMatchObject({
      action: "plan",
      reason: "recomputed_human_requested",
      bytesFrom: "parked_original",
    });
    const r = await reprocessNodeDocument({ tenantId: TENANT, uploadId: docId, force: true });
    expect(r).toMatchObject({
      action: "reprocessed",
      reason: "recomputed_human_requested",
      from: EXTRACTION_VERSION,
      to: EXTRACTION_VERSION,
      deleted: PAGES.length,
      inserted: PAGES.length,
    });
    expect(await versionReadBack()).toEqual({ n: PAGES.length, version: EXTRACTION_VERSION, old: 0 });
  });

  it("another tenant's id for the same upload is refused before anything is read", async () => {
    expect(await reprocessNodeDocument({ tenantId: randomUUID(), uploadId: docId, bytes: LOCAL_PDF })).toEqual({ action: "refused", reason: "no_upload" });
  });
});
