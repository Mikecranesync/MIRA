// GS10 page 26 reviewed pin (#5232, PR #5646): what happens to rows ALREADY STORED when the
// approval is added (rollout) or removed (rollback). Real disposable Postgres, the real writer,
// the real reprocessor, the real retrieval SQL, the real page reader and gate.
//
// The admission decision is persisted in chunk metadata at write time and retrieval reads only
// that metadata. So adding or removing the reviewed digest changes NOTHING for stored rows until
// the upload is re-written: an ordinary reprocess is a no-op (the extraction version did not
// change), and a forced, scoped reprocess (`scripts/reprocess-node-doc.ts --force`) re-writes the
// rows under the pins of the running build. This file proves both directions on one upload id.
//
// Only the PDF boundary is simulated (captured page 26 and 27 text items). The stub bytes stand
// for the approved file: the pin lookup translates their hash to the approved file's REAL
// page-keyed pin map, so page binding is exercised as shipped. `pins.reverted` stands for a build
// without this PR's reviewed digest.
//
// Requires (local/disposable only — never staging/prod):
//   TEST_DATABASE_URL      postgres
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
// Schema: `node scripts/setup-integration-db.mjs`, plus 045/068/072 and 003's dedup index here.
// Run: npx vitest run --config vitest.integration.config.ts src/lib/__tests__/gs10-p26-reviewed-rollout.integration.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");

const { testPool, BYTES, pins } = vi.hoisted(() => {
  process.env.NODE_EMBED_ON_WRITE = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool,
    BYTES: Buffer.from("%PDF-1.4 stub bytes standing for the approved GS10 file"),
    pins: { reverted: false },
  };
});
const APPROVED_SHA = "090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4";

vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/capabilities/table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/table-rule-pins")>();
  const stub = (await import("node:crypto")).createHash("sha256").update(BYTES).digest("hex");
  return { ...actual, rulePinsForSha: (sha: string) => {
    if (sha !== stub) return actual.rulePinsForSha(sha);
    const real = actual.rulePinsForSha(APPROVED_SHA)!;
    if (!pins.reverted) return real;
    return Object.fromEntries(Object.entries(real).map(([page, pin]) => {
      const reverted = { ...pin };
      delete reverted.reviewed;
      return [page, reverted];
    }));
  } };
});
vi.mock("unpdf", async () => {
  const { textContentItem } = await import("@/capabilities/__fixtures__/text-content-item");
  const p26 = (await import("@/capabilities/__fixtures__/table-rows/gs10-p26-230v-1ph.json")).default;
  const p27 = (await import("@/capabilities/__fixtures__/table-rows/gs10-p27-230v-3ph.json")).default;
  const pages: Record<number, { text: string; items: typeof p26.items }> = { 26: p26, 27: p27 as never };
  return {
    getDocumentProxy: vi.fn(async () => ({
      getPage: async (n: number) => ({
        getTextContent: async () => ({ items: (pages[n]?.items ?? []).map((i) => textContentItem(i)) }),
        cleanup: () => true,
      }),
    })),
    extractText: vi.fn(async () => ({ text: Array.from({ length: 27 }, (_, i) => pages[i + 1]?.text ?? "") })),
  };
});
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));

import { reprocessNodeDocument } from "@/lib/node-knowledge-ingest";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const TENANT = randomUUID();
const NODE = randomUUID();
const FILENAME = "gs10usermanual.pdf";
const SHA = createHash("sha256").update(BYTES).digest("hex");
const LINE_5_1 = "GS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A";
const hubRoot = path.resolve(__dirname, "..", "..", "..");
let client: PoolClient;

async function newUpload(): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO hub_uploads
       (tenant_id, provider, filename, status, kb_chunk_count, kind, kg_entity_id, uns_path, ingest_route, content_sha256)
     VALUES ($1, 'local', $2, 'parsed', 0, 'document', $3, NULL, 'v2', $4)
     RETURNING id::text AS id`,
    [TENANT, FILENAME, NODE, SHA],
  );
  return rows[0].id;
}
/** Model-specific retrieval for one GS10 model, as a notebook bound to that catalog number asks. */
async function ask(docId: string, catalog: string) {
  const diagnostics: { excludedTables?: Array<{ page: number | null; models: string[]; unqualified?: true }> } = {};
  const chunks = await retrieveNodeChunks(client, TENANT, `${catalog} rated input current`, {
    nodeId: NODE, unsPath: null, docIds: [docId], validatedDocScope: true, topK: 100,
    identity: { manufacturer: "AutomationDirect", model: "GS10" }, identityStatus: "user_confirmed",
    catalogNumber: catalog, diagnostics,
  });
  const cites51 = chunks.filter((c) => c.content.includes(LINE_5_1));
  return { chunks, cites51, diagnostics };
}
async function stored(docId: string) {
  const { rows } = await testPool.query<{ content: string; page: number; meta: Record<string, unknown> }>(
    `SELECT content, source_page AS page, metadata AS meta FROM knowledge_entries
      WHERE tenant_id = $1::uuid AND doc_id = $2::uuid ORDER BY (metadata->>'chunk_index')::int`, [TENANT, docId]);
  return rows;
}
const releasedOn = (rows: Awaited<ReturnType<typeof stored>>, page: number) =>
  rows.filter((r) => r.page === page && (r.meta.table_models as string[] | undefined)?.length === 1 && r.meta.table_unqualified !== true).length;

describe.skipIf(!READY)("GS10 page 26 reviewed pin: stored rows on rollout and rollback (real Postgres)", () => {
  beforeAll(async () => {
    for (const f of ["045_knowledge_entries_chunk_anchors.sql", "068_hub_uploads.sql", "072_hub_uploads_content_sha256.sql"]) {
      await testPool.query(fs.readFileSync(path.join(hubRoot, "db", "migrations", f), "utf8"));
    }
    await testPool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_chunk_dedup
         ON knowledge_entries (tenant_id, source_url, ((metadata->>'chunk_index')::int))
         WHERE (metadata->>'chunk_index') IS NOT NULL`,
    );
    // Retrieval's lexical pass reads the generated tsvector the production table carries; the
    // integration fixture table lacks it. Additive, and idempotent on a reused disposable DB.
    await testPool.query(
      `ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS content_tsv tsvector
         GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`,
    );
    client = await testPool.connect();
  });
  afterAll(async () => {
    client?.release();
    await testPool.query("DELETE FROM knowledge_entries WHERE tenant_id = $1::uuid", [TENANT]);
    await testPool.query("DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid", [TENANT]);
    await testPool.query("DELETE FROM hub_uploads WHERE tenant_id = $1", [TENANT]);
    await testPool.end();
  });

  it("rollback: a reverted build leaves stored page 26 rows released until a forced reprocess re-writes them", async () => {
    pins.reverted = false;
    const doc = await newUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("reprocessed");
    // Released under the approved pins: 5.1 A answers GS11N-20P2 from page 26, and not a sibling.
    const own = await ask(doc, "GS11N-20P2");
    expect(own.cites51.map((c) => c.sourcePage)).toEqual([26]);
    expect((await ask(doc, "GS11N-20P5")).cites51).toEqual([]);
    expect(releasedOn(await stored(doc), 26)).toBe(10);
    expect(releasedOn(await stored(doc), 27)).toBe(0); // page 27 is not reviewed

    pins.reverted = true; // the build without the reviewed digest
    // The hazard: nothing re-reads the pins for stored rows. Same rows, still released.
    expect((await ask(doc, "GS11N-20P2")).cites51).toHaveLength(1);
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("noop");
    expect((await ask(doc, "GS11N-20P2")).cites51).toHaveLength(1);
    // The declared rollback step: a forced, scoped reprocess of this upload.
    const r = await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES, force: true });
    expect(r).toMatchObject({ action: "reprocessed", reason: "recomputed_human_requested" });
    const after = await ask(doc, "GS11N-20P2");
    expect(after.cites51).toEqual([]);
    expect(releasedOn(await stored(doc), 26)).toBe(0);
    expect((await stored(doc)).some((row) => row.content.includes("Rated Input Current"))).toBe(true); // text kept, withheld
  });

  it("rollout: an upload stored before this build stays withheld until a forced reprocess re-writes it", async () => {
    pins.reverted = true; // the base build
    const doc = await newUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("reprocessed");
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    expect(releasedOn(await stored(doc), 26)).toBe(0);

    pins.reverted = false; // this build
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("noop");
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]); // the gap: still withheld
    const r = await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES, force: true });
    expect(r).toMatchObject({ action: "reprocessed", reason: "recomputed_human_requested" });
    const own = await ask(doc, "GS11N-20P2");
    expect(own.cites51.map((c) => c.sourcePage)).toEqual([26]);
    expect((await ask(doc, "GS11N-20P5")).cites51).toEqual([]);
    expect(releasedOn(await stored(doc), 26)).toBe(10);
    expect(releasedOn(await stored(doc), 27)).toBe(0);
  });
});
