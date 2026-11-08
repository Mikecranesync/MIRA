// #5316 — the canonical file lookup says whether the file is being read RIGHT NOW.
//
// The project panel used to call every unindexed PDF "still being read", so a
// failed ingest (route catch branch: claim released, upload_id still null) read
// as in progress forever. `ingesting` is computed in SQL from the ingest claim
// (migration 077), so it is proven here against a real Postgres, inside the real
// withTenantContext transaction, with the real claim/release/link functions.
//
// Requires a disposable Postgres (same recipe as
// src/app/api/namespace/node/[id]/files/__tests__/node-files-links.integration.test.ts):
//   TEST_DATABASE_URL=postgres://...  MIRA_TEST_DB_CONFIRM=DISPOSABLE
//   MIRA_INTEGRATION_MIGRATIONS="001_knowledge_graph.sql,010_kg_uns_path.sql,026_kg_entities_dedupe_and_constraint.sql,027_namespace_direct_uploads.sql,059_namespace_filing_cabinet.sql,068_hub_uploads.sql,072_hub_uploads_content_sha256.sql,073_equipment_notebooks.sql,075_workspace_file_links.sql,076_namespace_uploads_source_reconcile.sql,077_ingest_claim.sql,082_namespace_uploads_node_nullable.sql"
//   npm run db:integration:setup
//   npx vitest run --config vitest.integration.config.ts src/lib/__tests__/workspace-files-ingesting.integration.test.ts

import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { claimIngest, getFile, linkFileToUpload, parkOrReuseFile, releaseIngestClaim } from "@/lib/workspace-files";

const TENANT = "5316f000-0000-4000-8000-000000000001";
const OTHER = "5316f000-0000-4000-8000-0000000000ff";
const DOC = "5316d000-0000-4000-8000-000000000001";

async function park(): Promise<string> {
  const buffer = Buffer.from(`%PDF-1.4 #5316 ${Math.random()}`);
  const r = await parkOrReuseFile({ tenantId: TENANT, filename: "manual.pdf", mimeType: "application/pdf", sizeBytes: buffer.length, buffer });
  return r.fileId;
}
const state = async (fileId: string) => {
  const f = await getFile(TENANT, fileId);
  return f ? { indexed: f.file.indexed, ingesting: f.file.ingesting } : null;
};

describe("#5316 getFile reports a live ingest, and only a live ingest", () => {
  beforeEach(async () => {
    await testPool.query(`DELETE FROM namespace_direct_uploads WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT, OTHER]);
  });
  afterAll(async () => {
    await testPool.query(`DELETE FROM namespace_direct_uploads WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT, OTHER]);
    await testPool.end();
  });

  it("control: a parked file nobody has claimed is not being read", async () => {
    const id = await park();
    expect(await state(id)).toEqual({ indexed: false, ingesting: false });
  });

  it("a held claim reads as ingesting", async () => {
    const id = await park();
    const claim = await claimIngest(TENANT, id);
    expect(claim.claimed).toBe(true);
    expect(await state(id)).toEqual({ indexed: false, ingesting: true });
  });

  it("the failure path (route catch: claim released, no document) is NOT ingesting", async () => {
    const id = await park();
    const claim = await claimIngest(TENANT, id);
    if (!claim.claimed) throw new Error("precondition: claim must be won");
    await releaseIngestClaim(TENANT, id, claim.claimToken);
    expect(await state(id)).toEqual({ indexed: false, ingesting: false });
  });

  it("a stale claim (crashed worker, older than the takeover window) is NOT ingesting", async () => {
    const id = await park();
    expect((await claimIngest(TENANT, id)).claimed).toBe(true);
    await testPool.query(`UPDATE namespace_direct_uploads SET ingest_claimed_at = now() - interval '11 minutes' WHERE id = $1::uuid`, [id]);
    expect(await state(id)).toEqual({ indexed: false, ingesting: false });
    // Control: inside the window it still counts.
    await testPool.query(`UPDATE namespace_direct_uploads SET ingest_claimed_at = now() - interval '9 minutes' WHERE id = $1::uuid`, [id]);
    expect(await state(id)).toEqual({ indexed: false, ingesting: true });
  });

  it("a finished ingest is indexed, not ingesting", async () => {
    const id = await park();
    const claim = await claimIngest(TENANT, id);
    if (!claim.claimed) throw new Error("precondition: claim must be won");
    expect(await linkFileToUpload(TENANT, id, DOC, claim.claimToken)).toBe(true);
    expect(await state(id)).toEqual({ indexed: true, ingesting: false });
  });

  it("another tenant cannot see the file or its ingest state", async () => {
    const id = await park();
    expect((await claimIngest(TENANT, id)).claimed).toBe(true);
    expect(await getFile(OTHER, id)).toBeNull();
  });
});
