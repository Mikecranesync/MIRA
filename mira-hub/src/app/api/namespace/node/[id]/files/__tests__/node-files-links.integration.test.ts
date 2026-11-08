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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
// Keep PDF parsing/provider calls out of this database/RLS integration suite.
vi.mock("@/lib/node-knowledge-ingest", () => ({
  ingestPdfToNode: vi.fn(),
  ingestTextToNode: vi.fn(),
  deleteOrphanNodeIngest: vi.fn(async () => undefined),
}));

import { GET, POST } from "../route";
import { ingestPdfToNode } from "@/lib/node-knowledge-ingest";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import { parkOrReuseFile, claimIngest } from "@/lib/workspace-files";
import { sessionOr401 } from "@/lib/session";

const TENANT = "3f000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "3f000000-0000-4000-8000-0000000000ff";

let nodeA = "";
let nodeB = "";
let otherTenantNode = "";

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
  const tenants = [TENANT, OTHER_TENANT];
  await testPool.query(`DELETE FROM workspace_file_links WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  await testPool.query(`DELETE FROM namespace_direct_uploads WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  await testPool.query(`DELETE FROM hub_uploads WHERE tenant_id = ANY($1::text[])`, [tenants]);
}

beforeAll(async () => {
  process.env.NEON_DATABASE_URL = process.env.TEST_DATABASE_URL;
  await wipe();
  await testPool.query(`DELETE FROM kg_entities WHERE tenant_id = ANY($1::uuid[])`, [[TENANT, OTHER_TENANT]]);
  nodeA = await makeNode(TENANT, "Line A");
  nodeB = await makeNode(TENANT, "Line B");
  otherTenantNode = await makeNode(OTHER_TENANT, "Another tenant line");
});

afterAll(async () => {
  await wipe();
  await testPool.query(`DELETE FROM kg_entities WHERE tenant_id = ANY($1::uuid[])`, [[TENANT, OTHER_TENANT]]);
  await testPool.end();
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
