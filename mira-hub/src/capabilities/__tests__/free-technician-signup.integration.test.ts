/** Actual register handler + actual PostgreSQL; synthetic local database only. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");
const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
// The pipeline's unrelated tables are outside this disposable auth fixture.
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import { ensureSchema, ensureUserAndTenant, findUserByEmail } from "@/lib/users";
import { POST } from "@/app/api/auth/register/route";
import { publicSignupPolicy } from "@/capabilities/free-technician-signup";
import { PILOT_WINDOW_DAYS } from "@/lib/config";

function email() { return `tech-${randomUUID()}@example.test`; }
function request(address: string) {
  return new Request("https://app.factorylm.com/api/auth/register/", {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": randomUUID() },
    body: JSON.stringify({ email: address, password: "local-test-password", name: "Synthetic technician" }),
  });
}

describe.skipIf(!READY)("free-technician registration against PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(process.env.TEST_DATABASE_URL!);
    if (target.hostname !== "127.0.0.1" || !target.pathname.startsWith("/factorylm_free_signup_test")) {
      throw new Error("This suite requires its own disposable loopback database");
    }
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
    vi.stubEnv("NEON_DATABASE_URL", process.env.TEST_DATABASE_URL!);
    vi.stubEnv("HUBSPOT_API_KEY", "");
    await testPool.query("CREATE TABLE IF NOT EXISTS tenants (id uuid PRIMARY KEY, name text NOT NULL, contact_email text NOT NULL)");
    await ensureSchema();
    await testPool.query("ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS pilot_status text");
  });
  beforeEach(() => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
  });
  afterAll(async () => { vi.unstubAllEnvs(); await testPool.end(); });

  it("writes the real free registration with no expiry, and a tenant-owned upload identity", async () => {
    const address = email();
    const response = await POST(request(address));
    expect(response.status).toBe(201);
    const body = await response.json();
    const user = await findUserByEmail(address);
    expect(user).toMatchObject({ id: body.userId, tenantId: body.tenantId, status: "approved", plan: "technician_free", trialExpiresAt: null, role: "owner" });
    expect(user?.status).not.toBe("admin");
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
    const { rows } = await testPool.query("SELECT id FROM tenants WHERE id = $1", [body.tenantId]);
    expect(rows).toHaveLength(1);
    expect(publicSignupPolicy().kind).toBe("free_technician");
  });

  it("does not gain a trial deadline when its creation is older than the pilot window", async () => {
    const address = email();
    const created = await ensureUserAndTenant({ email: address });
    await testPool.query("UPDATE hub_users SET created_at = NOW() - INTERVAL '90 days' WHERE id = $1", [created.id]);
    await ensureUserAndTenant({ email: address });
    const user = await findUserByEmail(address);
    expect(user).toMatchObject({ status: "approved", trialExpiresAt: null, plan: "technician_free" });
  });

  it("keeps an existing free account free when signup rollout is disabled", async () => {
    const address = email();
    const first = await ensureUserAndTenant({ email: address });
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
    expect(await ensureUserAndTenant({ email: address })).toEqual(first);
    expect(await findUserByEmail(address)).toMatchObject({ status: "approved", trialExpiresAt: null, plan: "technician_free" });
  });

  it("preserves the old trial clock when free signup is not enabled", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
    const created = await ensureUserAndTenant({ email: email() });
    const { rows } = await testPool.query("SELECT status, plan, EXTRACT(EPOCH FROM (trial_expires_at - NOW())) / 86400 AS days FROM hub_users WHERE id=$1", [created.id]);
    expect(rows[0].status).toBe("trial");
    expect(rows[0].plan).toBeNull();
    expect(Number(rows[0].days)).toBeGreaterThan(PILOT_WINDOW_DAYS - 0.01);
    expect(Number(rows[0].days)).toBeLessThanOrEqual(PILOT_WINDOW_DAYS);
  });

  it("keeps an explicit plant pilot approval-required", async () => {
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1");
    const address = email();
    const created = await ensureUserAndTenant({ email: address, signupIntent: "pilot" });
    expect(await findUserByEmail(address)).toMatchObject({ status: "pending", trialExpiresAt: null, plan: null });
    const { rows } = await testPool.query("SELECT pilot_status FROM hub_tenants WHERE id = $1", [created.tenantId]);
    expect(rows[0].pilot_status).toBe("pending");
    expect(publicSignupPolicy("pilot").requiresApproval).toBe(true);
  });

  it("opens a free personal workspace without disabling or joining the existing pilot cohort", async () => {
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1");
    const address = email();
    const created = await ensureUserAndTenant({ email: address });
    expect(await findUserByEmail(address)).toMatchObject({ status: "approved", trialExpiresAt: null, plan: "technician_free" });
    const { rows } = await testPool.query("SELECT pilot_status FROM hub_tenants WHERE id = $1", [created.tenantId]);
    expect(rows[0].pilot_status).toBeNull();
    expect(publicSignupPolicy().kind).toBe("free_technician");
  });

  it("does not create a second workspace on a repeated registration", async () => {
    const address = email();
    expect((await POST(request(address))).status).toBe(201);
    const first = await findUserByEmail(address);
    expect((await POST(request(address))).status).toBe(409);
    expect((await findUserByEmail(address))?.tenantId).toBe(first?.tenantId);
    const { rows } = await testPool.query("SELECT COUNT(*) AS n FROM hub_users WHERE email_lower = lower($1)", [address]);
    expect(Number(rows[0].n)).toBe(1);
  });
});
