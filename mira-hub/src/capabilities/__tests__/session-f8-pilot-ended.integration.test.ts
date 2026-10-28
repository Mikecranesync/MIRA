// F8 (Mike-authorized post-cap Codex pass, #4882 @ 66f379a90; related
// pre-existing #3831) — real-Postgres proof that ending a pilot actually
// denies an already-issued session cookie on the very next request.
//
// Before this fix, `requireSession()` returned `status`/`trialExpiresAt`
// straight from the JWT claims written at sign-in. Those claims are only
// refreshed when NextAuth's own `jwt` callback runs (a browser-side session
// read — see `refreshEntitlementClaims`, src/auth.ts), never on this
// server-side route path. So `endPilotTenant` (which sets every non-admin
// `hub_users` row to `status='expired'`) had no effect on a cookie already
// in a browser's hands until that browser happened to refresh its session.
//
// This suite mocks only the cookie/JWT-decode layer (so we control exactly
// which uid/tid a "request" carries, and can plant a deliberately STALE
// status/trialExpiresAt claim in the token to prove the fix reads the DB,
// not the cookie) and runs `requireSession()` for real against a disposable
// Postgres — same bootstrap as pilot-access.integration.test.ts.
//
// Requires (local/disposable only — never staging/prod):
//   TEST_DATABASE_URL      postgres
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
// Run: npx vitest run --config vitest.integration.config.ts src/lib/__tests__/session-f8-pilot-ended.integration.test.ts

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
import { endPilotTenant } from "@/capabilities/pilot-access";
import {
  requireSession,
  sessionOr401,
  UnauthorizedError,
  SessionUpgradeRequiredError,
} from "@/lib/session";
import { GET as checkApproval } from "@/app/(hub)/api/auth/check-approval/route";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARK = randomUUID().slice(0, 8);
const DAY_MS = 24 * 60 * 60 * 1000;

// A fixed, deliberately STALE token claim set — far from what the DB will
// say by the time requireSession() runs. Every test below mocks decode()
// to return this (merged with per-test uid/tid), so a test that passes
// could only be reading the DB row, never this claim.
const STALE_CLAIM = { status: "trial", trialExpiresAt: new Date(Date.now() + 365 * DAY_MS).toISOString() };

async function makeTenant(name: string): Promise<{ tenantId: string }> {
  const {
    rows: [tenant],
  } = await testPool.query(`INSERT INTO hub_tenants (name) VALUES ($1) RETURNING id`, [name]);
  return { tenantId: String(tenant.id) };
}

async function makeUser(
  tenantId: string,
  email: string,
  status: string,
  trialExpiresAt: Date | null,
): Promise<string> {
  const {
    rows: [user],
  } = await testPool.query(
    `INSERT INTO hub_users (email, tenant_id, status, trial_expires_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, tenantId, status, trialExpiresAt],
  );
  return String(user.id);
}

function mockSessionFor(uid: string, tid: string, claims: Record<string, unknown> = STALE_CLAIM) {
  vi.mocked(decode).mockResolvedValue({ uid, tid, email: `${uid}@example.com`, ...claims } as never);
}

describe.skipIf(!READY)("requireSession denies an ended-pilot cookie on the next request (F8, #4882 @ 66f379a90)", () => {
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

  it("active pilot user's cookie-derived session is denied on the very next requireSession() call after endPilotTenant", async () => {
    const { tenantId } = await makeTenant(`f8-end-${MARK}`);
    testTenantIds.push(tenantId);
    await testPool.query(
      `UPDATE hub_tenants SET pilot_status = 'active', pilot_approved_at = NOW(), pilot_expires_at = NOW() + INTERVAL '30 days', pilot_approved_by = 'seed' WHERE id = $1`,
      [tenantId],
    );
    const userId = await makeUser(tenantId, `f8-end-member-${MARK}@example.com`, "trial", new Date(Date.now() + 29 * DAY_MS));
    mockSessionFor(userId, tenantId);

    // Before the pilot ends: the exact same cookie/token resolves fine.
    const before = await requireSession();
    expect(before.status).toBe("trial");

    const result = await endPilotTenant(tenantId);
    expect(result.ended).toBe(true);

    // Same cookie, same token, no new sign-in — and now denied, because
    // requireSession() re-reads the DB row (now 'expired') instead of
    // trusting the still-"trial" JWT claim that has not changed at all.
    await expect(requireSession()).rejects.toBeInstanceOf(SessionUpgradeRequiredError);
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);

    // The ~150-caller shared helper surfaces the specific, friendlier 403 —
    // not a bare generic 401 — for this case.
    const res = await sessionOr401();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
    const body = await (res as Response).json();
    expect(body.error).toBe("Your pilot has ended. Contact FactoryLM to continue.");
  });

  it("a non-pilot trial user inside the 30-day window still passes, unaffected by any other tenant's pilot ending", async () => {
    const { tenantId } = await makeTenant(`f8-ok-${MARK}`);
    testTenantIds.push(tenantId);
    const userId = await makeUser(tenantId, `f8-ok-member-${MARK}@example.com`, "trial", new Date(Date.now() + 10 * DAY_MS));
    mockSessionFor(userId, tenantId);

    const ctx = await requireSession();
    expect(ctx.status).toBe("trial");
    expect(ctx.userId).toBe(userId);
  });

  it("a trial whose date passed but was never explicitly ended keeps today's API access (no deploy-day lockout)", async () => {
    const { tenantId } = await makeTenant(`f8-lapsed-${MARK}`);
    testTenantIds.push(tenantId);
    const userId = await makeUser(tenantId, `f8-lapsed-${MARK}@example.com`, "trial", new Date(Date.now() - 40 * DAY_MS));
    mockSessionFor(userId, tenantId);

    const ctx = await requireSession();
    expect(ctx.status).toBe("trial");
    expect(ctx.userId).toBe(userId);
  });

  it("an admin passes regardless of trial/pilot state", async () => {
    const { tenantId } = await makeTenant(`f8-admin-${MARK}`);
    testTenantIds.push(tenantId);
    const userId = await makeUser(tenantId, `f8-admin-${MARK}@example.com`, "admin", null);
    mockSessionFor(userId, tenantId);

    const ctx = await requireSession();
    expect(ctx.status).toBe("admin");
    expect(ctx.platformAdmin).toBe(true);
  });

  it("a pending user is not denied by requireSession, and /api/auth/check-approval keeps working for them", async () => {
    const { tenantId } = await makeTenant(`f8-pending-${MARK}`);
    testTenantIds.push(tenantId);
    const userId = await makeUser(tenantId, `f8-pending-${MARK}@example.com`, "pending", null);
    mockSessionFor(userId, tenantId);

    const ctx = await requireSession();
    expect(ctx.status).toBe("pending");

    const res = await checkApproval();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
  });
});
