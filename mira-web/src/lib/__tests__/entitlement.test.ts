/**
 * Entitlement gate tests — requireActive (CMMS plane) vs requirePaid
 * (account plane).
 *
 * The defect: `requireActive` hard-compared `tenant.tier !== "active"`, so a
 * paying Drive Commander Pro buyer (tier `drive_commander_pro`, written by the
 * Stripe webhook) 403'd on every account-plane route — including the CCPA
 * account deletion they are legally entitled to perform.
 *
 * The fix widens the *account plane* only, via an explicit allowlist. These
 * tests lock BOTH directions:
 *   - entitled tiers pass the gate they belong to,
 *   - every other tier value in the codebase still 403s,
 *   - `requireActive` did NOT widen (no CMMS/chat/ingest/Connect leak),
 *   - soft-deleted tenants are blocked BEFORE the tier check (410), which is
 *     what makes the widening safe against the Stripe re-purchase
 *     resurrection chain.
 */
import { describe, test, expect, mock } from "bun:test";
import { Hono } from "hono";

// --- env BEFORE imports ----------------------------------------------------
process.env.PLG_JWT_SECRET = "test_jwt_secret_for_entitlement_gates";

// --- in-memory tenant store the mocked loader reads ------------------------
interface StoreRow {
  id: string;
  email: string;
  tier: string;
  deleted_at: string | null;
}

const TENANT_ID = "00000000-0000-0000-0000-0000000000e1";
let store: StoreRow | null = null;

function setTenant(tier: string, deletedAt: string | null = null) {
  store = {
    id: TENANT_ID,
    email: "buyer@example.com",
    tier,
    deleted_at: deletedAt,
  };
}

mock.module("../quota.js", () => ({
  findTenantById: async (id: string) =>
    store && id === store.id ? store : null,
  // Stubs for sibling test files that transitively import from quota.js
  // (mock.module is process-global per the bun:test design).
  findTenantByEmail: async () => null,
  findTenantByStripeCustomerId: async () => null,
  findTenantByInboxSlug: async () => null,
  getQuota: async (tenantId: string) => ({
    queriesUsedToday: 0,
    dailyLimit: 5,
    remaining: 5,
    tenantId,
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

mock.module("../cookie-session.js", () => ({
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

const { signToken, requireActive, requirePaid, CMMS_TIERS, PAID_TIERS } =
  await import("../auth.js");

// --- harness ---------------------------------------------------------------
let nextRan = false;

function buildApp() {
  const app = new Hono();
  const handler = (c: {
    json: (v: unknown) => Response;
    get: (k: string) => unknown;
  }) => {
    nextRan = true;
    return c.json({
      ok: true,
      tier: c.get("tier"),
      sub: (c.get("user") as { sub?: string } | undefined)?.sub,
    });
  };
  app.get("/cmms", requireActive, handler);
  app.get("/account", requirePaid, handler);
  return app;
}

async function token(tier = "active") {
  return signToken({
    tenantId: TENANT_ID,
    email: "buyer@example.com",
    tier,
    atlasCompanyId: 1,
    atlasUserId: 2,
    atlasRole: "USER",
  });
}

async function call(path: string, jwt: string | null) {
  nextRan = false;
  const headers: Record<string, string> = {};
  if (jwt) headers.Authorization = "Bearer " + jwt;
  return buildApp().request("http://localhost" + path, { headers });
}

// Every tier literal that exists (or could plausibly be typo'd / added later).
// Census: pending / active / churned / drive_commander_pro are the only values
// ever written to plg_tenants.tier. The rest must never become entitled.
const TIER_CENSUS = [
  "pending",
  "active",
  "churned",
  "drive_commander_pro",
  "unknown",
  "free",
  "base",
  "trial",
  "trialing",
  "past_due",
  "Active",
  "active ",
  "",
];

describe("requirePaid — the bug being fixed", () => {
  test("drive_commander_pro reaches the account plane (200)", async () => {
    setTenant("drive_commander_pro");
    const res = await call("/account", await token("drive_commander_pro"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tier: string; sub: string };
    expect(body.tier).toBe("drive_commander_pro");
    expect(body.sub).toBe(TENANT_ID);
    expect(nextRan).toBe(true);
  });

  test("active still reaches the account plane (200)", async () => {
    setTenant("active");
    const res = await call("/account", await token());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tier: string }).tier).toBe("active");
  });
});

describe("requirePaid — denial is the default", () => {
  const denied = TIER_CENSUS.filter(
    (t) => t !== "active" && t !== "drive_commander_pro"
  );
  for (const tier of denied) {
    test("tier " + JSON.stringify(tier) + " is denied (403)", async () => {
      setTenant(tier);
      const res = await call("/account", await token(tier));
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; tier: string };
      // "" falls back to the "unknown" label via `|| "unknown"`.
      expect(body.tier).toBe(tier || "unknown");
      expect(body.error).toBe("Subscription required");
      expect(nextRan).toBe(false);
    });
  }

  test("tenant row not found → 403 with tier unknown", async () => {
    store = null;
    const res = await call("/account", await token("active"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { tier: string }).tier).toBe("unknown");
    expect(nextRan).toBe(false);
  });
});

describe("soft delete blocks before the tier check (410)", () => {
  test("drive_commander_pro + deleted_at → 410", async () => {
    setTenant("drive_commander_pro", "2026-08-01T00:00:00Z");
    const res = await call("/account", await token("drive_commander_pro"));
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Account deleted"
    );
    expect(nextRan).toBe(false);
  });

  test("active + deleted_at → 410 on both gates", async () => {
    setTenant("active", "2026-08-01T00:00:00Z");
    expect((await call("/account", await token())).status).toBe(410);
    expect(nextRan).toBe(false);
    expect((await call("/cmms", await token())).status).toBe(410);
    expect(nextRan).toBe(false);
  });

  test("resurrection chain: churned+deleted, re-purchased as DC Pro, stays 410", async () => {
    // markTenantDeleted sets deleted_at + purge_after + tier='churned'.
    setTenant("churned", "2026-08-01T00:00:00Z");
    // The Stripe DC webhook branch's own mutation (server.ts:1199-1201):
    // rewrite the tier, leave deleted_at / purge_after untouched.
    (store as StoreRow).tier = "drive_commander_pro";
    const res = await call("/account", await token("drive_commander_pro"));
    expect(res.status).toBe(410);
    expect(nextRan).toBe(false);
  });
});

describe("requireActive did NOT widen — blast radius is locked", () => {
  test("drive_commander_pro is refused the CMMS plane (403)", async () => {
    setTenant("drive_commander_pro");
    const res = await call("/cmms", await token("drive_commander_pro"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { tier: string }).tier).toBe(
      "drive_commander_pro"
    );
    expect(nextRan).toBe(false);
  });

  test("active still passes the CMMS plane (200)", async () => {
    setTenant("active");
    expect((await call("/cmms", await token())).status).toBe(200);
  });

  for (const tier of ["pending", "churned"]) {
    test(tier + " is refused the CMMS plane (403)", async () => {
      setTenant(tier);
      expect((await call("/cmms", await token(tier))).status).toBe(403);
    });
  }
});

describe("allowlist-is-a-set invariant", () => {
  test("exactly {active} passes requireActive across the census", async () => {
    const passed: string[] = [];
    for (const tier of TIER_CENSUS) {
      setTenant(tier);
      if ((await call("/cmms", await token(tier))).status === 200) {
        passed.push(tier);
      }
    }
    expect(passed).toEqual(["active"]);
  });

  test("exactly {active, drive_commander_pro} passes requirePaid", async () => {
    const passed: string[] = [];
    for (const tier of TIER_CENSUS) {
      setTenant(tier);
      if ((await call("/account", await token(tier))).status === 200) {
        passed.push(tier);
      }
    }
    expect(passed).toEqual(["active", "drive_commander_pro"]);
  });

  test("the exported sets are the only source of entitlement", () => {
    expect([...CMMS_TIERS].sort()).toEqual(["active"]);
    expect([...PAID_TIERS].sort()).toEqual(["active", "drive_commander_pro"]);
  });
});

describe("auth preamble is unchanged for both gates", () => {
  for (const path of ["/cmms", "/account"]) {
    test(path + ": no header and no cookie → 401", async () => {
      setTenant("active");
      expect((await call(path, null)).status).toBe(401);
      expect(nextRan).toBe(false);
    });

    test(path + ": malformed token → 401", async () => {
      setTenant("active");
      expect((await call(path, "not-a-jwt")).status).toBe(401);
    });

    test(path + ": token signed with a different secret → 401", async () => {
      setTenant("active");
      const real = process.env.PLG_JWT_SECRET;
      process.env.PLG_JWT_SECRET = "a_completely_different_secret_value";
      const foreign = await token();
      process.env.PLG_JWT_SECRET = real;
      expect((await call(path, foreign)).status).toBe(401);
    });

    test(path + ": mira_session cookie is accepted when no header", async () => {
      setTenant("active");
      nextRan = false;
      const res = await buildApp().request("http://localhost" + path, {
        headers: { cookie: "mira_session=" + (await token()) },
      });
      expect(res.status).toBe(200);
    });

    test(path + ": ?token= query auth is still rejected (#890 P0.1)", async () => {
      setTenant("active");
      nextRan = false;
      const res = await buildApp().request(
        "http://localhost" + path + "?token=" + (await token())
      );
      expect(res.status).toBe(401);
      expect(nextRan).toBe(false);
    });
  }
});
