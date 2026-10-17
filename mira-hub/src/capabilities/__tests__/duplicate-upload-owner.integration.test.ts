// #4420 Codex r1 F1 — the duplicate chain, against a REAL disposable Postgres.
//
// local-upload.ts marks an exact re-upload "duplicate of <id>" and writes no
// chunks for it. A then B (duplicate of A) then C: C must resolve to A, the
// upload that owns the chunks — never to B. An already-persisted chain
// (C = duplicate of B) must not leak into the next lookup either.
//
// Requires (local/disposable only — never staging/prod):
//   TEST_DATABASE_URL      postgres
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
// Run: npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/duplicate-upload-owner.integration.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});

vi.mock("@/lib/db", () => ({ default: testPool }));

import { findDuplicateUpload } from "@/lib/uploads";

const TENANT = randomUUID();
const NODE = randomUUID();
const SHA = "c".repeat(64);
const hubRoot = path.resolve(__dirname, "..", "..", "..");

async function insertUpload(statusDetail: string | null, ageSeconds: number): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO hub_uploads
       (tenant_id, provider, filename, status, status_detail, kb_chunk_count,
        kind, kg_entity_id, ingest_route, content_sha256, created_at)
     VALUES ($1, 'local', 'gs10_fault_codes.pdf', 'parsed', $2, 12,
             'document', $3, 'v2', $4, NOW() - make_interval(secs => $5))
     RETURNING id::text AS id`,
    [TENANT, statusDetail, NODE, SHA, ageSeconds],
  );
  return rows[0].id;
}

describe.skipIf(!READY)("findDuplicateUpload on a duplicate chain (real Postgres)", () => {
  beforeAll(async () => {
    for (const f of ["068_hub_uploads.sql", "072_hub_uploads_content_sha256.sql"]) {
      await testPool.query(fs.readFileSync(path.join(hubRoot, "db", "migrations", f), "utf8"));
    }
  });
  afterAll(async () => {
    await testPool.query("DELETE FROM hub_uploads WHERE tenant_id = $1", [TENANT]);
    await testPool.end();
  });

  it("A, B = duplicate of A, then the next lookup still names A", async () => {
    const a = await insertUpload(null, 30);
    expect((await findDuplicateUpload(TENANT, SHA, NODE))?.id).toBe(a);

    await insertUpload(`duplicate of ${a}`, 20);
    // B is newer than A; before the fix the lookup returned B (no chunks).
    expect((await findDuplicateUpload(TENANT, SHA, NODE))?.id).toBe(a);
  });

  it("an already-persisted chain (C = duplicate of B) never becomes the original", async () => {
    const b = (
      await testPool.query<{ id: string }>(
        "SELECT id::text AS id FROM hub_uploads WHERE tenant_id = $1 AND status_detail LIKE 'duplicate of %'",
        [TENANT],
      )
    ).rows[0].id;
    await insertUpload(`duplicate of ${b}`, 10);
    const found = await findDuplicateUpload(TENANT, SHA, NODE);
    expect(found?.statusDetail ?? null).toBeNull();
  });
});
