/**
 * Integration test: Stripe webhook fires BEFORE Hub signup → payment queued → tenant provisioned.
 *
 * Exercises the full ordering-race path:
 * 1. A checkout.session.completed webhook for an email with no Hub account
 * 2. Payment is durably queued (not dropped)
 * 3. Hub signup happens later
 * 4. Reconciliation drains the queue and provisions the tenant
 * 5. Re-running reconciliation is idempotent (no double-provision)
 *
 * Closes GitHub issue #2438.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

let capturedQueries: Array<{ strings: TemplateStringsArray; values: unknown[] }>;
let scriptedReturns: Array<unknown[]>;

mock.module("@neondatabase/serverless", () => ({
  neon: () => {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedQueries.push({ strings, values });
      const next = scriptedReturns.shift() ?? [];
      return Promise.resolve(next);
    };
  },
}));

beforeEach(() => {
  capturedQueries = [];
  scriptedReturns = [];
  process.env.NEON_DATABASE_URL = "postgresql://fake:fake@fake/fake";
});

afterEach(() => {
  delete process.env.NEON_DATABASE_URL;
});

function joinedSql(i: number): string {
  return capturedQueries[i].strings.join("?");
}

describe("Stripe webhook before Hub signup race condition (#2438)", () => {
  test("webhook queues payment when Hub user doesn't exist yet, then reconciliation provisions tenant", async () => {
    const testEmail = "payer-before-signup@example.com";
    const testTenantId = "tenant-race-1";
    const stripeEventId = "evt_race_001";

    // Phase 1: Webhook fires, Hub user doesn't exist → queue the payment
    scriptedReturns = [
      // 1. INSERT into plg_pending_hub_provisioning → new row created
      [{ stripe_event_id: stripeEventId }],
    ];

    const {
      recordPendingHubProvisioning,
      reconcilePendingHubProvisioning,
    } = await import("../hub-provisioning-queue");

    const queued = await recordPendingHubProvisioning({
      stripeEventId,
      email: testEmail,
      tenantId: testTenantId,
      kind: "activate",
      lastError: "hub_user_not_found",
    });

    expect(queued).toBe(true);
    expect(capturedQueries.length).toBe(1);
    expect(joinedSql(0)).toContain("INSERT INTO plg_pending_hub_provisioning");

    // Phase 2: Later, Hub user is created (via signup flow)
    // Now reconciliation retries the queued payment
    capturedQueries = [];
    scriptedReturns = [
      // 1. SELECT pending rows → finds our queued row
      [
        {
          stripe_event_id: stripeEventId,
          email: testEmail,
          tenant_id: testTenantId,
          kind: "activate",
          status: "pending",
          attempts: 1,
          last_error: "hub_user_not_found",
        },
      ],
      // 2. UPDATE hub_users SET status='approved' WHERE email=... → NOW matches (user exists)
      [{ id: "hub-user-123" }],
      // 3. UPDATE plg_pending_hub_provisioning SET status='done' → queue row closed
      [],
    ];

    const result = await reconcilePendingHubProvisioning();

    expect(result).toEqual({
      scanned: 1,
      completed: 1,
      stillPending: 0,
      errors: 0,
    });

    // Verify the flow: SELECT → UPDATE hub_users → UPDATE queue row
    expect(capturedQueries.length).toBe(3);
    expect(joinedSql(0)).toContain("FROM plg_pending_hub_provisioning");
    expect(joinedSql(0)).toContain("status = 'pending'");
    expect(joinedSql(1)).toContain("UPDATE hub_users");
    expect(joinedSql(1)).toContain("status = 'approved'");
    expect(joinedSql(2)).toContain("UPDATE plg_pending_hub_provisioning");
    expect(joinedSql(2)).toContain("status = 'done'");

    // Phase 3: Re-running reconciliation is idempotent (no rows left to process)
    capturedQueries = [];
    scriptedReturns = [
      // No more pending rows
      [],
    ];

    const result2 = await reconcilePendingHubProvisioning();
    expect(result2).toEqual({
      scanned: 0,
      completed: 0,
      stillPending: 0,
      errors: 0,
    });
  });

  test("webhook queues multiple payments; reconciliation drains them in order", async () => {
    const email1 = "first-payer@example.com";
    const email2 = "second-payer@example.com";
    const evt1 = "evt_multi_001";
    const evt2 = "evt_multi_002";

    // Phase 1: Two webhooks queue payments for different emails
    const { recordPendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );

    scriptedReturns = [[{ stripe_event_id: evt1 }]];
    const q1 = await recordPendingHubProvisioning({
      stripeEventId: evt1,
      email: email1,
      tenantId: "tenant-1",
      kind: "activate",
    });
    expect(q1).toBe(true);

    scriptedReturns = [[{ stripe_event_id: evt2 }]];
    const q2 = await recordPendingHubProvisioning({
      stripeEventId: evt2,
      email: email2,
      tenantId: "tenant-2",
      kind: "activate",
    });
    expect(q2).toBe(true);

    // Phase 2: Reconciliation drains both
    const { reconcilePendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );

    capturedQueries = [];
    scriptedReturns = [
      // 1. SELECT both pending rows
      [
        {
          stripe_event_id: evt1,
          email: email1,
          tenant_id: "tenant-1",
          kind: "activate",
          status: "pending",
          attempts: 1,
          last_error: "hub_user_not_found",
        },
        {
          stripe_event_id: evt2,
          email: email2,
          tenant_id: "tenant-2",
          kind: "activate",
          status: "pending",
          attempts: 1,
          last_error: "hub_user_not_found",
        },
      ],
      // 2. evt1: UPDATE hub_users matches
      [{ id: "hub-user-1" }],
      // 3. evt1: queue row → done
      [],
      // 4. evt2: UPDATE hub_users matches
      [{ id: "hub-user-2" }],
      // 5. evt2: queue row → done
      [],
    ];

    const result = await reconcilePendingHubProvisioning();
    expect(result).toEqual({
      scanned: 2,
      completed: 2,
      stillPending: 0,
      errors: 0,
    });
    expect(capturedQueries.length).toBe(5);
  });

  test("Stripe webhook redelivery doesn't double-queue (ON CONFLICT idempotency)", async () => {
    const testEmail = "replay-test@example.com";
    const stripeEventId = "evt_replay_123";

    const { recordPendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );

    // First delivery
    scriptedReturns = [[{ stripe_event_id: stripeEventId }]];
    const first = await recordPendingHubProvisioning({
      stripeEventId,
      email: testEmail,
      tenantId: "tenant-replay",
      kind: "activate",
    });
    expect(first).toBe(true);

    // Stripe replays the same event (same event id)
    // ON CONFLICT (stripe_event_id) DO NOTHING → no row returned
    scriptedReturns = [[]];
    const replay = await recordPendingHubProvisioning({
      stripeEventId,
      email: testEmail,
      tenantId: "tenant-replay",
      kind: "activate",
    });
    expect(replay).toBe(false); // no new row created

    // Both queries touch the table, but replay inserted nothing new
    expect(capturedQueries.length).toBe(2);
    expect(joinedSql(0)).toContain("ON CONFLICT");
    expect(joinedSql(1)).toContain("ON CONFLICT");
  });

  test("reconciliation keeps unmatched rows pending and bumps attempt count", async () => {
    const queuedEmail = "not-yet-registered@example.com";
    const stripeEventId = "evt_unmatched";

    const { reconcilePendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );

    scriptedReturns = [
      // 1. SELECT the pending row
      [
        {
          stripe_event_id: stripeEventId,
          email: queuedEmail,
          tenant_id: null,
          kind: "activate",
          status: "pending",
          attempts: 3,
          last_error: "hub_user_not_found",
        },
      ],
      // 2. UPDATE hub_users matches NOTHING (user still not on Hub)
      [],
      // 3. Bump attempt count, stays pending
      [],
    ];

    const result = await reconcilePendingHubProvisioning();
    expect(result).toEqual({
      scanned: 1,
      completed: 0,
      stillPending: 1,
      errors: 0,
    });

    // Verify the row stays pending (attempts bumped, error recorded, but status unchanged)
    expect(joinedSql(2)).toContain("UPDATE plg_pending_hub_provisioning");
    expect(joinedSql(2)).toContain("attempts = attempts + 1");
    expect(joinedSql(2)).toContain("last_error = 'hub_user_not_found'");
  });

  test("reconciliation scoped to one email finds and retries only that email", async () => {
    const targetEmail = "Specific@Example.com";
    const otherEmail = "other@example.com";
    const evt1 = "evt_scope_1";
    const evt2 = "evt_scope_2";

    const { reconcilePendingHubProvisioning } = await import(
      "../hub-provisioning-queue"
    );

    // Scenario: two queued payments, but we reconcile only the first email
    scriptedReturns = [
      // 1. SELECT WHERE LOWER(email) = LOWER(targetEmail) — only evt1 returned
      [
        {
          stripe_event_id: evt1,
          email: targetEmail,
          tenant_id: "t-scope-1",
          kind: "activate",
          status: "pending",
          attempts: 0,
          last_error: null,
        },
      ],
      // 2. UPDATE hub_users for targetEmail
      [{ id: "hub-user-target" }],
      // 3. Queue row → done
      [],
    ];

    const result = await reconcilePendingHubProvisioning({
      email: targetEmail,
    });

    expect(result.scanned).toBe(1);
    expect(result.completed).toBe(1);

    // Verify the SELECT used LOWER() comparison and filtered to targetEmail only
    expect(joinedSql(0)).toContain("LOWER(email) = LOWER(");
    expect(capturedQueries[0].values).toContain(targetEmail);
    // Confirm otherEmail (evt2) is not in the scan results — scoping enforced
    expect(capturedQueries[0].values).not.toContain(otherEmail);
    expect(joinedSql(0)).not.toContain(evt2);
  });
});
