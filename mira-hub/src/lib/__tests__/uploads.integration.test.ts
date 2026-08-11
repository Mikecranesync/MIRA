// Requires a disposable Postgres/Neon test DB.
//
//   $env:TEST_DATABASE_URL="postgres://..."
//   $env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   npm run test:integration:db
//
// The setup command creates the factorylm_app role, applies integration-only
// fixtures, applies Hub migrations (including 068_hub_uploads.sql — added to
// scripts/setup-integration-db.mjs's defaultMigrationFiles for this suite),
// and runs smoke checks before Vitest.
//
// Coverage for mira-hub/src/lib/uploads.ts, the hub_uploads data-access
// layer, which previously had no direct test file. #2981 changed
// ensureUploadsSchema() from inline "CREATE TABLE IF NOT EXISTS" DDL to a
// memoized column-existence check that throws when migration
// 068_hub_uploads.sql hasn't been applied to the environment yet — that
// fail-loud + do-not-cache-the-failure behavior is the focus of the
// "ensureUploadsSchema" block below.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { Pool } from "pg";

// Build the test pool (no SSL — the lib's default pool forces SSL, which a
// local postgres:16 rejects) before imports, and inject it as the @/lib/db
// default so uploads.ts runs against the test DB. require() in vi.hoisted is
// fine in vitest (see import.integration.test.ts / rls-deny.integration.test.ts).
const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import {
  createUpload,
  listUploads,
  getUpload,
  findUploadByExternalFileId,
  updateUploadStatus,
  deleteUpload,
  getUploadCounts,
  type Upload,
} from "../uploads";

const TENANT_A = "hub-uploads-itest-a";
const TENANT_B = "hub-uploads-itest-b";
// uploads.ts DEFAULT_TENANT_ID = process.env.HUB_TENANT_ID ?? "mike"; HUB_TENANT_ID
// is unset in the test env, so this is what an omitted tenantId resolves to.
const DEFAULT_TENANT = "mike";

const ISO_8601_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Pins the `Upload` interface's declared `string` contract for a
 * timestamptz-backed field. Deliberately stricter than
 * `new Date(v).getTime()` not being NaN — pg returns `Date` objects for
 * timestamptz columns by default, and `new Date(aDateObject).getTime()`
 * passes identically whether rowToUpload converts it or not. Checking the
 * runtime type plus the exact ISO-8601-with-milliseconds shape plus a
 * round-trip through `toISOString()` is what actually fails against a raw
 * `Date` leaking through an `as string` cast.
 */
function expectIsoString(value: unknown) {
  expect(typeof value).toBe("string");
  const v = value as string;
  expect(v).toMatch(ISO_8601_MS);
  expect(new Date(v).toISOString()).toBe(v);
}

let createdIds: string[] = [];

function track(upload: Upload): Upload {
  createdIds.push(upload.id);
  return upload;
}

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is required for the uploads integration test. See test header.",
    );
  }
});

afterAll(async () => {
  await testPool.end();
});

afterEach(async () => {
  if (createdIds.length > 0) {
    await testPool.query(`DELETE FROM hub_uploads WHERE id = ANY($1::uuid[])`, [createdIds]);
    createdIds = [];
  }
  // The ensureUploadsSchema tests transiently DROP the ingest_route column —
  // guarantee it's back for every other test, whatever the previous test did.
  await testPool.query(`ALTER TABLE hub_uploads ADD COLUMN IF NOT EXISTS ingest_route TEXT`);
  await testPool.query(`ALTER TABLE hub_uploads ADD COLUMN IF NOT EXISTS content_sha256 TEXT`);
});

describe("ensureUploadsSchema", () => {
  // schemaReady is a module-level singleton, so each scenario needs its own
  // fresh module instance (vi.resetModules + dynamic import) — otherwise a
  // prior test's cached success/failure would leak into this one.
  async function freshUploadsModule() {
    vi.resetModules();
    return import("../uploads");
  }

  it("resolves once migrations 068+072 have been applied (happy path)", async () => {
    const mod = await freshUploadsModule();
    await expect(mod.ensureUploadsSchema()).resolves.toBeUndefined();
  });

  // The probe watches the NEWEST known column — content_sha256 since migration
  // 072 (ARPK 1b) — so dropping it is how "schema out of date" is simulated.
  it("throws when content_sha256 is missing, and does not cache the failure — a retry after the column appears succeeds", async () => {
    await testPool.query(`ALTER TABLE hub_uploads DROP COLUMN IF EXISTS content_sha256`);
    const mod = await freshUploadsModule();

    await expect(mod.ensureUploadsSchema()).rejects.toThrow(/hub_uploads schema is out of date/);

    // Simulate the migration landing, then retry on the SAME module instance
    // (not a new import). If the failure had been memoized, this would still reject.
    await testPool.query(`ALTER TABLE hub_uploads ADD COLUMN IF NOT EXISTS content_sha256 TEXT`);
    await expect(mod.ensureUploadsSchema()).resolves.toBeUndefined();
  });
});

describe("createUpload", () => {
  it("returns a populated Upload with documented defaults", async () => {
    const upload = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "manual.pdf" }),
    );

    expect(upload.id).toEqual(expect.any(String));
    expect(upload.tenantId).toBe(TENANT_A);
    expect(upload.provider).toBe("google");
    expect(upload.filename).toBe("manual.pdf");
    expect(upload.kind).toBe("document"); // default
    expect(upload.status).toBe("queued"); // default
    expect(upload.externalFileId).toBeNull();
    expect(upload.externalDownloadUrl).toBeNull();
    expect(upload.mimeType).toBeNull();
    expect(upload.sizeBytes).toBeNull();
    expect(upload.statusDetail).toBeNull();
    expect(upload.kbFileId).toBeNull();
    expect(upload.kbChunkCount).toBeNull();
    expect(upload.assetTag).toBeNull();
    expect(upload.unsPath).toBeNull();
    expect(upload.kgEntityId).toBeNull();
    expect(upload.ingestRoute).toBeNull();
    // externalCreatedAt wasn't supplied — nullable field must stay null, not
    // become "Invalid Date" or throw.
    expect(upload.externalCreatedAt).toBeNull();
    // createdAt/updatedAt are typed `string` — pin the actual contract
    // (runtime type + ISO-8601 shape + toISOString() round-trip), not just
    // "date-parseable", which a raw pg `Date` object also satisfies.
    expectIsoString(upload.createdAt);
    expectIsoString(upload.updatedAt);
  });

  it("returns externalCreatedAt as an ISO string when supplied", async () => {
    const upload = track(
      await createUpload({
        tenantId: TENANT_A,
        provider: "google",
        filename: "with-external-date.pdf",
        externalCreatedAt: new Date("2026-01-15T12:34:56.000Z"),
      }),
    );
    expectIsoString(upload.externalCreatedAt);
    expect(upload.externalCreatedAt).toBe("2026-01-15T12:34:56.000Z");
  });

  it("falls back to DEFAULT_TENANT_ID when tenantId is omitted", async () => {
    const upload = track(await createUpload({ provider: "local", filename: "no-tenant.pdf" }));
    expect(upload.tenantId).toBe(DEFAULT_TENANT);
  });

  it("honors an explicit kind and initialStatus", async () => {
    const upload = track(
      await createUpload({
        tenantId: TENANT_A,
        provider: "dropbox",
        kind: "photo",
        filename: "gauge.jpg",
        initialStatus: "fetching",
      }),
    );
    expect(upload.kind).toBe("photo");
    expect(upload.status).toBe("fetching");
  });
});

describe("listUploads", () => {
  it("is tenant-scoped — another tenant's rows never appear", async () => {
    track(await createUpload({ tenantId: TENANT_A, provider: "google", filename: "a.pdf" }));
    track(await createUpload({ tenantId: TENANT_B, provider: "google", filename: "b.pdf" }));

    const rows = await listUploads(TENANT_A);
    const filenames = rows.map((r) => r.filename);
    expect(filenames).toContain("a.pdf");
    expect(filenames).not.toContain("b.pdf");
    expect(rows.every((r) => r.tenantId === TENANT_A)).toBe(true);
  });

  it("excludes cancelled uploads", async () => {
    track(
      await createUpload({
        tenantId: TENANT_A,
        provider: "google",
        filename: "cancelled.pdf",
        initialStatus: "cancelled",
      }),
    );
    const rows = await listUploads(TENANT_A);
    expect(rows.map((r) => r.filename)).not.toContain("cancelled.pdf");
  });
});

describe("getUpload", () => {
  it("returns the upload when found for the correct tenant", async () => {
    const created = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "found.pdf" }),
    );
    const found = await getUpload(created.id, TENANT_A);
    expect(found?.id).toBe(created.id);
    expect(found?.filename).toBe("found.pdf");
  });

  it("returns null when the id does not exist", async () => {
    const found = await getUpload("00000000-0000-0000-0000-000000000000", TENANT_A);
    expect(found).toBeNull();
  });

  it("returns null for a real id under the wrong tenant", async () => {
    const created = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "scoped.pdf" }),
    );
    const found = await getUpload(created.id, TENANT_B);
    expect(found).toBeNull();
  });
});

describe("findUploadByExternalFileId", () => {
  it("finds the upload by tenant + provider + external_file_id", async () => {
    const created = track(
      await createUpload({
        tenantId: TENANT_A,
        provider: "google",
        externalFileId: "gdrive-123",
        filename: "drive-file.pdf",
      }),
    );
    const found = await findUploadByExternalFileId(TENANT_A, "google", "gdrive-123");
    expect(found?.id).toBe(created.id);
  });

  it("returns null when no upload matches", async () => {
    const found = await findUploadByExternalFileId(TENANT_A, "google", "nonexistent-id");
    expect(found).toBeNull();
  });
});

describe("updateUploadStatus", () => {
  it("persists the status transition and returns void (not the row)", async () => {
    const created = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "update.pdf" }),
    );
    const result = await updateUploadStatus(created.id, TENANT_A, "parsing", "working on it");
    expect(result).toBeUndefined();

    const after = await getUpload(created.id, TENANT_A);
    expect(after?.status).toBe("parsing");
    expect(after?.statusDetail).toBe("working on it");
  });

  it("COALESCEs a missing detail — does not clobber the existing value with null", async () => {
    const created = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "coalesce.pdf" }),
    );
    await updateUploadStatus(created.id, TENANT_A, "parsing", "first detail");
    await updateUploadStatus(created.id, TENANT_A, "parsed"); // no detail passed this time

    const after = await getUpload(created.id, TENANT_A);
    expect(after?.status).toBe("parsed");
    expect(after?.statusDetail).toBe("first detail"); // unchanged
  });

  it("sets extras (kbFileId, kbChunkCount, kgEntityId, ingestRoute)", async () => {
    const created = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "extras.pdf" }),
    );
    const kgEntityId = "11111111-1111-1111-1111-111111111111";
    await updateUploadStatus(created.id, TENANT_A, "parsed", null, {
      kbFileId: "kb-1",
      kbChunkCount: 7,
      kgEntityId,
      ingestRoute: "v2",
    });

    const after = await getUpload(created.id, TENANT_A);
    expect(after?.kbFileId).toBe("kb-1");
    expect(after?.kbChunkCount).toBe(7);
    expect(after?.kgEntityId).toBe(kgEntityId);
    expect(after?.ingestRoute).toBe("v2");
  });

  it("does not update another tenant's row", async () => {
    const created = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "protected.pdf" }),
    );
    await updateUploadStatus(created.id, TENANT_B, "failed", "hijack attempt");

    const after = await getUpload(created.id, TENANT_A);
    expect(after?.status).toBe("queued"); // unchanged — WHERE tenant_id=$2 matched nothing
  });
});

describe("deleteUpload", () => {
  it("deletes the row and returns true", async () => {
    const created = await createUpload({
      tenantId: TENANT_A,
      provider: "google",
      filename: "delete-me.pdf",
    });
    const deleted = await deleteUpload(created.id, TENANT_A);
    expect(deleted).toBe(true);
    expect(await getUpload(created.id, TENANT_A)).toBeNull();
  });

  it("returns false when the id does not exist", async () => {
    const deleted = await deleteUpload("00000000-0000-0000-0000-000000000000", TENANT_A);
    expect(deleted).toBe(false);
  });

  it("will not delete another tenant's row", async () => {
    const created = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "not-yours.pdf" }),
    );
    const deleted = await deleteUpload(created.id, TENANT_B);
    expect(deleted).toBe(false);
    expect(await getUpload(created.id, TENANT_A)).not.toBeNull();
  });
});

describe("getUploadCounts", () => {
  it("falls back to 0 for pm_tasks/fault_codes when their tables don't exist, and reports kb_chunk_count directly", async () => {
    // Neither pm_schedules nor kb_chunks is in this DB's applied migration
    // set — this exercises the documented try/catch "table doesn't exist
    // yet, return 0" resilience path for real, not by mocking it away.
    const created = track(
      await createUpload({ tenantId: TENANT_A, provider: "google", filename: "counts.pdf" }),
    );
    await updateUploadStatus(created.id, TENANT_A, "parsed", null, { kbChunkCount: 12 });
    const upload = await getUpload(created.id, TENANT_A);
    expect(upload).not.toBeNull();

    const counts = await getUploadCounts(upload as Upload, TENANT_A);
    expect(counts).toEqual({ pm_tasks_count: 0, fault_codes_count: 0, knowledge_chunks_count: 12 });
  });

  describe("with pm_schedules / kb_chunks present", () => {
    // Minimal throwaway fixture tables carrying only the columns
    // getUploadCounts' queries reference. Created only if the disposable DB
    // doesn't already have real ones (it doesn't, today — see the fallback
    // test above); dropped again in afterAll so this file leaves no schema
    // behind for other integration test files to trip over.
    let createdPmSchedules = false;
    let createdKbChunks = false;

    beforeAll(async () => {
      const pm = await testPool.query(`SELECT to_regclass('public.pm_schedules') AS t`);
      if (!pm.rows[0].t) {
        await testPool.query(
          `CREATE TABLE pm_schedules (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, source_citation TEXT)`,
        );
        createdPmSchedules = true;
      }
      const kb = await testPool.query(`SELECT to_regclass('public.kb_chunks') AS t`);
      if (!kb.rows[0].t) {
        await testPool.query(
          `CREATE TABLE kb_chunks (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, source TEXT, doc_type TEXT, title TEXT)`,
        );
        createdKbChunks = true;
      }
    });

    afterAll(async () => {
      if (createdPmSchedules) await testPool.query(`DROP TABLE IF EXISTS pm_schedules`);
      if (createdKbChunks) await testPool.query(`DROP TABLE IF EXISTS kb_chunks`);
    });

    afterEach(async () => {
      await testPool.query(`DELETE FROM pm_schedules WHERE tenant_id IN ($1, $2)`, [
        TENANT_A,
        TENANT_B,
      ]);
      await testPool.query(`DELETE FROM kb_chunks WHERE tenant_id IN ($1, $2)`, [
        TENANT_A,
        TENANT_B,
      ]);
    });

    it("counts are tenant-scoped", async () => {
      const created = track(
        await createUpload({ tenantId: TENANT_A, provider: "google", filename: "shared-name.pdf" }),
      );
      const upload = (await getUpload(created.id, TENANT_A)) as Upload;

      // One matching row per tenant — proves the query filters by tenant_id
      // rather than returning every matching-filename row across tenants.
      await testPool.query(
        `INSERT INTO pm_schedules (tenant_id, source_citation) VALUES ($1, $2), ($3, $2)`,
        [TENANT_A, "shared-name.pdf", TENANT_B],
      );
      await testPool.query(
        `INSERT INTO kb_chunks (tenant_id, source, doc_type, title) VALUES
           ($1, $2, 'fault_code', 'x'), ($3, $2, 'fault_code', 'x')`,
        [TENANT_A, "shared-name.pdf", TENANT_B],
      );

      const countsA = await getUploadCounts(upload, TENANT_A);
      expect(countsA.pm_tasks_count).toBe(1);
      expect(countsA.fault_codes_count).toBe(1);

      const countsB = await getUploadCounts(upload, TENANT_B);
      expect(countsB.pm_tasks_count).toBe(1);
      expect(countsB.fault_codes_count).toBe(1);
    });
  });
});
