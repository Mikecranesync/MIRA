/**
 * TASK-OUTBOX-CREATE-WO — "request an Atlas work order" -> outbox, against
 * real Postgres. Harness copied from finish-outbox.integration.test.ts (same
 * disposable DB, same 114-applies-twice beforeAll, same `setCmmsConfig`
 * helper).
 *
 * This file covers the ENQUEUE layer only: event+delivery creation, the
 * double-tap/replay no-op, the policy gate, and tenant isolation. Cases that
 * require the dispatcher to actually branch on `operation = 'create_work_order'`
 * (retry-after-retryable-failure, timeout-after-accepted, lease-expiry
 * restart) live in a SIBLING file under `living-sheet/__tests__/` —
 * `request-work-order-dispatch.integration.test.ts` — never in
 * `cmms-dispatch/__tests__/dispatcher.integration.test.ts`. Reason (same as
 * finish-outbox.integration.test.ts's header): only `living-sheet/__tests__/`
 * applies migration 114's widened CHECK constraints in `beforeAll`, and
 * `cmms-dispatch/__tests__/` sorts BEFORE `living-sheet/__tests__/` under
 * `--no-file-parallelism` — a `create_work_order` INSERT from that file would
 * hit a fresh disposable DB before 114 ever ran.
 *
 * Run (disposable DB only):
 *   MIRA_TEST_DB_CONFIRM=DISPOSABLE TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/<db> \
 *     npx vitest run -c vitest.integration.config.ts --no-file-parallelism src/capabilities/living-sheet
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

// R2-23: refuse to touch any database the runner hasn't confirmed is throwaway.
const { testPool } = vi.hoisted(() => {
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error(
      "request-work-order-outbox.integration.test.ts refuses to run: set MIRA_TEST_DB_CONFIRM=DISPOSABLE to " +
        "confirm TEST_DATABASE_URL points at a throwaway database. This suite applies migration 114 and writes " +
        "and deletes real rows.",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { requestWorkOrder, startJob, type StartJobResult } from "../store";
import type { JobSheetBody } from "../types";
import { reduceSheet, type StoredEvent } from "../reduce";
import { withTenantContext } from "@/lib/tenant-context";
import { enqueueWorkOrderRequestedEvent } from "../request-work-order-outbox";
import { deliveryStatusForWorkOrderRequest, subjectRefForWorkOrderRequested } from "@/capabilities/cmms-dispatch";

const MIGRATION = path.resolve(__dirname, "../../../../db/migrations/114_living_work_sheet.sql");

async function makeNotebook(tenantId: string, entityId: string | null, confirmed: boolean): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, equipment_entity_id, asset_confirmed_at)
     VALUES ($1::uuid, $2::uuid, 'request work order test', $3, $4)
     RETURNING id::text AS id`,
    [tenantId, uuid(), entityId, entityId && confirmed ? new Date().toISOString() : null],
  );
  return res.rows[0]!.id;
}

function template(over: Partial<JobSheetBody> = {}): JobSheetBody {
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
    ...over,
  };
}

function startInput() {
  return {
    title: "Light wheel bearing",
    templateRevisionId: null,
    template: template(),
    clientEventId: uuid(),
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
  };
}

const ACTOR = { userId: "tech-1", label: "Mike" };

function created(r: StartJobResult): Extract<StartJobResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}

/** Same shape as finish-outbox.integration.test.ts / dispatcher.integration.test.ts. */
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

function workOrderRequestedEnabledPolicy() {
  return { version: 1, work_order_requested: { enabled: true } };
}

async function countDomainEvents(tenantId: string, subjectRef: string): Promise<number> {
  const res = await testPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM notebook_domain_events WHERE tenant_id = $1::uuid AND subject_ref = $2`,
    [tenantId, subjectRef],
  );
  return Number(res.rows[0]!.n);
}

async function countDeliveries(tenantId: string, subjectRef: string): Promise<number> {
  const res = await testPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM notebook_event_deliveries d
       JOIN notebook_domain_events e ON e.event_id = d.event_id
      WHERE d.tenant_id = $1::uuid AND e.subject_ref = $2`,
    [tenantId, subjectRef],
  );
  return Number(res.rows[0]!.n);
}

async function deliveryOperations(tenantId: string, subjectRef: string): Promise<string[]> {
  const res = await testPool.query<{ operation: string }>(
    `SELECT d.operation AS operation FROM notebook_event_deliveries d
       JOIN notebook_domain_events e ON e.event_id = d.event_id
      WHERE d.tenant_id = $1::uuid AND e.subject_ref = $2`,
    [tenantId, subjectRef],
  );
  return res.rows.map((r) => r.operation);
}

async function jobView(tenantId: string, notebookId: string, jobId: string, entityId: string, machineName: string): Promise<ReturnType<typeof reduceSheet>> {
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

beforeAll(async () => {
  const sql = readFileSync(MIGRATION, "utf8");
  await testPool.query(sql);
  await testPool.query(sql);
});

afterAll(async () => {
  await testPool.end();
});

describe("request-work-order-outbox — enqueue (policy enabled)", () => {
  it("requesting a work order enqueues exactly 1 domain event and 1 queued create_work_order delivery", async () => {
    const tenant = uuid();
    const entityId = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entityId, true);
    const job = created(await startJob(tenant, nb, { entityId, name: "Pump 07" }, startInput(), ACTOR));
    await setCmmsConfig(tenant, { writePolicy: workOrderRequestedEnabledPolicy() });

    const view = await jobView(tenant, nb, job.jobId, entityId, "Pump 07");
    await withTenantContext(tenant, (c) =>
      enqueueWorkOrderRequestedEvent(c, {
        tenantId: tenant,
        notebookId: nb,
        jobId: job.jobId,
        view,
        actorUserId: ACTOR.userId,
        occurredAt: new Date().toISOString(),
      }),
    );

    const subjectRef = subjectRefForWorkOrderRequested(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(1);
    expect(await deliveryOperations(tenant, subjectRef)).toEqual(["create_work_order"]);
  });

  it("double tap: two enqueue calls for the same job leave exactly 1 event and 1 delivery", async () => {
    const tenant = uuid();
    const entityId = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entityId, true);
    const job = created(await startJob(tenant, nb, { entityId, name: "Pump 07" }, startInput(), ACTOR));
    await setCmmsConfig(tenant, { writePolicy: workOrderRequestedEnabledPolicy() });

    const view = await jobView(tenant, nb, job.jobId, entityId, "Pump 07");
    const input = {
      tenantId: tenant,
      notebookId: nb,
      jobId: job.jobId,
      view,
      actorUserId: ACTOR.userId,
      occurredAt: new Date().toISOString(),
    };

    const first = await withTenantContext(tenant, (c) => enqueueWorkOrderRequestedEvent(c, input));
    const second = await withTenantContext(tenant, (c) => enqueueWorkOrderRequestedEvent(c, input));

    expect(second.replayed).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(second.delivery.deliveryId).toBe(first.delivery.deliveryId);

    const subjectRef = subjectRefForWorkOrderRequested(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(1);
  });
});

describe("request-work-order-outbox — policy off", () => {
  it("0 deliveries, reason policy_disabled, when the tenant has no CMMS config at all", async () => {
    const tenant = uuid();
    const entityId = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entityId, true);
    const job = created(await startJob(tenant, nb, { entityId, name: "Pump 07" }, startInput(), ACTOR));

    const view = await jobView(tenant, nb, job.jobId, entityId, "Pump 07");
    const result = await withTenantContext(tenant, (c) =>
      enqueueWorkOrderRequestedEvent(c, {
        tenantId: tenant,
        notebookId: nb,
        jobId: job.jobId,
        view,
        actorUserId: ACTOR.userId,
        occurredAt: new Date().toISOString(),
      }),
    );
    expect(result.delivery.deliveryId).toBeNull();

    const subjectRef = subjectRefForWorkOrderRequested(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(0);
  });

  it("0 deliveries when work_order_requested.enabled is false (fixRecorded enabled is irrelevant)", async () => {
    const tenant = uuid();
    const entityId = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entityId, true);
    const job = created(await startJob(tenant, nb, { entityId, name: "Pump 07" }, startInput(), ACTOR));
    await setCmmsConfig(tenant, {
      writePolicy: {
        version: 1,
        fix_recorded: { enabled: true, target: { kind: "asset_linked_work_order" } },
        work_order_requested: { enabled: false },
      },
    });

    const view = await jobView(tenant, nb, job.jobId, entityId, "Pump 07");
    const result = await withTenantContext(tenant, (c) =>
      enqueueWorkOrderRequestedEvent(c, {
        tenantId: tenant,
        notebookId: nb,
        jobId: job.jobId,
        view,
        actorUserId: ACTOR.userId,
        occurredAt: new Date().toISOString(),
      }),
    );
    expect(result.delivery.deliveryId).toBeNull();

    const subjectRef = subjectRefForWorkOrderRequested(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(0);
  });
});

describe("request-work-order-outbox — tenant isolation", () => {
  it("tenant B's outbox never contains tenant A's work_order_requested row", async () => {
    const tenantA = uuid();
    const tenantB = uuid();
    const entityId = `cmms-${uuid()}`;
    const nbA = await makeNotebook(tenantA, entityId, true);
    const job = created(await startJob(tenantA, nbA, { entityId, name: "Pump 07" }, startInput(), ACTOR));
    await setCmmsConfig(tenantA, { writePolicy: workOrderRequestedEnabledPolicy() });

    const view = await jobView(tenantA, nbA, job.jobId, entityId, "Pump 07");
    await withTenantContext(tenantA, (c) =>
      enqueueWorkOrderRequestedEvent(c, {
        tenantId: tenantA,
        notebookId: nbA,
        jobId: job.jobId,
        view,
        actorUserId: ACTOR.userId,
        occurredAt: new Date().toISOString(),
      }),
    );

    const subjectRef = subjectRefForWorkOrderRequested(job.jobId);
    expect(await countDomainEvents(tenantA, subjectRef)).toBe(1);

    const crossTenant = await withTenantContext(tenantB, (c) =>
      c.query(`SELECT 1 FROM notebook_domain_events WHERE subject_ref = $1`, [subjectRef]),
    );
    expect(crossTenant.rows.length).toBe(0);
  });
});

describe("requestWorkOrder (route entry point) — scoping", () => {
  it("creates once for the right tenant + notebook; a second call replays the same event; status reads it back", async () => {
    const tenant = uuid();
    const entityId = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entityId, true);
    const job = created(await startJob(tenant, nb, { entityId, name: "Pump 07" }, startInput(), ACTOR));
    await setCmmsConfig(tenant, { writePolicy: workOrderRequestedEnabledPolicy() });

    const first = await requestWorkOrder(tenant, nb, job.jobId, ACTOR);
    const second = await requestWorkOrder(tenant, nb, job.jobId, ACTOR);
    if (first.status !== "enqueued" || second.status !== "enqueued") throw new Error("expected enqueued");
    expect(first.result.replayed).toBe(false);
    expect(second.result.replayed).toBe(true);
    expect(second.result.eventId).toBe(first.result.eventId);
    expect(await countDomainEvents(tenant, subjectRefForWorkOrderRequested(job.jobId))).toBe(1);

    const status = await deliveryStatusForWorkOrderRequest(tenant, job.jobId);
    expect(status).toMatchObject({ eventId: first.result.eventId, state: "queued", externalRef: null });
  });

  it.each([
    // [last_error the dispatcher wrote, blockedBy shown while refused, state after a re-tap]
    ["cmms_licence_limit", "cmms_licence_limit", "queued"],
    ["permission_denied", null, "permission_denied"],
  ] as const)(
    "a re-tap after a refusal (%s): licence limit re-queues the same delivery, an access refusal stays refused",
    async (lastError, refusedBlockedBy, expectedState) => {
      const tenant = uuid();
      const entityId = `cmms-${uuid()}`;
      const nb = await makeNotebook(tenant, entityId, true);
      const job = created(await startJob(tenant, nb, { entityId, name: "Pump 07" }, startInput(), ACTOR));
      await setCmmsConfig(tenant, { writePolicy: workOrderRequestedEnabledPolicy() });
      const first = await requestWorkOrder(tenant, nb, job.jobId, ACTOR);
      if (first.status !== "enqueued") throw new Error("expected enqueued");

      // What the dispatcher writes when Atlas refuses the create.
      await testPool.query(
        `UPDATE notebook_event_deliveries
            SET state = 'permission_denied', last_error = $2, attempts = 1, next_attempt_at = now() + interval '1 day'
          WHERE event_id = $1::uuid`,
        [first.result.eventId, lastError],
      );
      const refused = await deliveryStatusForWorkOrderRequest(tenant, job.jobId);
      expect(refused).toMatchObject({ state: "permission_denied", blockedBy: refusedBlockedBy });

      const retap = await requestWorkOrder(tenant, nb, job.jobId, ACTOR);
      if (retap.status !== "enqueued") throw new Error("expected enqueued");
      expect(retap.result.replayed).toBe(true);
      expect(retap.result.eventId).toBe(first.result.eventId);

      const subject = subjectRefForWorkOrderRequested(job.jobId);
      expect(await countDomainEvents(tenant, subject)).toBe(1);
      expect(await countDeliveries(tenant, subject)).toBe(1);
      const after = await deliveryStatusForWorkOrderRequest(tenant, job.jobId);
      expect(after).toMatchObject({ state: expectedState, blockedBy: null });
      const due = await testPool.query<{ due: boolean }>(
        `SELECT next_attempt_at <= now() AS due FROM notebook_event_deliveries WHERE event_id = $1::uuid`,
        [first.result.eventId],
      );
      expect(due.rows[0]!.due).toBe(expectedState === "queued");
    },
  );

  it("wrong tenant or wrong notebook → job_not_found and nothing enqueued", async () => {
    const tenantA = uuid();
    const tenantB = uuid();
    const entityId = `cmms-${uuid()}`;
    const nbA = await makeNotebook(tenantA, entityId, true);
    const nbOther = await makeNotebook(tenantA, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenantA, nbA, { entityId, name: "Pump 07" }, startInput(), ACTOR));
    await setCmmsConfig(tenantA, { writePolicy: workOrderRequestedEnabledPolicy() });
    await setCmmsConfig(tenantB, { writePolicy: workOrderRequestedEnabledPolicy() });

    expect(await requestWorkOrder(tenantB, nbA, job.jobId, ACTOR)).toEqual({ status: "job_not_found" });
    expect(await requestWorkOrder(tenantA, nbOther, job.jobId, ACTOR)).toEqual({ status: "job_not_found" });
    const subjectRef = subjectRefForWorkOrderRequested(job.jobId);
    expect(await countDomainEvents(tenantA, subjectRef)).toBe(0);
    expect(await countDomainEvents(tenantB, subjectRef)).toBe(0);
    expect(await deliveryStatusForWorkOrderRequest(tenantB, job.jobId)).toBeNull();
  });
});
