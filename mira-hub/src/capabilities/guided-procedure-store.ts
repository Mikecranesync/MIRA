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
import {
  checkApplicability,
  MANUFACTURER_PROCEDURES,
  type EquipmentIdentity,
  type NotebookManual,
} from "@/capabilities/diagnostic-plan/guided";
import { withTenantContext } from "@/lib/tenant-context";
import { listSources } from "@/lib/equipment-notebooks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** What a dead end was reached on: the procedure and the exact manual match it ran against. */
export interface DeadEndSession {
  templateId: string;
  revision: string;
  sourceSha256: string | null;
}

/**
 * `sessionId` if it is this notebook's most recent guided session AND ended at a dead end the
 * manual does not cover (stored status "degraded" = view status "escalate"), saved on the procedure
 * version offered today (`currentVersions`: template id → version). A restarted, resolved, running
 * or superseded session — or one saved on an earlier compiled version (Codex #4598 F1 on #4592's
 * version bump) — returns null.
 */
export async function guidedDeadEndSession(
  db: QueryDb,
  tenantId: string,
  notebookId: string,
  sessionId: string,
  currentVersions: ReadonlyMap<string, string> = CURRENT_VERSIONS,
): Promise<DeadEndSession | null> {
  const res = await db.query(
    `SELECT s.template_id, s.template_version, s.revision, s.source_sha256 FROM guided_procedure_sessions s
      WHERE s.id = $3::uuid AND s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.status = 'degraded'
        AND NOT EXISTS (
          SELECT 1 FROM guided_procedure_sessions n
           WHERE n.tenant_id = s.tenant_id AND n.notebook_id = s.notebook_id AND n.template_id = s.template_id
             AND (n.started_at, n.id) > (s.started_at, s.id)
        )`,
    [tenantId, notebookId, sessionId],
  );
  const row = res.rows[0];
  if (!row || currentVersions.get(String(row.template_id)) !== String(row.template_version)) return null;
  return {
    templateId: String(row.template_id),
    revision: String(row.revision ?? ""),
    sourceSha256: row.source_sha256 == null ? null : String(row.source_sha256),
  };
}

/** The machine a notebook describes today: its confirmed identity and the sha256 of each manual. */
export interface GuidedMachine {
  confirmed: boolean;
  identity: EquipmentIdentity;
  manuals: NotebookManual[];
}

/**
 * Read-only lookup of the notebook's identity and attached manuals — the ONE place the procedure
 * endpoint and the dead-end hand-off both read the machine from (#4602). Null when the notebook is
 * not this tenant's. (getNotebook is not used: it would bump last_opened_at.)
 */
export async function loadGuidedMachine(tenantId: string, notebookId: string): Promise<GuidedMachine | null> {
  const nb = await withTenantContext(tenantId, async (c) => {
    const r = await c.query(
      `SELECT manufacturer, model, catalog_number, identity_status
         FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId],
    );
    return r.rows[0] as Record<string, unknown> | undefined;
  });
  if (!nb) return null;
  const sources = await listSources(tenantId, notebookId);
  const fileIds = sources.map((s) => s.fileId).filter((v): v is string => !!v && UUID_RE.test(v));
  const shaById = new Map<string, string>();
  if (fileIds.length) {
    const rows = await withTenantContext(tenantId, async (c) =>
      (
        await c.query(
          `SELECT id::text AS id, content_sha256 FROM namespace_direct_uploads
            WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
          [tenantId, fileIds],
        )
      ).rows,
    );
    for (const r of rows) if (r.content_sha256) shaById.set(String(r.id), String(r.content_sha256));
  }
  const manuals: NotebookManual[] = sources.map((s) => ({ filename: s.filename, sha256: s.fileId ? shaById.get(s.fileId) ?? null : null }));
  return {
    confirmed: nb.identity_status === "user_confirmed",
    identity: {
      manufacturer: (nb.manufacturer as string | null) ?? null,
      model: (nb.model as string | null) ?? null,
      catalogNumber: (nb.catalog_number as string | null) ?? null,
    },
    manuals,
  };
}

export type DeadEndDecision =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no_dead_end"
        | "notebook_not_found"
        | "identity_not_confirmed"
        | "procedure_unknown"
        | "no_longer_applies"
        | "revision_changed"
        | "manual_changed";
    };

/**
 * Does a dead end still describe this machine (#4602)? The same identity and manual-applicability
 * check the procedure endpoint offers procedures by, plus: the revision match must be the one the
 * session ran on, and an exact session's manual (by sha256) must still be attached. Anything that
 * cannot be established fails closed.
 */
export function deadEndStillApplies(session: DeadEndSession, machine: GuidedMachine | null): DeadEndDecision {
  if (!machine) return { ok: false, reason: "notebook_not_found" };
  if (!machine.confirmed) return { ok: false, reason: "identity_not_confirmed" };
  const proc = MANUFACTURER_PROCEDURES.find((p) => p.template.id === session.templateId);
  if (!proc) return { ok: false, reason: "procedure_unknown" };
  const now = checkApplicability(proc, machine.identity, machine.manuals);
  if (!now.applies) return { ok: false, reason: "no_longer_applies" };
  if (now.revision !== session.revision) return { ok: false, reason: "revision_changed" };
  if (session.revision === "exact" && !(session.sourceSha256 && machine.manuals.some((m) => m.sha256 === session.sourceSha256))) {
    return { ok: false, reason: "manual_changed" };
  }
  return { ok: true };
}

/**
 * The chat route's single gate for the WP-1 dead-end exception to #4068: the named session is this
 * notebook's latest dead end on the current procedure version (guidedDeadEndSession) AND it still
 * applies to the machine as it is now (deadEndStillApplies). Errors propagate; the caller fails closed.
 */
export async function authorizeGuidedDeadEnd(tenantId: string, notebookId: string, sessionId: string): Promise<DeadEndDecision> {
  const session = await withTenantContext(tenantId, (c) => guidedDeadEndSession(c as unknown as QueryDb, tenantId, notebookId, sessionId));
  if (!session) return { ok: false, reason: "no_dead_end" };
  return deadEndStillApplies(session, await loadGuidedMachine(tenantId, notebookId));
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
