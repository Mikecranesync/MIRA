/**
 * WP-1 guided-procedure sessions, persisted in the shared durable run record (`workflow_runs`,
 * migration 044) — no new table. One row per session:
 *   workflow_name = 'guided_procedure'
 *   input         = { notebookId, templateId, version, sourceSha256, revision }
 *   step_artifacts = the append-only StepRecord list the runner replays
 *   status        = running | ok (resolved) | degraded (escalated) | failed (unsafe / blocked)
 *
 * `workflow_runs.tenant_id` is TEXT and the table has no RLS, so EVERY query here binds the caller's
 * tenant explicitly. Appends are compare-and-set on the record count, so a double tap or a second
 * device can never interleave two answers into one session.
 */
import type { RunRecord, StepRecord } from "@/capabilities/diagnostic-plan/types";

export type QueryDb = {
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

export const GUIDED_WORKFLOW = "guided_procedure";

/** The staging-only switch for the guided-procedure route (exact "1"). */
export function guidedProcedureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.NOTEBOOK_GUIDED_PROCEDURE ?? "").trim() === "1";
}

export type SessionStatus = "running" | "ok" | "degraded" | "failed";

export interface GuidedSession {
  runId: string;
  status: SessionStatus;
  input: { notebookId: string; templateId: string; version: string; sourceSha256: string; revision: string };
  run: RunRecord;
  startedAt: string;
}

function toSession(r: Record<string, unknown>): GuidedSession {
  const input = (r.input ?? {}) as GuidedSession["input"];
  const records = Array.isArray(r.step_artifacts) ? (r.step_artifacts as StepRecord[]) : [];
  return {
    runId: String(r.run_id),
    status: r.status as SessionStatus,
    input,
    run: { templateId: input.templateId, records },
    startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at ?? ""),
  };
}

/** The most recent session for this notebook and procedure, whatever its status. */
export async function latestSession(db: QueryDb, tenantId: string, notebookId: string, templateId: string): Promise<GuidedSession | null> {
  const res = await db.query(
    `SELECT run_id::text AS run_id, status, input, step_artifacts, started_at
       FROM workflow_runs
      WHERE tenant_id = $1::text
        AND workflow_name = '${GUIDED_WORKFLOW}'
        AND input->>'notebookId' = $2
        AND input->>'templateId' = $3
      ORDER BY started_at DESC
      LIMIT 1`,
    [tenantId, notebookId, templateId],
  );
  return res.rows[0] ? toSession(res.rows[0]) : null;
}

export async function createSession(
  db: QueryDb,
  tenantId: string,
  input: GuidedSession["input"],
): Promise<GuidedSession> {
  const res = await db.query(
    `INSERT INTO workflow_runs (workflow_name, workflow_version, tenant_id, status, input, step_artifacts)
     VALUES ('${GUIDED_WORKFLOW}', $1, $2::text, 'running', $3::jsonb, '[]'::jsonb)
     RETURNING run_id::text AS run_id, status, input, step_artifacts, started_at`,
    [input.version || "1.0.0", tenantId, JSON.stringify(input)],
  );
  return toSession(res.rows[0]);
}

/**
 * Append one record if — and only if — the session still has `expectedCount` records and is
 * running. Returns null when it lost the race (the caller re-reads and shows the current step).
 */
export async function appendRecord(
  db: QueryDb,
  tenantId: string,
  runId: string,
  expectedCount: number,
  record: StepRecord,
  status: SessionStatus,
): Promise<GuidedSession | null> {
  const res = await db.query(
    `UPDATE workflow_runs
        SET step_artifacts = step_artifacts || jsonb_build_array($4::jsonb),
            status = $5,
            finished_at = CASE WHEN $5 = 'running' THEN NULL ELSE now() END
      WHERE run_id = $1::uuid
        AND tenant_id = $2::text
        AND workflow_name = '${GUIDED_WORKFLOW}'
        AND status = 'running'
        AND jsonb_array_length(step_artifacts) = $3
      RETURNING run_id::text AS run_id, status, input, step_artifacts, started_at`,
    [runId, tenantId, expectedCount, JSON.stringify(record), status],
  );
  return res.rows[0] ? toSession(res.rows[0]) : null;
}
