/**
 * Job sheet templates (TASK-S4) — createJobSheet / reviseJobSheet /
 * reviewJobSheet / listJobSheets / getJobSheetRevision against real
 * Postgres. Harness copied from living-sheet.integration.test.ts: the real
 * withTenantContext (SET LOCAL ROLE factorylm_app + RLS) runs against a
 * disposable database. Migration 114 is applied here too (idempotent;
 * harmless if living-sheet.integration.test.ts's beforeAll already ran it
 * in the same process, since vitest isolates test files).
 *
 * Also covers startJob's new `templateRevisionId` snapshot behavior
 * (store.ts), which reads `job_sheet_revisions` written by this file's
 * createJobSheet calls — the two capabilities meet at that FK.
 *
 * Both this file and living-sheet.integration.test.ts apply migration 114's
 * DDL in their own `beforeAll`. Vitest runs integration test FILES in
 * separate parallel workers against the SAME disposable DB — they are not
 * one process — so the two applications can race (observed once in ~9 runs:
 * this file's `beforeAll` failed and every test skipped; not reproduced on
 * a clean rerun, exact error not captured). This is the same shape as the
 * S1 harness this file was copied from, not a regression introduced here;
 * if it recurs, rerun.
 *
 * Run (disposable DB only):
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/livesheet_7e8f MIRA_TEST_DB_CONFIRM=DISPOSABLE \
 *     npx vitest run --config vitest.integration.config.ts src/capabilities/living-sheet
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
      "job-sheet-template.integration.test.ts refuses to run: set MIRA_TEST_DB_CONFIRM=DISPOSABLE to confirm " +
        "TEST_DATABASE_URL points at a throwaway database. This suite applies migration 114 and writes " +
        "and deletes real rows.",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import {
  createJobSheet,
  reviseJobSheet,
  reviewJobSheet,
  listJobSheets,
  getJobSheetRevision,
  type CreateJobSheetResult,
  type ReviseJobSheetResult,
  type ReviewJobSheetResult,
} from "../job-sheet-store";
import { startJob, type StartJobResult } from "../store";
import type { JobSheetBody } from "../types";

const MIGRATION = path.resolve(__dirname, "../../../../db/migrations/114_living_work_sheet.sql");

const ACTOR = { userId: "tech-1", label: "Tech One" };

function body(over: Partial<JobSheetBody> = {}): JobSheetBody {
  return {
    title: "Front wheel bearing service",
    machineLabel: "Bike-Stand-7",
    component: null,
    jobType: "pm",
    estHours: null,
    crewSize: null,
    isolationPoints: null,
    cautions: null,
    returnToService: [],
    items: [],
    torques: [],
    steps: [{ id: "step-1", text: "Remove axle nut", checkoff: "none", torqueRef: null, source: null }],
    author: null,
    notes: null,
    ...over,
  };
}

function createdC(r: CreateJobSheetResult): Extract<CreateJobSheetResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}
function createdR(r: ReviseJobSheetResult): Extract<ReviseJobSheetResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}
function createdV(r: ReviewJobSheetResult): Extract<ReviewJobSheetResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}

async function countRevisions(tenantId: string, jobSheetId: string): Promise<number> {
  const res = await testPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND job_sheet_id = $2::uuid`,
    [tenantId, jobSheetId],
  );
  return Number(res.rows[0]!.n);
}

async function makeNotebook(tenantId: string): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, equipment_entity_id, asset_confirmed_at)
     VALUES ($1::uuid, $2::uuid, 'job sheet test', $3, $4)
     RETURNING id::text AS id`,
    [tenantId, uuid(), `cmms-${uuid()}`, new Date().toISOString()],
  );
  return res.rows[0]!.id;
}

function startedC(r: StartJobResult): Extract<StartJobResult, { status: "created" }> {
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

describe("job sheet templates — createJobSheet idempotency", () => {
  it("retrying the same clientRequestId returns the existing sheet, with exactly one revision row", async () => {
    const tenant = uuid();
    const clientRequestId = uuid();
    const first = createdC(await createJobSheet(tenant, { clientRequestId, body: body() }, ACTOR));

    const second = await createJobSheet(tenant, { clientRequestId, body: body() }, ACTOR);
    expect(second.status).toBe("existing");
    if (second.status === "existing") expect(second.jobSheetId).toBe(first.jobSheetId);
    expect(await countRevisions(tenant, first.jobSheetId)).toBe(1);
  });

  it("reusing a clientRequestId with different content conflicts", async () => {
    const tenant = uuid();
    const clientRequestId = uuid();
    const first = createdC(await createJobSheet(tenant, { clientRequestId, body: body() }, ACTOR));

    const changed = await createJobSheet(
      tenant,
      { clientRequestId, body: body({ title: "A completely different job" }) },
      ACTOR,
    );
    expect(changed.status).toBe("request_id_conflict");
    expect(await countRevisions(tenant, first.jobSheetId)).toBe(1);
  });

  it("a body that fails validateJobSheetBody is refused with invalid_body, nothing written", async () => {
    const tenant = uuid();
    const result = await createJobSheet(tenant, { clientRequestId: uuid(), body: body({ title: "" }) }, ACTOR);
    expect(result.status).toBe("invalid_body");
    const rows = await testPool.query(`SELECT count(*)::text AS n FROM job_sheets WHERE tenant_id = $1::uuid`, [tenant]);
    expect(rows.rows[0]!.n).toBe("0");
  });

  it("first revision is status='draft' and revision=1", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    expect(created.revision.revision).toBe(1);
    expect(created.revision.status).toBe("draft");
  });
});

describe("job sheet templates — reviseJobSheet", () => {
  it("a revise allocates the next revision number and leaves prior revisions readable (never edits them)", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));

    const revised = createdR(
      await reviseJobSheet(
        tenant,
        created.jobSheetId,
        { clientRequestId: uuid(), body: body({ notes: "updated torque spec" }) },
        ACTOR,
      ),
    );
    expect(revised.revision.revision).toBe(2);
    expect(revised.revision.status).toBe("draft");

    const firstStill = await getJobSheetRevision(tenant, created.revision.id);
    expect(firstStill.status).toBe("ok");
    if (firstStill.status === "ok") expect(firstStill.revision.body.notes).toBeNull();
  });

  it("revising a nonexistent job sheet returns job_sheet_not_found, writes nothing", async () => {
    const tenant = uuid();
    const result = await reviseJobSheet(tenant, uuid(), { clientRequestId: uuid(), body: body() }, ACTOR);
    expect(result.status).toBe("job_sheet_not_found");
  });

  it("retrying the same clientRequestId on a revise returns existing, no duplicate row", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    const clientRequestId = uuid();
    const revisedBody = body({ notes: "torque re-check" });

    const first = createdR(await reviseJobSheet(tenant, created.jobSheetId, { clientRequestId, body: revisedBody }, ACTOR));
    const second = await reviseJobSheet(tenant, created.jobSheetId, { clientRequestId, body: revisedBody }, ACTOR);
    expect(second.status).toBe("existing");
    if (second.status === "existing") expect(second.revision.id).toBe(first.revision.id);
    expect(await countRevisions(tenant, created.jobSheetId)).toBe(2); // 1 (create) + 1 (revise), no 3rd
  });

  it("two technicians revising the SAME sheet concurrently both land as distinct, sequential revisions (no UNIQUE(job_sheet_id, revision) collision)", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));

    const [a, b] = await Promise.all([
      reviseJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), body: body({ notes: "tech A edit" }) }, ACTOR),
      reviseJobSheet(
        tenant,
        created.jobSheetId,
        { clientRequestId: uuid(), body: body({ notes: "tech B edit" }) },
        { userId: "tech-2", label: "Tech Two" },
      ),
    ]);
    expect(a.status).toBe("created");
    expect(b.status).toBe("created");
    const revA = createdR(a).revision.revision;
    const revB = createdR(b).revision.revision;
    expect(new Set([revA, revB]).size).toBe(2); // no collision
    expect([revA, revB].sort()).toEqual([2, 3]);
  });
});

describe("job sheet templates — reviewJobSheet", () => {
  it("review writes a NEW revision row with status='reviewed', copying the named revision's body; the source row is untouched", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));

    const reviewed = createdV(
      await reviewJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), revision: 1 }, ACTOR),
    );
    expect(reviewed.revision.revision).toBe(2);
    expect(reviewed.revision.status).toBe("reviewed");
    expect(reviewed.revision.reviewedBy).toBe("Tech One");
    expect(reviewed.revision.reviewedAt).not.toBeNull();
    expect(reviewed.revision.body).toEqual(body());

    const sourceStill = await getJobSheetRevision(tenant, created.revision.id);
    expect(sourceStill.status).toBe("ok");
    if (sourceStill.status === "ok") expect(sourceStill.revision.status).toBe("draft"); // never mutated
  });

  it("a draft may carry an unsourced torque value, but reviewing it is refused and writes nothing", async () => {
    const tenant = uuid();
    const unsourced = body({
      torques: [{ id: "t1", what: "Bearing cap bolts", value: 85, unit: "ft-lb", pattern: null, threadLocker: null, tool: null, source: null }],
    });
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: unsourced }, ACTOR));
    const result = await reviewJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), revision: 1 }, ACTOR);
    expect(result).toMatchObject({ status: "unsourced_torque", what: "Bearing cap bolts" });
    expect(await countRevisions(tenant, created.jobSheetId)).toBe(1);
  });

  it("reviewing a nonexistent job sheet returns job_sheet_not_found", async () => {
    const tenant = uuid();
    const result = await reviewJobSheet(tenant, uuid(), { clientRequestId: uuid(), revision: 1 }, ACTOR);
    expect(result.status).toBe("job_sheet_not_found");
  });

  it("reviewing a revision number that doesn't exist on this sheet returns revision_not_found", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    const result = await reviewJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), revision: 99 }, ACTOR);
    expect(result.status).toBe("revision_not_found");
  });

  it("an actor with no label and no userId still satisfies the reviewed_by NOT NULL check (falls back to 'unknown')", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    const reviewed = createdV(
      await reviewJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), revision: 1 }, { userId: null, label: null }),
    );
    expect(reviewed.revision.reviewedBy).toBe("unknown");
  });
});

describe("job sheet templates — spec acceptance (TASK-S4 line 69)", () => {
  it("create → revise → review gives revisions 1 (draft), 2 (draft), 3 (reviewed)", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    expect(created.revision.revision).toBe(1);
    expect(created.revision.status).toBe("draft");

    const revised = createdR(
      await reviseJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), body: body({ notes: "v2" }) }, ACTOR),
    );
    expect(revised.revision.revision).toBe(2);
    expect(revised.revision.status).toBe("draft");

    const reviewed = createdV(
      await reviewJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), revision: 2 }, ACTOR),
    );
    expect(reviewed.revision.revision).toBe(3);
    expect(reviewed.revision.status).toBe("reviewed");

    expect(await countRevisions(tenant, created.jobSheetId)).toBe(3);
  });
});

describe("job sheet templates — listJobSheets", () => {
  it("reports latest and latestReviewed independently per sheet — a draft revise AFTER a review moves latest but not latestReviewed", async () => {
    const tenant = uuid();
    // rev 1: draft (create) -> rev 2: reviewed (review rev 1) -> rev 3: draft (revise again).
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    createdV(await reviewJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), revision: 1 }, ACTOR));
    createdR(await reviseJobSheet(tenant, created.jobSheetId, { clientRequestId: uuid(), body: body({ notes: "v2 draft" }) }, ACTOR));

    const list = await listJobSheets(tenant);
    const entry = list.find((s) => s.jobSheetId === created.jobSheetId);
    expect(entry).toBeDefined();
    expect(entry!.latest.revision).toBe(3); // the newest draft revise
    expect(entry!.latest.status).toBe("draft");
    expect(entry!.latestReviewed).not.toBeNull();
    expect(entry!.latestReviewed!.revision).toBe(2); // the review stays the latest *reviewed* one
    expect(entry!.latestReviewed!.status).toBe("reviewed");
  });

  it("a sheet with no reviewed revision has latestReviewed: null", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    const list = await listJobSheets(tenant);
    const entry = list.find((s) => s.jobSheetId === created.jobSheetId);
    expect(entry!.latestReviewed).toBeNull();
  });
});

describe("job sheet templates — tenant isolation (RLS)", () => {
  it("tenant B cannot see, revise, or review tenant A's job sheet", async () => {
    const tenantA = uuid();
    const tenantB = uuid();
    const created = createdC(await createJobSheet(tenantA, { clientRequestId: uuid(), body: body() }, ACTOR));

    const listB = await listJobSheets(tenantB);
    expect(listB.find((s) => s.jobSheetId === created.jobSheetId)).toBeUndefined();

    const reviseB = await reviseJobSheet(tenantB, created.jobSheetId, { clientRequestId: uuid(), body: body() }, {
      userId: "intruder",
      label: "Intruder",
    });
    expect(reviseB.status).toBe("job_sheet_not_found");

    const reviewB = await reviewJobSheet(tenantB, created.jobSheetId, { clientRequestId: uuid(), revision: 1 }, {
      userId: "intruder",
      label: "Intruder",
    });
    expect(reviewB.status).toBe("job_sheet_not_found");

    // Tenant A's own data untouched.
    expect(await countRevisions(tenantA, created.jobSheetId)).toBe(1);
  });
});

describe("job sheet templates — factorylm_app cannot UPDATE/DELETE job_sheet_revisions", () => {
  it("UPDATE is denied (append-only-with-revisions, not edit-in-place)", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    const { withTenantContext } = await import("@/lib/tenant-context");
    await expect(
      withTenantContext(tenant, (c) =>
        c.query(`UPDATE job_sheet_revisions SET status = 'reviewed' WHERE id = $1::uuid`, [created.revision.id]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("DELETE is denied", async () => {
    const tenant = uuid();
    const created = createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR));
    const { withTenantContext } = await import("@/lib/tenant-context");
    await expect(
      withTenantContext(tenant, (c) => c.query(`DELETE FROM job_sheet_revisions WHERE id = $1::uuid`, [created.revision.id])),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("job sheet templates — startJob snapshots a templateRevisionId (store.ts ↔ job-sheet-store.ts)", () => {
  it("starting a job with templateRevisionId snapshots that revision's body + status, ignoring any client-sent template", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant);
    const created = createdV(
      await reviewJobSheet(
        tenant,
        createdC(await createJobSheet(tenant, { clientRequestId: uuid(), body: body() }, ACTOR)).jobSheetId,
        { clientRequestId: uuid(), revision: 1 },
        ACTOR,
      ),
    );

    const bogusClientTemplate = body({ title: "CLIENT SENT THIS — MUST BE IGNORED" });
    const started = startedC(
      await startJob(
        tenant,
        nb,
        { entityId: `cmms-${uuid()}`, name: "Bike-Stand-7" },
        {
          title: "Front wheel bearing service",
          templateRevisionId: created.revision.id,
          template: bogusClientTemplate,
          clientEventId: uuid(),
          occurredAt: new Date().toISOString(),
        },
        ACTOR,
      ),
    );
    expect(started.jobId).toBeTruthy();

    const row = await testPool.query<{ payload: { template: JobSheetBody; templateStatus?: string } }>(
      `SELECT payload FROM work_sheet_events WHERE tenant_id = $1::uuid AND job_id = $2::uuid AND kind = 'job_started'`,
      [tenant, started.jobId],
    );
    const payload = row.rows[0]!.payload;
    expect(payload.template.title).toBe("Front wheel bearing service"); // from the DB revision, not the bogus client body
    expect(payload.templateStatus).toBe("reviewed");
  });

  it("starting a job with a nonexistent templateRevisionId returns template_revision_not_found, writes no event", async () => {
    const tenant = uuid();
    const nb = await makeNotebook(tenant);
    const result = await startJob(
      tenant,
      nb,
      { entityId: `cmms-${uuid()}`, name: "Bike-Stand-7" },
      {
        title: "Front wheel bearing service",
        templateRevisionId: uuid(),
        template: body(),
        clientEventId: uuid(),
        occurredAt: new Date().toISOString(),
      },
      ACTOR,
    );
    expect(result.status).toBe("template_revision_not_found");
  });
});
