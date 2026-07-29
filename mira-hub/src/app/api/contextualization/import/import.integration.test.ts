// Requires a disposable Postgres/Neon test DB.
//
//   $env:TEST_DATABASE_URL="postgres://..."
//   $env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   npm run test:integration:db
//
// The setup command creates the factorylm_app role, applies integration-only
// fixtures, applies Hub migrations, and runs smoke checks before Vitest.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Pool } from "pg";

// Build the test pool (no SSL — the lib's default pool forces SSL, which a local
// postgres:16 rejects) before imports, and inject it as the @/lib/db default so
// withTenantContext runs against the test DB. require() in vi.hoisted is fine in vitest.
const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));

import { POST } from "./route";
import { sessionOr401 } from "@/lib/session";

const TENANT = "000000c1-0000-0000-0000-0000000000c1";
const SHA_A = "a".repeat(64);
const SHA_SRC = "c".repeat(64);

const sessionOr401Mock = vi.mocked(sessionOr401);

function envelope(): Record<string, unknown> {
  return {
    contract_version: "contextualization-intake/v1",
    ingest_route: "offline",
    project_hint: "Garage Demo / Micro820 Conveyor",
    bundle_sha256: SHA_A,
    review_status: "proposed",
    sources: [
      {
        source_sha256: SHA_SRC,
        source_type: "st",
        source_metadata: { file_name: "Micro820.st", mime: "text/plain", uploader: "mike" },
      },
    ],
    proposed_signals: [
      { tag_name: "Conv_Run", roles: ["output"], uns_path: "enterprise.garage.demo.conv.run", confidence: 0.9, source_sha256: SHA_SRC },
    ],
  };
}

function jsonReq(body: unknown): Request {
  return new Request("http://test/api/contextualization/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required for the import integration test. See header.");
  }
  process.env.NEON_DATABASE_URL = process.env.TEST_DATABASE_URL; // satisfy the route's 503 guard
});

afterAll(async () => {
  await testPool.end();
});

beforeEach(async () => {
  vi.clearAllMocks();
  // superuser connection bypasses RLS for cleanup; CASCADE clears sources/batches/extractions.
  await testPool.query("DELETE FROM contextualization_projects WHERE tenant_id = $1", [TENANT]);
  sessionOr401Mock.mockResolvedValue({
    userId: "u_test",
    tenantId: TENANT,
    email: "tester@example.com",
    status: "active",
    trialExpiresAt: null,
  });
});

describe("POST /api/contextualization/import — intake contract", () => {
  it("accepts the intake contract and stages a project + source + extraction (test 1)", async () => {
    const res = await POST(jsonReq(envelope()));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.sources).toBe(1);
    expect(body.extractions).toBe(1);

    const proj = await testPool.query("SELECT count(*)::int AS n FROM contextualization_projects WHERE tenant_id=$1", [TENANT]);
    expect(proj.rows[0].n).toBe(1);
  });

  it("does not duplicate a source with the same sha256 on re-import (test 3)", async () => {
    const first = await POST(jsonReq(envelope()));
    expect(first.status).toBe(201);
    const second = await POST(jsonReq(envelope()));
    expect(second.status).toBe(201);

    const src = await testPool.query(
      "SELECT count(*)::int AS n FROM ctx_sources WHERE tenant_id=$1 AND source_sha256=$2",
      [TENANT, SHA_SRC],
    );
    expect(src.rows[0].n).toBe(1); // deduped — exactly one source row.

    const proj = await testPool.query("SELECT count(*)::int AS n FROM contextualization_projects WHERE tenant_id=$1", [TENANT]);
    expect(proj.rows[0].n).toBe(1); // bundle dedup — one project.
  });

  it("everything lands proposed — batch review_status=proposed, no accepted extraction", async () => {
    await POST(jsonReq(envelope()));
    const batch = await testPool.query("SELECT review_status FROM ctx_import_batches WHERE tenant_id=$1", [TENANT]);
    expect(batch.rows[0].review_status).toBe("proposed");
    const accepted = await testPool.query(
      "SELECT count(*)::int AS n FROM ctx_extractions WHERE tenant_id=$1 AND status='accepted'",
      [TENANT],
    );
    expect(accepted.rows[0].n).toBe(0);
  });

  it("rejects a malformed contract with 400", async () => {
    const bad = { ...envelope(), ingest_route: "pigeon" };
    const res = await POST(jsonReq(bad));
    expect(res.status).toBe(400);
  });
});
