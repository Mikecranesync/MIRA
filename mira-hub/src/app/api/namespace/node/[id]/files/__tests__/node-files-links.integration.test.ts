// Issue #3396 — a file filed through workspace_file_links is invisible in the
// node's Files panel.
//
// Requires a disposable Postgres. From mira-hub/ (PowerShell):
//
//   docker run -d --name mira3396-pg -e POSTGRES_PASSWORD=testpw `
//     -e POSTGRES_DB=mira_test -p 5599:5432 postgres:16
//   $env:TEST_DATABASE_URL="postgres://postgres:testpw@127.0.0.1:5599/mira_test"
//   $env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   $env:MIRA_INTEGRATION_MIGRATIONS="001_knowledge_graph.sql,010_kg_uns_path.sql,` +
//     "026_kg_entities_dedupe_and_constraint.sql,027_namespace_direct_uploads.sql," +
//     "059_namespace_filing_cabinet.sql,068_hub_uploads.sql," +
//     "072_hub_uploads_content_sha256.sql,073_equipment_notebooks.sql," +
//     "075_workspace_file_links.sql,076_namespace_uploads_source_reconcile.sql," +
//     "077_ingest_claim.sql,082_namespace_uploads_node_nullable.sql"
//   npm run db:integration:setup   # smoke-checks unrelated suites; the schema
//                                  # this file needs is applied before that
//   npx vitest run --config vitest.integration.config.ts "src/app/api/namespace/node/[id]/files"
//
// NOTE: CI does not currently run mira-hub's vitest integration suite, so this
// file is a local/manual proof. The CI-gating guard for the same defect is the
// "reads workspace_file_links" case in the sibling route.test.ts.
//
// WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST.
// The sibling route.test.ts mocks `withTenantContext` to resolve straight to a
// finished array, so the GET's actual SQL never runs. That is precisely why this
// defect shipped and stayed live for six days behind a green unit suite. The
// test that catches it has to execute the real query, inside the real
// `SET LOCAL ROLE factorylm_app` + RLS transaction the route actually runs in —
// the same lesson as the 23505 episode, where an autocommit connection turned a
// fatal bug into a green check.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Pool } from "pg";
import { createHash } from "node:crypto";

const { testPool } = vi.hoisted(() => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("This suite requires TEST_DATABASE_URL and MIRA_TEST_DB_CONFIRM=DISPOSABLE");
  }
  const target = new URL(databaseUrl);
  if (/prod|prd|staging/i.test(`${target.hostname} ${target.pathname}`)) {
    throw new Error("Refusing a production/staging integration database");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    throw new Error("This destructive integration suite requires a loopback disposable database");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: databaseUrl }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
// Keep PDF parsing/provider calls out of this database/RLS integration suite.
vi.mock("@/lib/node-knowledge-ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/node-knowledge-ingest")>();
  return {
    ingestPdfToNode: vi.fn(),
    ingestTextToNode: vi.fn(),
    deleteOrphanNodeIngest: actual.deleteOrphanNodeIngest,
  };
});

import { GET, POST } from "../route";
import { POST as uploadFile } from "@/app/api/files/route";
import { ingestPdfToNode, deleteOrphanNodeIngest } from "@/lib/node-knowledge-ingest";
import { createUpload, updateUploadStatus, findDuplicateUpload, getUpload } from "@/lib/uploads";
import { parkOrReuseFile, claimIngest, linkFileToUpload, releaseIngestClaim } from "@/lib/workspace-files";
import { sessionOr401 } from "@/lib/session";

const TENANT = "3f000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "3f000000-0000-4000-8000-0000000000ff";

let nodeA = "";
let nodeB = "";
let otherTenantNode = "";
let disposableVerified = false;

const session = (tenantId: string) => ({
  userId: "3f000000-0000-4000-8000-000000000099",
  tenantId,
  email: "itest@example.com",
  status: "trial",
  trialExpiresAt: null,
});

async function makeNode(tenantId: string, name: string): Promise<string> {
  const r = await testPool.query<{ id: string }>(
    `INSERT INTO kg_entities (tenant_id, entity_type, name)
     VALUES ($1::uuid, 'namespace_node', $2) RETURNING id::text AS id`,
    [tenantId, name],
  );
  return r.rows[0].id;
}

/** Park a canonical file. A null nodeId models the /api/files door (mig 082). */
async function parkFile(
  tenantId: string,
  filename: string,
  nodeId: string | null,
): Promise<string> {
  const r = await testPool.query<{ id: string }>(
    `INSERT INTO namespace_direct_uploads
        (tenant_id, node_id, filename, mime_type, size_bytes, content, source)
     VALUES ($1::uuid, $2::uuid, $3, 'application/pdf', 1024, decode('00', 'hex'), 'user_upload')
     RETURNING id::text AS id`,
    [tenantId, nodeId, filename],
  );
  return r.rows[0].id;
}

async function link(tenantId: string, fileId: string, nodeId: string) {
  await testPool.query(
    `INSERT INTO workspace_file_links (tenant_id, file_id, target_type, target_id)
     VALUES ($1::uuid, $2::uuid, 'namespace_node', $3::uuid)
     ON CONFLICT ON CONSTRAINT uq_workspace_file_links_relationship DO NOTHING`,
    [tenantId, fileId, nodeId],
  );
}

async function listFiles(nodeId: string) {
  const res = await GET(
    new Request(`https://hub.test/api/namespace/node/${nodeId}/files`),
    { params: Promise.resolve({ id: nodeId }) },
  );
  const body = await res.json();
  return {
    status: res.status,
    names: (body.files ?? []).map((f: { filename: string }) => f.filename) as string[],
  };
}

async function wipe() {
  if (!disposableVerified) throw new Error("Disposable integration schema has not been verified");
  const tenants = [TENANT, OTHER_TENANT];
  await testPool.query(`DELETE FROM knowledge_entries WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  await testPool.query(`DELETE FROM workspace_file_links WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  await testPool.query(`DELETE FROM namespace_direct_uploads WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  await testPool.query(`DELETE FROM hub_uploads WHERE tenant_id = ANY($1::text[])`, [tenants]);
}

beforeAll(async () => {
  process.env.NEON_DATABASE_URL = process.env.TEST_DATABASE_URL;
  // Use the existing setup tool's fixture ledger, not a permissive database
  // name. This check is read-only and must succeed before any cleanup/write.
  const ledger = await testPool.query("SELECT to_regclass('public.integration_schema_migrations') AS ledger");
  if (!ledger.rows[0]?.ledger) throw new Error("Run db:integration:setup on a disposable database first");
  const fixtures = ["000_base_cmms_rls.sql", "001_tenant_cmms_config.sql", "077_ingest_claim.sql"];
  const applied = await testPool.query("SELECT file_name FROM public.integration_schema_migrations WHERE file_name = ANY($1::text[])", [fixtures]);
  if (applied.rows.length !== fixtures.length) throw new Error("Disposable integration schema is missing required fixture migrations");
  disposableVerified = true;
  await wipe();
  await testPool.query(`DELETE FROM kg_entities WHERE tenant_id = ANY($1::uuid[])`, [[TENANT, OTHER_TENANT]]);
  nodeA = await makeNode(TENANT, "Line A");
  nodeB = await makeNode(TENANT, "Line B");
  otherTenantNode = await makeNode(OTHER_TENANT, "Another tenant line");
});

afterAll(async () => {
  try {
    if (disposableVerified) {
      await wipe();
      await testPool.query(`DELETE FROM kg_entities WHERE tenant_id = ANY($1::uuid[])`, [[TENANT, OTHER_TENANT]]);
    }
  } finally {
    await testPool.end();
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(ingestPdfToNode).mockRejectedValue(new Error("Parser not run in persistence-only test"));
  vi.mocked(sessionOr401).mockResolvedValue(session(TENANT));
  await wipe();
});

describe("GET /api/namespace/node/[id]/files — filing lives in workspace_file_links (#3396)", () => {
  it("lists a file whose bytes were already parked under another node (the dedup case)", async () => {
    // The E2E's exact shape: identical bytes uploaded to A, then attached to B.
    // parkOrReuseFile returns reused:true and never moves node_id, so B's
    // filing exists ONLY as a link.
    const fileId = await parkFile(TENANT, "shared-manual.pdf", nodeA);
    await link(TENANT, fileId, nodeA);
    await link(TENANT, fileId, nodeB);

    const b = await listFiles(nodeB);
    expect(b.status).toBe(200);
    expect(b.names).toContain("shared-manual.pdf");
  });

  it("lists a file parked with no node at all (the /api/files door, migration 082)", async () => {
    // 082 made node_id nullable precisely because POST /api/files parks first
    // and files afterwards. Such a file has node_id NULL and only a link.
    const fileId = await parkFile(TENANT, "parked-then-filed.pdf", null);
    await link(TENANT, fileId, nodeA);

    const a = await listFiles(nodeA);
    expect(a.status).toBe(200);
    expect(a.names).toContain("parked-then-filed.pdf");
  });

  it("still lists a legacy file that has node_id but no link row", async () => {
    // Pre-075 rows the backfill did not reach must not regress.
    await parkFile(TENANT, "legacy-only.pdf", nodeA);

    const a = await listFiles(nodeA);
    expect(a.names).toContain("legacy-only.pdf");
  });

  it("lists a file exactly once when it has both node_id and a link", async () => {
    const fileId = await parkFile(TENANT, "both-paths.pdf", nodeA);
    await link(TENANT, fileId, nodeA);

    const a = await listFiles(nodeA);
    expect(a.names.filter((n) => n === "both-paths.pdf")).toHaveLength(1);
  });

  it("never leaks another tenant's file through the link table", async () => {
    // The link table has NO foreign key on target_id (075 delegates ownership
    // to per-target validators), so a union over it must stay tenant-scoped or
    // it becomes an IDOR. Forge a link from another tenant's file to OUR node.
    const foreign = await parkFile(OTHER_TENANT, "not-yours.pdf", otherTenantNode);
    await link(OTHER_TENANT, foreign, nodeB);

    const b = await listFiles(nodeB);
    expect(b.names).not.toContain("not-yours.pdf");
  });

  it("does not expose a node's files to a tenant who does not own the node", async () => {
    const fileId = await parkFile(TENANT, "tenant-a-file.pdf", nodeA);
    await link(TENANT, fileId, nodeA);

    vi.mocked(sessionOr401).mockResolvedValue(session(OTHER_TENANT));
    const a = await listFiles(nodeA);
    expect(a.status).toBe(404);
  });
});


// #5318: session and PDF parser are the only mocks. Canonical parking, scoped
// dedup, claim/finalize SQL, RLS transactions and GET reconciliation are real.
describe("POST — recover a parsed document after finalization failed (#5318)", () => {
  const bytes = Buffer.from("%PDF-1.4 synthetic persistence fixture 5318");
  const hash = createHash("sha256").update(bytes).digest("hex");

  it("links the existing parsed upload on retry and persists one usable file across repeat requests", async () => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "retry.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const upload = await createUpload({ tenantId: TENANT, provider: "local", filename: "retry.pdf", initialStatus: "parsed", kgEntityId: nodeA, ingestRoute: "v2", contentSha256: hash });
    await updateUploadStatus(upload.id, TENANT, "parsed", null, { kbChunkCount: 42 });

    for (let attempt = 0; attempt < 2; attempt++) {
      const form = new FormData();
      form.append("file", new File([bytes], "retry.pdf", { type: "application/pdf" }));
      const res = await POST(new Request(`https://hub.test/api/namespace/node/${nodeA}/files`, { method: "POST", body: form }), { params: Promise.resolve({ id: nodeA }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ indexed: true, duplicate: true, fileId: parked.fileId, uploadId: upload.id });
    }
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    const saved = await testPool.query("SELECT upload_id::text, ingest_claim_token, content FROM namespace_direct_uploads WHERE id = $1", [parked.fileId]);
    expect(saved.rows[0]).toMatchObject({ upload_id: upload.id, ingest_claim_token: null, content: bytes });
    const count = await testPool.query("SELECT count(*)::int AS n FROM hub_uploads WHERE tenant_id = $1", [TENANT]);
    expect(count.rows[0].n).toBe(1);
    expect((await listFiles(nodeA)).names).toEqual(["retry.pdf"]);
  });

  it("honors a real active ingestion claim even when the document is already parsed", async () => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "claimed.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    await createUpload({ tenantId: TENANT, provider: "local", filename: "claimed.pdf", initialStatus: "parsed", kgEntityId: nodeA, ingestRoute: "v2", contentSha256: hash });
    const owner = await claimIngest(TENANT, parked.fileId);
    expect(owner.claimed).toBe(true);
    const form = new FormData();
    form.append("file", new File([bytes], "claimed.pdf", { type: "application/pdf" }));
    const res = await POST(new Request(`https://hub.test/api/namespace/node/${nodeA}/files`, { method: "POST", body: form }), { params: Promise.resolve({ id: nodeA }) });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ indexed: false, indexing: true, fileId: parked.fileId });
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    const saved = await testPool.query("SELECT upload_id, ingest_claim_token::text FROM namespace_direct_uploads WHERE id = $1", [parked.fileId]);
    expect(saved.rows[0]).toEqual({ upload_id: null, ingest_claim_token: owner.claimed ? owner.claimToken : null });
  });

  it.each(["after adoption", "between lookup and adoption"] as const)("preserves the parsed document and chunks when a stale producer cleans up %s", async (order) => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "race.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const upload = await createUpload({ tenantId: TENANT, provider: "local", filename: "race.pdf", initialStatus: "parsed", kgEntityId: nodeA, ingestRoute: "v2", contentSha256: hash });
    await testPool.query("INSERT INTO knowledge_entries (tenant_id, doc_id, content, is_private) VALUES ($1::uuid, $2::uuid, 'retained fixture chunk', true)", [TENANT, upload.id]);
    const claim = await claimIngest(TENANT, parked.fileId);
    expect(claim.claimed).toBe(true);
    if (!claim.claimed) throw new Error("fixture claim unavailable");
    expect((await findDuplicateUpload(TENANT, hash, nodeA))?.id).toBe(upload.id);

    if (order === "between lookup and adoption") await deleteOrphanNodeIngest(TENANT, upload.id, parked.fileId);
    expect(await linkFileToUpload(TENANT, parked.fileId, upload.id, claim.claimToken)).toBe(true);
    if (order === "after adoption") await deleteOrphanNodeIngest(TENANT, upload.id, parked.fileId);

    const document = await testPool.query("SELECT id FROM hub_uploads WHERE tenant_id = $1 AND id = $2", [TENANT, upload.id]);
    expect(document.rowCount).toBe(1);
    const chunks = await testPool.query("SELECT count(*)::int AS n FROM knowledge_entries WHERE tenant_id = $1::uuid AND doc_id = $2::uuid", [TENANT, upload.id]);
    expect(chunks.rows[0].n).toBe(1);
    const saved = await testPool.query("SELECT upload_id::text FROM namespace_direct_uploads WHERE id = $1", [parked.fileId]);
    expect(saved.rows[0].upload_id).toBe(upload.id);
  });

  it("serializes cleanup before a retry can claim and adopt the document being removed", async () => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "ordered.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const input = { tenantId: TENANT, provider: "local" as const, filename: "ordered.pdf", initialStatus: "parsed" as const, kgEntityId: nodeA, ingestRoute: "v2", contentSha256: hash };
    const oldUpload = await createUpload(input);
    const chunk = await testPool.query("INSERT INTO knowledge_entries (tenant_id, doc_id, content, is_private) VALUES ($1::uuid, $2::uuid, 'blocked fixture chunk', true) RETURNING id", [TENANT, oldUpload.id]);
    const locker = await testPool.connect();
    let cleanup: Promise<void> | undefined;
    let retry: Promise<Response> | undefined;
    let retryFinished = false;
    let replacementId = "";
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM knowledge_entries WHERE id = $1 FOR UPDATE", [chunk.rows[0].id]);
      cleanup = deleteOrphanNodeIngest(TENANT, oldUpload.id, parked.fileId);
      // A real row lock pauses cleanup at DELETE, after it locked the file.
      let blocked = false;
      for (let n = 0; n < 200; n++) {
        const waiting = await testPool.query("SELECT 1 FROM pg_stat_activity WHERE query LIKE 'DELETE FROM knowledge_entries%' AND wait_event_type = 'Lock'");
        if (waiting.rowCount) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      vi.mocked(ingestPdfToNode).mockImplementationOnce(async () => {
        const replacement = await createUpload(input);
        replacementId = replacement.id;
        return { uploadId: replacement.id, chunkCount: 1 };
      });
      const form = new FormData();
      form.append("file", new File([bytes], "ordered.pdf", { type: "application/pdf" }));
      retry = POST(new Request(`https://hub.test/api/namespace/node/${nodeA}/files`, { method: "POST", body: form }), { params: Promise.resolve({ id: nodeA }) }).finally(() => { retryFinished = true; });
      // Wait for the retry to reach a database wait, or incorrectly finish.
      for (let n = 0; n < 200 && !retryFinished; n++) {
        const waiting = await testPool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock'");
        if (waiting.rows[0].n >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(retryFinished).toBe(false);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      await cleanup;
      if (retry) await retry;
    }
    const res = await retry!;
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ indexed: true, uploadId: replacementId, fileId: parked.fileId });
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [oldUpload.id])).rowCount).toBe(0);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [replacementId])).rowCount).toBe(1);
    const saved = await testPool.query("SELECT upload_id::text FROM namespace_direct_uploads WHERE id = $1", [parked.fileId]);
    expect(saved.rows[0].upload_id).toBe(replacementId);
  });

  it("retains an upload when the supplied canonical file no longer exists", async () => {
    const upload = await createUpload({ tenantId: TENANT, provider: "local", filename: "uncertain.pdf", initialStatus: "parsed", kgEntityId: nodeA, ingestRoute: "v2" });
    await deleteOrphanNodeIngest(TENANT, upload.id, nodeB);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [upload.id])).rowCount).toBe(1);
  });

  it.each(["missing", "different"] as const)("cleans a loser using its canonical file identity when the derived content hash is %s", async (hashKind) => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "derived.txt", mimeType: "text/plain", sizeBytes: bytes.length, buffer: bytes });
    const input = { tenantId: TENANT, provider: "local" as const, filename: "derived.txt", initialStatus: "parsed" as const, kgEntityId: nodeA, ingestRoute: "v2", contentSha256: hashKind === "missing" ? null : "b".repeat(64) };
    const loser = await createUpload(input);
    const winner = await createUpload(input);
    const claim = await claimIngest(TENANT, parked.fileId);
    if (!claim.claimed) throw new Error("fixture claim unavailable");
    expect(await linkFileToUpload(TENANT, parked.fileId, winner.id, claim.claimToken)).toBe(true);
    await deleteOrphanNodeIngest(TENANT, loser.id, parked.fileId);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [loser.id])).rowCount).toBe(0);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [winner.id])).rowCount).toBe(1);
  });

  it.each(["finalize a different document", "adopt the deferred document", "release the claim"] as const)("reconciles durable deferred cleanup when the active winner will %s", async (outcome) => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "deferred.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const claim = await claimIngest(TENANT, parked.fileId);
    if (!claim.claimed) throw new Error("fixture claim unavailable");
    // The takeover has already missed A's not-yet-published document.
    expect(await findDuplicateUpload(TENANT, hash, nodeA)).toBeNull();
    const input = { tenantId: TENANT, provider: "local" as const, filename: "deferred.pdf", initialStatus: "parsed" as const, kgEntityId: nodeA, ingestRoute: "v2", contentSha256: hash };
    const late = await createUpload(input);
    await testPool.query("INSERT INTO knowledge_entries (tenant_id, doc_id, content, is_private) VALUES ($1::uuid, $2::uuid, 'deferred private fixture', true)", [TENANT, late.id]);
    await deleteOrphanNodeIngest(TENANT, late.id, parked.fileId);
    expect((await testPool.query("SELECT status_detail FROM hub_uploads WHERE id = $1", [late.id])).rows[0].status_detail).toContain(parked.fileId);
    let winnerId: string | null = null;
    if (outcome === "release the claim") {
      await releaseIngestClaim(TENANT, parked.fileId, claim.claimToken);
    } else {
      winnerId = outcome === "adopt the deferred document" ? late.id : (await createUpload(input)).id;
      expect(await linkFileToUpload(TENANT, parked.fileId, winnerId, claim.claimToken)).toBe(true);
    }
    const retained = await testPool.query("SELECT id::text, status_detail FROM hub_uploads WHERE tenant_id = $1", [TENANT]);
    expect(retained.rows.map((row) => row.id)).toEqual(winnerId ? [winnerId] : []);
    if (winnerId) expect(retained.rows[0].status_detail).toBeNull();
    expect((await listFiles(nodeA)).names).toEqual(["deferred.pdf"]);
    const chunks = await testPool.query("SELECT doc_id::text FROM knowledge_entries WHERE tenant_id = $1::uuid", [TENANT]);
    expect(chunks.rows).toEqual(winnerId === late.id ? [{ doc_id: late.id }] : []);
  });

  it.each(["active", "released", "removed"] as const)("cleanup for a different file never selects file A's deferred document when A is %s", async (state) => {
    const otherBytes = Buffer.from("%PDF-1.4 different canonical file 5319");
    const fileA = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "A.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const fileB = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeB, filename: "B.pdf", mimeType: "application/pdf", sizeBytes: otherBytes.length, buffer: otherBytes });
    expect(fileA.fileId).not.toBe(fileB.fileId);
    const input = { tenantId: TENANT, provider: "local" as const, initialStatus: "parsed" as const, ingestRoute: "v2" };
    const docA = await createUpload({ ...input, filename: "A.pdf", kgEntityId: nodeA });
    const docB = await createUpload({ ...input, filename: "B.pdf", kgEntityId: nodeB });
    const claimA = await claimIngest(TENANT, fileA.fileId);
    const claimB = await claimIngest(TENANT, fileB.fileId);
    if (!claimA.claimed || !claimB.claimed) throw new Error("fixture claim unavailable");
    await deleteOrphanNodeIngest(TENANT, docA.id, fileA.fileId);
    await deleteOrphanNodeIngest(TENANT, docB.id, fileB.fileId);
    // Declared fixture states: A's release committed before its drain, or its
    // canonical row was removed. Neither can make marker A match marker B.
    if (state === "released") await testPool.query("UPDATE namespace_direct_uploads SET ingest_claim_token = NULL, ingest_claimed_at = NULL WHERE id = $1", [fileA.fileId]);
    if (state === "removed") await testPool.query("DELETE FROM workspace_file_links WHERE file_id = $1;", [fileA.fileId]);
    if (state === "removed") await testPool.query("DELETE FROM namespace_direct_uploads WHERE id = $1", [fileA.fileId]);
    const before = (await testPool.query("SELECT status_detail FROM hub_uploads WHERE id = $1", [docA.id])).rows[0].status_detail;
    await releaseIngestClaim(TENANT, fileB.fileId, claimB.claimToken);
    expect((await testPool.query("SELECT status_detail FROM hub_uploads WHERE id = $1", [docA.id])).rows[0].status_detail).toBe(before);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [docB.id])).rowCount).toBe(0);
  });

  it("never reassigns an existing deferred cleanup intent to a different canonical file", async () => {
    const otherBytes = Buffer.from("%PDF-1.4 mismatched canonical file 5319");
    const fileA = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "A.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const fileB = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeB, filename: "B.pdf", mimeType: "application/pdf", sizeBytes: otherBytes.length, buffer: otherBytes });
    const docA = await createUpload({ tenantId: TENANT, provider: "local", filename: "A.pdf", initialStatus: "parsed", kgEntityId: nodeA, ingestRoute: "v2" });
    expect((await claimIngest(TENANT, fileA.fileId)).claimed).toBe(true);
    await deleteOrphanNodeIngest(TENANT, docA.id, fileA.fileId);
    const before = (await testPool.query("SELECT status_detail FROM hub_uploads WHERE id = $1", [docA.id])).rows[0].status_detail;
    // Invalid internal pairing is a negative control, not an exposed API path.
    await deleteOrphanNodeIngest(TENANT, docA.id, fileB.fileId);
    expect((await testPool.query("SELECT status_detail FROM hub_uploads WHERE id = $1", [docA.id])).rows[0].status_detail).toBe(before);
  });

  it.each([null, "3 pages indexed", "", 'A "quoted" status\nwith a second line'])("preserves an adopted document's previous status explanation: %j", async (detail) => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "detail.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const upload = await createUpload({ tenantId: TENANT, provider: "local", filename: "detail.pdf", initialStatus: "parsed", kgEntityId: nodeA, ingestRoute: "v2" });
    await updateUploadStatus(upload.id, TENANT, "parsed", detail);
    const claim = await claimIngest(TENANT, parked.fileId);
    if (!claim.claimed) throw new Error("fixture claim unavailable");
    await deleteOrphanNodeIngest(TENANT, upload.id, parked.fileId);
    expect((await getUpload(upload.id, TENANT))?.statusDetail).toBe("Finishing file processing.");
    await deleteOrphanNodeIngest(TENANT, upload.id, parked.fileId); // repeated recovery is idempotent
    expect(await linkFileToUpload(TENANT, parked.fileId, upload.id, claim.claimToken)).toBe(true);
    expect((await getUpload(upload.id, TENANT))?.statusDetail).toBe(detail);
    expect((await testPool.query("SELECT status_detail FROM hub_uploads WHERE id = $1", [upload.id])).rows[0].status_detail).toBe(detail);
  });

  it("keeps cleanup intent durable after a database failure and drains it on supported reuse", async () => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "durable.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const input = { tenantId: TENANT, provider: "local" as const, filename: "durable.pdf", initialStatus: "parsed" as const, kgEntityId: nodeA, ingestRoute: "v2" };
    const loser = await createUpload(input);
    const winner = await createUpload(input);
    await testPool.query("INSERT INTO knowledge_entries (tenant_id, doc_id, content, is_private) VALUES ($1::uuid, $2::uuid, 'cleanup fault fixture', true)", [TENANT, loser.id]);
    const claim = await claimIngest(TENANT, parked.fileId);
    if (!claim.claimed) throw new Error("fixture claim unavailable");
    expect(await linkFileToUpload(TENANT, parked.fileId, winner.id, claim.claimToken)).toBe(true);
    // Disposable-DB fault injection only: fail DELETE after intent is stored.
    await testPool.query("CREATE FUNCTION cv101_5319_cleanup_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'declared cleanup fault'; END $$; CREATE TRIGGER cv101_5319_cleanup_fault BEFORE DELETE ON knowledge_entries FOR EACH ROW EXECUTE FUNCTION cv101_5319_cleanup_fault()");
    try {
      await deleteOrphanNodeIngest(TENANT, loser.id, parked.fileId);
      expect((await testPool.query("SELECT status_detail FROM hub_uploads WHERE id = $1", [loser.id])).rows[0].status_detail).toContain(parked.fileId);
    } finally {
      await testPool.query("DROP TRIGGER cv101_5319_cleanup_fault ON knowledge_entries; DROP FUNCTION cv101_5319_cleanup_fault()");
    }
    const reused = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "durable.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    expect(reused).toMatchObject({ fileId: parked.fileId, uploadId: winner.id, reused: true });
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [loser.id])).rowCount).toBe(0);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [winner.id])).rowCount).toBe(1);
  });

  it("cleans a real /api/files stale producer that does not supply a content hash", async () => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, filename: "files-door.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    let loserId = "";
    let winnerId = "";
    vi.mocked(ingestPdfToNode).mockImplementationOnce(async (opts) => {
      expect(opts.contentSha256).toBeUndefined();
      const input = { tenantId: TENANT, provider: "local" as const, filename: "files-door.pdf", initialStatus: "parsed" as const, kgEntityId: nodeA, ingestRoute: "v2" };
      loserId = (await createUpload(input)).id;
      await testPool.query("INSERT INTO knowledge_entries (tenant_id, doc_id, content, is_private) VALUES ($1::uuid, $2::uuid, 'files door private fixture', true)", [TENANT, loserId]);
      // Declared clock fixture: allow B to take over A's real claim.
      await testPool.query("UPDATE namespace_direct_uploads SET ingest_claimed_at = now() - interval '11 minutes' WHERE id = $1", [parked.fileId]);
      const takeover = await claimIngest(TENANT, parked.fileId);
      if (!takeover.claimed) throw new Error("fixture takeover unavailable");
      winnerId = (await createUpload(input)).id;
      expect(await linkFileToUpload(TENANT, parked.fileId, winnerId, takeover.claimToken)).toBe(true);
      return { uploadId: loserId, chunkCount: 1 };
    });
    const form = new FormData();
    form.append("file", new File([bytes], "files-door.pdf", { type: "application/pdf" }));
    form.append("targets", JSON.stringify([{ targetType: "namespace_node", targetId: nodeA }]));
    const res = await uploadFile(new Request("https://hub.test/api/files", { method: "POST", body: form }));
    expect(res.status).toBe(202);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [loserId])).rowCount).toBe(0);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [winnerId])).rowCount).toBe(1);
    expect((await listFiles(nodeA)).names).toEqual(["files-door.pdf"]);
  });

  it("still cleans a proven losing document when the canonical file is linked to a different winner", async () => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "winner.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const input = { tenantId: TENANT, provider: "local" as const, filename: "winner.pdf", initialStatus: "parsed" as const, kgEntityId: nodeA, ingestRoute: "v2", contentSha256: hash };
    const loser = await createUpload(input);
    const winner = await createUpload(input);
    await testPool.query("INSERT INTO knowledge_entries (tenant_id, doc_id, content, is_private) VALUES ($1::uuid, $2::uuid, 'losing fixture chunk', true), ($1::uuid, $3::uuid, 'winning fixture chunk', true)", [TENANT, loser.id, winner.id]);
    const claim = await claimIngest(TENANT, parked.fileId);
    if (!claim.claimed) throw new Error("fixture claim unavailable");
    expect(await linkFileToUpload(TENANT, parked.fileId, winner.id, claim.claimToken)).toBe(true);
    await deleteOrphanNodeIngest(TENANT, loser.id, parked.fileId);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [loser.id])).rowCount).toBe(0);
    expect((await testPool.query("SELECT id FROM hub_uploads WHERE id = $1", [winner.id])).rowCount).toBe(1);
    expect((await testPool.query("SELECT doc_id::text FROM knowledge_entries WHERE tenant_id = $1::uuid", [TENANT])).rows).toEqual([{ doc_id: winner.id }]);
  });

  it.each(["tenant", "node", "hash", "failed", "legacy", "duplicate"] as const)("does not relink a document with the wrong %s scope or state", async (mismatch) => {
    const parked = await parkOrReuseFile({ tenantId: TENANT, nodeId: nodeA, filename: "scope.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, buffer: bytes });
    const upload = await createUpload({
      tenantId: mismatch === "tenant" ? OTHER_TENANT : TENANT,
      provider: "local", filename: "scope.pdf",
      initialStatus: mismatch === "failed" ? "failed" : "parsed",
      kgEntityId: mismatch === "node" ? nodeB : nodeA,
      ingestRoute: mismatch === "legacy" ? null : "v2",
      contentSha256: mismatch === "hash" ? "a".repeat(64) : hash,
    });
    if (mismatch === "duplicate") await updateUploadStatus(upload.id, TENANT, "parsed", "duplicate of another-upload");
    const form = new FormData();
    form.append("file", new File([bytes], "scope.pdf", { type: "application/pdf" }));
    const res = await POST(new Request(`https://hub.test/api/namespace/node/${nodeA}/files`, { method: "POST", body: form }), { params: Promise.resolve({ id: nodeA }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ indexed: false, fileId: parked.fileId, warning: expect.any(String) });
    expect(ingestPdfToNode).toHaveBeenCalledTimes(1);
    const saved = await testPool.query("SELECT upload_id, ingest_claim_token FROM namespace_direct_uploads WHERE id = $1", [parked.fileId]);
    expect(saved.rows[0]).toEqual({ upload_id: null, ingest_claim_token: null });
  });
});
