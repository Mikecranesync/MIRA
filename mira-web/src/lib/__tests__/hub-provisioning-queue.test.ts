/**
 * hub-provisioning-queue tests.
 *
 * Same approach as hub-user-activation.test.ts: no live NeonDB — we mock
 * @neondatabase/serverless's `neon` to capture the SQL each helper issues
 * and script the rows it returns. Because the reconcile path calls
 * activateHubUserByEmail / expireHubUserByEmail internally, their
 * hub_users UPDATEs flow through the same mock and are scripted inline.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

let capturedQueries: Array<{ strings: TemplateStringsArray; values: unknown[] }>;
let scriptedReturns: Array<unknown[]>;
// 1-based query index that should reject instead of resolve (null = never).
let throwOnCall: number | null;

mock.module("@neondatabase/serverless", () => ({
  neon: () => {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedQueries.push({ strings, values });
      if (throwOnCall !== null && capturedQueries.length === throwOnCall) {
        return Promise.reject(new Error("connection reset"));
      }
      const next = scriptedReturns.shift() ?? [];
      return Promise.resolve(next);
    };
  },
}));

beforeEach(() => {
  capturedQueries = [];
  scriptedReturns = [];
  throwOnCall = null;
  process.env.NEON_DATABASE_URL = "postgresql://fake:fake@fake/fake";
});

afterEach(() => {
  delete process.env.NEON_DATABASE_URL;
});

function joinedSql(i: number): string {
  return capturedQueries[i].strings.join("?");
}

describe("recordPendingHubProvisioning", () => {
  test("inserts idempotently on stripe_event_id", async () => {
    scriptedReturns = [[{ stripe_event_id: "evt_1" }]];
    const { recordPendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );
    const created = await recordPendingHubProvisioning({
      stripeEventId: "evt_1",
      email: "payer@example.com",
      tenantId: "tenant-1",
      kind: "activate",
      lastError: "hub_user_not_found",
    });
    expect(created).toBe(true);
    expect(capturedQueries.length).toBe(1);
    const sql = joinedSql(0);
    expect(sql).toContain("INSERT INTO plg_pending_hub_provisioning");
    expect(sql).toContain("ON CONFLICT (stripe_event_id) DO NOTHING");
    expect(capturedQueries[0].values).toEqual([
      "evt_1",
      "payer@example.com",
      "tenant-1",
      "activate",
      "hub_user_not_found",
    ]);
  });

  test("returns false when the event was already recorded (Stripe replay)", async () => {
    scriptedReturns = [[]]; // ON CONFLICT DO NOTHING → no row back
    const { recordPendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );
    const created = await recordPendingHubProvisioning({
      stripeEventId: "evt_1",
      email: "payer@example.com",
      kind: "activate",
    });
    expect(created).toBe(false);
    expect(capturedQueries.length).toBe(1);
  });

  test("no-ops without touching DB when event id or email is missing", async () => {
    const { recordPendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );
    expect(
      await recordPendingHubProvisioning({
        stripeEventId: "",
        email: "a@b.com",
        kind: "activate",
      }),
    ).toBe(false);
    expect(
      await recordPendingHubProvisioning({
        stripeEventId: "evt_2",
        email: "   ",
        kind: "activate",
      }),
    ).toBe(false);
    expect(capturedQueries.length).toBe(0);
  });
});

describe("markHubProvisioningDoneByEmail", () => {
  test("closes pending rows for the email+kind only", async () => {
    scriptedReturns = [[{ stripe_event_id: "evt_1" }]];
    const { markHubProvisioningDoneByEmail } = await import(
      "../hub-provisioning-queue"
    );
    const closed = await markHubProvisioningDoneByEmail(
      "Payer@Example.com",
      "activate",
    );
    expect(closed).toBe(1);
    const sql = joinedSql(0);
    expect(sql).toContain("UPDATE plg_pending_hub_provisioning");
    expect(sql).toContain("status = 'done'");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("LOWER(email) = LOWER(");
    expect(capturedQueries[0].values).toContain("activate");
  });

  test("returns 0 for empty email without touching DB", async () => {
    const { markHubProvisioningDoneByEmail } = await import(
      "../hub-provisioning-queue"
    );
    expect(await markHubProvisioningDoneByEmail("  ", "activate")).toBe(0);
    expect(capturedQueries.length).toBe(0);
  });
});

describe("reconcilePendingHubProvisioning", () => {
  test("completes matched rows and keeps unmatched rows pending", async () => {
    scriptedReturns = [
      // 1. SELECT pending rows
      [
        {
          stripe_event_id: "evt_a",
          email: "landed@example.com",
          tenant_id: "t-1",
          kind: "activate",
          status: "pending",
          attempts: 0,
          last_error: null,
        },
        {
          stripe_event_id: "evt_b",
          email: "not-yet@example.com",
          tenant_id: "t-2",
          kind: "activate",
          status: "pending",
          attempts: 2,
          last_error: "hub_user_not_found",
        },
      ],
      // 2. evt_a → hub_users UPDATE (via activateHubUserByEmail) matches
      [{ id: "hub-user-1" }],
      // 3. evt_a → queue row flipped to done
      [],
      // 4. evt_b → hub_users UPDATE matches nothing (user still not on Hub)
      [],
      // 5. evt_b → queue row attempts bumped, stays pending
      [],
    ];
    const { reconcilePendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );
    const result = await reconcilePendingHubProvisioning();
    expect(result).toEqual({
      scanned: 2,
      completed: 1,
      stillPending: 1,
      errors: 0,
    });
    expect(capturedQueries.length).toBe(5);
    expect(joinedSql(0)).toContain("FROM plg_pending_hub_provisioning");
    expect(joinedSql(0)).toContain("status = 'pending'");
    expect(joinedSql(1)).toContain("UPDATE hub_users");
    expect(joinedSql(1)).toContain("status = 'approved'");
    expect(joinedSql(2)).toContain("status = 'done'");
    expect(joinedSql(4)).toContain("attempts = attempts + 1");
    expect(joinedSql(4)).toContain("'hub_user_not_found'");
  });

  test("routes kind=expire through expireHubUserByEmail", async () => {
    scriptedReturns = [
      [
        {
          stripe_event_id: "evt_c",
          email: "churned@example.com",
          tenant_id: null,
          kind: "expire",
          status: "pending",
          attempts: 0,
          last_error: null,
        },
      ],
      [{ id: "hub-user-2" }], // hub_users UPDATE matches
      [], // queue row → done
    ];
    const { reconcilePendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );
    const result = await reconcilePendingHubProvisioning();
    expect(result.completed).toBe(1);
    expect(joinedSql(1)).toContain("status = 'expired'");
  });

  test("scopes the sweep to one email when given (login-path hook)", async () => {
    scriptedReturns = [[]];
    const { reconcilePendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );
    const result = await reconcilePendingHubProvisioning({
      email: "Payer@Example.com",
    });
    expect(result).toEqual({
      scanned: 0,
      completed: 0,
      stillPending: 0,
      errors: 0,
    });
    expect(capturedQueries.length).toBe(1);
    expect(joinedSql(0)).toContain("LOWER(email) = LOWER(");
    expect(capturedQueries[0].values).toContain("Payer@Example.com");
  });

  test("a throwing hub UPDATE records the error and keeps the row pending", async () => {
    // Query 1 (SELECT) succeeds, query 2 (hub_users UPDATE) throws,
    // query 3 (bookkeeping UPDATE) succeeds.
    throwOnCall = 2;
    scriptedReturns = [
      [
        {
          stripe_event_id: "evt_d",
          email: "blip@example.com",
          tenant_id: "t-3",
          kind: "activate",
          status: "pending",
          attempts: 0,
          last_error: null,
        },
      ],
    ];
    const { reconcilePendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );
    const result = await reconcilePendingHubProvisioning();
    expect(result).toEqual({
      scanned: 1,
      completed: 0,
      stillPending: 0,
      errors: 1,
    });
    // Last query is the attempts/last_error bookkeeping UPDATE.
    const last = joinedSql(capturedQueries.length - 1);
    expect(last).toContain("attempts = attempts + 1");
    expect(capturedQueries[capturedQueries.length - 1].values).toContain(
      "connection reset",
    );
  });
});
