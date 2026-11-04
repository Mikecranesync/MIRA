/**
 * `listJobsActiveBetween` (S6) against real Postgres. Harness copied from
 * living-sheet.integration.test.ts: the real withTenantContext (SET LOCAL
 * ROLE factorylm_app + RLS) runs against a disposable database. Migration
 * 114 is applied here too (idempotent — applying it a second time, after
 * the sibling suite already did, must be a no-op).
 *
 * Covers: two notebooks + two technicians on one tenant inside the window,
 * the notebook display name resolved from `equipment_notebooks.display_name`,
 * window exclusion, and cross-tenant isolation (RLS) — a second tenant's
 * jobs never appear in the first tenant's report.
 *
 * Run (disposable DB only):
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/<db> MIRA_TEST_DB_CONFIRM=DISPOSABLE \
 *     npx vitest run --config vitest.integration.config.ts --no-file-parallelism src/capabilities/living-sheet
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

// R2-23: this suite applies migrations and inserts/deletes real rows against
// whatever TEST_DATABASE_URL points at. Refuse to even open a connection
// unless the human running it has explicitly confirmed the target is
// disposable — loudly, and before any test (or even `beforeAll`) runs.
const { testPool } = vi.hoisted(() => {
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error(
      "shift-report.integration.test.ts refuses to run: set MIRA_TEST_DB_CONFIRM=DISPOSABLE to confirm " +
        "TEST_DATABASE_URL points at a throwaway database. This suite applies migration 114 and writes " +
        "and deletes real rows.",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { appendEvent, listJobsActiveBetween, startJob, type StartJobResult } from "../store";
import { shiftReport } from "../shift-report";
import type { JobSheetBody } from "../types";

const MIGRATION = path.resolve(__dirname, "../../../../db/proposed/114_living_work_sheet.sql");

async function makeNotebook(tenantId: string, entityId: string | null, displayName: string): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, equipment_entity_id, asset_confirmed_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5)
     RETURNING id::text AS id`,
    [tenantId, uuid(), displayName, entityId, entityId ? new Date().toISOString() : null],
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

function startInput(occurredAt: string, title = "PM — Pump 07") {
  return { title, templateRevisionId: null, template: template({ title }), clientEventId: uuid(), occurredAt };
}

function created(r: StartJobResult): Extract<StartJobResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}

beforeAll(async () => {
  const sql = readFileSync(MIGRATION, "utf8");
  await testPool.query(sql);
  await testPool.query(sql);
});

afterAll(async () => {
  await testPool.end();
});

describe("listJobsActiveBetween — two notebooks, two technicians, one tenant", () => {
  it("returns every job with an event in the window, with the notebook's real display_name", async () => {
    const tenant = uuid();
    const nbPump = await makeNotebook(tenant, `cmms-${uuid()}`, "Pump Room");
    const nbComp = await makeNotebook(tenant, `cmms-${uuid()}`, "Compressor Room");

    const windowStart = "2026-11-03T12:00:00.000Z";
    const windowEnd = "2026-11-03T18:00:00.000Z";
    const insideA = "2026-11-03T13:00:00.000Z";
    const insideB = "2026-11-03T14:00:00.000Z";

    const jobPump = created(
      await startJob(tenant, nbPump, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(insideA, "PM — Pump 07"), {
        userId: "tech-1",
        label: "Tech One",
      }),
    );
    const jobComp = created(
      await startJob(
        tenant,
        nbComp,
        { entityId: `cmms-${uuid()}`, name: "Compressor 2" },
        startInput(insideB, "PM — Compressor 2"),
        { userId: "tech-2", label: "Tech Two" },
      ),
    );

    const active = await listJobsActiveBetween(tenant, windowStart, windowEnd);
    expect(active).toHaveLength(2);

    const byJobId = new Map(active.map((a) => [a.jobId, a]));
    const pump = byJobId.get(jobPump.jobId);
    const comp = byJobId.get(jobComp.jobId);
    expect(pump).toBeDefined();
    expect(comp).toBeDefined();
    expect(pump!.notebookId).toBe(nbPump);
    expect(pump!.notebookName).toBe("Pump Room");
    expect(pump!.view.title).toBe("PM — Pump 07");
    expect(pump!.events).toHaveLength(1);
    expect(comp!.notebookId).toBe(nbComp);
    expect(comp!.notebookName).toBe("Compressor Room");

    // Feed straight into shiftReport (S6) and sanity-check the two
    // technicians both show up, plain-English, no banned words.
    const report = shiftReport(active, { from: windowStart, to: windowEnd });
    expect(report.counts.jobsTouched).toBe(2);
    const techs = report.byTechnician.map((g) => g.technician);
    expect(techs).toContain("Tech One");
    expect(techs).toContain("Tech Two");
  });

  it("excludes a job whose only event is outside the window", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, "Pump Room");
    const outside = "2026-11-01T00:00:00.000Z";
    await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(outside), { userId: "tech-1", label: "Tech One" });

    const active = await listJobsActiveBetween(tenant, "2026-11-03T00:00:00.000Z", "2026-11-04T00:00:00.000Z");
    expect(active).toHaveLength(0);
  });

  it("a job's full event log is returned, not just the in-window slice — a later correction stays visible even when its window excludes the original reading", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant, `cmms-${uuid()}`, "Pump Room");
    const startedAt = "2026-11-03T08:00:00.000Z";
    const correctedAt = "2026-11-03T20:00:00.000Z";
    const job = created(
      await startJob(tenant, nb, { entityId: `cmms-${uuid()}`, name: "Pump 07" }, startInput(startedAt), { userId: "tech-1", label: "Tech One" }),
    );
    const readingId = uuid();
    await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId: uuid(), baseSeq: 1, kind: "reading_recorded", payload: { readingId, what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null } }, occurredAt: "2026-11-03T08:05:00.000Z", workOrderId: null },
      { userId: "tech-1", label: "Tech One" },
    );
    await appendEvent(
      tenant, nb, job.jobId,
      { clientEventId: uuid(), baseSeq: 2, kind: "reading_corrected", payload: { readingId, value: 4.8, unit: "A", reason: "misread" }, occurredAt: correctedAt, workOrderId: null },
      { userId: "tech-1", label: "Tech One" },
    );

    // Window covers only the correction, not job_started/reading_recorded.
    const active = await listJobsActiveBetween(tenant, "2026-11-03T19:00:00.000Z", "2026-11-03T21:00:00.000Z");
    expect(active).toHaveLength(1);
    expect(active[0]!.events).toHaveLength(3); // full log: started + recorded + corrected

    const report = shiftReport(active, { from: "2026-11-03T19:00:00.000Z", to: "2026-11-03T21:00:00.000Z" });
    const bucket = report.byTechnician.find((g) => g.technician === "Tech One")!;
    const correction = bucket.entries.find((e) => e.kind === "reading_corrected")!;
    // The correction's text names the real prior value (48 A) even though
    // reading_recorded itself is outside the window — proves the full log
    // (not just the in-window slice) was used to resolve it.
    expect(correction.text).toContain("48 A → 4.8 A");
  });
});

describe("listJobsActiveBetween — tenant isolation (RLS)", () => {
  it("tenant B's jobs never appear in tenant A's window query, even for the same wall-clock window", async () => {
    const tenantA = uuid();
    const tenantB = uuid();
    const windowStart = "2026-11-03T00:00:00.000Z";
    const windowEnd = "2026-11-04T00:00:00.000Z";
    const at = "2026-11-03T12:00:00.000Z";

    const nbA = await makeNotebook(tenantA, `cmms-${uuid()}`, "Tenant A Pump Room");
    const nbB = await makeNotebook(tenantB, `cmms-${uuid()}`, "Tenant B Pump Room");

    const jobA = created(
      await startJob(tenantA, nbA, { entityId: `cmms-${uuid()}`, name: "Pump A" }, startInput(at), { userId: "tech-a", label: "Tech A" }),
    );
    const jobB = created(
      await startJob(tenantB, nbB, { entityId: `cmms-${uuid()}`, name: "Pump B" }, startInput(at), { userId: "tech-b", label: "Tech B" }),
    );

    const activeA = await listJobsActiveBetween(tenantA, windowStart, windowEnd);
    const activeB = await listJobsActiveBetween(tenantB, windowStart, windowEnd);

    expect(activeA.map((a) => a.jobId)).toEqual([jobA.jobId]);
    expect(activeB.map((a) => a.jobId)).toEqual([jobB.jobId]);
    expect(activeA.map((a) => a.jobId)).not.toContain(jobB.jobId);
    expect(activeB.map((a) => a.jobId)).not.toContain(jobA.jobId);
  });
});
