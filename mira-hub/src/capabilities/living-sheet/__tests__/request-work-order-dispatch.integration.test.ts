/**
 * TASK-OUTBOX-CREATE-WO — dispatcher coverage for `create_work_order`
 * deliveries, against real Postgres. MUST live under `living-sheet/__tests__/`,
 * never `cmms-dispatch/__tests__/` — see `request-work-order-outbox.integration.test.ts`'s
 * header for why: only `living-sheet/__tests__/` applies migration 114's
 * widened CHECK constraints in `beforeAll`, and `cmms-dispatch/__tests__/`
 * sorts BEFORE `living-sheet/__tests__/` under `--no-file-parallelism` — a
 * `create_work_order` INSERT from that directory would hit a fresh disposable
 * DB before 114 ever ran.
 *
 * Harness copied from `cmms-dispatch/__tests__/dispatcher.integration.test.ts`
 * (TRUNCATE/DELETE hygiene, MockCmmsWriteProvider, the `work_orders` stand-in)
 * plus `finish-outbox.integration.test.ts` (114-applies-twice beforeAll).
 *
 * Run (disposable DB only):
 *   MIRA_TEST_DB_CONFIRM=DISPOSABLE TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/<db> \
 *     npx vitest run -c vitest.integration.config.ts --no-file-parallelism src/capabilities/living-sheet
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error(
      "request-work-order-dispatch.integration.test.ts refuses to run: set MIRA_TEST_DB_CONFIRM=DISPOSABLE to " +
        "confirm TEST_DATABASE_URL points at a throwaway database. This suite applies migration 114 and writes " +
        "and deletes real rows.",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { withTenantContext } from "@/lib/tenant-context";
import { MockCmmsWriteProvider } from "@/lib/cmms/mock-write-provider";
import { runDispatchTick } from "@/capabilities/cmms-dispatch/dispatcher";
import { enqueueWorkOrderRequestedEvent } from "../request-work-order-outbox";
import { subjectRefForWorkOrderRequested } from "@/capabilities/cmms-dispatch";
import { reduceSheet, type StoredEvent } from "../reduce";
import { appendEvent, startJob, type StartJobResult } from "../store";
import type { JobSheetBody } from "../types";

const MIGRATION = path.resolve(__dirname, "../../../../db/migrations/114_living_work_sheet.sql");

function workOrderRequestedEnabledPolicy() {
  return { version: 1, work_order_requested: { enabled: true } };
}

async function setCmmsConfig(
  tenantId: string,
  opts: { provider?: string; enabled?: boolean; writePolicy: Record<string, unknown> },
): Promise<void> {
  await testPool.query(
    `INSERT INTO tenant_cmms_config (tenant_id, provider, enabled, write_policy)
     VALUES ($1, $2::cmms_provider, $3, $4::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET provider = $2::cmms_provider, enabled = $3, write_policy = $4::jsonb`,
    [tenantId, opts.provider ?? "atlas", opts.enabled ?? true, JSON.stringify(opts.writePolicy)],
  );
}

async function makeNotebook(tenantId: string, entityId: string | null, confirmed: boolean): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, equipment_entity_id, asset_confirmed_at)
     VALUES ($1::uuid, $2::uuid, 'dispatch test', $3, $4)
     RETURNING id::text AS id`,
    [tenantId, uuid(), entityId, entityId && confirmed ? new Date().toISOString() : null],
  );
  return res.rows[0]!.id;
}

function template(): JobSheetBody {
  return {
    title: "PM — Pump 07",
    machineLabel: "Pump 07",
    component: null,
    jobType: "pm",
    estHours: null,
    crewSize: null,
    isolationPoints: null,
    cautions: null,
    returnToService: [],
    items: [],
    torques: [],
    steps: [{ id: "step-1", text: "Check seal", checkoff: "none", torqueRef: null, source: null }],
    author: null,
    notes: null,
  };
}

const ACTOR = { userId: "tech-1", label: "Mike" };

function created(r: StartJobResult): Extract<StartJobResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}

async function jobView(jobId: string, entityId: string, machineName: string): Promise<ReturnType<typeof reduceSheet>> {
  const startEvent: StoredEvent = {
    id: `evt-${jobId}`,
    kind: "job_started",
    seq: 1,
    actorLabel: ACTOR.label,
    actorUserId: ACTOR.userId,
    occurredAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    workOrderId: null,
    payload: {
      title: "Light wheel bearing",
      machine: { entityId, name: machineName },
      templateRevisionId: null,
      template: template(),
    },
  } as StoredEvent;
  return reduceSheet([startEvent], jobId);
}

/** Enqueue one work_order_requested event + create_work_order delivery via
 *  the real store/outbox path (startJob + enqueueWorkOrderRequestedEvent),
 *  not a hand-rolled INSERT. Returns the delivery id so a test can inspect
 *  or mutate its row directly (lease-expiry simulation). */
async function enqueueOne(
  tenantId: string,
  notebookId: string,
  entityId: string,
): Promise<{ jobId: string; deliveryId: string }> {
  const jobId = await startOne(tenantId, notebookId, entityId);
  return { jobId, deliveryId: await enqueueFor(tenantId, notebookId, entityId, jobId) };
}

async function startOne(tenantId: string, notebookId: string, entityId: string): Promise<string> {
  const job = created(
    await startJob(
      tenantId,
      notebookId,
      { entityId, name: "Pump 07" },
      {
        title: "Light wheel bearing",
        templateRevisionId: null,
        template: template(),
        clientEventId: uuid(),
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
      },
      ACTOR,
    ),
  );
  return job.jobId;
}

async function enqueueFor(tenantId: string, notebookId: string, entityId: string, jobId: string): Promise<string> {
  const view = await jobView(jobId, entityId, "Pump 07");
  const result = await withTenantContext(tenantId, (c) =>
    enqueueWorkOrderRequestedEvent(c, {
      tenantId,
      notebookId,
      jobId,
      view,
      actorUserId: ACTOR.userId,
      occurredAt: new Date().toISOString(),
    }),
  );
  if (result.delivery.deliveryId === null) {
    throw new Error(`expected a delivery id, got reason=${result.delivery.reason}`);
  }
  return result.delivery.deliveryId;
}

beforeAll(async () => {
  const sql = readFileSync(MIGRATION, "utf8");
  await testPool.query(sql);
  await testPool.query(sql);

  // `cmms_equipment` is a production table (not tracked by a CREATE in this
  // migrations directory — same situation `target.ts`'s header documents for
  // `work_orders`). On the shared disposable DB this suite runs against, the
  // shared integration fixture (db/integration-fixtures/000_base_cmms_rls.sql,
  // also relied on by asset-bridge.integration.test.ts and
  // rls-deny.integration.test.ts) has ALREADY created `cmms_equipment` with a
  // UUID `tenant_id` + an FK to `tenants(id)` — deliberately diverging from
  // production's TEXT `tenant_id` (see that fixture's own file header and
  // .claude/rules/mira-hub-migrations.md). A bare `CREATE TABLE IF NOT EXISTS`
  // here would silently no-op against that pre-existing table, so instead:
  // add the one column this suite needs (mirroring how
  // asset-bridge.integration.test.ts ADDs `uns_path` onto the same shared
  // table rather than redefining it), and only if the fixture's base CREATE
  // never ran, create a minimal stand-in.
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS cmms_equipment (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      atlas_id text
    )
  `);
  await testPool.query(`ALTER TABLE cmms_equipment ADD COLUMN IF NOT EXISTS atlas_id text`);
  await testPool.query(`GRANT SELECT ON cmms_equipment TO factorylm_app`);
});

afterAll(async () => {
  await testPool.end();
});

// Global CLAIM means a row left behind by one test is fair game for the
// next test's runDispatchTick — wipe the outbox before every test (same
// hygiene dispatcher.integration.test.ts uses).
beforeEach(async () => {
  await testPool.query(`DELETE FROM notebook_event_deliveries`);
  await testPool.query(`DELETE FROM notebook_domain_events`);
});

describe("request-work-order-dispatch — basic delivery", () => {
  it("delivers exactly one Atlas order, unlinked (no cmms_equipment row for this asset)", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    const { deliveryId } = await enqueueOne(tenantId, nb, entityId);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });

    expect(stats.verified).toBe(1);
    expect(mock.creates).toBe(1);
    expect(mock.orders()).toHaveLength(1);
    expect(mock.orders()[0]!.externalAssetId).toBeNull();

    const row = await testPool.query<{ state: string; operation: string; external_ref: string | null }>(
      `SELECT state, operation, external_ref FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.operation).toBe("create_work_order");
    expect(row.rows[0]!.state).toBe("verified_by_readback");
    expect(row.rows[0]!.external_ref).toBe(mock.orders()[0]!.id);
  });

  it("resolves the Atlas asset id from cmms_equipment and links the order to it", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    // cmms_equipment.tenant_id carries an FK to tenants(id) in the shared
    // fixture (000_base_cmms_rls.sql) — satisfy it before the insert below.
    await testPool.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES ($1::uuid, $2, 'dispatch itest', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, `dispatch-itest-${tenantId}`],
    );
    await testPool.query(
      `INSERT INTO cmms_equipment (id, tenant_id, equipment_number, slug, path, atlas_id)
       VALUES ($1::uuid, $2::uuid, $3, $3, $3, $4)`,
      [entityId, tenantId, `pump-07-${entityId}`, "42"],
    );
    await enqueueOne(tenantId, nb, entityId);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });

    expect(stats.verified).toBe(1);
    expect(mock.orders()[0]!.externalAssetId).toBe("42");
  });

  it("a malformed atlas_id never reaches Atlas as an asset id — the order is created unlinked", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    await testPool.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES ($1::uuid, $2, 'dispatch itest', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, `dispatch-itest-${tenantId}`],
    );
    await testPool.query(
      `INSERT INTO cmms_equipment (id, tenant_id, equipment_number, slug, path, atlas_id)
       VALUES ($1::uuid, $2::uuid, $3, $3, $3, $4)`,
      [entityId, tenantId, `pump-07-${entityId}`, "atlas-asset-42"],
    );
    await enqueueOne(tenantId, nb, entityId);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });

    expect(stats.verified).toBe(1);
    expect(mock.orders()).toHaveLength(1);
    expect(mock.orders()[0]!.externalAssetId).toBeNull();
  });

  it("double tap: two enqueue calls for the same job still deliver exactly one Atlas order", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    const job = created(
      await startJob(
        tenantId,
        nb,
        { entityId, name: "Pump 07" },
        { title: "Light wheel bearing", templateRevisionId: null, template: template(), clientEventId: uuid(), occurredAt: new Date().toISOString() },
        ACTOR,
      ),
    );
    const view = await jobView(job.jobId, entityId, "Pump 07");
    const input = { tenantId, notebookId: nb, jobId: job.jobId, view, actorUserId: ACTOR.userId, occurredAt: new Date().toISOString() };
    await withTenantContext(tenantId, (c) => enqueueWorkOrderRequestedEvent(c, input));
    await withTenantContext(tenantId, (c) => enqueueWorkOrderRequestedEvent(c, input)); // the double tap

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });

    expect(stats.verified).toBe(1);
    expect(mock.creates).toBe(1);

    const subjectRef = subjectRefForWorkOrderRequested(job.jobId);
    const deliveries = await testPool.query(
      `SELECT count(*)::int AS n FROM notebook_event_deliveries d JOIN notebook_domain_events e ON e.event_id = d.event_id WHERE e.subject_ref = $1`,
      [subjectRef],
    );
    expect(deliveries.rows[0]!.n).toBe(1);
  });
});

describe("request-work-order-dispatch — retry after retryable_failure", () => {
  it("one retryable_failure tick, then a successful tick, creates exactly once", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    const { deliveryId } = await enqueueOne(tenantId, nb, entityId);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    mock.failNextCreate("retryable_failure");
    const s1 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(s1.retryable).toBe(1);
    expect(mock.creates).toBe(0);

    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
    const s2 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(s2.verified).toBe(1);
    expect(mock.creates).toBe(1);
  });
});

describe("request-work-order-dispatch — timeout after Atlas accepted", () => {
  it("lost_response (created, outcome reported unknown) reconciles by read-back next tick, zero additional creates", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    const { deliveryId } = await enqueueOne(tenantId, nb, entityId);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    mock.failNextCreate("lost_response");
    const s1 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(s1.unknown).toBe(1);
    expect(mock.creates).toBe(1); // the order WAS created — only the outcome was lost

    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
    const s2 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(s2.verified).toBe(1);
    expect(mock.creates).toBe(1); // never a second create

    const row = await testPool.query<{ state: string }>(`SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(row.rows[0]!.state).toBe("verified_by_readback");
  });
});

describe("request-work-order-dispatch — restart / lease expiry", () => {
  it("a reclaim whose previous owner never pinned is delivered normally by the second worker (one create)", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    const { deliveryId } = await enqueueOne(tenantId, nb, entityId);

    // Simulate the first worker dying after CLAIM but before PIN+WRITE: the
    // lease is expired and no pin was ever recorded.
    await testPool.query(
      `UPDATE notebook_event_deliveries
          SET state = 'leased', lease_token = gen_random_uuid(), lease_until = now() - interval '1 second', attempts = 1
        WHERE delivery_id = $1`,
      [deliveryId],
    );

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.verified).toBe(1);
    expect(mock.calls.map((c) => c.op)).toEqual(["createWorkOrder"]);
    expect(mock.creates).toBe(1);
  });

  it("a reclaim whose previous owner HAD pinned the request is reconciled by read-back only, never re-created", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    const { deliveryId } = await enqueueOne(tenantId, nb, entityId);

    // Simulate the first worker pinning the (unlinked) request, then dying
    // before — or during — the write: the write may have reached Atlas.
    await testPool.query(
      `UPDATE notebook_event_deliveries
          SET state = 'leased', lease_token = gen_random_uuid(), lease_until = now() - interval '1 second',
              attempts = 1, receipt = receipt || $2::jsonb
        WHERE delivery_id = $1`,
      [
        deliveryId,
        JSON.stringify({
          pinned_request: { providerId: "atlas", externalAssetId: null, source: "unlinked", pinnedAt: new Date().toISOString() },
        }),
      ],
    );

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(mock.calls.map((c) => c.op)).toEqual(["readBackWorkOrder"]);
    expect(mock.creates).toBe(0);
    // Not found by read-back (nothing was actually ever created in this
    // mock) — the row stays outcome_unknown, exactly the "ambiguous, never
    // re-created blindly" guarantee this test is proving.
    expect(stats.unknown).toBe(1);
  });
});

describe("request-work-order-dispatch — policy disabled between enqueue and dispatch", () => {
  it("blocked_policy, zero creates, when the tenant turns work_order_requested off before the tick runs", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: workOrderRequestedEnabledPolicy() });
    await enqueueOne(tenantId, nb, entityId);

    await setCmmsConfig(tenantId, { writePolicy: { version: 1, work_order_requested: { enabled: false } } });

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.blocked).toBe(1);
    expect(mock.creates).toBe(0);
  });
});

describe("request-work-order-dispatch — the finish note lands on the order this job created", () => {
  const POLICY_WO = "policy-wo-999";
  function bothPolicies() {
    return {
      version: 1,
      work_order_requested: { enabled: true },
      fix_recorded: { enabled: true, operation: "append_work_log", target: { kind: "work_order", externalWorkOrderId: POLICY_WO } },
    };
  }
  async function finish(tenantId: string, nb: string, jobId: string) {
    const r = await appendEvent(
      tenantId,
      nb,
      jobId,
      {
        clientEventId: uuid(),
        baseSeq: 1,
        kind: "job_finished",
        payload: { summary: null, openItemsAcknowledged: true },
        occurredAt: new Date().toISOString(),
        workOrderId: null,
      },
      ACTOR,
    );
    if (r.status !== "created") throw new Error(`expected created, got ${r.status}`);
  }

  it("created order → the job_finished note is appended to it, not to the policy target", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: bothPolicies() });
    const { jobId } = await enqueueOne(tenantId, nb, entityId);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    const orderId = mock.orders()[0]!.id;

    await finish(tenantId, nb, jobId);
    await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });

    expect(mock.orders()).toHaveLength(1);
    expect(mock.records(orderId).length).toBe(1);
    expect(mock.records(POLICY_WO).length).toBe(0);
  });

  it("create still in flight → the finish note waits, never lands on the policy target, then lands on the created order", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: bothPolicies() });
    const { jobId } = await enqueueOne(tenantId, nb, entityId);
    await finish(tenantId, nb, jobId);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    mock.failNextCreate("retryable_failure");
    await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });

    const finishState = async () =>
      (
        await testPool.query<{ state: string }>(
          `SELECT d.state FROM notebook_event_deliveries d
             JOIN notebook_domain_events e ON e.event_id = d.event_id
            WHERE e.tenant_id = $1::uuid AND e.event_type = 'job_finished'`,
          [tenantId],
        )
      ).rows[0]!.state;
    expect(["queued", "retryable_failure"]).toContain(await finishState());
    expect(mock.records(POLICY_WO).length).toBe(0);

    // Next ticks: the create succeeds, then the finish note follows it.
    for (let i = 0; i < 3; i++) {
      await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE tenant_id = $1::uuid`, [tenantId]);
      await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    }
    expect(mock.orders()).toHaveLength(1);
    expect(mock.records(mock.orders()[0]!.id).length).toBe(1);
    expect(mock.records(POLICY_WO).length).toBe(0);
    expect(await finishState()).toBe("verified_by_readback");
  });

  const deliveryOf = async (tenantId: string, eventType: string) =>
    (
      await testPool.query<{ state: string; last_error: string | null }>(
        `SELECT d.state, d.last_error FROM notebook_event_deliveries d
           JOIN notebook_domain_events e ON e.event_id = d.event_id
          WHERE e.tenant_id = $1::uuid AND e.event_type = $2`,
        [tenantId, eventType],
      )
    ).rows[0]!;

  it("create failed for good → the finish note is held visibly, never written to the policy target (Codex #5207 F4)", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: bothPolicies() });
    const { jobId } = await enqueueOne(tenantId, nb, entityId);
    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    mock.failNextCreate("permanent_failure");
    await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect((await deliveryOf(tenantId, "work_order_requested")).state).toBe("permanent_failure");

    await finish(tenantId, nb, jobId);
    await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });

    const fin = await deliveryOf(tenantId, "job_finished");
    expect(fin.state).toBe("blocked_policy");
    expect(fin.last_error).toContain("requested_work_order_not_created:permanent_failure");
    expect(mock.orders()).toHaveLength(0);
    expect(mock.records(POLICY_WO).length).toBe(0);
  });

  it("order requested AFTER the finish → both deliver; neither waits on the other (Codex #5207 F7)", async () => {
    const tenantId = uuid();
    const entityId = uuid();
    const nb = await makeNotebook(tenantId, entityId, true);
    await setCmmsConfig(tenantId, { writePolicy: bothPolicies() });
    const jobId = await startOne(tenantId, nb, entityId);
    await finish(tenantId, nb, jobId);
    await enqueueFor(tenantId, nb, entityId, jobId);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    for (let i = 0; i < 3; i++) {
      await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE tenant_id = $1::uuid`, [tenantId]);
      await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    }
    expect((await deliveryOf(tenantId, "job_finished")).state).toBe("verified_by_readback");
    expect((await deliveryOf(tenantId, "work_order_requested")).state).toBe("verified_by_readback");
    expect(mock.orders()).toHaveLength(1);
    // The order carries the finished sheet in its own description; the
    // finish note follows the tenant's policy as it did before this change.
    expect(mock.records(POLICY_WO).length).toBe(1);
  });
});
