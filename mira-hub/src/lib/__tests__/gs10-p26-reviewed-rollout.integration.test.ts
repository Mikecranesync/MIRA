// GS10 page 26 reviewed pin (#5232, PR #5646): what happens to rows ALREADY STORED when the
// approval is added (rollout) or removed (rollback). Real disposable Postgres, the real writer,
// the real reprocessor, the real retrieval SQL, the real page reader and gate.
//
// Release: the gate stamps every row it releases with the reviewed digest it was released under
// (`metadata.table_reviewed`). Rows written before the approval carry no release, so rollout still
// needs a forced, scoped reprocess (`scripts/reprocess-node-doc.ts --force`) of the uploads that
// own chunks of an approved file: an ordinary reprocess is a no-op at the same extraction version.
//
// Withdrawal does not depend on the original file or its hash. Every answer query admits a stamped
// row only while the shipped pin of its file and page still carries its digest with the approval
// switch enabled (`activeReleaseSql`), so setting `release` to "disabled" removes every released
// row from every route at once, with no reprocess and no bytes. The stamp also makes the released
// rows directly queryable: it is the fence that must read zero before a build without the guard
// may serve.
//
// Only the PDF boundary is simulated (captured page 26 and 27 text items). The stub bytes stand
// for the approved file: the pin lookup translates their hash to the approved file's REAL
// page-keyed pin map, so page binding is exercised as shipped. `pins.reverted` stands for a build
// whose pin file has the approval switch disabled.
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
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9"; // asset enrichment's embedder is unreachable: its text search runs
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool,
    BYTES: Buffer.from("%PDF-1.4 stub bytes standing for the approved GS10 file"),
    BYTES_B: Buffer.from("%PDF-1.4 stub bytes standing for the second approved GS10 file"),
    // `reverted`: the approval switch of the stub file's page 26 is set to "disabled" (the supported
    // rollback; the record itself stays). `lateWriter`: a process of the previous build that still
    // has the approval enabled and commits after the switch is off for readers.
    // `sqlGuardOff`: the SQL release guard admits everything, so the per-row check in admit() is
    // the only thing between a revoked row and an answer (it must hold on its own).
    pins: { reverted: false, revertedB: false, lateWriter: false, sqlGuardOff: false },
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
  // One lookup serves the reader: the read check (`isReleaseActive`) and the SQL guard
  // (`activeReleaseSql`) both see the switch exactly as an edited pin file would set it. The writer
  // uses the same lookup, except as a late writer of the previous build (`lateWriter`).
  // The switch state is set here, not inherited from the shipped file, so this suite holds whether
  // the shipped approval is enabled or has been switched off for a rollback.
  const withRelease = (sha: string, release: "enabled" | "disabled") =>
    Object.fromEntries(Object.entries(actual.rulePinsForSha(sha)!).map(([page, pin]) => [page, pin.reviewed ? { ...pin, release } : pin]));
  const forReaders = (sha: string) => {
    if (!Object.hasOwn(stubs, sha)) return actual.rulePinsForSha(sha);
    const [realSha, reverted] = stubs[sha];
    return withRelease(realSha, reverted() ? "disabled" : "enabled");
  };
  const forWriter = (sha: string) => {
    if (!pins.lateWriter || !Object.hasOwn(stubs, sha)) return forReaders(sha);
    return withRelease(stubs[sha][0], "enabled"); // the previous build: approval still enabled
  };
  const documents = () => ({ ...actual.allRulePins(), ...Object.fromEntries(Object.keys(stubs).map((sha) => [sha, forReaders(sha)!])) });
  return {
    ...actual,
    rulePinsForSha: forWriter,
    isReleaseActive: (sha: unknown, page: unknown, digest: unknown) => actual.isReleaseActive(sha, page, digest, forReaders),
    activeReleaseSql: (alias = "") => (pins.sqlGuardOff ? "TRUE" : actual.activeReleaseSql(alias, documents())),
  };
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
import { retrieveCitedPageChunks, retrieveManualChunks, retrieveNodeChunks } from "@/lib/manual-rag";
import { searchKB } from "@/lib/agents/asset-intelligence";

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
/** Namespace document chat (mira-hub/src/app/api/namespace/node/[id]/chat/route.ts): the opened
 *  document, no catalog number, no identity. Round 4 F1: this route served withdrawn rows. */
async function docChat(docId: string, question = "GS11N-20P2 rated input current 5.1 A") {
  const node = (await testPool.query<{ n: string }>("SELECT kg_entity_id::text AS n FROM hub_uploads WHERE id = $1::uuid", [docId])).rows[0].n;
  return retrieveNodeChunks(client, TENANT, question, { nodeId: node, unsPath: null, docId, approvedSourceDocIds: [docId] });
}
/** The manual-library search hub ask and asset chat run when no maker is named (tenant fallback). */
async function library() {
  return retrieveManualChunks(client, TENANT, "GS11N-20P2 Rated Input Current", { topK: 50 });
}
/** Stored hold marks of one upload. */
async function storedMeta(docId: string) {
  return (await testPool.query<{ page: number; content: string; held: string | null; heldSha: string | null }>(
    `SELECT source_page AS page, content, metadata->>'table_held' AS held, metadata->>'table_held_sha' AS "heldSha"
       FROM knowledge_entries WHERE doc_id = $1::uuid AND tenant_id = $2::uuid ORDER BY source_page, (metadata->>'chunk_index')::int`,
    [docId, TENANT])).rows;
}
const heldOn = (rows: Array<{ page: number; held: string | null }>, page: number) => rows.filter((r) => r.page === page && r.held !== null).length;
/** The chunks of one upload (node document source URLs carry the upload id). */
const ofDoc = <T extends { sourceUrl?: string | null }>(docId: string, chunks: T[]) => chunks.filter((c) => (c.sourceUrl ?? "").includes(docId));
/** Any chunk that would carry a withdrawn value into an answer. */
const carries51 = (chunks: Array<{ content: string }>) => chunks.filter((c) => c.content.includes("5.1 A"));
/** The rollback fence for retiring the read check: rows still carrying a release stamp. */
const STAMPED_SQL = `SELECT count(*)::int AS n FROM knowledge_entries k
 WHERE k.source_type = 'node_attachment' AND k.metadata->>'table_reviewed' IS NOT NULL
   AND k.tenant_id = '<tenant uuid>'::uuid`;
async function stampedCount(docId?: string): Promise<number> {
  const sql = fill(STAMPED_SQL) + (docId ? ` AND k.doc_id = '${docId}'::uuid` : "");
  return (await testPool.query<{ n: number }>(sql)).rows[0].n;
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

    // With the switch off, no route serves it, though the original is gone.
    expect(carries51(await docChat(doc)).length).toBeGreaterThan(0); // precondition: the route finds it while enabled
    pins.reverted = true;
    expect(carries51(await docChat(doc))).toEqual([]);
    // Retiring the read check is fenced on zero stamped rows. This upload cannot be re-written, so
    // its rows keep their stamps and the fence stays closed: a build without the check must not ship.
    expect(await stampedCount(doc)).toBe(10);
    const after = await stored(doc);
    expect(stampedOn(after, 26)).toBe(10); // the stamp is kept as the record of what was withdrawn
    expect(after.some((r) => r.content.includes(LINE_5_1))).toBe(true); // historical text kept
    pins.reverted = false;
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
  it("universal revocation: a disabled approval removes its rows from document chat, model-specific chat and cited-page reads (#5646 r4 F1)", async () => {
    pins.reverted = false; pins.lateWriter = false;
    const doc = await newUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("reprocessed");
    // Released: every route finds page 26 (so the withdrawal below is not vacuous).
    expect(carries51(await docChat(doc)).length).toBeGreaterThan(0);
    expect(carries51(ofDoc(doc, await library())).length).toBeGreaterThan(0);
    // Asset enrichment reads at most 5 rows tenant-wide, so it gets a tenant of its own holding a
    // copy of exactly this upload's stamped GS11N-20P2 row.
    const enrichTenant = randomUUID();
    await testPool.query(
      `INSERT INTO knowledge_entries (id, tenant_id, doc_id, content, source_type, source_url, source_page, page_start, page_end, metadata, is_private, verified, ingest_route)
       SELECT gen_random_uuid(), $2::uuid, doc_id, content, source_type, source_url, source_page, page_start, page_end, metadata, is_private, verified, ingest_route
         FROM knowledge_entries WHERE tenant_id = $1::uuid AND doc_id = $3::uuid AND content LIKE '%' || $4 || '%'`,
      [TENANT, enrichTenant, doc, LINE_5_1]);
    const enrich = () => searchKB(enrichTenant, "GS11N-20P2 Rated Input Current");
    expect(carries51(ofDoc(doc, await enrich())).length).toBeGreaterThan(0);
    expect((await ask(doc, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);
    // The cited-page read returns only warning text, which page 26 has none of: a stamped copy of the
    // 5.1 A row that carries a warning word stands for such a line, so that read is tested too.
    await testPool.query(
      `INSERT INTO knowledge_entries (id, tenant_id, doc_id, content, source_type, source_url, source_page, page_start, page_end, metadata, is_private, verified, ingest_route)
       SELECT gen_random_uuid(), tenant_id, doc_id, 'WARNING: ' || content, source_type, source_url, source_page, page_start, page_end, jsonb_set(metadata, '{chunk_index}', '9999'), is_private, verified, ingest_route
         FROM knowledge_entries WHERE tenant_id = $1::uuid AND doc_id = $2::uuid AND content LIKE '%' || $3 || '%' AND metadata->>'table_reviewed' IS NOT NULL LIMIT 1`,
      [TENANT, doc, LINE_5_1]);
    const sourceUrl = (await testPool.query<{ u: string }>("SELECT source_url AS u FROM knowledge_entries WHERE doc_id = $1::uuid LIMIT 1", [doc])).rows[0].u;
    const citedRead = () => retrieveCitedPageChunks(client, TENANT, [{ docId: doc, sourceUrl, page: 26 }], { keep: () => true });
    expect(carries51(await citedRead()).length).toBeGreaterThan(0);
    const before = await stored(doc);
    const page26 = before.filter((r) => r.page === 26);

    pins.reverted = true; // the switch is turned off; nothing else changes
    expect(carries51(await docChat(doc))).toEqual([]); // no catalog number: the route round 4 found
    expect(carries51(await docChat(doc, "what is the rated input current on page 26"))).toEqual([]);
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    expect(carries51((await ask(doc, "GS11N-20P2")).chunks)).toEqual([]);
    expect(carries51(await citedRead())).toEqual([]); // safety statements from a cited page
    // Tenant-wide routes also see other uploads of this tenant (withheld, unstamped rows from the
    // other tests are main's baseline), so these are held to this upload's own rows.
    expect(carries51(ofDoc(doc, await library()))).toEqual([]); // hub ask / asset chat: the library search, no maker named
    expect(carries51(ofDoc(doc, await enrich()))).toEqual([]); // asset enrichment
    // Historical evidence is kept as it was: the rows, their text and their stamps.
    expect(await stored(doc)).toEqual(before);
    expect(page26.some((r) => r.content.includes(LINE_5_1))).toBe(true);

    // Second layer: with the SQL guard admitting everything, the node routes still drop the rows.
    pins.sqlGuardOff = true;
    try {
      expect(carries51(await docChat(doc))).toEqual([]);
      expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    } finally {
      pins.sqlGuardOff = false;
    }

    pins.reverted = false; // enabled again: the same rows answer again, without a reprocess
    expect(carries51(await docChat(doc)).length).toBeGreaterThan(0);
    expect(carries51(ofDoc(doc, await library())).length).toBeGreaterThan(0);
    expect(carries51(ofDoc(doc, await enrich())).length).toBeGreaterThan(0);
    expect(carries51(await citedRead()).length).toBeGreaterThan(0);
    // page 26 again (the warning copy above is a second page 26 line)
    expect(new Set((await ask(doc, "GS11N-20P2")).cites51.map((c) => c.sourcePage))).toEqual(new Set([26]));
    await testPool.query("DELETE FROM knowledge_entries WHERE tenant_id = $1::uuid", [enrichTenant]);
  });

  it("in-flight indexing: a late writer of the previous build commits released rows after the switch is off, and no route serves them", async () => {
    pins.reverted = true; pins.lateWriter = true; // readers: disabled. writer: the previous build.
    const doc = await newUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("reprocessed");
    expect(stampedOn(await stored(doc), 26)).toBe(10); // the late write did land released, stamped rows
    pins.lateWriter = false;
    expect(carries51(await docChat(doc))).toEqual([]);
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    // The fence finds them, and a forced reprocess under the disabled build clears them.
    expect(await stampedCount(doc)).toBe(10);
    expect(await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES, force: true }))
      .toMatchObject({ action: "reprocessed" });
    expect(await stampedCount(doc)).toBe(0);
    // Re-indexed while the approval is off: every page 26 row is held, so no route serves it.
    expect(heldOn(await storedMeta(doc), 26)).toBeGreaterThan(0);
    expect(carries51(await docChat(doc))).toEqual([]);
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    pins.reverted = false;
  });

  it("indexed while the approval is off: a fresh upload's page 26 answers nowhere, with or without its file, until the approval is on (#5646 r4)", async () => {
    pins.reverted = true; pins.lateWriter = false;
    const doc = await newUpload();
    expect((await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES })).action).toBe("reprocessed");
    const meta = await storedMeta(doc);
    expect(stampedOn(await stored(doc), 26)).toBe(0); // nothing released
    const page26 = meta.filter((r) => r.page === 26);
    expect(page26.length).toBeGreaterThan(0);
    expect(page26.every((r) => r.held === APPROVED_DIGEST && r.heldSha === SHA)).toBe(true); // every row of the page, bound to its file
    expect(meta.filter((r) => r.page !== 26).some((r) => r.held !== null)).toBe(false); // and no other page
    expect(page26.some((r) => r.content.includes(LINE_5_1))).toBe(true); // the text itself is kept
    expect(carries51(await docChat(doc))).toEqual([]);
    expect(carries51(await docChat(doc, "what is the rated input current on page 26"))).toEqual([]);
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    expect(carries51(ofDoc(doc, await library()))).toEqual([]);
    // Enabled again: the held rows are served as unreviewed text (as on main), never as a release.
    pins.reverted = false;
    expect(carries51(await docChat(doc)).length).toBeGreaterThan(0);
    expect((await ask(doc, "GS11N-20P2")).cites51).toEqual([]);
    expect(await reprocessNodeDocument({ tenantId: TENANT, uploadId: doc, bytes: BYTES, force: true })).toMatchObject({ action: "reprocessed" });
    expect((await ask(doc, "GS11N-20P2")).cites51.map((c) => c.sourcePage)).toEqual([26]);
  });
});
