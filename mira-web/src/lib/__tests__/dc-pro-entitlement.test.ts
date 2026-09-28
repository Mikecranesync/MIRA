/**
 * Hermetic unit tests for Drive Commander Pro entitlement flow.
 *
 * Covers:
 *  1. ensureDCProTenant (webhook helper): sets tier=drive_commander_pro for new user
 *  2. ensureDCProTenant: does NOT call finalizeActivation / CMMS / Hub — only
 *     findTenantByEmail, createTenant, findTenantById, updateTenantStripe,
 *     updateTenantTier, recordAuditEvent queries appear; no Atlas/Hub SQL.
 *  3. ensureDCProTenant: existing tenant gets tier updated, not recreated
 *  4. verifyDCProSession returns null for non-DC-pro sessions (fail-closed)
 *  5. verifyDCProSession returns null for unpaid sessions (fail-closed)
 *  6. Free-tier rendering does not expose Pro DOM content
 *  7. isPro=true rendering omits the pro-lock DOM gate (CSS class may still exist)
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// ── Mocks ──────────────────────────────────────────────────────────────────

let stripeSessionReturn: Record<string, unknown> = {};

mock.module("stripe", () => ({
  default: class MockStripe {
    checkout = {
      sessions: {
        retrieve: async () => stripeSessionReturn,
      },
    };
    webhooks = {
      constructEventAsync: async (body: string, _sig: string, _secret: string) =>
        JSON.parse(body),
    };
  },
}));

let capturedQueries: Array<{ sql: string; values: unknown[] }>;
let scriptedReturns: Array<unknown[]>;

mock.module("@neondatabase/serverless", () => ({
  neon: () =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedQueries.push({ sql: strings.join("?"), values });
      const next = scriptedReturns.shift() ?? [];
      return Promise.resolve(next);
    },
}));

beforeEach(() => {
  capturedQueries = [];
  scriptedReturns = [];
  stripeSessionReturn = {};
  process.env.NEON_DATABASE_URL = "postgresql://fake:fake@fake/fake";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
  process.env.PLG_JWT_SECRET = "test-secret-at-least-32-bytes-long!!";
});

afterEach(() => {
  delete process.env.NEON_DATABASE_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.PLG_JWT_SECRET;
});

// ── Test: verifyDCProSession ───────────────────────────────────────────────

describe("verifyDCProSession", () => {
  test("returns null for non-cs_ session id (fail-closed)", async () => {
    const { verifyDCProSession } = await import("../stripe.js");
    const result = await verifyDCProSession("bogus");
    expect(result).toBeNull();
  });

  test("returns null when session payment_status is not paid", async () => {
    stripeSessionReturn = {
      payment_status: "unpaid",
      metadata: { product: "drive-commander-pro" },
      customer_details: { email: "test@example.com" },
      customer: "cus_test",
      subscription: "sub_test",
    };
    const { verifyDCProSession } = await import("../stripe.js");
    const result = await verifyDCProSession("cs_live_fake");
    expect(result).toBeNull();
  });

  test("returns null when product metadata is missing (not DC Pro)", async () => {
    stripeSessionReturn = {
      payment_status: "paid",
      metadata: { product: "cmms-team" },
      customer_details: { email: "test@example.com" },
      customer: "cus_test",
      subscription: "sub_test",
    };
    const { verifyDCProSession } = await import("../stripe.js");
    const result = await verifyDCProSession("cs_live_fake");
    expect(result).toBeNull();
  });

  test("returns email+ids for a paid drive-commander-pro session", async () => {
    stripeSessionReturn = {
      payment_status: "paid",
      metadata: { product: "drive-commander-pro" },
      customer_details: { email: "tech@plant.com" },
      customer: "cus_abc123",
      subscription: "sub_xyz789",
    };
    const { verifyDCProSession } = await import("../stripe.js");
    const result = await verifyDCProSession("cs_live_fake");
    expect(result).toEqual({
      email: "tech@plant.com",
      customerId: "cus_abc123",
      subscriptionId: "sub_xyz789",
    });
  });
});

// ── Test: ensureDCProTenant — real hermetic coverage of the DC Pro activation path ──

describe("ensureDCProTenant (DC Pro webhook/redirect helper)", () => {
  test("new customer: creates tenant with tier=drive_commander_pro", async () => {
    // Query sequence inside ensureDCProTenant for a new user:
    //   1. findTenantByEmail → [] (not found)
    //   2. generateUniqueInboxSlug SELECT → [] (slug is unique)
    //   3. createTenant INSERT → []
    //   4. findTenantById → [new tenant row]
    //   5. updateTenantStripe UPDATE → []
    //   6. (no updateTenantTier — tier already drive_commander_pro from createTenant)
    //   7. recordAuditEvent INSERT → []
    scriptedReturns = [
      [],                                                                              // findTenantByEmail → null
      [],                                                                              // generateUniqueInboxSlug SELECT → unique
      [],                                                                              // createTenant INSERT
      [{ id: "new-uuid-1", email: "newtech@plant.com", tier: "drive_commander_pro" }], // findTenantById
      [],                                                                              // updateTenantStripe
      [],                                                                              // recordAuditEvent
    ];

    const { ensureDCProTenant } = await import("../dc-pro-activation.js");
    const result = await ensureDCProTenant({
      email: "newtech@plant.com",
      customerId: "cus_new",
      subscriptionId: "sub_new",
    });

    expect(result).not.toBeNull();
    expect(result?.tier).toBe("drive_commander_pro");

    // tier=drive_commander_pro must appear in DB queries (the createTenant INSERT)
    const tierQuery = capturedQueries.find((q) =>
      q.sql.includes("drive_commander_pro") || q.values.includes("drive_commander_pro"),
    );
    expect(tierQuery).toBeDefined();

    // Hub provisioning queue must NOT be touched — that is the CMMS path.
    const hubQueue = capturedQueries.find((q) =>
      q.sql.includes("plg_pending_hub_provisioning") || q.sql.includes("hub_users"),
    );
    expect(hubQueue).toBeUndefined();
  });

  test("existing pending tenant: tier updated to drive_commander_pro, NOT active", async () => {
    scriptedReturns = [
      // findTenantByEmail → existing pending tenant
      [{ id: "exist-uuid-2", email: "returning@plant.com", tier: "pending" }],
      [],  // updateTenantStripe
      [],  // updateTenantTier
      [],  // recordAuditEvent
    ];

    const { ensureDCProTenant } = await import("../dc-pro-activation.js");
    const result = await ensureDCProTenant({
      email: "returning@plant.com",
      customerId: "cus_exist",
      subscriptionId: "sub_exist",
    });

    expect(result).not.toBeNull();

    // updateTenantTier must have been called with drive_commander_pro (not "active")
    const tierUpdate = capturedQueries.find(
      (q) => q.sql.includes("SET tier") && q.values.includes("drive_commander_pro"),
    );
    expect(tierUpdate).toBeDefined();

    // Must NOT update to "active" (that is the CMMS path)
    const activeUpdate = capturedQueries.find(
      (q) => q.sql.includes("SET tier") && q.values.includes("active"),
    );
    expect(activeUpdate).toBeUndefined();
  });

  test("existing active CMMS subscriber: tier preserved as active (not downgraded)", async () => {
    scriptedReturns = [
      [{ id: "cmms-uuid-3", email: "team@plant.com", tier: "active" }],
      [],  // updateTenantStripe
      [],  // recordAuditEvent (no updateTenantTier call expected)
    ];

    const { ensureDCProTenant } = await import("../dc-pro-activation.js");
    const result = await ensureDCProTenant({
      email: "team@plant.com",
      customerId: "cus_cmms",
      subscriptionId: "sub_cmms",
    });

    expect(result).not.toBeNull();

    // updateTenantTier must NOT be called — preserving the active CMMS tier
    const anyTierUpdate = capturedQueries.find((q) => q.sql.includes("SET tier"));
    expect(anyTierUpdate).toBeUndefined();
  });

  test("empty email returns null without touching DB", async () => {
    const { ensureDCProTenant } = await import("../dc-pro-activation.js");
    const result = await ensureDCProTenant({
      email: "",
      customerId: "cus_x",
      subscriptionId: "sub_x",
    });

    expect(result).toBeNull();
    expect(capturedQueries).toHaveLength(0);
  });
});

// ── Test: renderer entitlement gate ───────────────────────────────────────

describe("renderDriveLandingPage entitlement gate", () => {
  test("free tier renders pro-lock DOM element", async () => {
    const { renderDriveLandingPage } = await import("../drive-commander-renderer.js");
    const { getPack } = await import("../drive-pack-data.js");
    const pack = getPack("siemens-g120");
    expect(pack).not.toBeNull();
    if (!pack) return;

    const html = renderDriveLandingPage(pack, { isPro: false });
    expect(html).toContain("pro-lock");
    expect(html).toContain("Drive Commander Pro");
    // Pro content must NOT leak into free DOM
    expect(html).not.toContain("value-table");
  });

  test("isPro=true omits the pro-lock DOM gate (CSS class definition is still present)", async () => {
    const { renderDriveLandingPage } = await import("../drive-commander-renderer.js");
    const { getPack } = await import("../drive-pack-data.js");
    const pack = getPack("siemens-g120");
    expect(pack).not.toBeNull();
    if (!pack) return;

    const html = renderDriveLandingPage(pack, { isPro: true });
    // The CSS always defines .pro-lock; the DOM element must not appear for Pro users.
    expect(html).not.toContain('class="pro-lock"');
  });

  test("CTA copy leads with $197/yr (annual is lead SKU)", async () => {
    const { renderDriveLandingPage } = await import("../drive-commander-renderer.js");
    const { getPack } = await import("../drive-pack-data.js");
    const pack = getPack("siemens-g120");
    if (!pack) return;

    const html = renderDriveLandingPage(pack, { isPro: false });
    // Lead price must be annual $197/yr
    expect(html).toContain("$197/yr");
    // $29/mo must not appear as a standalone lead offer
    expect(html).not.toContain("$29/mo");
  });
});
