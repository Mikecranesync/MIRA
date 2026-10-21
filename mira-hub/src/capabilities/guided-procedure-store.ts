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
import { MANUFACTURER_PROCEDURES } from "@/capabilities/diagnostic-plan/guided";

/** The compiled version of every offered manufacturer procedure, by template id. */
const CURRENT_VERSIONS: ReadonlyMap<string, string> = new Map(
  MANUFACTURER_PROCEDURES.map((p) => [p.template.id, p.template.version ?? ""]),
);

export type QueryDb = {
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

/** The staging-only switch for the guided-procedure route (exact "1"). */
export function guidedProcedureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.NOTEBOOK_GUIDED_PROCEDURE ?? "").trim() === "1";
}

export type SessionStatus = "running" | "ok" | "degraded" | "failed" | "restarted";

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

/**
 * Whether `sessionId` is this notebook's most recent guided session AND ended at a dead end the
 * manual does not cover (stored status "degraded" = view status "escalate"). The chat route only
 * lifts the #4068 "won't guess about this machine" decline for a turn that names such a session
 * (owner decision 2026-10-21); a restarted, resolved, running or superseded session — or one saved on
 * a procedure version other than the current one (`currentVersions`: template id → version) — never
 * qualifies.
 */
export async function isGuidedDeadEnd(
  db: QueryDb,
  tenantId: string,
  notebookId: string,
  sessionId: string,
  currentVersions: ReadonlyMap<string, string> = CURRENT_VERSIONS,
): Promise<boolean> {
  const res = await db.query(
    `SELECT s.template_id, s.template_version FROM guided_procedure_sessions s
      WHERE s.id = $3::uuid AND s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.status = 'degraded'
        AND NOT EXISTS (
          SELECT 1 FROM guided_procedure_sessions n
           WHERE n.tenant_id = s.tenant_id AND n.notebook_id = s.notebook_id AND n.template_id = s.template_id
             AND (n.started_at, n.id) > (s.started_at, s.id)
        )`,
    [tenantId, notebookId, sessionId],
  );
  const row = res.rows[0];
  // A session ended on an earlier compiled version is superseded (Codex #4598 F1 on #4592's
  // version bump): the current procedure may have a step it lacked, so it never qualifies.
  return !!row && currentVersions.get(String(row.template_id)) === String(row.template_version);
}

type NewSession = {
  notebookId: string;
  templateId: string;
  templateVersion: string;
  sourceSha256: string;
  revision: "exact" | "not_attached";
  startedBy: string | null;
};

async function insertRunning(db: QueryDb, tenantId: string, s: NewSession): Promise<GuidedSession | null> {
  const res = await db.query(
    `INSERT INTO guided_procedure_sessions
       (tenant_id, notebook_id, template_id, template_version, source_sha256, revision, started_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, notebook_id, template_id) WHERE status = 'running' DO NOTHING
     RETURNING ${COLS}`,
    [tenantId, s.notebookId, s.templateId, s.templateVersion, s.sourceSha256, s.revision, s.startedBy],
  );
  return res.rows[0] ? toSession(res.rows[0]) : null;
}

/**
 * Start, or join the session already running: the partial unique index (migration 106) admits one
 * running session per notebook and procedure, so two devices starting together get the SAME
 * session (Codex #4573 F8). `created` says whether this call made it.
 */
export async function startSession(db: QueryDb, tenantId: string, s: NewSession): Promise<{ session: GuidedSession; created: boolean }> {
  const made = await insertRunning(db, tenantId, s);
  if (made) return { session: made, created: true };
  const running = await latestSession(db, tenantId, s.notebookId, s.templateId);
  if (!running || running.status !== "running") throw new Error("guided session start conflicted but no running session was found");
  return { session: running, created: false };
}

/** "Start again": end the running session as 'restarted', then start a fresh one. Run in one transaction. */
export async function restartSession(db: QueryDb, tenantId: string, s: NewSession): Promise<GuidedSession> {
  await db.query(
    `UPDATE guided_procedure_sessions
        SET status = 'restarted', updated_at = now(), finished_at = now()
      WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND template_id = $3 AND status = 'running'`,
    [tenantId, s.notebookId, s.templateId],
  );
  const made = await insertRunning(db, tenantId, s);
  if (!made) throw new Error("guided session restart lost a concurrent start");
  return made;
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
