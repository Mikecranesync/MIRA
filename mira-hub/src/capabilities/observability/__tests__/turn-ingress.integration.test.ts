/**
 * The reconciliation is SQL, so it is proven against real Postgres.
 *
 * The whole point of 093 is to see a turn the ledger cannot see. A mocked pool
 * would only prove the arithmetic around the query; it would happily agree with
 * a WHERE clause that silently excludes the very rows the table exists to
 * catch. So this applies the real migrations to a disposable database, seeds one
 * attempt of each shape, and asserts the buckets by count.
 *
 * Run: MIRA_TEST_DB_CONFIRM=DISPOSABLE TEST_DATABASE_URL=… bun run test:integration
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

const URL_ = process.env.TEST_DATABASE_URL;

// `@/lib/db` builds its pool from NEON_DATABASE_URL with SSL forced on, which a
// disposable local Postgres does not speak. Inject the test pool instead — the
// same pattern node-files-links.integration.test.ts uses — so the module under
// test and this file talk to one database.
const testPool = new pg.Pool({ connectionString: URL_, max: 4 });
vi.mock("@/lib/db", () => ({ default: testPool }));
const d = URL_ ? describe : describe.skip;

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

/** a=closed, b=unfinished, c=pre-accept 400, d=LOST START, e=no response */
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const E = "eeeeeeee-0000-4000-8000-000000000005";

let client: pg.Client;

async function arrival(attemptId: string, at: string) {
  await client.query(
    `INSERT INTO turn_ingress (attempt_id, phase, route, tenant_id, notebook_id, at)
     VALUES ($1::uuid, 'arrived', 'hub_notebook_chat', $2, $3::uuid, now() - $4::interval)`,
    [attemptId, TENANT, NB, at],
  );
}
async function responded(attemptId: string, status: number, at: string) {
  await client.query(
    `INSERT INTO turn_ingress (attempt_id, phase, route, tenant_id, http_status, at)
     VALUES ($1::uuid, 'responded', 'hub_notebook_chat', $2, $3, now() - $4::interval)`,
    [attemptId, TENANT, status, at],
  );
}
async function ledger(attemptId: string, lifecycle: "started" | "closed", ageIso: string) {
  await client.query(
    `INSERT INTO decision_traces
       (tenant_id, platform, user_question, recommendation, citations_present,
        attempt_id, lifecycle, outcome, started_at, notebook_id)
     VALUES ($1, 'hub_notebook_chat', '', '', false, $2::uuid, $3,
             CASE WHEN $3 = 'closed' THEN 'answered' END,
             now() - $4::interval, $5::uuid)`,
    [TENANT, attemptId, lifecycle, ageIso, NB],
  );
}

d("turn_ingress reconciles against the ledger on real Postgres", () => {
  beforeAll(async () => {
    client = new pg.Client({ connectionString: URL_ });
    await client.connect();
    await client.query("DELETE FROM turn_ingress");
    await client.query("DELETE FROM decision_traces WHERE attempt_id IS NOT NULL");

    // A — a healthy turn: arrived, 200, opened, closed.
    await arrival(A, "30 minutes");
    await responded(A, 200, "30 minutes");
    await ledger(A, "started", "30 minutes");
    await ledger(A, "closed", "30 minutes");

    // B — accepted and never finished. The orphan 091 already sees.
    await arrival(B, "30 minutes");
    await responded(B, 200, "30 minutes");
    await ledger(B, "started", "30 minutes");

    // C — rejected before acceptance. Correct behaviour, NOT a capture loss.
    await arrival(C, "30 minutes");
    await responded(C, 400, "30 minutes");

    // D — THE DEFECT. Served a 200 and the ledger never heard about it.
    await arrival(D, "30 minutes");
    await responded(D, 200, "30 minutes");

    // E — arrived, nothing else. Cannot be judged either way; own bucket.
    await arrival(E, "30 minutes");
  });

  afterAll(async () => {
    await client?.end();
    await testPool?.end();
  });

  it("counts a 200 with no start row as a LOST START, not as coverage", async () => {
    const { ingressReconciliation } = await import("../turn-ingress");
    const r = await ingressReconciliation({ tenantId: TENANT, windowMs: 60 * 60_000, staleAfterMs: 5 * 60_000 });

    expect(r.arrived).toBe(5);
    expect(r.lost_starts).toBe(1); // D — invisible to any decision_traces query
    expect(r.pre_accept_rejections).toBe(1); // C
    expect(r.no_response_recorded).toBe(1); // E
    expect(r.accepted).toBe(2); // A, B
    expect(r.accepted_closed).toBe(1); // A
    expect(r.accepted_unfinished).toBe(1); // B
  });

  it("keeps the two populations on separate denominators", async () => {
    const { ingressReconciliation } = await import("../turn-ingress");
    const r = await ingressReconciliation({ tenantId: TENANT });

    // close_rate is about ACCEPTED turns only: 1 of 2.
    expect(r.close_rate).toBeCloseTo(0.5, 6);
    // start_capture is about arrivals that SHOULD have opened: 5 - 1 rejected
    // - 1 unjudgeable = 3, of which 1 was lost.
    expect(r.start_capture_rate).toBeCloseTo(2 / 3, 6);
  });

  it("the ledger's own coverage cannot see the lost start — which is why 093 exists", async () => {
    const { lifecycleCoverage } = await import("../turn-lifecycle");
    const c = await lifecycleCoverage({ tenantId: TENANT, windowMs: 60 * 60_000, staleAfterMs: 5 * 60_000 });
    // Two starts, one close: the ledger reports 50% and is not wrong — it is
    // blind. D never appears in either number. This assertion is the defect,
    // pinned: if a future change makes the ledger self-sufficient it fails here.
    expect(c.started).toBe(2);
    expect(c.closed).toBe(1);
    const ledgerOnlyDenominator = c.started;
    expect(ledgerOnlyDenominator).toBeLessThan(3); // the 3 that should have opened
  });

  it("does not attribute another tenant's arrivals", async () => {
    const { ingressReconciliation } = await import("../turn-ingress");
    const other = await ingressReconciliation({ tenantId: "99999999-9999-4999-8999-999999999999" });
    expect(other.arrived).toBe(0);
    expect(other.lost_starts).toBe(0);
  });

  it("the reconciler closes a stale start by APPENDING abandoned, never mutating it", async () => {
    const { reconcileStaleTurns } = await import("../turn-lifecycle");
    const before = await client.query(
      "SELECT count(*)::int AS n FROM decision_traces WHERE attempt_id = $1::uuid",
      [B],
    );
    expect(before.rows[0].n).toBe(1); // just the start

    const swept = await reconcileStaleTurns({ tenantId: TENANT, olderThanMs: 60_000 });
    expect(swept.abandoned).toBe(1);
    expect(swept.attemptIds).toContain(B);

    const rows = await client.query(
      "SELECT lifecycle, outcome FROM decision_traces WHERE attempt_id = $1::uuid ORDER BY lifecycle",
      [B],
    );
    expect(rows.rows.map((x) => x.lifecycle)).toEqual(["closed", "started"]);
    expect(rows.rows.find((x) => x.lifecycle === "closed")?.outcome).toBe("abandoned");
    // the start survived untouched — append-only, not an UPDATE
    expect(rows.rows.find((x) => x.lifecycle === "started")?.outcome).toBeNull();
  });

  it("is idempotent — a second sweep abandons nothing", async () => {
    const { reconcileStaleTurns } = await import("../turn-lifecycle");
    const again = await reconcileStaleTurns({ tenantId: TENANT, olderThanMs: 60_000 });
    expect(again.abandoned).toBe(0);
  });

  it("refuses to let the request path rewrite an arrival", async () => {
    await client.query("SET LOCAL ROLE factorylm_app").catch(() => {});
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await expect(
      client.query("UPDATE turn_ingress SET http_status = 999 WHERE attempt_id = $1::uuid", [D]),
    ).rejects.toThrow(/permission denied/i);
    await client.query("ROLLBACK");
  });
});
