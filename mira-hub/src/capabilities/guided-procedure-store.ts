/**
 * WP-1 guided-procedure sessions in `guided_procedure_sessions` (migration 105): tenant-isolated
 * with RLS, because the records hold customer plant data — observations, readings and the named
 * person confirming isolation. Every query also binds the caller's tenant explicitly, and runs on
 * a withTenantContext client (the caller passes one in).
 *
 * Appends are compare-and-set on (session id, record count, running), so a double tap, a second
 * device or an answer meant for an older session can never land in the wrong one.
 */
import type { RunRecord, StepRecord } from "@/capabilities/diagnostic-plan/types";

export type QueryDb = {
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

/** The staging-only switch for the guided-procedure route (exact "1"). */
export function guidedProcedureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.NOTEBOOK_GUIDED_PROCEDURE ?? "").trim() === "1";
}

export type SessionStatus = "running" | "ok" | "degraded" | "failed";

export interface GuidedSession {
  id: string;
  status: SessionStatus;
  templateId: string;
  templateVersion: string;
  revision: "exact" | "not_attached";
  run: RunRecord;
  startedAt: string;
}

const COLS = `id::text AS id, status, template_id, template_version, revision, records, started_at`;

function toSession(r: Record<string, unknown>): GuidedSession {
  const templateId = String(r.template_id);
  return {
    id: String(r.id),
    status: r.status as SessionStatus,
    templateId,
    templateVersion: String(r.template_version),
    revision: r.revision as GuidedSession["revision"],
    run: { templateId, records: Array.isArray(r.records) ? (r.records as StepRecord[]) : [] },
    startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at ?? ""),
  };
}

/** The most recent session for this notebook and procedure, whatever its status. */
export async function latestSession(db: QueryDb, tenantId: string, notebookId: string, templateId: string): Promise<GuidedSession | null> {
  const res = await db.query(
    `SELECT ${COLS} FROM guided_procedure_sessions
      WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND template_id = $3
      ORDER BY started_at DESC, id DESC
      LIMIT 1`,
    [tenantId, notebookId, templateId],
  );
  return res.rows[0] ? toSession(res.rows[0]) : null;
}

export async function createSession(
  db: QueryDb,
  tenantId: string,
  s: { notebookId: string; templateId: string; templateVersion: string; sourceSha256: string; revision: "exact" | "not_attached"; startedBy: string | null },
): Promise<GuidedSession> {
  const res = await db.query(
    `INSERT INTO guided_procedure_sessions
       (tenant_id, notebook_id, template_id, template_version, source_sha256, revision, started_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
     RETURNING ${COLS}`,
    [tenantId, s.notebookId, s.templateId, s.templateVersion, s.sourceSha256, s.revision, s.startedBy],
  );
  return toSession(res.rows[0]);
}

/**
 * Append one record if — and only if — this exact session still has `expectedCount` records and is
 * running. Returns null when it did not (the caller re-reads and shows the current state).
 */
export async function appendRecord(
  db: QueryDb,
  tenantId: string,
  sessionId: string,
  expectedCount: number,
  record: StepRecord,
  status: SessionStatus,
): Promise<GuidedSession | null> {
  const res = await db.query(
    `UPDATE guided_procedure_sessions
        SET records = records || jsonb_build_array($4::jsonb),
            status = $5,
            updated_at = now(),
            finished_at = CASE WHEN $5 = 'running' THEN NULL ELSE now() END
      WHERE id = $1::uuid
        AND tenant_id = $2::uuid
        AND status = 'running'
        AND jsonb_array_length(records) = $3
      RETURNING ${COLS}`,
    [sessionId, tenantId, expectedCount, JSON.stringify(record), status],
  );
  return res.rows[0] ? toSession(res.rows[0]) : null;
}
