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

  return { ok: true, value: { symptom, fix, faultCode, sourceTurnId } };
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

/**
 * Insert a technician-confirmed fix record. Caller (the route) has already
 * validated the input and confirmed the notebook belongs to this tenant —
 * this function trusts `notebook.id` and does not re-check ownership.
 */
export async function insertFixRecord(
  tenantId: string,
  notebook: { id: string; equipmentEntityId: string | null },
  input: ValidatedFixInput,
  recordedBy: string | null,
): Promise<FixRecord> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `INSERT INTO asset_fix_records
         (tenant_id, notebook_id, equipment_entity_id, symptom, fault_code, fix, recorded_by, source_turn_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid)
       RETURNING id::text AS id, notebook_id::text AS notebook_id, equipment_entity_id,
                 symptom, fault_code, fix, recorded_by, created_at`,
      [
        tenantId,
        notebook.id,
        notebook.equipmentEntityId,
        input.symptom,
        input.faultCode,
        input.fix,
        recordedBy,
        input.sourceTurnId,
      ],
    );
    return mapRow(res.rows[0] as Record<string, unknown>);
  });
}

/** Newest-first fix records for a notebook. */
export async function listFixRecords(
  tenantId: string,
  notebookId: string,
  limit = 3,
): Promise<FixRecord[]> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT id::text AS id, notebook_id::text AS notebook_id, equipment_entity_id,
              symptom, fault_code, fix, recorded_by, created_at
         FROM asset_fix_records
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
        ORDER BY created_at DESC
        LIMIT $3`,
      [tenantId, notebookId, limit],
    );
    return (res.rows as Record<string, unknown>[]).map(mapRow);
  });
}

function collapseNewlines(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ");
}

function dayOf(createdAt: string): string {
  const d = new Date(createdAt);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  // Fallback for an unexpected createdAt shape — best-effort, never throws.
  return String(createdAt).slice(0, 10);
}

/**
 * Render recorded fixes as a grounding block for the chat prompt. Pure —
 * returns "" for an empty list. Cite as "Recorded fix" (never as a manual
 * citation — this is technician confirmation, not a document).
 */
export function formatRecordedFixes(records: FixRecord[]): string {
  if (records.length === 0) return "";
  const lines = records.map((r) => {
    const symptom = collapseNewlines(r.symptom);
    const fix = collapseNewlines(r.fix);
    const faultSuffix = r.faultCode ? `; fault ${collapseNewlines(r.faultCode)}` : "";
    return `- ${dayOf(r.createdAt)} — symptom: ${symptom}${faultSuffix} → fix: ${fix}`;
  });
  return `RECORDED FIXES ON THIS MACHINE (technician-confirmed; cite as "Recorded fix"):\n${lines.join("\n")}`;
}
