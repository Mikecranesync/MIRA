/**
 * Account deletion lib tests — verifies requestSoftDelete sets the right
 * flags, calls Stripe (or skips when not configured), records the audit
 * event, and that purgePendingDeletions only touches tenants past grace.
 *
 * Tier 1 #8.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

interface FakeTenant {
  id: string;
  email: string;
  tier: string;
  stripe_subscription_id: string | null;
  deleted_at: string | null;
  purge_after: string | null;
}

const T1: FakeTenant = {
  id: "00000000-0000-0000-0000-000000000111",
  email: "delete-me@example.com",
  tier: "active",
  stripe_subscription_id: "sub_TEST_111",
  deleted_at: null,
  purge_after: null,
};

let store: Map<string, FakeTenant>;
const auditLog: any[] = [];
const stripeCancelCalls: string[] = [];
let stripeCancelShouldFail = false;

mock.module("../quota.js", () => ({
  findTenantById: async (id: string) => store.get(id) ?? null,
  markTenantDeleted: async (id: string) => {
    const t = store.get(id);
    if (!t) return;
    if (t.deleted_at) return;
    t.deleted_at = new Date().toISOString();
    t.purge_after = new Date(Date.now() + 30 * 86400_000).toISOString();
    t.tier = "churned";
  },
  listTenantsAwaitingPurge: async () => {
    const now = Date.now();
    return [...store.values()]
      .filter((t) => t.purge_after && new Date(t.purge_after).getTime() < now)
      .map((t) => ({ id: t.id, email: t.email, deleted_at: t.deleted_at! }));
  },
  hardDeleteTenant: async (id: string) => {
    store.delete(id);
  },
  // Stubs for sibling test files that transitively import quota.js (bun:test
  // mock.module is process-global).
  findTenantByEmail: async () => null,
  findTenantByStripeCustomerId: async () => null,
  findTenantByInboxSlug: async () => null,
  getQuota: async () => ({ used: 0, limit: 100, remaining: 100 }),
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
  ensureSchema: async () => {},
}));

mock.module("../audit.js", () => ({
  recordAuditEvent: async (ev: any) => {
    auditLog.push(ev);
    return true;
  },
  requestMetadata: () => ({ ip: "127.0.0.1", userAgent: "bun-test" }),
}));

mock.module("stripe", () => {
  return {
    default: class StripeStub {
      subscriptions = {
        cancel: async (id: string) => {
          stripeCancelCalls.push(id);
          if (stripeCancelShouldFail) throw new Error("Stripe is down");
          return { id, status: "canceled" };
        },
      };
    },
  };
});

const { requestSoftDelete, purgePendingDeletions } = await import(
  "../account-deletion.js"
);

beforeEach(() => {
  store = new Map();
  store.set(T1.id, { ...T1 });
  auditLog.length = 0;
  stripeCancelCalls.length = 0;
  stripeCancelShouldFail = false;
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
});

describe("requestSoftDelete", () => {
  test("flags tenant deleted, cancels Stripe, audits", async () => {
    const tenant = store.get(T1.id)!;
    const result = await requestSoftDelete({
      tenant: tenant as any,
      ip: "203.0.113.5",
      userAgent: "bun-test",
      reason: "no longer needed",
    });
    expect(result.ok).toBe(true);
    expect(result.stripeCanceled).toBe("ok");
    expect(stripeCancelCalls).toEqual(["sub_TEST_111"]);
    expect(store.get(T1.id)!.deleted_at).toBeTruthy();
    expect(store.get(T1.id)!.purge_after).toBeTruthy();
    expect(store.get(T1.id)!.tier).toBe("churned");
    const ev = auditLog.find((e) => e.action === "account.deletion_requested");
    expect(ev).toBeTruthy();
    expect(ev.metadata.stripe_cancel).toBe("ok");
    expect(ev.metadata.reason).toBe("no longer needed");
    expect(ev.metadata.grace_days).toBe(30);
  });

  test("Stripe cancel failure does NOT block soft-delete", async () => {
    stripeCancelShouldFail = true;
    const tenant = store.get(T1.id)!;
    const result = await requestSoftDelete({ tenant: tenant as any });
    expect(result.ok).toBe(true);
    expect(result.stripeCanceled).toBe("failed");
    expect(store.get(T1.id)!.deleted_at).toBeTruthy();
    expect(store.get(T1.id)!.tier).toBe("churned");
  });

  test("missing STRIPE_SECRET_KEY → stripeCanceled='skipped'", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const tenant = store.get(T1.id)!;
    const result = await requestSoftDelete({ tenant: tenant as any });
    expect(result.stripeCanceled).toBe("skipped");
    expect(stripeCancelCalls).toEqual([]);
    expect(store.get(T1.id)!.deleted_at).toBeTruthy();
  });

  test("tenant with no subscription_id → stripeCanceled='skipped'", async () => {
    const t = store.get(T1.id)!;
    t.stripe_subscription_id = null;
    const result = await requestSoftDelete({ tenant: t as any });
    expect(result.stripeCanceled).toBe("skipped");
    expect(stripeCancelCalls).toEqual([]);
  });
});

describe("purgePendingDeletions", () => {
  test("only purges tenants past their purge_after timestamp", async () => {
    // T1 is active (no purge_after) — should be ignored
    const reports = await purgePendingDeletions();
    expect(reports).toEqual([]);
    expect(store.has(T1.id)).toBe(true);
  });

  test("hard-deletes tenant whose grace window elapsed", async () => {
    const t = store.get(T1.id)!;
    t.deleted_at = new Date(Date.now() - 31 * 86400_000).toISOString();
    t.purge_after = new Date(Date.now() - 1000).toISOString();
    const reports = await purgePendingDeletions();
    expect(reports.length).toBe(1);
    expect(reports[0]!.tenant_id).toBe(T1.id);
    expect(reports[0]!.steps.neon).toBe("ok");
    expect(store.has(T1.id)).toBe(false);
  });

  test("future purge_after is ignored", async () => {
    const t = store.get(T1.id)!;
    t.deleted_at = new Date().toISOString();
    t.purge_after = new Date(Date.now() + 86400_000).toISOString();
    const reports = await purgePendingDeletions();
    expect(reports).toEqual([]);
    expect(store.has(T1.id)).toBe(true);
  });
});
