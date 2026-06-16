/**
 * Cross-tenant fail-closed test — Tier 1 #12.
 *
 * The Phase-1 tenant-isolation control for MIRA's NeonDB-backed endpoints
 * is app-layer scoping: every authenticated route reads `tenant_id` from
 * the verified JWT subject (`payload.sub`) and uses ONLY that value to
 * look up tenant data. Query-string and body parameters never override
 * the JWT subject.
 *
 * This test proves the boundary holds and breaks the build if a future
 * regression takes `tenant_id` from request input instead of the JWT.
 *
 * What we verify:
 *   1. requireActive populates c.get("user").sub from the JWT subject only.
 *      Coerce-attempts via ?tenant_id=B / body tenant_id / x-tenant-id
 *      header have no effect on user.sub.
 *   2. A handler that calls findTenantById(user.sub) on tenant A's JWT
 *      retrieves A's row and never B's, even when the request contains
 *      B-shaped coercion attempts.
 *   3. Reversing the JWT (B) flips the scope cleanly to B.
 *
 * What we DON'T verify here (separate audit / Atlas-side concern):
 *   - /demo/tenant-work-orders calls listWorkOrders(undefined, 50) with
 *     an Atlas admin token. In Phase-1 (1 Atlas deployment per tenant)
 *     ATLAS_URL is per-tenant, so the topology provides isolation. If
 *     Atlas ever consolidates (Phase 2 / Q3 2026), this endpoint must
 *     be scoped by user.atlasCompanyId at the API layer. Tracked
 *     separately.
 */
import { describe, test, expect, mock } from "bun:test";
import { Hono } from "hono";

// Env BEFORE imports — JWT signer needs a secret.
process.env.PLG_JWT_SECRET = "test_jwt_secret_for_cross_tenant_isolation";

const TENANT_A = {
  id: "00000000-0000-0000-0000-00000000aaaa",
  email: "alice@a-co.example.com",
  company: "A Co",
  tier: "active",
  first_name: "Alice",
  inbox_slug: "aaaa1111",
  // Distinct sentinel field so a cross-tenant leak shows up in assertions.
  atlas_company_id: 100,
  atlas_user_id: 200,
  atlas_password: "",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  atlas_provisioning_status: "ok",
  activation_email_status: "sent",
  demo_seed_status: "ok",
  provisioning_attempts: 0,
  provisioning_last_attempt_at: null,
  provisioning_last_error: null,
  created_at: "2026-04-24T00:00:00Z",
};

const TENANT_B = {
  ...TENANT_A,
  id: "00000000-0000-0000-0000-00000000bbbb",
  email: "bob@b-co.example.com",
  company: "B Co",
  first_name: "Bob",
  inbox_slug: "bbbb2222",
  atlas_company_id: 300,
  atlas_user_id: 400,
};

// Module mock — findTenantById returns whichever sentinel matches the id.
// `getQuota` returns the tenant_id back so we can detect leaks in the response.
// Other quota.js exports are stubbed so this mock doesn't break sibling test
// files that transitively import them when bun runs the suite together
// (mock.module is process-global per the bun:test design).
mock.module("../../lib/quota.js", () => ({
  findTenantById: async (id: string) => {
    if (id === TENANT_A.id) return TENANT_A;
    if (id === TENANT_B.id) return TENANT_B;
    return null;
  },
  findTenantByEmail: async () => null,
  findTenantByStripeCustomerId: async () => null,
  findTenantByInboxSlug: async () => null,
  getQuota: async (tenantId: string, _tier: string) => ({
    tenantId,
    used: tenantId === TENANT_A.id ? 7 : 13,
    limit: 100,
    remaining: tenantId === TENANT_A.id ? 93 : 87,
  }),
  getQueriesUsedToday: async () => 0,
  hasQuotaRemaining: async () => true,
  logQuery: async () => {},
  createTenant: async () => {},
  updateTenantTier: async () => {},
  updateTenantStripe: async () => {},
  updateTenantAtlas: async () => {},
  updateTenantCmmsConfig: async () => {},
  getTenantCmmsTier: async () => "base",
  updateTenantEmailStatus: async () => {},
  updateTenantSeedStatus: async () => {},
  recordProvisioningAttempt: async () => {},
  generateInboxSlug: () => "stub1234",
  getMfaState: async () => ({
    enabled: false,
    secretEnc: null,
    recoveryCodesHashed: [],
    enrolledAt: null,
  }),
  stageMfaEnrollment: async () => {},
  activateMfa: async () => {},
  clearMfa: async () => {},
  consumeRecoveryCodeAt: async () => {},
  getDeletionState: async () => ({ deletedAt: null, purgeAfter: null }),
  markTenantDeleted: async () => {},
  listTenantsAwaitingPurge: async () => [],
  hardDeleteTenant: async () => {},
  ensureSchema: async () => {},
}));

// Cookie parser is a transitive dep of requireActive — no behavior change needed.
mock.module("../../lib/cookie-session.js", () => ({
  parseCookies: (header: string | undefined) => {
    if (!header) return {};
    const out: Record<string, string> = {};
    for (const part of header.split(";")) {
      const [k, v] = part.trim().split("=");
      if (k && v) out[k] = v;
    }
    return out;
  },
  buildSessionCookie: () => "",
}));

const { signToken, requireActive } = await import("../../lib/auth.js");
const { findTenantById, getQuota } = await import("../../lib/quota.js");

// Build a minimal app that mirrors /api/me's contract: read user.sub from
// the JWT, look up the tenant, return tenant-scoped data. No query/body
// parameter ever feeds into the lookup. This is the contract any
// authenticated endpoint must follow.
function buildApp() {
  const app = new Hono();
  app.get("/test/me", requireActive, async (c) => {
    const user = c.get("user") as { sub: string; email: string };
    const tenant = await findTenantById(user.sub);
    if (!tenant) return c.json({ error: "not found" }, 404);
    const quota = await getQuota(user.sub, "active");
    return c.json({
      jwt_sub: user.sub,
      jwt_email: user.email,
      tenant_id: tenant.id,
      tenant_email: tenant.email,
      tenant_company: tenant.company,
      atlas_company_id: tenant.atlas_company_id,
      quota,
    });
  });
  return app;
}

async function jwtFor(tenant: typeof TENANT_A): Promise<string> {
  return signToken({
    tenantId: tenant.id,
    email: tenant.email,
    tier: tenant.tier,
    atlasCompanyId: tenant.atlas_company_id,
    atlasUserId: tenant.atlas_user_id,
    atlasRole: "USER",
  });
}

describe("cross-tenant fail-closed (auth middleware + handler contract)", () => {
  test("Tenant A's JWT returns A's row only", async () => {
    const app = buildApp();
    const tokA = await jwtFor(TENANT_A);
    const res = await app.request("/test/me", {
      headers: { Authorization: `Bearer ${tokA}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant_id).toBe(TENANT_A.id);
    expect(body.tenant_email).toBe(TENANT_A.email);
    expect(body.tenant_company).toBe("A Co");
    expect(body.atlas_company_id).toBe(100);
    expect(body.quota.used).toBe(7);
    // Negative — must not contain B's sentinels anywhere.
    const text = JSON.stringify(body);
    expect(text).not.toContain(TENANT_B.id);
    expect(text).not.toContain(TENANT_B.email);
    expect(text).not.toContain("B Co");
  });

  test("Tenant B's JWT returns B's row only", async () => {
    const app = buildApp();
    const tokB = await jwtFor(TENANT_B);
    const res = await app.request("/test/me", {
      headers: { Authorization: `Bearer ${tokB}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant_id).toBe(TENANT_B.id);
    expect(body.atlas_company_id).toBe(300);
    expect(body.quota.used).toBe(13);
    const text = JSON.stringify(body);
    expect(text).not.toContain(TENANT_A.id);
    expect(text).not.toContain(TENANT_A.email);
    expect(text).not.toContain("A Co");
  });

  test("?tenant_id=B with A's JWT must NOT leak B's data — JWT subject wins", async () => {
    const app = buildApp();
    const tokA = await jwtFor(TENANT_A);
    const res = await app.request(
      `/test/me?tenant_id=${TENANT_B.id}&user_id=${TENANT_B.atlas_user_id}`,
      { headers: { Authorization: `Bearer ${tokA}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant_id).toBe(TENANT_A.id);
    expect(body.atlas_company_id).toBe(100);
    expect(JSON.stringify(body)).not.toContain(TENANT_B.id);
  });

  test("x-tenant-id header coercion attempt has no effect", async () => {
    const app = buildApp();
    const tokA = await jwtFor(TENANT_A);
    const res = await app.request("/test/me", {
      headers: {
        Authorization: `Bearer ${tokA}`,
        "X-Tenant-Id": TENANT_B.id,
        "X-Atlas-Company-Id": String(TENANT_B.atlas_company_id),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant_id).toBe(TENANT_A.id);
  });

  test("missing JWT → 401, no tenant data exposed", async () => {
    const app = buildApp();
    const res = await app.request("/test/me");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(TENANT_A.id);
    expect(JSON.stringify(body)).not.toContain(TENANT_B.id);
  });

  test("malformed JWT → 401, no tenant data exposed", async () => {
    const app = buildApp();
    const res = await app.request("/test/me", {
      headers: { Authorization: "Bearer not.a.real.jwt" },
    });
    expect(res.status).toBe(401);
  });

  test("JWT signed with a different secret → 401", async () => {
    const app = buildApp();
    // Save and swap the secret to forge a token, then restore.
    const real = process.env.PLG_JWT_SECRET;
    process.env.PLG_JWT_SECRET = "evil_attacker_secret";
    const forged = await jwtFor(TENANT_A);
    process.env.PLG_JWT_SECRET = real;

    const res = await app.request("/test/me", {
      headers: { Authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
  });

  test("query-param token with A's signed JWT cannot be paired with B's tenant_id", async () => {
    // The ?token= path is a supported auth mechanism. Verify the same
    // JWT-wins-over-query rule applies: even when the token itself comes
    // via query string, a sibling tenant_id query param can't override it.
    const app = buildApp();
    const tokA = await jwtFor(TENANT_A);
    const res = await app.request(
      `/test/me?token=${encodeURIComponent(tokA)}&tenant_id=${TENANT_B.id}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant_id).toBe(TENANT_A.id);
  });
});
