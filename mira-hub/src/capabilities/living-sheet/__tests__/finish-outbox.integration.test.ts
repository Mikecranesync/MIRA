/**
 * TASK-S7 — finish job -> outbox -> Atlas work log, against real Postgres.
 * Harness copied from living-sheet.integration.test.ts (same disposable DB,
 * same 114-applies-twice beforeAll). Adds `setCmmsConfig`, the one local
 * helper cmms-dispatch/__tests__/dispatcher.integration.test.ts also defines
 * for itself, to opt a tenant into dispatch.
 *
 * The one dispatcher-level assertion (a job_finished event delivers
 * `payload.summary` as the note text, not "Recorded fix — …") lives HERE,
 * not in dispatcher.integration.test.ts: only THIS file's `beforeAll` applies
 * 114's widened `notebook_domain_events_event_type_check`. Under
 * `--no-file-parallelism`, `cmms-dispatch/__tests__/` sorts before
 * `living-sheet/__tests__/`, so a job_finished INSERT attempted from that
 * file would hit a fresh disposable DB before 114 ever ran. Side benefit:
 * dispatcher.integration.test.ts stays byte-unchanged.
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

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { appendEvent, startJob, type AppendEventResult, type StartJobResult } from "../store";
import type { JobSheetBody } from "../types";
import { withTenantContext } from "@/lib/tenant-context";
import { MockCmmsWriteProvider } from "@/lib/cmms/mock-write-provider";
import { runDispatchTick, type DispatchDeps } from "@/capabilities/cmms-dispatch/dispatcher";
import { enqueueFixRecordedEvent } from "@/capabilities/cmms-dispatch/enqueue";
import { subjectRefForJobFinished } from "../finish-outbox";

const MIGRATION = path.resolve(__dirname, "../../../../db/proposed/114_living_work_sheet.sql");

async function makeNotebook(tenantId: string, entityId: string | null, confirmed: boolean): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, equipment_entity_id, asset_confirmed_at)
     VALUES ($1::uuid, $2::uuid, 'finish outbox test', $3, $4)
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
    steps: [
      { id: "step-1", text: "Check seal", checkoff: "none", torqueRef: null, source: null },
      { id: "step-2", text: "Torque bolts", checkoff: "none", torqueRef: null, source: null },
    ],
    author: null,
    notes: null,
    ...over,
  };
}

function startInput(
  over: Partial<{ title: string; templateRevisionId: string | null; template: JobSheetBody; clientEventId: string; occurredAt: string }> = {},
) {
  return {
    title: "Light wheel bearing",
    templateRevisionId: null,
    template: template(),
    clientEventId: uuid(),
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}

const ACTOR = { userId: "tech-1", label: "Mike" };

function created(r: StartJobResult): Extract<StartJobResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}

function appendCreated(r: AppendEventResult): Extract<AppendEventResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}

const finishEvent = (over: Record<string, unknown> = {}) => ({
  clientEventId: uuid(),
  baseSeq: 1,
  kind: "job_finished" as const,
  payload: { summary: null, openItemsAcknowledged: true },
  occurredAt: new Date().toISOString(),
  workOrderId: null,
  ...over,
});

/** Same shape as cmms-dispatch/__tests__/dispatcher.integration.test.ts's own
 *  helper — opts a tenant into dispatch via tenant_cmms_config. */
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

function enabledPolicy(externalWorkOrderId: string) {
  return { version: 1, fix_recorded: { enabled: true, operation: "append_work_log", target: { kind: "work_order", externalWorkOrderId } } };
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

beforeAll(async () => {
  const sql = readFileSync(MIGRATION, "utf8");
  await testPool.query(sql);
  await testPool.query(sql);
});

afterAll(async () => {
  await testPool.end();
});

describe("finish-outbox — finish -> outbox (policy enabled)", () => {
  it("finishing a job enqueues exactly 1 domain event and 1 queued delivery", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    const woId = `wo-${uuid()}`;
    await setCmmsConfig(tenant, { writePolicy: enabledPolicy(woId) });

    const finished = appendCreated(await appendEvent(tenant, nb, job.jobId, finishEvent(), ACTOR));
    expect(finished.status).toBe("created");

    const subjectRef = subjectRefForJobFinished(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(1);
  });

  it("a replayed finish (same clientEventId) still leaves exactly 1 event and 1 delivery", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    const woId = `wo-${uuid()}`;
    await setCmmsConfig(tenant, { writePolicy: enabledPolicy(woId) });

    const ev = finishEvent();
    const first = appendCreated(await appendEvent(tenant, nb, job.jobId, ev, ACTOR));
    const second = await appendEvent(tenant, nb, job.jobId, ev, ACTOR);
    expect(second.status).toBe("existing");
    if (second.status === "existing") expect(second.event.id).toBe(first.event.id);

    const subjectRef = subjectRefForJobFinished(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(1);
  });
});

describe("finish-outbox — policy disabled", () => {
  it("0 deliveries, reason policy_disabled, when the tenant has no CMMS config at all", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));

    const finished = appendCreated(await appendEvent(tenant, nb, job.jobId, finishEvent(), ACTOR));
    expect(finished.status).toBe("created");

    const subjectRef = subjectRefForJobFinished(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(0);
  });

  it("0 deliveries when the tenant's write policy has fix_recorded disabled", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    await setCmmsConfig(tenant, { writePolicy: { version: 1, fix_recorded: { enabled: false } } });

    const finished = appendCreated(await appendEvent(tenant, nb, job.jobId, finishEvent(), ACTOR));
    expect(finished.status).toBe("created");

    const subjectRef = subjectRefForJobFinished(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(0);
  });
});

describe("finish-outbox — a failed sheet append never reaches the outbox", () => {
  it("finishing an already-finished job (409 job_finished) writes no second outbox row", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    const woId = `wo-${uuid()}`;
    await setCmmsConfig(tenant, { writePolicy: enabledPolicy(woId) });

    appendCreated(await appendEvent(tenant, nb, job.jobId, finishEvent(), ACTOR));
    const second = await appendEvent(
      tenant, nb, job.jobId,
      finishEvent({ baseSeq: 2 }),
      ACTOR,
    );
    expect(second.status).toBe("job_finished");

    const subjectRef = subjectRefForJobFinished(job.jobId);
    expect(await countDomainEvents(tenant, subjectRef)).toBe(1);
    expect(await countDeliveries(tenant, subjectRef)).toBe(1);
  });
});

describe("finish-outbox — tenant isolation", () => {
  it("tenant B's outbox never contains tenant A's job_finished row", async () => {
    const tenantA = uuid();
    const tenantB = uuid();
    const nbA = await makeNotebook(tenantA, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenantA, nbA, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    await setCmmsConfig(tenantA, { writePolicy: enabledPolicy(`wo-${uuid()}`) });
    appendCreated(await appendEvent(tenantA, nbA, job.jobId, finishEvent(), ACTOR));

    const subjectRef = subjectRefForJobFinished(job.jobId);
    expect(await countDomainEvents(tenantA, subjectRef)).toBe(1);

    const crossTenant = await withTenantContext(tenantB, (c) =>
      c.query(`SELECT 1 FROM notebook_domain_events WHERE subject_ref = $1`, [subjectRef]),
    );
    expect(crossTenant.rows.length).toBe(0);
  });
});

describe("finish-outbox — dispatcher delivers the job-sheet note, not a fix-record note", () => {
  it("runDispatchTick delivers payload.summary as the note text, never 'Recorded fix — …'", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    const woId = `wo-${uuid()}`;
    await setCmmsConfig(tenant, { writePolicy: enabledPolicy(woId) });

    appendCreated(
      await appendEvent(
        tenant, nb, job.jobId,
        finishEvent({ payload: { summary: "closed out, pump sounds fine", openItemsAcknowledged: true } }),
        ACTOR,
      ),
    );

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const deps: DispatchDeps = { providerFor: () => mock, tenantAllowlist: new Set([tenant]) };
    await runDispatchTick(deps);

    const records = mock.records(woId);
    expect(records.length).toBe(1);
    expect(records[0]!.content).toContain("Job sheet finished");
    expect(records[0]!.content).toContain("Light wheel bearing");
    expect(records[0]!.content).not.toContain("Recorded fix");
  });

  it("control group: a fix_recorded event still delivers via buildNoteText (unchanged)", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const woId = `wo-${uuid()}`;
    await setCmmsConfig(tenant, { writePolicy: enabledPolicy(woId) });

    // The real enqueue path (not a hand-rolled insert) — this is the
    // existing fix_recorded behavior the dispatcher.ts edit must leave
    // byte-for-byte unchanged.
    const fixRecordId = uuid();
    await withTenantContext(tenant, (c) =>
      enqueueFixRecordedEvent(c, {
        tenantId: tenant,
        notebookId: nb,
        fixRecordId,
        sourceTurnId: null,
        equipmentEntityId: `cmms-${uuid()}`,
        symptom: "conveyor stopped",
        faultCode: "F0004",
        fix: "cleared the jam",
        recordedBy: "tech-1",
        occurredAt: new Date().toISOString(),
      }),
    );

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenant]) });

    const records = mock.records(woId);
    expect(records.length).toBe(1);
    expect(records[0]!.content).toContain("Recorded fix");
  });
});
