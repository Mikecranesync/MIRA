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
  PilotTenantNotActiveError,
  admitPilotInvite,
  approvePilotTenant,
  endPilotTenant,
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

async function occupiedSeatCount(tenantId: string): Promise<number> {
  const { rows } = await testPool.query(
    `SELECT COUNT(DISTINCT email_lower)::int AS n FROM (
       SELECT email_lower FROM hub_users WHERE tenant_id = $1
       UNION
       SELECT email_lower FROM pilot_seat_reservations WHERE tenant_id = $1
     ) seats`,
    [tenantId],
  );
  return Number(rows[0].n);
}

/** Mirrors ensureInvitedUser's real transactional shape: admitPilotInvite
 *  runs inside the SAME open transaction/lock the caller commits. */
async function runAdmit(tenantId: string, email: string) {
  const client = await testPool.connect();
  try {
    await client.query("BEGIN");
    const result = await admitPilotInvite(client, tenantId, email);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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

  it("F1 — endPilotTenant genuinely BLOCKS while a redemption holds the tenant lock, it does not race it", async () => {
    // Proves the mechanism, not just an outcome a scheduler happened to
    // pick: a second transaction on the SAME tenant lock cannot proceed
    // until the first commits, so a redemption can never observe a stale
    // 'active' snapshot concurrently with termination committing 'ended'.
    const { tenantId } = await makeTenant(`f1-lock-org-${MARK}`);
    testTenantIds.push(tenantId);
    await activateDirectly(tenantId);

    const holdClient = await testPool.connect();
    try {
      await holdClient.query("BEGIN");
      await holdClient.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [778899002, tenantId]);

      const start = Date.now();
      const endPromise = endPilotTenant(tenantId);

      // Give endPilotTenant ample time to attempt the lock and block.
      await new Promise((r) => setTimeout(r, 300));
      const raceResult = await Promise.race([
        endPromise.then(() => "resolved" as const),
        new Promise<"still-pending">((r) => setTimeout(() => r("still-pending"), 0)),
      ]);
      expect(raceResult).toBe("still-pending");

      await holdClient.query("COMMIT");
      await expect(endPromise).resolves.toEqual({ ended: true });
      expect(Date.now() - start).toBeGreaterThanOrEqual(290);
    } finally {
      holdClient.release();
    }
  });

  it("F1 — a token issued while active, redeemed after the admin ends the pilot, never creates access", async () => {
    const { tenantId } = await makeTenant(`f1-race-org-${MARK}`);
    testTenantIds.push(tenantId);
    await activateDirectly(tenantId);
    const email = `late-redeemer-${MARK}@example.com`;
    await reservePilotSeat(tenantId, email); // the live, still-unredeemed reservation/token

    await expect(endPilotTenant(tenantId)).resolves.toEqual({ ended: true });

    // The pilot has now ended. Redeeming the still-live token must be rejected.
    await expect(runAdmit(tenantId, email)).rejects.toBeInstanceOf(PilotTenantNotActiveError);
    const { rows } = await testPool.query(
      `SELECT COUNT(*)::int AS n FROM hub_users WHERE tenant_id = $1 AND email_lower = $2`,
      [tenantId, email],
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("F2 — two concurrent redemptions of tokens with NO reservation on record, at 4 occupied: exactly one wins", async () => {
    const { tenantId } = await makeTenant(`f2-org-${MARK}`);
    testTenantIds.push(tenantId);
    await activateDirectly(tenantId);
    for (let i = 0; i < 3; i++) {
      await testPool.query(`INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, 'trial')`, [
        `f2-crew-${MARK}-${i}@example.com`,
        tenantId,
      ]);
    }
    expect(await occupiedSeatCount(tenantId)).toBe(4);

    // Neither email was ever reserved — simulates two tokens issued before
    // the tenant was ever capacity-checked. admitPilotInvite must still
    // re-check capacity live, with exactly one winner.
    const results = await Promise.allSettled([
      runAdmit(tenantId, `f2-unreserved-a-${MARK}@example.com`),
      runAdmit(tenantId, `f2-unreserved-b-${MARK}@example.com`),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PilotSeatCapError);
    expect(await occupiedSeatCount(tenantId)).toBe(PILOT_SEAT_MAX_USERS);
  });

  it("F3 — approving a tenant moves an existing 'approved' crew member to trial, and leaves a platform admin untouched", async () => {
    // Free the cohort entirely: earlier tests in this file leave active
    // tenants behind (cleanup is afterAll-only), so this test's own
    // approval would otherwise 409 on the COHORT cap — a test-ordering
    // artifact, not the thing F3 is proving.
    await testPool.query(`UPDATE hub_tenants SET pilot_status = 'ended' WHERE pilot_status = 'active'`);
    expect(await activeOrgCount()).toBe(0);

    const { tenantId } = await makeTenant(`f3-org-${MARK}`);
    testTenantIds.push(tenantId);

    const {
      rows: [crew],
    } = await testPool.query(
      `INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, 'approved') RETURNING id`,
      [`f3-crew-${MARK}@example.com`, tenantId],
    );
    const {
      rows: [admin],
    } = await testPool.query(
      `INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, 'admin') RETURNING id`,
      [`f3-admin-${MARK}@example.com`, tenantId],
    );

    const result = await approvePilotTenant(tenantId, "approving-admin");
    expect(result.status).toBe("activated");

    const { rows } = await testPool.query(
      `SELECT id, status, trial_expires_at FROM hub_users WHERE tenant_id = $1 ORDER BY email`,
      [tenantId],
    );
    const byId = new Map(
      rows.map((r: { id: string; status: string; trial_expires_at: string }) => [String(r.id), r]),
    );

    const crewRow = byId.get(String(crew.id));
    expect(crewRow?.status).toBe("trial");
    expect(new Date(crewRow!.trial_expires_at).toISOString()).toBe(result.tenant.pilotExpiresAt);

    const adminRow = byId.get(String(admin.id));
    expect(adminRow?.status).toBe("admin");
  });

  it("F3 — approvePilotTenant genuinely BLOCKS while a redemption holds the tenant lock (the mechanism, proven directly)", async () => {
    const { tenantId } = await makeTenant(`f3-block-${MARK}`);
    testTenantIds.push(tenantId);
    await testPool.query(
      `UPDATE hub_tenants SET pilot_status = 'ended' WHERE pilot_status = 'active' AND id <> $1`,
      [tenantId],
    );

    const holdClient = await testPool.connect();
    try {
      await holdClient.query("BEGIN");
      // The identical lock admitPilotInvite/endPilotTenant take.
      await holdClient.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [778899002, tenantId]);

      const start = Date.now();
      // approvePromise may settle (fulfill OR reject) before this test ever
      // awaits it directly below — give it a handler immediately so an
      // early rejection (e.g. this test failing under a mutation) can never
      // surface as an unhandled rejection that corrupts a LATER test.
      const approvePromise = approvePilotTenant(tenantId, "admin-f3-block");
      const approveSettled = approvePromise.then(
        () => "resolved" as const,
        () => "resolved" as const,
      );

      await new Promise((r) => setTimeout(r, 300));
      const raceResult = await Promise.race([
        approveSettled,
        new Promise<"still-pending">((r) => setTimeout(() => r("still-pending"), 0)),
      ]);
      expect(raceResult).toBe("still-pending");

      await holdClient.query("COMMIT");
      const result = await approvePromise;
      expect(result.status).toBe("activated");
      expect(Date.now() - start).toBeGreaterThanOrEqual(290);
    } catch (err) {
      await holdClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      holdClient.release();
    }
  });

  it("F3 — a redemption that already decided 'legacy' (held open, uncommitted) blocks approval until it commits; approval's sweep still converts it to trial, never leaves it approved", async () => {
    // A LEGACY tenant: pilot_status is NULL (never activated), exactly the
    // precondition Codex's F3 evidence names.
    const { tenantId } = await makeTenant(`f3-interleave-${MARK}`);
    testTenantIds.push(tenantId);
    await testPool.query(
      `UPDATE hub_tenants SET pilot_status = 'ended' WHERE pilot_status = 'active' AND id <> $1`,
      [tenantId],
    );
    const email = `f3-interleave-member-${MARK}@example.com`;

    const admitClient = await testPool.connect();
    try {
      await admitClient.query("BEGIN");
      // Reproduces admitPilotInvite's own first two steps exactly: the
      // tenant-scoped lock, then the FOR UPDATE tenant read — decides
      // "legacy" (NULL), exactly as the real function would, with its
      // hub_users write still pending (not yet issued).
      await admitClient.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [778899002, tenantId]);
      const { rows: tenantSnap } = await admitClient.query(
        "SELECT pilot_status FROM hub_tenants WHERE id = $1 LIMIT 1 FOR UPDATE",
        [tenantId],
      );
      expect(tenantSnap[0].pilot_status).toBeNull();

      // Approval attempts to run concurrently — it must BLOCK on the tenant
      // lock this in-flight "redemption" still holds. Same early-settle
      // handler as the sibling F3 test above: approvePromise must not be
      // allowed to surface an unhandled rejection if it settles early under
      // a mutation, since that would hang this test on the final `await` or
      // leak a rejection into a later test's process.
      const approvePromise = approvePilotTenant(tenantId, "admin-f3-interleave");
      const approveSettled = approvePromise.then(
        () => "resolved" as const,
        () => "resolved" as const,
      );
      await new Promise((r) => setTimeout(r, 300));
      const raceResult = await Promise.race([
        approveSettled,
        new Promise<"still-pending">((r) => setTimeout(() => r("still-pending"), 0)),
      ]);
      expect(raceResult).toBe("still-pending");

      // The "redemption" now completes its legacy-branch write and commits
      // — exactly what ensureInvitedUser's non-pilot branch does.
      await admitClient.query(
        `INSERT INTO hub_users (email, tenant_id, name, role, status) VALUES ($1, $2, NULL, 'technician', 'approved')`,
        [email, tenantId],
      );
      await admitClient.query("COMMIT");

      const approveResult = await approvePromise;
      expect(approveResult.status).toBe("activated");
    } catch (err) {
      await admitClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      admitClient.release();
    }

    const { rows } = await testPool.query(
      `SELECT status, trial_expires_at FROM hub_users WHERE tenant_id = $1 AND email_lower = $2`,
      [tenantId, email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("trial");
    expect(rows[0].status).not.toBe("approved");
    expect(rows[0].trial_expires_at).not.toBeNull();
  });

  it("F5 — approving a legacy tenant with 6 existing members is rejected; tenant stays not-active, nobody converted", async () => {
    const { tenantId, ownerId } = await makeTenant(`f5-over-${MARK}`);
    testTenantIds.push(tenantId);
    const crewIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const {
        rows: [crew],
      } = await testPool.query(
        `INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, 'approved') RETURNING id`,
        [`f5-over-crew-${MARK}-${i}@example.com`, tenantId],
      );
      crewIds.push(String(crew.id));
    }
    // owner + 5 crew = 6 total non-admin members.

    await expect(approvePilotTenant(tenantId, "admin-f5-over")).rejects.toBeInstanceOf(
      PilotSeatCapError,
    );

    const { rows: tenantRows } = await testPool.query(
      `SELECT pilot_status FROM hub_tenants WHERE id = $1`,
      [tenantId],
    );
    expect(tenantRows[0].pilot_status).toBeNull();

    const { rows: ownerRows } = await testPool.query(`SELECT status FROM hub_users WHERE id = $1`, [
      ownerId,
    ]);
    expect(ownerRows[0].status).toBe("trial"); // unchanged from makeTenant's seed value
    const { rows: crewRows } = await testPool.query(
      `SELECT status FROM hub_users WHERE id = ANY($1)`,
      [crewIds],
    );
    expect(crewRows.every((r: { status: string }) => r.status === "approved")).toBe(true);
  });

  it("CONTROL — approving a legacy tenant with exactly 5 existing members succeeds", async () => {
    const { tenantId } = await makeTenant(`f5-at-cap-${MARK}`);
    testTenantIds.push(tenantId);
    for (let i = 0; i < 4; i++) {
      await testPool.query(
        `INSERT INTO hub_users (email, tenant_id, status) VALUES ($1, $2, 'approved')`,
        [`f5-at-cap-crew-${MARK}-${i}@example.com`, tenantId],
      );
    }
    // owner + 4 crew = 5 total — exactly at the cap, not over it.

    const result = await approvePilotTenant(tenantId, "admin-f5-at-cap");
    expect(result.status).toBe("activated");
  });
});
