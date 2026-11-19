// GS10 page 26 reviewed pin (#5232, PR #5646): what happens to rows ALREADY STORED when the
// approval is added (rollout) or removed (rollback). Real disposable Postgres, the real writer,
// the real reprocessor, the real retrieval SQL, the real page reader and gate.
//
// Release: the gate stamps every row it releases with the reviewed digest it was released under
// (`metadata.table_reviewed`). Rows written before the approval carry no release, so rollout still
// needs a forced, scoped reprocess (`scripts/reprocess-node-doc.ts --force`) of the uploads that
// own chunks of an approved file: an ordinary reprocess is a no-op at the same extraction version.
//
// Withdrawal does not depend on the original file or its hash. Retrieval honours a stamped row
// only while the shipped pins still carry its digest, so removing the approval from
// `table-rule-pins.json` withholds every released row at once, with no reprocess and no bytes.
// The stamp also makes the released rows directly queryable, which is the withdrawal path if the
// whole PR (and with it that read check) is ever reverted.
//
// Only the PDF boundary is simulated (captured page 26 and 27 text items). The stub bytes stand
// for the approved file: the pin lookup translates their hash to the approved file's REAL
// page-keyed pin map, so page binding is exercised as shipped. `pins.reverted` stands for a build
// whose pin file no longer carries this PR's reviewed digest.
//
// Requires (local/disposable only — never staging/prod):
//   TEST_DATABASE_URL      postgres
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
// Schema: `node scripts/setup-integration-db.mjs`, plus 045/068/072/077 and 003's dedup index here.
// Run: npx vitest run --config vitest.integration.config.ts src/lib/__tests__/gs10-p26-reviewed-rollout.integration.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");

const { testPool, BYTES, BYTES_B, pins } = vi.hoisted(() => {
  process.env.NODE_EMBED_ON_WRITE = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool,
    BYTES: Buffer.from("%PDF-1.4 stub bytes standing for the approved GS10 file"),
    BYTES_B: Buffer.from("%PDF-1.4 stub bytes standing for the second approved GS10 file"),
    pins: { reverted: false, revertedB: false },
  };
});
const { APPROVED_SHA, SECOND_SHA } = vi.hoisted(() => ({
  APPROVED_SHA: "090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4",
  SECOND_SHA: "90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab",
}));
const APPROVED_DIGEST = "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5";

vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/capabilities/table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/table-rule-pins")>();
  const { createHash: hash } = await import("node:crypto");
  const stubs: Record<string, [string, () => boolean]> = {
    [hash("sha256").update(BYTES).digest("hex")]: [APPROVED_SHA, () => pins.reverted],
    [hash("sha256").update(BYTES_B).digest("hex")]: [SECOND_SHA, () => pins.revertedB],
  };
  // One lookup serves the writer AND the read check (`isReleaseActive` calls it), so a reverted
  // file is reverted for both, exactly as an edited pin file would be.
  const rulePinsForSha = (sha: string) => {
    if (!Object.hasOwn(stubs, sha)) return actual.rulePinsForSha(sha);
    const [realSha, reverted] = stubs[sha];
    const real = actual.rulePinsForSha(realSha)!;
    if (!reverted()) return real;
    return Object.fromEntries(Object.entries(real).map(([page, pin]) => {
      const without = { ...pin };
      delete without.reviewed;
      return [page, without];
    }));
  };
  return { ...actual, rulePinsForSha, isReleaseActive: (sha: unknown, page: unknown, digest: unknown) => actual.isReleaseActive(sha, page, digest, rulePinsForSha) };
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
import { linkFileToUpload, parkOrReuseFile } from "@/lib/workspace-files";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const TENANT = randomUUID();
const NODE = randomUUID();
const FILENAME = "gs10usermanual.pdf";
const SHA = createHash("sha256").update(BYTES).digest("hex");
const LINE_5_1 = "GS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A";
const hubRoot = path.resolve(__dirname, "..", "..", "..");
let client: PoolClient;

async function newUpload(bytes: Buffer = BYTES): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO hub_uploads
       (tenant_id, provider, filename, status, kb_chunk_count, kind, kg_entity_id, uns_path, ingest_route, content_sha256)
     VALUES ($1, 'local', $2, 'parsed', 0, 'document', $3, NULL, 'v2', $4)
     RETURNING id::text AS id`,
    [TENANT, FILENAME, NODE, createHash("sha256").update(bytes).digest("hex")],
  );
  return rows[0].id;
}
/** The Files and manual-discovery routes record no hash on the upload row; the parked
 *  canonical file carries it. Same shape as those routes: park the bytes, record the upload
 *  with a null hash, link the file to it. */
async function newParkedUpload(): Promise<string> {
  const node = randomUUID(); // the upload's node (hub_uploads.kg_entity_id); the legacy filing column stays null
  const park = await parkOrReuseFile({ tenantId: TENANT, nodeId: null, filename: FILENAME,
    mimeType: "application/pdf", sizeBytes: BYTES.length, buffer: BYTES });
  expect(park.reused).toBe(false);
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO hub_uploads
       (tenant_id, provider, filename, status, kb_chunk_count, kind, kg_entity_id, uns_path, ingest_route, content_sha256)
     VALUES ($1, 'local', $2, 'parsed', 0, 'document', $3, NULL, 'v2', NULL)
     RETURNING id::text AS id`,
    [TENANT, FILENAME, node],
  );
  expect(await linkFileToUpload(TENANT, park.fileId, rows[0].id)).toBe(true);
  return rows[0].id;
}
const fill = (sql: string) => sql.replaceAll("<tenant uuid>", TENANT).replaceAll("<sha a>", SHA)
  .replaceAll("<sha b>", SECOND_SHA).replaceAll("<digest>", APPROVED_DIGEST);

/** The ROLLOUT inventory from the PR body (the stub bytes' hash stands in for the first approved
 *  hash): every upload of the tenant whose upload row OR linked canonical file carries one of the
 *  two approved hashes AND that owns node chunks of its own. A record that owns no chunks (a
 *  duplicate upload of the same bytes) is never listed, so a forced pass over the list cannot
 *  index it. hub_uploads.tenant_id is TEXT, so the joins cast the UUID side to text. */
const INVENTORY_SQL = `SELECT u.tenant_id, u.id::text AS upload_id
  FROM hub_uploads u
  LEFT JOIN namespace_direct_uploads d ON d.upload_id = u.id AND d.tenant_id::text = u.tenant_id
 WHERE (u.content_sha256 IN ('<sha a>', '<sha b>')
        OR d.content_sha256 IN ('<sha a>', '<sha b>'))
   AND EXISTS (SELECT 1 FROM knowledge_entries k
                WHERE k.doc_id = u.id AND k.tenant_id::text = u.tenant_id
                  AND k.source_type = 'node_attachment' AND k.ingest_route = 'v2')
   AND u.tenant_id = '<tenant uuid>'`;
/** The WITHDRAWAL inventory from the PR body: the released rows themselves, by their stamp. It
 *  needs no hash and no file. */
const RELEASED_SQL = `SELECT k.tenant_id::text AS tenant_id, k.doc_id::text AS upload_id, count(*)::int AS released
  FROM knowledge_entries k
 WHERE k.source_type = 'node_attachment'
   AND k.metadata->>'table_reviewed' = '<digest>'
   AND k.tenant_id = '<tenant uuid>'::uuid
 GROUP BY 1, 2`;
/** The PR body's withdrawal statement for a build that no longer has the read check (a full
 *  revert of this PR): withhold the stamped rows in place, keeping their text and their stamp. */
const WITHDRAW_SQL = `UPDATE knowledge_entries k
   SET metadata = (k.metadata - 'table_header') || '{"table_scope": "unresolved", "table_unqualified": true}'::jsonb
 WHERE k.source_type = 'node_attachment'
   AND k.metadata->>'table_reviewed' = '<digest>'
   AND k.tenant_id = '<tenant uuid>'::uuid`;

async function inventory(): Promise<string[]> {
  return (await testPool.query<{ upload_id: string }>(fill(INVENTORY_SQL))).rows.map((r) => r.upload_id).sort();
}
async function releasedRows(): Promise<Record<string, number>> {
  const { rows } = await testPool.query<{ upload_id: string; released: number }>(fill(RELEASED_SQL));
  return Object.fromEntries(rows.map((r) => [r.upload_id, r.released]));
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
const stampedOn = (rows: Awaited<ReturnType<typeof stored>>, page: number) =>
  rows.filter((r) => r.page === page && r.meta.table_reviewed === APPROVED_DIGEST).length;
const stamps = (rows: Awaited<ReturnType<typeof stored>>) => rows.filter((r) => r.meta.table_reviewed !== undefined).length;

describe.skipIf(!READY)("GS10 page 26 reviewed pin: stored rows on rollout and withdrawal (real Postgres)", () => {
  beforeAll(async () => {
    for (const f of ["045_knowledge_entries_chunk_anchors.sql", "068_hub_uploads.sql", "072_hub_uploads_content_sha256.sql", "077_ingest_claim.sql"]) {
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

  it("withdrawal: removing the approval withholds stored page 26 rows at once, with no reprocess, and restoring it releases them again", async () => {
    pins.reverted = false;
    const doc = await newUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("reprocessed");
    // Released under the approved pins: 5.1 A answers GS11N-20P2 from page 26, and not a sibling.
    const own = await ask(doc, "GS11N-20P2");
    expect(own.cites51.map((c) => c.sourcePage)).toEqual([26]);
    expect((await ask(doc, "GS11N-20P5")).cites51).toEqual([]);
    const before = await stored(doc);
    expect(releasedOn(before, 26)).toBe(10);
    expect(releasedOn(before, 27)).toBe(0); // page 27 is not reviewed
    // Every released row, and only those, carries the digest it was released under.
    expect(stampedOn(before, 26)).toBe(10);
    expect(stamps(before)).toBe(10);

    pins.reverted = true; // the approval is removed from the pin file
    const withdrawn = await ask(doc, "GS11N-20P2");
    expect(withdrawn.cites51).toEqual([]);
    expect(withdrawn.diagnostics.excludedTables?.some((t) => t.page === 26 && t.unqualified === true)).toBe(true);
    expect((await ask(doc, "GS11N-20P5")).cites51).toEqual([]);
    // No reprocess was needed, and none changes anything: the stored rows are untouched.
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("noop");
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    expect(await stored(doc)).toEqual(before);

    pins.reverted = false; // repeatable: restoring the approval releases the same rows again
    expect((await ask(doc, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);
    pins.reverted = true;
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    pins.reverted = false;
  });

  it("withdrawal is per file: removing the approval for one approved file withholds that file's rows only", async () => {
    pins.reverted = false; pins.revertedB = false;
    const a = await newUpload(BYTES);
    const b = await newUpload(BYTES_B);
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: a, bytes: BYTES })).action).toBe("reprocessed");
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: b, bytes: BYTES_B })).action).toBe("reprocessed");
    const shaA = createHash("sha256").update(BYTES).digest("hex");
    const shaB = createHash("sha256").update(BYTES_B).digest("hex");
    // Same reviewed digest on both files, each row bound to the file it was read from.
    expect((await stored(a)).filter((r) => r.meta.table_reviewed === APPROVED_DIGEST).map((r) => r.meta.table_reviewed_sha)).toEqual(Array(10).fill(shaA));
    expect((await stored(b)).filter((r) => r.meta.table_reviewed === APPROVED_DIGEST).map((r) => r.meta.table_reviewed_sha)).toEqual(Array(10).fill(shaB));
    expect((await ask(a, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);
    expect((await ask(b, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);

    pins.revertedB = true; // the second file's approval is removed; the first file's stays
    expect((await ask(b, "GS11N-20P2")).cites51).toEqual([]);
    expect((await ask(a, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);
    pins.revertedB = false;
  });

  it("withdrawal needs no original: a null-hash upload whose parked file is gone is found by its rows and withheld", async () => {
    await testPool.query("DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid", [TENANT]);
    pins.reverted = false;
    const doc = await newParkedUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc })).action).toBe("reprocessed");
    expect((await ask(doc, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);

    // The original is deleted while the source is still in use: no hash anywhere, no bytes.
    await testPool.query("DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid AND upload_id = $2::uuid", [TENANT, doc]);
    const row = await testPool.query("SELECT 1 FROM hub_uploads WHERE id = $1::uuid AND content_sha256 IS NULL", [doc]);
    expect(row.rowCount).toBe(1);
    expect(await inventory()).not.toContain(doc); // a hash-based selector cannot find it any more
    expect(await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, force: true }))
      .toEqual({ action: "refused", reason: "no_bytes" }); // and a forced reprocess cannot re-write it
    expect((await ask(doc, "GS11N-20P2")).cites51).toHaveLength(1); // still released at this point

    // The released rows are found by their stamp, with no hash and no file.
    expect((await releasedRows())[doc]).toBe(10);

    pins.reverted = true; // route 1: remove the approval from the pin file
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    pins.reverted = false;
    expect((await ask(doc, "GS11N-20P2")).cites51).toHaveLength(1);

    // Route 2, for a build that no longer has the read check: withhold the stamped rows in place.
    const updated = await testPool.query(fill(WITHDRAW_SQL).replace("AND k.tenant_id", `AND k.doc_id = '${doc}'::uuid AND k.tenant_id`));
    expect(updated.rowCount).toBe(10);
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]); // withheld even with the approval live
    const after = await stored(doc);
    expect(releasedOn(after, 26)).toBe(0);
    expect(stampedOn(after, 26)).toBe(10); // the stamp is kept as the record of what was withdrawn
    expect(after.some((r) => r.content.includes(LINE_5_1))).toBe(true); // text kept, withheld
  });

  it("rollout: an upload stored before this build stays withheld until a forced reprocess re-writes it", async () => {
    pins.reverted = true; // the base build
    const doc = await newUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("reprocessed");
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    expect(releasedOn(await stored(doc), 26)).toBe(0);
    expect(stamps(await stored(doc))).toBe(0);

    pins.reverted = false; // this build
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("noop");
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]); // the gap: still withheld
    const r = await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES, force: true });
    expect(r).toMatchObject({ action: "reprocessed", reason: "recomputed_human_requested" });
    const own = await ask(doc, "GS11N-20P2");
    expect(own.cites51.map((c) => c.sourcePage)).toEqual([26]);
    expect((await ask(doc, "GS11N-20P5")).cites51).toEqual([]);
    const rows = await stored(doc);
    expect(releasedOn(rows, 26)).toBe(10);
    expect(releasedOn(rows, 27)).toBe(0);
    expect(stampedOn(rows, 26)).toBe(10);
    expect(stamps(rows)).toBe(10);
  });

  it("inventory: an upload with no hash on its row is found through its parked file, and the forced reprocess uses the parked bytes", async () => {
    await testPool.query("DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid", [TENANT]);
    pins.reverted = true; // indexed before this build
    const doc = await newParkedUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc })).action).toBe("reprocessed");
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    expect(await inventory()).toContain(doc);
    // The row-hash-only selector Codex found would miss it.
    const rowOnly = await testPool.query("SELECT 1 FROM hub_uploads WHERE id = $1::uuid AND content_sha256 IS NOT NULL", [doc]);
    expect(rowOnly.rowCount).toBe(0);

    pins.reverted = false; // rollout: no local PDF is supplied, the parked original is used
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc })).action).toBe("noop");
    expect(await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, force: true }))
      .toMatchObject({ action: "reprocessed", reason: "recomputed_human_requested" });
    expect((await ask(doc, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);
  });

  it("inventory: a duplicate upload record of the same bytes that owns no chunks is not listed, so a forced pass gives it nothing", async () => {
    await testPool.query("DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid", [TENANT]);
    pins.reverted = true;
    const doc = await newUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("reprocessed");
    const duplicate = await newUpload(); // same tenant, same bytes, never indexed
    expect(await stored(duplicate)).toHaveLength(0);
    const hashMatches = await testPool.query("SELECT 1 FROM hub_uploads WHERE id = $1::uuid AND content_sha256 = $2", [duplicate, SHA]);
    expect(hashMatches.rowCount).toBe(1); // a hash-only selector would list it

    pins.reverted = false;
    const listed = await inventory();
    expect(listed).toContain(doc);
    expect(listed).not.toContain(duplicate);
    for (const id of listed) await reprocessNodeDocument({ tenantId: TENANT, uploadId: id, bytes: BYTES, force: true });
    expect(await stored(duplicate)).toHaveLength(0);
    expect((await ask(doc, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);
  });

  it("reuse: attaching the same bytes to another node of the same tenant returns the old upload, still withheld until it is reprocessed", async () => {
    await testPool.query("DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid", [TENANT]);
    pins.reverted = true; // indexed before this build
    const doc = await newParkedUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc })).action).toBe("reprocessed");
    pins.reverted = false; // this build
    const again = await parkOrReuseFile({ tenantId: TENANT, nodeId: null, filename: "copy.pdf",
      mimeType: "application/pdf", sizeBytes: BYTES.length, buffer: BYTES });
    expect(again).toMatchObject({ reused: true, uploadId: doc }); // no new upload, no new chunks
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    expect(await inventory()).toContain(doc);
    await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, force: true });
    expect((await ask(doc, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);
  });
});
