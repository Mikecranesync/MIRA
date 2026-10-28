// #4878 (Codex #4664 F1/F2/F4) — real-Postgres proof for the concurrency-safe
// 5-org cohort cap and 5-seat-per-org cap. The mocked-pool suite in
// pilot-access.test.ts proves the SQL/branch shape; this suite proves the
// actual pg_advisory_xact_lock serialization and COUNT semantics under real
// concurrent connections — no mock can substitute for that.
//
// Requires (local/disposable only — never staging/prod):
//   TEST_DATABASE_URL      postgres
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
// Run: npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/pilot-access.integration.test.ts
//
// Bootstraps hub_tenants/hub_users itself (ensureSchema(), code-bootstrap —
// no migration file creates them, mira-hub-migrations.md rule 8) and then
// applies 107_pilot_access.sql directly, rather than going through
// scripts/setup-integration-db.mjs's migration-file list: that script never
// runs ensureSchema(), so 107's `ALTER TABLE hub_tenants` would hit a
// relation that doesn't exist yet if ordered the other way.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});

vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import { ensureSchema } from "@/lib/users";
import { PILOT_COHORT_MAX_ORGS, PILOT_SEAT_MAX_USERS } from "@/lib/config";
import {
  PilotCohortCapError,
  PilotSeatCapError,
  approvePilotTenant,
  redeemPilotSeat,
  reservePilotSeat,
} from "../pilot-access";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARK = randomUUID().slice(0, 8);

async function makeTenant(name: string): Promise<{ tenantId: string; ownerId: string }> {
  const {
    rows: [tenant],
  } = await testPool.query(`INSERT INTO hub_tenants (name) VALUES ($1) RETURNING id`, [name]);
  const tenantId = String(tenant.id);
  const {
    rows: [owner],
  } = await testPool.query(
    `INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, 'trial') RETURNING id`,
    [`owner-${MARK}-${tenantId}@example.com`, tenantId],
  );
  await testPool.query(`UPDATE hub_tenants SET owner_user_id = $1 WHERE id = $2`, [
    String(owner.id),
    tenantId,
  ]);
  return { tenantId, ownerId: String(owner.id) };
}

async function activateDirectly(tenantId: string): Promise<void> {
  await testPool.query(
    `UPDATE hub_tenants SET pilot_status = 'active', pilot_approved_at = NOW(), pilot_expires_at = NOW() + INTERVAL '30 days', pilot_approved_by = 'seed' WHERE id = $1`,
    [tenantId],
  );
}

async function activeOrgCount(): Promise<number> {
  const { rows } = await testPool.query(
    `SELECT COUNT(*)::int AS n FROM hub_tenants WHERE pilot_status = 'active'`,
  );
  return Number(rows[0].n);
}

describe.skipIf(!READY)("pilot access against real Postgres (#4878, Codex #4664 F1/F2/F4)", () => {
  const testTenantIds: string[] = [];

  beforeAll(async () => {
    await testPool.query(
      "DO $$ BEGIN CREATE ROLE factorylm_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$",
    );
    await ensureSchema();
    const migrationSql = await fs.readFile(
      path.resolve(__dirname, "../../../db/migrations/107_pilot_access.sql"),
      "utf8",
    );
    await testPool.query(migrationSql);
  });

  beforeEach(() => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
  });

  afterAll(async () => {
    delete process.env.MIRA_PILOT_APPROVAL_REQUIRED;
    if (testTenantIds.length) {
      await testPool.query(`DELETE FROM pilot_seat_reservations WHERE tenant_id = ANY($1)`, [
        testTenantIds,
      ]);
      await testPool.query(`DELETE FROM hub_users WHERE tenant_id = ANY($1)`, [testTenantIds]);
      await testPool.query(`DELETE FROM hub_tenants WHERE id = ANY($1)`, [testTenantIds]);
    }
    await testPool.end();
  });

  it("two concurrent approvals with 4 orgs already active: exactly one wins, the other gets the cohort cap", async () => {
    // Precondition, asserted rather than assumed (prove-the-test-fails.md
    // rule 5) — this test's "4 active, 5 is the cap" framing is only valid
    // against a clean slate.
    expect(await activeOrgCount()).toBe(0);

    const seeded = await Promise.all(
      Array.from({ length: PILOT_COHORT_MAX_ORGS - 1 }, (_, i) => makeTenant(`seed-org-${MARK}-${i}`)),
    );
    for (const { tenantId } of seeded) {
      testTenantIds.push(tenantId);
      await activateDirectly(tenantId);
    }
    expect(await activeOrgCount()).toBe(PILOT_COHORT_MAX_ORGS - 1);

    const candidateA = await makeTenant(`candidate-a-${MARK}`);
    const candidateB = await makeTenant(`candidate-b-${MARK}`);
    testTenantIds.push(candidateA.tenantId, candidateB.tenantId);

    const results = await Promise.allSettled([
      approvePilotTenant(candidateA.tenantId, "admin-1"),
      approvePilotTenant(candidateB.tenantId, "admin-1"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PilotCohortCapError);
    expect(await activeOrgCount()).toBe(PILOT_COHORT_MAX_ORGS);
  });

  it("two concurrent invites with 4 seats occupied: exactly one wins, the other gets the seat cap", async () => {
    const { tenantId } = await makeTenant(`seat-org-${MARK}`);
    testTenantIds.push(tenantId);
    await activateDirectly(tenantId);

    // 3 more members beyond the owner = 4 occupied seats.
    for (let i = 0; i < 3; i++) {
      await testPool.query(
        `INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, 'trial')`,
        [`crew-${MARK}-${i}@example.com`, tenantId],
      );
    }

    const results = await Promise.allSettled([
      reservePilotSeat(tenantId, `fifth-${MARK}@example.com`),
      reservePilotSeat(tenantId, `sixth-${MARK}@example.com`),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PilotSeatCapError);

    const { rows } = await testPool.query(
      `SELECT COUNT(DISTINCT email_lower)::int AS n FROM (
         SELECT email_lower FROM hub_users WHERE tenant_id = $1
         UNION
         SELECT email_lower FROM pilot_seat_reservations WHERE tenant_id = $1
       ) seats`,
      [tenantId],
    );
    expect(Number(rows[0].n)).toBe(PILOT_SEAT_MAX_USERS);
  });

  it("redemption never exceeds 5 — redeeming a seat never frees it for a new reservation", async () => {
    const { tenantId } = await makeTenant(`redeem-org-${MARK}`);
    testTenantIds.push(tenantId);
    await activateDirectly(tenantId);

    for (let i = 0; i < 3; i++) {
      await testPool.query(
        `INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, 'trial')`,
        [`crew-${MARK}-r${i}@example.com`, tenantId],
      );
    }
    // Fills the 5th seat.
    const fifthEmail = `fifth-${MARK}@example.com`;
    await expect(reservePilotSeat(tenantId, fifthEmail)).resolves.toEqual({ reserved: true });

    // Redeem it (simulates the invitee actually signing in).
    await redeemPilotSeat(tenantId, fifthEmail);
    const { rows: redeemedRow } = await testPool.query(
      `SELECT status FROM pilot_seat_reservations WHERE tenant_id = $1 AND email_lower = $2`,
      [tenantId, fifthEmail],
    );
    expect(redeemedRow[0].status).toBe("redeemed");

    // A sixth invite must still be rejected — redemption did not free a seat.
    await expect(reservePilotSeat(tenantId, `sixth-${MARK}@example.com`)).rejects.toBeInstanceOf(
      PilotSeatCapError,
    );

    const { rows } = await testPool.query(
      `SELECT COUNT(DISTINCT email_lower)::int AS n FROM (
         SELECT email_lower FROM hub_users WHERE tenant_id = $1
         UNION
         SELECT email_lower FROM pilot_seat_reservations WHERE tenant_id = $1
       ) seats`,
      [tenantId],
    );
    expect(Number(rows[0].n)).toBe(PILOT_SEAT_MAX_USERS);
  });
});
