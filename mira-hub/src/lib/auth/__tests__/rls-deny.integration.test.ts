// mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts
//
// Integration test that proves Row-Level Security actually denies cross-tenant
// reads. This is THE test that should have shipped with #578. Without it,
// nothing else in the auth stack is trustworthy.
//
// Requires: a Postgres test database with the migrations through #578 applied.
// Provide via env:   TEST_DATABASE_URL=postgres://...
// Locally, you can spin one up via docker-compose:
//
//   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test \
//     --name mira-rls-test postgres:16
//   psql postgres://postgres:test@localhost:5433/postgres \
//     -f mira-hub/db/migrations/2026-04-24-003-asset-hierarchy.sql \
//     -f mira-hub/db/migrations/2026-04-24-008-tenants-rls.sql
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres \
//     npx vitest run src/lib/auth/__tests__/rls-deny.integration.test.ts
//
// CI: spin a fresh ephemeral container per run.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { withTenant, withServiceRole } from "../session";
import type { Session } from "../session";

// We override the default pool by reassigning the import target. In the
// real app, src/lib/db.ts exports a singleton pool sourced from
// NEON_DATABASE_URL; here we point at TEST_DATABASE_URL.
let testPool: Pool;

function makeSession(tenantId: string, userId = "u_test"): Session {
  return {
    userId,
    tenantId,
    role: "member",
    exp: Date.now() / 1000 + 3600,
  };
}

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is required for the RLS integration test. " +
        "See test header for setup instructions.",
    );
  }
  testPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

  // Patch the module-level pool the lib uses. The library imports `pool`
  // from "@/lib/db"; in tests we monkey-patch that module's export.
  const dbModule = await import("@/lib/db");
  // @ts-expect-error — test-only override
  dbModule.default = testPool;
});

afterAll(async () => {
  await testPool.end();
});

beforeEach(async () => {
  // Each test runs with a fresh dataset. Use the service role to set up,
  // because the seed includes BOTH tenants (one tenant context can't insert
  // for the other).
  await withServiceRole(null, async (client) => {
    await client.query(`DELETE FROM cmms_equipment WHERE id::text LIKE 'eq_%'`);
    await client.query(`DELETE FROM cmms_areas WHERE id::text LIKE 'a_%'`);
    await client.query(`DELETE FROM cmms_sites WHERE id::text LIKE 's_%'`);
    await client.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [TENANT_A, TENANT_B]);

    // Two tenants.
    await client.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES
         ($1, 'tenant-a', 'Tenant A', 'active'),
         ($2, 'tenant-b', 'Tenant B', 'active')`,
      [TENANT_A, TENANT_B],
    );

    // One site per tenant, one area, one equipment.
    for (const t of [TENANT_A, TENANT_B]) {
      const { rows: siteRows } = await client.query(
        `INSERT INTO cmms_sites (tenant_id, slug, name) VALUES ($1, 'site-1', 'Site 1') RETURNING id`,
        [t],
      );
      const { rows: areaRows } = await client.query(
        `INSERT INTO cmms_areas (tenant_id, site_id, slug, name) VALUES ($1, $2, 'area-1', 'Area 1') RETURNING id`,
        [t, siteRows[0].id],
      );
      await client.query(
        `INSERT INTO cmms_equipment
           (tenant_id, equipment_number, manufacturer, site_id, area_id, slug, path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          t,
          `eq-${t.slice(-1)}`,
          "Acme Corp",
          siteRows[0].id,
          areaRows[0].id,
          `eq-${t.slice(-1)}`,
          `/site-1/area-1/eq-${t.slice(-1)}`,
        ],
      );
    }
  });
});

describe("RLS — tenant isolation", () => {
  it("tenant A sees its own equipment", async () => {
    const session = makeSession(TENANT_A);
    const rows = await withTenant(session, (client) =>
      client.query("SELECT equipment_number FROM cmms_equipment").then((r) => r.rows),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].equipment_number).toBe("eq-a");
  });

  it("tenant A CANNOT see tenant B's equipment", async () => {
    const session = makeSession(TENANT_A);
    const rows = await withTenant(session, (client) =>
      client
        .query(
          "SELECT equipment_number FROM cmms_equipment WHERE equipment_number = 'eq-b'",
        )
        .then((r) => r.rows),
    );
    expect(rows).toHaveLength(0); // RLS denial — row exists but is invisible.
  });

  it("tenant A cannot INSERT a row tagged for tenant B (WITH CHECK denies)", async () => {
    const session = makeSession(TENANT_A);
    const insertB = withTenant(session, (client) =>
      client.query(
        `INSERT INTO cmms_equipment
           (tenant_id, equipment_number, manufacturer, slug, path)
         VALUES ($1, 'eq-evil', 'Evil', 'eq-evil', '/x/y/eq-evil')`,
        [TENANT_B],
      ),
    );
    await expect(insertB).rejects.toThrow(); // policy violation, not 0 rows.
  });

  it("tenant A cannot UPDATE tenant B's row (USING denies the row from being seen)", async () => {
    const session = makeSession(TENANT_A);
    const result = await withTenant(session, (client) =>
      client.query(
        `UPDATE cmms_equipment SET manufacturer = 'PWNED' WHERE equipment_number = 'eq-b'`,
      ),
    );
    expect(result.rowCount).toBe(0); // row invisible to A → 0 rows updated.

    // Verify B's row is unchanged from B's own session.
    const sessionB = makeSession(TENANT_B);
    const { rows } = await withTenant(sessionB, (client) =>
      client.query(`SELECT manufacturer FROM cmms_equipment WHERE equipment_number = 'eq-b'`),
    );
    expect(rows[0].manufacturer).toBe("Acme Corp");
  });

  it("missing mira.tenant_id (no withTenant wrapper) → no rows visible", async () => {
    // Connect outside withTenant() to simulate a route that forgot to wrap.
    // Setting nothing means current_setting('mira.tenant_id', true) returns NULL,
    // and `NULL = uuid` is NULL, treated as false → all rows hidden.
    const client = await testPool.connect();
    try {
      const { rows } = await client.query("SELECT * FROM cmms_equipment");
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it("service role sees both tenants (worker bypass)", async () => {
    const rows = await withServiceRole(null, (client) =>
      client.query("SELECT equipment_number FROM cmms_equipment ORDER BY equipment_number").then((r) => r.rows),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.equipment_number)).toEqual(["eq-a", "eq-b"]);
  });

  it("withTenant ROLLBACKs on error and releases the client", async () => {
    const session = makeSession(TENANT_A);
    const failing = withTenant(session, async (client) => {
      await client.query(
        `INSERT INTO cmms_equipment (tenant_id, equipment_number, manufacturer, slug, path)
         VALUES ($1, 'eq-temp', 'TMP', 'eq-temp', '/x/y/eq-temp')`,
        [TENANT_A],
      );
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");

    // Verify the insert rolled back.
    const sessionA = makeSession(TENANT_A);
    const { rows } = await withTenant(sessionA, (client) =>
      client.query(`SELECT 1 FROM cmms_equipment WHERE equipment_number = 'eq-temp'`),
    );
    expect(rows).toHaveLength(0);
  });

  it("audit log is append-only — UPDATE returns 0 rows", async () => {
    // After the audit-log immutability fix (separate FOR INSERT + FOR SELECT
    // policies), no app-role session can UPDATE/DELETE tenant_audit_log.
    const session = makeSession(TENANT_A);

    // Seed a row.
    await withTenant(session, (client) =>
      client.query(
        `INSERT INTO tenant_audit_log (tenant_id, actor_id, action, resource_type, resource_id, payload)
         VALUES ($1, $2, 'test.action', 'test', $3, $4)`,
        [TENANT_A, "u_test", "00000000-0000-0000-0000-000000000001", JSON.stringify({})],
      ),
    );

    const update = withTenant(session, (client) =>
      client.query(`UPDATE tenant_audit_log SET action = 'tampered' WHERE tenant_id = $1`, [TENANT_A]),
    );
    // After the immutability fix lands, this should throw or return rowCount 0.
    // If neither, the policy hasn't been split — fail with a useful message.
    const result = await update.catch((e) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/policy|permission|denied/i);
    } else {
      expect(result.rowCount).toBe(0);
    }
  });
});
