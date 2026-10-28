// F10 (Codex #4882 post-cap review) — real-Postgres proof that the LEGACY
// admin-user-status route (PATCH /api/admin/users/[id]) can no longer be
// used to bypass pilot governance: a pending pilot applicant cannot be
// granted 'approved' with no expiry through this door, and the 5-org cohort
// cap still holds even when an admin tries this route instead of the
// dedicated POST /api/admin/pilots/[tenantId]/approve endpoint.
//
// Requires (local/disposable only — never staging/prod):
//   TEST_DATABASE_URL      postgres
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
// Run: npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/admin-user-status-pilot-gate.integration.test.ts

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
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn() }));

import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { ensureSchema } from "@/lib/users";
import { approvePilotTenant } from "@/capabilities/pilot-access";
import { PATCH as patchUserStatus } from "@/app/(hub)/api/admin/users/[id]/route";

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
    [`owner-${name}@example.com`, tenantId],
  );
  const ownerId = String(owner.id);
  await testPool.query(`UPDATE hub_tenants SET owner_user_id = $1 WHERE id = $2`, [ownerId, tenantId]);
  return { tenantId, ownerId };
}

async function makeUser(tenantId: string, email: string, status: string): Promise<string> {
  const {
    rows: [user],
  } = await testPool.query(`INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, $3) RETURNING id`, [
    email,
    tenantId,
    status,
  ]);
  return String(user.id);
}

function mockCallerSession(uid: string, tid: string) {
  vi.mocked(decode).mockResolvedValue({ uid, tid, email: `${uid}@example.com`, status: "trial" } as never);
}

function patch(targetId: string, status: string) {
  return patchUserStatus(
    new Request(`http://hub.test/hub/api/admin/users/${targetId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: targetId }) },
  );
}

describe.skipIf(!READY)("legacy admin-user-status PATCH cannot bypass pilot governance (F10, #4882)", () => {
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
    vi.mocked(cookies).mockResolvedValue({
      get: (n: string) => (n === "__Secure-next-auth.session-token" ? { value: "jwt" } : undefined),
    } as never);
  });

  afterAll(async () => {
    delete process.env.MIRA_PILOT_APPROVAL_REQUIRED;
    if (testTenantIds.length) {
      await testPool.query(`DELETE FROM hub_users WHERE tenant_id = ANY($1)`, [testTenantIds]);
      await testPool.query(`DELETE FROM hub_tenants WHERE id = ANY($1)`, [testTenantIds]);
    }
    await testPool.end();
  });

  it("a pending pilot applicant cannot gain approved-without-expiry via the legacy PATCH route", async () => {
    // The admin tenant + caller (needs a REAL hub_users row with
    // status='admin' so requireSession()'s DB lookup derives platformAdmin).
    const { tenantId: adminTenantId } = await makeTenant(`f10-admin-tenant-${MARK}`);
    testTenantIds.push(adminTenantId);
    const adminUserId = await makeUser(adminTenantId, `f10-admin-${MARK}@example.com`, "admin");
    mockCallerSession(adminUserId, adminTenantId);

    // A pending pilot applicant: the tenant is pilot_status='pending', the
    // owner-applicant row is status='pending' — exactly what signup leaves
    // behind under MIRA_PILOT_APPROVAL_REQUIRED (ensureUserAndTenant).
    const { tenantId: applicantTenantId } = await makeTenant(`f10-applicant-${MARK}`);
    testTenantIds.push(applicantTenantId);
    await testPool.query(`UPDATE hub_tenants SET pilot_status = 'pending' WHERE id = $1`, [applicantTenantId]);
    const applicantId = await makeUser(applicantTenantId, `f10-applicant-${MARK}@example.com`, "pending");
    await testPool.query(`UPDATE hub_tenants SET owner_user_id = $1 WHERE id = $2`, [applicantId, applicantTenantId]);

    const res = await patch(applicantId, "approved");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/\/api\/admin\/pilots\/.*\/approve/);

    // The applicant and tenant are UNTOUCHED — no approved-without-expiry,
    // the exact bug this test exists to prove is closed.
    const { rows: userRows } = await testPool.query(
      `SELECT status, trial_expires_at FROM hub_users WHERE id = $1`,
      [applicantId],
    );
    expect(userRows[0].status).toBe("pending");
    expect(userRows[0].trial_expires_at).toBeNull();
    const { rows: tenantRows } = await testPool.query(`SELECT pilot_status FROM hub_tenants WHERE id = $1`, [
      applicantTenantId,
    ]);
    expect(tenantRows[0].pilot_status).toBe("pending");
  });

  it("the 5-org cohort cap cannot be bypassed through the legacy PATCH route either", async () => {
    const { tenantId: adminTenantId } = await makeTenant(`f10-admin-tenant2-${MARK}`);
    testTenantIds.push(adminTenantId);
    const adminUserId = await makeUser(adminTenantId, `f10-admin2-${MARK}@example.com`, "admin");
    mockCallerSession(adminUserId, adminTenantId);

    // Fill the 5-org cohort for real, via the real approvePilotTenant.
    for (let i = 0; i < 5; i++) {
      const { tenantId } = await makeTenant(`f10-cohort-${MARK}-${i}`);
      testTenantIds.push(tenantId);
      await approvePilotTenant(tenantId, adminUserId);
    }

    // A 6th tenant, pending, tries the legacy PATCH door instead of the
    // real endpoint. It must be refused — not "succeed anyway because the
    // cohort is full and this route never checked" (that IS the F10 bug) —
    // this route refuses unconditionally for a pilot-tracked tenant, so the
    // cohort cap can never be bypassed through it, full or not.
    const { tenantId: applicantTenantId } = await makeTenant(`f10-sixth-${MARK}`);
    testTenantIds.push(applicantTenantId);
    await testPool.query(`UPDATE hub_tenants SET pilot_status = 'pending' WHERE id = $1`, [applicantTenantId]);
    const applicantId = await makeUser(applicantTenantId, `f10-sixth-applicant-${MARK}@example.com`, "pending");
    await testPool.query(`UPDATE hub_tenants SET owner_user_id = $1 WHERE id = $2`, [applicantId, applicantTenantId]);

    const res = await patch(applicantId, "approved");
    expect(res.status).toBe(409);
    const { rows: userRows } = await testPool.query(`SELECT status FROM hub_users WHERE id = $1`, [applicantId]);
    expect(userRows[0].status).toBe("pending");
  });
});
