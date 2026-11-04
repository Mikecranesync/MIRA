/**
 * Living Work Sheet event log against real Postgres. Harness copied from
 * capabilities/observations/__tests__/observations.integration.test.ts: the
 * real withTenantContext (SET LOCAL ROLE factorylm_app + RLS) runs against a
 * disposable database. Migration 114 is applied here, twice, from
 * db/proposed (never db/migrations).
 *
 * Run (disposable DB only):
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/<db> MIRA_TEST_DB_CONFIRM=DISPOSABLE \
 *     npx vitest run --config vitest.integration.config.ts src/capabilities/living-sheet
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

import { appendEvent, listJobs, loadJob, startJob, type AppendEventResult, type StartJobResult } from "../store";
import type { JobSheetBody } from "../types";
import { withTenantContext } from "@/lib/tenant-context";

const MIGRATION = path.resolve(__dirname, "../../../../db/proposed/114_living_work_sheet.sql");

async function makeNotebook(tenantId: string, entityId: string | null, confirmed: boolean): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, equipment_entity_id, asset_confirmed_at)
     VALUES ($1::uuid, $2::uuid, 'living sheet test', $3, $4)
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

function startInput(over: Partial<{ title: string; templateRevisionId: string | null; template: JobSheetBody; clientEventId: string; occurredAt: string }> = {}) {
  return {
    title: "PM — Pump 07",
    templateRevisionId: null,
    template: template(),
    clientEventId: uuid(),
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}

const ACTOR = { userId: "tech-1", label: "Tech One" };

function created(r: StartJobResult): Extract<StartJobResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}

function appendCreated(r: AppendEventResult): Extract<AppendEventResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}

async function countEvents(tenantId: string, jobId: string): Promise<number> {
  const res = await testPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM work_sheet_events WHERE tenant_id = $1::uuid AND job_id = $2::uuid`,
    [tenantId, jobId],
  );
  return Number(res.rows[0]!.n);
}

beforeAll(async () => {
  const sql = readFileSync(MIGRATION, "utf8");
  // Idempotency: applying the proposed file twice must leave the same schema.
  await testPool.query(sql);
  await testPool.query(sql);
});

afterAll(async () => {
  await testPool.end();
});

describe("living sheet — startJob idempotency", () => {
  it("retrying the same clientEventId returns the existing job, with exactly one job_started row", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const input = startInput();

    const first = created(await startJob(tenant, nb, machine, input, ACTOR));
    const second = await startJob(tenant, nb, machine, input, ACTOR);

    expect(second.status).toBe("existing");
    if (second.status === "existing") expect(second.jobId).toBe(first.jobId);
    expect(await countEvents(tenant, first.jobId)).toBe(1);
  });

  it("reusing a clientEventId with a different title conflicts", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const input = startInput();
    const first = created(await startJob(tenant, nb, machine, input, ACTOR));

    const changed = await startJob(tenant, nb, machine, { ...input, title: "A different title entirely" }, ACTOR);
    expect(changed.status).toBe("request_id_conflict");
    expect(await countEvents(tenant, first.jobId)).toBe(1);
  });
});

describe("living sheet — appendEvent idempotency and conflicts", () => {
  it("retrying the same clientEventId returns the existing event, with exactly one row at that seq", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenant, nb, machine, startInput(), ACTOR));

    const append = {
      clientEventId: uuid(),
      baseSeq: 1,
      kind: "step_marked" as const,
      payload: { stepId: "step-1", done: true, note: null },
      occurredAt: new Date().toISOString(),
      workOrderId: null,
    };
    const first = appendCreated(await appendEvent(tenant, nb, job.jobId, append, ACTOR));
    const second = await appendEvent(tenant, nb, job.jobId, append, ACTOR);

    expect(second.status).toBe("existing");
    if (second.status === "existing") expect(second.event.id).toBe(first.event.id);
    expect(await countEvents(tenant, job.jobId)).toBe(2); // job_started + the one step_marked
  });

  // F17 (TASK-EGM-C). The photos route
  // (app/api/.../sheets/[jobId]/photos/route.ts) has no client-supplied
  // timestamp to carry — it's a multipart upload — so it stamps
  // `occurredAt: new Date().toISOString()` fresh on EVERY call, including a
  // same-clientEventId retry. Simulated here by calling appendEvent twice
  // with the same photo_attached clientEventId/payload but two DIFFERENT
  // server-generated occurredAt values, exactly as two separate HTTP POSTs
  // of the identical multipart retry would produce. Before the fix this
  // returned request_id_conflict (409) instead of replaying idempotently.
  it("F17: a photo_attached retry with a different server-stamped occurredAt still replays idempotently (never request_id_conflict)", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenant, nb, machine, startInput(), ACTOR));
    const clientEventId = uuid(); // == payload.photoId, per the route's own doc comment

    const first = appendCreated(
      await appendEvent(
        tenant, nb, job.jobId,
        { clientEventId, baseSeq: 1, kind: "photo_attached", payload: { photoId: clientEventId, fileId: "file-1", caption: "bearing surface" }, occurredAt: new Date().toISOString(), workOrderId: null },
        ACTOR,
      ),
    );
    // A retry: SAME clientEventId, SAME payload, but a LATER occurredAt —
    // the server has no way to reproduce its own first timestamp.
    const second = await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId, baseSeq: 1, kind: "photo_attached", payload: { photoId: clientEventId, fileId: "file-1", caption: "bearing surface" }, occurredAt: new Date(Date.now() + 5000).toISOString(), workOrderId: null },
      ACTOR,
    );

    expect(second.status).toBe("existing");
    if (second.status === "existing") expect(second.event.id).toBe(first.event.id);
    expect(await countEvents(tenant, job.jobId)).toBe(2); // job_started + the one photo_attached, never a duplicate
  });

  it("control: a step_marked retry with a DIFFERENT occurredAt still conflicts — only photo_attached gets the F17 exemption", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenant, nb, machine, startInput(), ACTOR));
    const clientEventId = uuid();
    await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId, baseSeq: 1, kind: "step_marked", payload: { stepId: "step-1", done: true, note: null }, occurredAt: new Date().toISOString(), workOrderId: null },
      ACTOR,
    );
    const second = await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId, baseSeq: 1, kind: "step_marked", payload: { stepId: "step-1", done: true, note: null }, occurredAt: new Date(Date.now() + 5000).toISOString(), workOrderId: null },
      ACTOR,
    );
    expect(second.status).toBe("request_id_conflict");
  });

  it("reusing a clientEventId with a different payload conflicts", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenant, nb, machine, startInput(), ACTOR));
    const clientEventId = uuid();

    await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId, baseSeq: 1, kind: "step_marked", payload: { stepId: "step-1", done: true, note: null }, occurredAt: new Date().toISOString(), workOrderId: null },
      ACTOR,
    );
    const changed = await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId, baseSeq: 1, kind: "step_marked", payload: { stepId: "step-1", done: false, note: null }, occurredAt: new Date().toISOString(), workOrderId: null },
      ACTOR,
    );
    expect(changed.status).toBe("request_id_conflict");
    expect(await countEvents(tenant, job.jobId)).toBe(2);
  });

  it("3 commutative appends (part_logged) at a stale baseSeq all land, in order, with 0 duplicates", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenant, nb, machine, startInput(), ACTOR));
    // Three devices went offline right after job_started (seq 1) and each
    // queued one part_logged append against that same stale baseSeq.
    const staleBaseSeq = 1;
    const parts = [uuid(), uuid(), uuid()];
    const results: AppendEventResult[] = [];
    for (const partEntryId of parts) {
      results.push(
        await appendEvent(
          tenant, nb, job.jobId,
          { clientEventId: uuid(), baseSeq: staleBaseSeq, kind: "part_logged", payload: { partEntryId, item: "Seal kit", action: "used", qty: 1 }, occurredAt: new Date().toISOString(), workOrderId: null },
          ACTOR,
        ),
      );
    }
    for (const r of results) expect(r.status).toBe("created");
    const seqs = results.map((r) => appendCreated(r).seq);
    expect(seqs).toEqual([2, 3, 4]); // landed in call order, no conflicts
    expect(new Set(seqs).size).toBe(3); // 0 duplicates
    expect(await countEvents(tenant, job.jobId)).toBe(4); // job_started + 3 parts

    const final = await loadJob(tenant, nb, job.jobId);
    if (final.status !== "ok") throw new Error(final.status);
    expect(final.view.parts).toHaveLength(3);
  });

  it("two corrections of the same reading from the same baseSeq: the 2nd is a conflict", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenant, nb, machine, startInput(), ACTOR));
    const readingId = uuid();

    const recorded = appendCreated(
      await appendEvent(
        tenant, nb, job.jobId,
        { clientEventId: uuid(), baseSeq: 1, kind: "reading_recorded", payload: { readingId, what: "Discharge pressure", value: 48, unit: "psi", source: { kind: "tech", ref: null } }, occurredAt: new Date().toISOString(), workOrderId: null },
        ACTOR,
      ),
    );
    const baseSeq = recorded.seq; // both corrections start from this same baseSeq

    const correctionA = await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId: uuid(), baseSeq, kind: "reading_corrected", payload: { readingId, value: 4.8, unit: "psi", reason: "misread" }, occurredAt: new Date().toISOString(), workOrderId: null },
      ACTOR,
    );
    expect(correctionA.status).toBe("created");

    const correctionB = await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId: uuid(), baseSeq, kind: "reading_corrected", payload: { readingId, value: 5.2, unit: "psi", reason: "re-measured" }, occurredAt: new Date().toISOString(), workOrderId: null },
      ACTOR,
    );
    expect(correctionB.status).toBe("conflict");
    if (correctionB.status === "conflict") {
      expect(correctionB.view.readings[0]!.current.value).toBe(4.8); // correctionA's value won; B never landed
    }
  });
});

describe("living sheet — S1 review fixes (7e8f9de7)", () => {
  const ev = (over: Record<string, unknown>) => ({
    clientEventId: uuid(), baseSeq: 1, occurredAt: new Date().toISOString(), workOrderId: null, ...over,
  }) as Parameters<typeof appendEvent>[3];

  it("a finished job refuses any further event", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    appendCreated(await appendEvent(tenant, nb, job.jobId, ev({ kind: "job_finished", payload: { summary: null, openItemsAcknowledged: true } }), ACTOR));
    const after = await appendEvent(tenant, nb, job.jobId, ev({ baseSeq: 2, kind: "note_added", payload: { noteId: uuid(), text: "late note", noteKind: "note" } }), ACTOR);
    expect(after.status).toBe("job_finished");
    expect(await countEvents(tenant, job.jobId)).toBe(2);
  });

  it("two techs marking the same step done from the same baseSeq both land (same value is not a clash)", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    const mark = { kind: "step_marked", payload: { stepId: "step-1", done: true, note: null } };
    appendCreated(await appendEvent(tenant, nb, job.jobId, ev(mark), ACTOR));
    const second = await appendEvent(tenant, nb, job.jobId, ev(mark), { userId: "tech-2", label: "Tech Two" });
    expect(second.status).toBe("created");
    const undo = await appendEvent(tenant, nb, job.jobId, ev({ kind: "step_marked", payload: { stepId: "step-1", done: false, note: null } }), ACTOR);
    expect(undo.status).toBe("conflict");
  });

  it("recording a reading under an id that already exists is refused", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const job = created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));
    const readingId = uuid();
    const rec = (value: number, baseSeq: number) => ev({ baseSeq, kind: "reading_recorded", payload: { readingId, what: "motor current", value, unit: "A", source: { kind: "tech", ref: null } } });
    appendCreated(await appendEvent(tenant, nb, job.jobId, rec(48, 1), ACTOR));
    const dup = await appendEvent(tenant, nb, job.jobId, rec(4.8, 2), ACTOR);
    expect(dup.status).toBe("invalid_target");
  });
});

describe("living sheet — tenant isolation (RLS)", () => {
  it("tenant B cannot read or append to tenant A's job", async () => {
    const tenantA = uuid();
    const tenantB = uuid();
    const nbA = await makeNotebook(tenantA, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenantA, nbA, machine, startInput(), ACTOR));

    // Tenant B's listJobs against notebook A's id sees nothing (RLS scopes
    // the row set to tenant B before the notebook_id filter even matters).
    expect(await listJobs(tenantB, nbA)).toEqual([]);

    // Tenant B's loadJob for A's job id: job_not_found, never A's data.
    const read = await loadJob(tenantB, nbA, job.jobId);
    expect(read.status).toBe("job_not_found");

    // Tenant B's appendEvent for A's job id: job_not_found, nothing written.
    const write = await appendEvent(
      tenantB, nbA, job.jobId,
      { clientEventId: uuid(), baseSeq: 1, kind: "step_marked", payload: { stepId: "step-1", done: true, note: null }, occurredAt: new Date().toISOString(), workOrderId: null },
      { userId: "intruder", label: "Intruder" },
    );
    expect(write.status).toBe("job_not_found");

    // Tenant A's own view is untouched.
    expect(await countEvents(tenantA, job.jobId)).toBe(1);
    const stillA = await loadJob(tenantA, nbA, job.jobId);
    expect(stillA.status).toBe("ok");
  });
});

describe("living sheet — factorylm_app is append-only (UPDATE/DELETE denied)", () => {
  it("UPDATE on work_sheet_events is denied", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenant, nb, machine, startInput(), ACTOR));

    await expect(
      withTenantContext(tenant, (c) => c.query(`UPDATE work_sheet_events SET actor_label = 'tampered' WHERE job_id = $1::uuid`, [job.jobId])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("DELETE on work_sheet_events is denied", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    const machine = { entityId: `cmms-${uuid()}`, name: "Pump 07" };
    const job = created(await startJob(tenant, nb, machine, startInput(), ACTOR));

    await expect(
      withTenantContext(tenant, (c) => c.query(`DELETE FROM work_sheet_events WHERE job_id = $1::uuid`, [job.jobId])),
    ).rejects.toThrow(/permission denied/i);
  });
});

// Mirrors observations.integration.test.ts's rollback proof: the block is run
// statement-for-statement in one transaction on a dedicated client, the end
// state asserted, then rolled back so suites sharing this disposable
// database keep the table.
describe("living sheet — migration 114 applies twice cleanly; documented rollback runs", () => {
  it("the ROLLBACK-BEGIN/END block drops all three tables and is reversible", async () => {
    const text = readFileSync(MIGRATION, "utf8");
    const m = text.match(/^-- ROLLBACK-BEGIN\n([\s\S]*?)^-- ROLLBACK-END$/m);
    expect(m, "114 must carry a ROLLBACK-BEGIN / ROLLBACK-END block").not.toBeNull();
    const block = m![1]!.split("\n").map((l) => l.replace(/^--   ?/, "")).join("\n").trim();
    expect(block.startsWith("BEGIN;")).toBe(true);
    expect(block.endsWith("COMMIT;")).toBe(true);
    const body = block.slice("BEGIN;".length, -"COMMIT;".length);

    // Leave at least one real row behind so the rollback runs against a
    // populated table, not an empty one.
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, true);
    created(await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(), ACTOR));

    const c = await testPool.connect();
    try {
      await c.query("BEGIN");
      await c.query(body);
      const events = await c.query<{ r: string | null }>(`SELECT to_regclass('public.work_sheet_events')::text AS r`);
      const sheets = await c.query<{ r: string | null }>(`SELECT to_regclass('public.job_sheets')::text AS r`);
      const revisions = await c.query<{ r: string | null }>(`SELECT to_regclass('public.job_sheet_revisions')::text AS r`);
      expect(events.rows[0]!.r).toBeNull();
      expect(sheets.rows[0]!.r).toBeNull();
      expect(revisions.rows[0]!.r).toBeNull();
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }

    const still = await testPool.query<{ r: string | null }>(`SELECT to_regclass('public.work_sheet_events')::text AS r`);
    expect(still.rows[0]!.r).toBe("work_sheet_events");
  });
});
