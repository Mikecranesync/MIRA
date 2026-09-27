/**
 * Fix records — "plant memory" (a technician records what fixed a machine;
 * the next technician on the same machine sees it as a grounding source).
 *
 * Schema: db/migrations/095_asset_fix_records.sql. Read that file's header
 * before changing this module — it explains why the table is append-only
 * (no UPDATE grant) and why a recorded fix is evidence, never auto-promoted
 * KG doctrine (materialized-evidence rule 9).
 *
 * Pool discipline: asset_fix_records is UUID-family RLS, same posture as
 * equipment_notebooks (.claude/rules/mira-hub-migrations.md §1) — every read
 * and write here runs inside withTenantContext.
 */

import { createHash } from "node:crypto";
import { withTenantContext } from "@/lib/tenant-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYMPTOM_MAX = 500;
const FIX_MAX = 2000;
const FAULT_CODE_MAX = 64;

export type FixRecord = {
  id: string;
  notebookId: string;
  equipmentEntityId: string | null;
  symptom: string;
  faultCode: string | null;
  fix: string;
  recordedBy: string | null;
  createdAt: string;
};

export type ValidatedFixInput = {
  symptom: string;
  fix: string;
  faultCode: string | null;
  sourceTurnId: string | null;
  /** Stable per-fix id from the client, REQUIRED: a retry with the same id
   *  returns the record already stored instead of a duplicate (migration 097),
   *  and an unkeyed save would have no way to be deduplicated. */
  clientRequestId: string;
};

export type ValidateFixInputResult =
  | { ok: true; value: ValidatedFixInput }
  | { ok: false; error: string };

/**
 * Validate a POST body for recording a fix. Trims strings, enforces the same
 * length limits as the DB CHECK constraints (095), and requires a non-empty
 * symptom and fix. `sourceTurnId`, when present, must be a UUID.
 */
export function validateFixInput(body: unknown): ValidateFixInputResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.symptom !== "string") {
    return { ok: false, error: "symptom_required" };
  }
  const symptom = b.symptom.trim();
  if (!symptom) return { ok: false, error: "symptom_required" };
  if (symptom.length > SYMPTOM_MAX) return { ok: false, error: "symptom_too_long" };

  if (typeof b.fix !== "string") {
    return { ok: false, error: "fix_required" };
  }
  const fix = b.fix.trim();
  if (!fix) return { ok: false, error: "fix_required" };
  if (fix.length > FIX_MAX) return { ok: false, error: "fix_too_long" };

  let faultCode: string | null = null;
  if (b.faultCode !== undefined && b.faultCode !== null) {
    if (typeof b.faultCode !== "string") return { ok: false, error: "invalid_fault_code" };
    const trimmed = b.faultCode.trim();
    if (trimmed) {
      if (trimmed.length > FAULT_CODE_MAX) return { ok: false, error: "fault_code_too_long" };
      faultCode = trimmed;
    }
  }

  let sourceTurnId: string | null = null;
  if (b.sourceTurnId !== undefined && b.sourceTurnId !== null) {
    if (typeof b.sourceTurnId !== "string" || !UUID_RE.test(b.sourceTurnId)) {
      return { ok: false, error: "invalid_source_turn_id" };
    }
    sourceTurnId = b.sourceTurnId;
  }

  // Required (Codex #4057 post-hardening F3): the fix table is append-only,
  // so a save that cannot be deduplicated on retry is refused.
  if (b.clientRequestId === undefined || b.clientRequestId === null) {
    return { ok: false, error: "client_request_id_required" };
  }
  if (typeof b.clientRequestId !== "string" || !UUID_RE.test(b.clientRequestId)) {
    return { ok: false, error: "invalid_client_request_id" };
  }
  const clientRequestId = b.clientRequestId.toLowerCase();

  return { ok: true, value: { symptom, fix, faultCode, sourceTurnId, clientRequestId } };
}

function mapRow(r: Record<string, unknown>): FixRecord {
  return {
    id: String(r.id),
    notebookId: String(r.notebook_id),
    equipmentEntityId: (r.equipment_entity_id as string) ?? null,
    symptom: String(r.symptom),
    faultCode: (r.fault_code as string) ?? null,
    fix: String(r.fix),
    recordedBy: (r.recorded_by as string) ?? null,
    createdAt: String(r.created_at),
  };
}

export type InsertFixResult =
  | { status: "created"; fix: FixRecord }
  | { status: "existing"; fix: FixRecord }
  | { status: "request_id_conflict" }
  | { status: "binding_changed" };

/** What a keyed save was: the validated content and the machine it was filed
 *  against. A retry replays only an identical fingerprint (migration 098). */
export function requestFingerprint(input: ValidatedFixInput, equipmentEntityId: string | null): string {
  return createHash("sha256")
    .update(
      JSON.stringify([input.symptom, input.faultCode, input.fix, input.sourceTurnId, equipmentEntityId]),
    )
    .digest("hex");
}

const RETURN_COLS = `id::text AS id, notebook_id::text AS notebook_id, equipment_entity_id,
                 symptom, fault_code, fix, recorded_by, created_at`;
// The list JOINs equipment_notebooks, which also has `id` and
// `equipment_entity_id` — every column is qualified to the fix row.
const LIST_COLS = `f.id::text AS id, f.notebook_id::text AS notebook_id, f.equipment_entity_id,
                 f.symptom, f.fault_code, f.fix, f.recorded_by, f.created_at`;

/** True for a string the route can safely hand to a `::uuid` cast. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Insert a technician-confirmed fix record — atomically against the notebook's
 * CURRENT binding (Codex #4057 post-split F1). One statement reads the
 * notebook row `FOR SHARE` and inserts only if it is still bound to the
 * machine the route checked (`expectedEntityId`) and, when bound, still
 * confirmed. A concurrent re-bind either waits for this insert or wins first,
 * in which case nothing is inserted (`binding_changed`) — a 201 can never
 * point at a machine the notebook no longer lists.
 *
 * With a `clientRequestId`, a retry returns the stored record (`existing`)
 * instead of a second, un-deletable row (F2, migration 097).
 */
export async function insertFixRecord(
  tenantId: string,
  notebookId: string,
  expectedEntityId: string | null,
  input: ValidatedFixInput,
  recordedBy: string | null,
): Promise<InsertFixResult> {
  const fingerprint = requestFingerprint(input, expectedEntityId);
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `INSERT INTO asset_fix_records
         (tenant_id, notebook_id, equipment_entity_id, symptom, fault_code, fix,
          recorded_by, source_turn_id, client_request_id, request_fingerprint)
       SELECT $1::uuid, n.id, n.equipment_entity_id, $4, $5, $6, $7, $8::uuid, $9::uuid, $10
         FROM equipment_notebooks n
        WHERE n.id = $2::uuid
          AND n.tenant_id = $1::uuid
          AND n.equipment_entity_id IS NOT DISTINCT FROM $3
          AND (n.equipment_entity_id IS NULL OR n.asset_confirmed_at IS NOT NULL)
          FOR SHARE
       ON CONFLICT (tenant_id, notebook_id, client_request_id)
          WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING ${RETURN_COLS}`,
      [
        tenantId,
        notebookId,
        expectedEntityId,
        input.symptom,
        input.faultCode,
        input.fix,
        recordedBy,
        input.sourceTurnId,
        input.clientRequestId,
        fingerprint,
      ],
    );
    if (res.rows.length > 0) return { status: "created", fix: mapRow(res.rows[0] as Record<string, unknown>) };
    const prior = await c.query(
      `SELECT ${RETURN_COLS}, request_fingerprint FROM asset_fix_records
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND client_request_id = $3::uuid`,
      [tenantId, notebookId, input.clientRequestId],
    );
    if (prior.rows.length > 0) {
      const row = prior.rows[0] as Record<string, unknown>;
      // Replay only the SAME save; a reused id with different content or a
      // different machine is a conflict, never someone else's success (F2).
      return row.request_fingerprint === fingerprint
        ? { status: "existing", fix: mapRow(row) }
        : { status: "request_id_conflict" };
    }
    return { status: "binding_changed" };
  });
}

/**
 * Newest-first fix records for a notebook, scoped to the machine the notebook
 * is bound to NOW. A notebook can be unbound and rebound (equipment-notebooks
 * `bindNotebookAsset`); a fix recorded against machine A must never be listed
 * as a fix for machine B. Records made while unbound (null) are only listed
 * while the notebook is still unbound — `IS NOT DISTINCT FROM` makes null
 * match null and nothing else.
 *
 * Chat grounding and the past-fixes card ship separately (branch
 * feat/plant-memory-chat-card), together with their UI rendering.
 */
export const FIX_PAGE_DEFAULT = 10;
export const FIX_PAGE_MAX = 50;

/**
 * One page, newest first, ordered by (created_at, id) so the order is total and
 * stable. The machine scope is read from the notebook's CURRENT binding in the
 * SAME query — a re-bind between the route's check and this read can never
 * return the previous machine's repairs, and an unconfirmed selection returns
 * nothing (Codex #4057 post-hardening F1). `before` is the id of the last record of the previous page; the next
 * page starts strictly after it (Codex #4057 post-split F3). A `before` id that
 * is not a record of this notebook yields an empty page, never another
 * notebook's rows. `nextCursor` is set only when another page exists.
 */
export async function listFixRecords(
  tenantId: string,
  notebookId: string,
  opts: { limit?: number; before?: string | null } = {},
): Promise<{ fixes: FixRecord[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? FIX_PAGE_DEFAULT), 1), FIX_PAGE_MAX);
  const before = opts.before ?? null;
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT ${LIST_COLS}
         FROM asset_fix_records f
         JOIN equipment_notebooks n ON n.id = f.notebook_id AND n.tenant_id = f.tenant_id
        WHERE f.tenant_id = $1::uuid AND f.notebook_id = $2::uuid
          AND f.equipment_entity_id IS NOT DISTINCT FROM n.equipment_entity_id
          AND (n.equipment_entity_id IS NULL OR n.asset_confirmed_at IS NOT NULL)
          AND ($4::uuid IS NULL OR (f.created_at, f.id) < (
                SELECT p.created_at, p.id FROM asset_fix_records p
                 WHERE p.id = $4::uuid AND p.tenant_id = $1::uuid AND p.notebook_id = $2::uuid))
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT $3`,
      [tenantId, notebookId, limit + 1, before],
    );
    const rows = (res.rows as Record<string, unknown>[]).map(mapRow);
    const page = rows.slice(0, limit);
    return { fixes: page, nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
  });
}
