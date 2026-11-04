/**
 * Job sheet templates — the write/read store for `job_sheets` +
 * `job_sheet_revisions` (TASK-S4). Append-only-with-revisions, NOT
 * event-sourced like store.ts's `work_sheet_events`: a "review" is a new
 * revision row that copies an existing revision's body with
 * status='reviewed' — the source row is never edited (db/proposed/114 grants
 * SELECT, INSERT only; there is no UPDATE grant).
 *
 * Idempotency follows the same shape as store.ts (`appendEvent`), adapted to
 * a schema with no `request_fingerprint` column: `job_sheet_revisions` has
 * only `UNIQUE (tenant_id, client_request_id)`, so a replay is detected by
 * looking up that row and comparing its *content* to what was asked for
 * now, instead of comparing a precomputed hash column. The comparison must
 * not compare `JSON.stringify` output directly — Postgres JSONB does not
 * preserve input key order (it rewrites to Postgres's own ordering on
 * storage), so two calls with identical content but different incoming key
 * order would otherwise look like a conflict. `stableStringify` sorts keys
 * recursively on both sides before hashing/comparing, which makes the
 * comparison independent of key order on either side of the round trip.
 *
 * Concurrency: one `pg_advisory_xact_lock(hashtextextended($1,0))` per
 * write, same primitive as store.ts's `appendEvent`. The lock key is the
 * SHARED RESOURCE under contention, not the request id: `createJobSheet`
 * contends only on its own `client_request_id` (a brand-new `job_sheets` row
 * can never collide with another request's row), but `reviseJobSheet` and
 * `reviewJobSheet` both allocate the next `revision` number for one
 * `job_sheet_id` — two different technicians revising/reviewing the SAME
 * sheet with two different `client_request_id`s must still serialize against
 * each other, so those two lock on `${tenantId}:${jobSheetId}`.
 */
import { randomUUID } from "node:crypto";
import { withTenantContext } from "@/lib/tenant-context";
import type { Actor } from "./store";
import type { JobSheetBody } from "./types";
import { validateJobSheetBody } from "./validate";

export type JobSheetRevisionStatus = "draft" | "reviewed";

export type JobSheetRevision = {
  id: string;
  jobSheetId: string;
  revision: number;
  status: JobSheetRevisionStatus;
  body: JobSheetBody;
  createdBy: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

type RevisionRow = {
  id: string;
  job_sheet_id: string;
  revision: number | string;
  status: JobSheetRevisionStatus;
  body: JobSheetBody;
  created_by: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

const REVISION_COLS = `id::text AS id, job_sheet_id::text AS job_sheet_id, revision, status, body,
  created_by, created_at, reviewed_by, reviewed_at`;

function toRevision(r: RevisionRow): JobSheetRevision {
  return {
    id: r.id,
    jobSheetId: r.job_sheet_id,
    revision: Number(r.revision),
    status: r.status,
    body: r.body,
    createdBy: r.created_by ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
  };
}

/** Recursively sorts object keys before serializing, so two logically-equal
 *  values with different key order (notably: content as originally
 *  constructed in JS, vs. the same content read back from Postgres JSONB,
 *  which does not preserve input key order) hash/compare equal. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function bodyEquals(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

// ---------------------------------------------------------------------------
// createJobSheet
// ---------------------------------------------------------------------------

export type CreateJobSheetInput = { clientRequestId: string; body: unknown };

export type CreateJobSheetResult =
  | { status: "created"; jobSheetId: string; revision: JobSheetRevision }
  | { status: "existing"; jobSheetId: string; revision: JobSheetRevision }
  | { status: "request_id_conflict" }
  | { status: "invalid_body"; error: string; field?: string };

export async function createJobSheet(
  tenantId: string,
  input: CreateJobSheetInput,
  actor: Actor,
): Promise<CreateJobSheetResult> {
  const validated = validateJobSheetBody(input.body);
  if (!validated.ok) return { status: "invalid_body", error: validated.error, field: validated.field };
  const body = validated.value;

  return withTenantContext(tenantId, async (c) => {
    // Only one shared resource is at risk here — a replay of this exact
    // client_request_id — so the lock is keyed on the request id, not a
    // job_sheet_id (none exists yet).
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${tenantId}:${input.clientRequestId}`]);

    const prior = await c.query<RevisionRow>(
      `SELECT ${REVISION_COLS} FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND client_request_id = $2::uuid`,
      [tenantId, input.clientRequestId],
    );
    if (prior.rows.length > 0) {
      const priorRow = prior.rows[0]!;
      if (!bodyEquals(priorRow.body, body)) return { status: "request_id_conflict" };
      return { status: "existing", jobSheetId: priorRow.job_sheet_id, revision: toRevision(priorRow) };
    }

    const jobSheetId = randomUUID();
    await c.query(`INSERT INTO job_sheets (id, tenant_id, created_by) VALUES ($1::uuid, $2::uuid, $3)`, [
      jobSheetId,
      tenantId,
      actor.label ?? actor.userId ?? null,
    ]);

    const inserted = await c.query<RevisionRow>(
      `INSERT INTO job_sheet_revisions (tenant_id, job_sheet_id, revision, status, body, created_by, client_request_id)
       VALUES ($1::uuid, $2::uuid, 1, 'draft', $3::jsonb, $4, $5::uuid)
       RETURNING ${REVISION_COLS}`,
      [tenantId, jobSheetId, JSON.stringify(body), actor.label ?? actor.userId ?? null, input.clientRequestId],
    );
    return { status: "created", jobSheetId, revision: toRevision(inserted.rows[0]!) };
  });
}

// ---------------------------------------------------------------------------
// reviseJobSheet
// ---------------------------------------------------------------------------

export type ReviseJobSheetInput = { clientRequestId: string; body: unknown };

export type ReviseJobSheetResult =
  | { status: "created"; revision: JobSheetRevision }
  | { status: "existing"; revision: JobSheetRevision }
  | { status: "request_id_conflict" }
  | { status: "invalid_body"; error: string; field?: string }
  | { status: "job_sheet_not_found" };

export async function reviseJobSheet(
  tenantId: string,
  jobSheetId: string,
  input: ReviseJobSheetInput,
  actor: Actor,
): Promise<ReviseJobSheetResult> {
  const validated = validateJobSheetBody(input.body);
  if (!validated.ok) return { status: "invalid_body", error: validated.error, field: validated.field };
  const body = validated.value;

  return withTenantContext(tenantId, async (c) => {
    // Resource under contention is the job sheet's revision sequence —
    // every revise/review of this jobSheetId shares this lock key.
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${tenantId}:${jobSheetId}`]);

    const sheetExists = await c.query(`SELECT 1 FROM job_sheets WHERE tenant_id = $1::uuid AND id = $2::uuid`, [
      tenantId,
      jobSheetId,
    ]);
    if (sheetExists.rows.length === 0) return { status: "job_sheet_not_found" };

    const prior = await c.query<RevisionRow>(
      `SELECT ${REVISION_COLS} FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND client_request_id = $2::uuid`,
      [tenantId, input.clientRequestId],
    );
    if (prior.rows.length > 0) {
      const priorRow = prior.rows[0]!;
      if (priorRow.job_sheet_id !== jobSheetId || !bodyEquals(priorRow.body, body)) {
        return { status: "request_id_conflict" };
      }
      return { status: "existing", revision: toRevision(priorRow) };
    }

    const maxRevRes = await c.query<{ max_rev: string | null }>(
      `SELECT max(revision) AS max_rev FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND job_sheet_id = $2::uuid`,
      [tenantId, jobSheetId],
    );
    const nextRevision = Number(maxRevRes.rows[0]?.max_rev ?? 0) + 1;

    const inserted = await c.query<RevisionRow>(
      `INSERT INTO job_sheet_revisions (tenant_id, job_sheet_id, revision, status, body, created_by, client_request_id)
       VALUES ($1::uuid, $2::uuid, $3, 'draft', $4::jsonb, $5, $6::uuid)
       RETURNING ${REVISION_COLS}`,
      [tenantId, jobSheetId, nextRevision, JSON.stringify(body), actor.label ?? actor.userId ?? null, input.clientRequestId],
    );
    return { status: "created", revision: toRevision(inserted.rows[0]!) };
  });
}

// ---------------------------------------------------------------------------
// reviewJobSheet
// ---------------------------------------------------------------------------

export type ReviewJobSheetInput = { clientRequestId: string; revision: number };

export type ReviewJobSheetResult =
  | { status: "created"; revision: JobSheetRevision }
  | { status: "existing"; revision: JobSheetRevision }
  | { status: "request_id_conflict" }
  | { status: "job_sheet_not_found" }
  | { status: "revision_not_found" };

export async function reviewJobSheet(
  tenantId: string,
  jobSheetId: string,
  input: ReviewJobSheetInput,
  actor: Actor,
): Promise<ReviewJobSheetResult> {
  return withTenantContext(tenantId, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${tenantId}:${jobSheetId}`]);

    const sheetExists = await c.query(`SELECT 1 FROM job_sheets WHERE tenant_id = $1::uuid AND id = $2::uuid`, [
      tenantId,
      jobSheetId,
    ]);
    if (sheetExists.rows.length === 0) return { status: "job_sheet_not_found" };

    const source = await c.query<RevisionRow>(
      `SELECT ${REVISION_COLS} FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND job_sheet_id = $2::uuid AND revision = $3`,
      [tenantId, jobSheetId, input.revision],
    );
    if (source.rows.length === 0) return { status: "revision_not_found" };
    const sourceBody = source.rows[0]!.body;

    const prior = await c.query<RevisionRow>(
      `SELECT ${REVISION_COLS} FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND client_request_id = $2::uuid`,
      [tenantId, input.clientRequestId],
    );
    if (prior.rows.length > 0) {
      const priorRow = prior.rows[0]!;
      const matches =
        priorRow.job_sheet_id === jobSheetId && priorRow.status === "reviewed" && bodyEquals(priorRow.body, sourceBody);
      if (!matches) return { status: "request_id_conflict" };
      return { status: "existing", revision: toRevision(priorRow) };
    }

    const maxRevRes = await c.query<{ max_rev: string | null }>(
      `SELECT max(revision) AS max_rev FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND job_sheet_id = $2::uuid`,
      [tenantId, jobSheetId],
    );
    const nextRevision = Number(maxRevRes.rows[0]?.max_rev ?? 0) + 1;
    // CHECK job_sheet_revisions_reviewed_chk requires reviewed_by NOT NULL
    // whenever status='reviewed' — fall back through label -> userId ->
    // a literal "unknown" so the insert can never violate that constraint.
    const reviewedBy = actor.label ?? actor.userId ?? "unknown";

    const inserted = await c.query<RevisionRow>(
      `INSERT INTO job_sheet_revisions
         (tenant_id, job_sheet_id, revision, status, body, created_by, reviewed_by, reviewed_at, client_request_id)
       VALUES ($1::uuid, $2::uuid, $3, 'reviewed', $4::jsonb, $5, $6, now(), $7::uuid)
       RETURNING ${REVISION_COLS}`,
      [
        tenantId,
        jobSheetId,
        nextRevision,
        JSON.stringify(sourceBody),
        actor.label ?? actor.userId ?? null,
        reviewedBy,
        input.clientRequestId,
      ],
    );
    return { status: "created", revision: toRevision(inserted.rows[0]!) };
  });
}

// ---------------------------------------------------------------------------
// listJobSheets / getJobSheetRevision
// ---------------------------------------------------------------------------

export type JobSheetSummary = {
  jobSheetId: string;
  latest: JobSheetRevision;
  latestReviewed: JobSheetRevision | null;
};

export async function listJobSheets(tenantId: string): Promise<JobSheetSummary[]> {
  return withTenantContext(tenantId, async (c) => {
    const latestRes = await c.query<RevisionRow>(
      `SELECT DISTINCT ON (job_sheet_id) ${REVISION_COLS}
         FROM job_sheet_revisions
        WHERE tenant_id = $1::uuid
        ORDER BY job_sheet_id, revision DESC`,
      [tenantId],
    );
    const latestReviewedRes = await c.query<RevisionRow>(
      `SELECT DISTINCT ON (job_sheet_id) ${REVISION_COLS}
         FROM job_sheet_revisions
        WHERE tenant_id = $1::uuid AND status = 'reviewed'
        ORDER BY job_sheet_id, revision DESC`,
      [tenantId],
    );
    const reviewedByJobSheet = new Map(latestReviewedRes.rows.map((r) => [r.job_sheet_id, r]));

    return latestRes.rows
      .map((r) => {
        const reviewedRow = reviewedByJobSheet.get(r.job_sheet_id);
        return {
          jobSheetId: r.job_sheet_id,
          latest: toRevision(r),
          latestReviewed: reviewedRow ? toRevision(reviewedRow) : null,
        };
      })
      .sort((a, b) => (a.latest.createdAt < b.latest.createdAt ? 1 : -1));
  });
}

export type GetJobSheetRevisionResult = { status: "ok"; revision: JobSheetRevision } | { status: "not_found" };

export async function getJobSheetRevision(tenantId: string, revisionId: string): Promise<GetJobSheetRevisionResult> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query<RevisionRow>(
      `SELECT ${REVISION_COLS} FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, revisionId],
    );
    if (res.rows.length === 0) return { status: "not_found" };
    return { status: "ok", revision: toRevision(res.rows[0]!) };
  });
}
