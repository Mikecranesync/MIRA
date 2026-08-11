/**
 * Equipment Notebook domain — persistence + validation.
 *
 * One physical machine = one notebook = one bounded source set. A notebook
 * wraps a kg_entities node (node_id) so the existing v2 ingest and doc-scoped
 * retrieval serve it unchanged; these helpers own only the product semantics.
 *
 * Pool discipline (audit §8): notebook tables + kg_entities run inside
 * withTenantContext (UUID family, RLS in-type); hub_uploads has no RLS/grant
 * and is queried on the raw pool with an explicit tenant predicate, comparing
 * hub_uploads.tenant_id (TEXT) against the session UUID as text.
 */

import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";

export type IdentityStatus = "unknown" | "candidate" | "user_confirmed" | "verified";
export type MatchState = "candidate" | "user_confirmed" | "verified" | "rejected";

export type EquipmentNotebook = {
  id: string;
  displayName: string;
  manufacturer: string | null;
  model: string | null;
  catalogNumber: string | null;
  serialNumber: string | null;
  equipmentType: string | null;
  assetTag: string | null;
  locationLabel: string | null;
  identityStatus: IdentityStatus;
  identityConfidence: number | null;
  identitySourceType: string | null;
  nodeId: string;
  sourceCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
};

export type NotebookSource = {
  docId: string;
  filename: string | null;
  status: string | null;
  enabledByDefault: boolean;
  matchState: MatchState;
  sourceRole: string | null;
  pages: number | null;
  fileId: string | null; // namespace_direct_uploads id for the byte-serving viewer
};

const NOTEBOOK_COLS = `
  n.id::text AS id, n.display_name, n.manufacturer, n.model, n.catalog_number,
  n.serial_number, n.equipment_type, n.asset_tag, n.location_label,
  n.identity_status, n.identity_confidence, n.identity_source_type,
  n.node_id::text AS node_id, n.last_opened_at, n.created_at`;

function rowToNotebook(r: Record<string, unknown>, sourceCount = 0): EquipmentNotebook {
  return {
    id: String(r.id),
    displayName: String(r.display_name),
    manufacturer: (r.manufacturer as string) ?? null,
    model: (r.model as string) ?? null,
    catalogNumber: (r.catalog_number as string) ?? null,
    serialNumber: (r.serial_number as string) ?? null,
    equipmentType: (r.equipment_type as string) ?? null,
    assetTag: (r.asset_tag as string) ?? null,
    locationLabel: (r.location_label as string) ?? null,
    identityStatus: (r.identity_status as IdentityStatus) ?? "unknown",
    identityConfidence: r.identity_confidence == null ? null : Number(r.identity_confidence),
    identitySourceType: (r.identity_source_type as string) ?? null,
    nodeId: String(r.node_id),
    sourceCount,
    lastOpenedAt: r.last_opened_at ? String(r.last_opened_at) : null,
    createdAt: String(r.created_at),
  };
}

export type CreateNotebookInput = {
  displayName: string;
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
  serialNumber?: string | null;
  equipmentType?: string | null;
  assetTag?: string | null;
  locationLabel?: string | null;
  identityStatus?: IdentityStatus;
  identityConfidence?: number | null;
  identitySourceType?: "manual" | "nameplate_image" | "user" | "existing_asset" | null;
  identityObservation?: unknown;
  createdBy?: string | null;
};

export async function createNotebook(
  tenantId: string,
  input: CreateNotebookInput,
): Promise<EquipmentNotebook> {
  const name = (input.displayName ?? "").trim();
  if (!name) throw new Error("display_name_required");
  if (name.length > 200) throw new Error("display_name_too_long");

  return withTenantContext(tenantId, async (c) => {
    // Backing node — approval_state MUST be pinned 'verified' or chat 404s
    // (audit trap #6; the migration-set default is contradictory).
    const node = await c.query(
      `INSERT INTO kg_entities (entity_type, name, uns_path, tenant_id, approval_state)
       VALUES ('equipment', $1, NULL, $2::uuid, 'verified')
       RETURNING id::text AS id`,
      [name, tenantId],
    );
    const nodeId = String(node.rows[0].id);
    const res = await c.query(
      `INSERT INTO equipment_notebooks
         (tenant_id, display_name, manufacturer, model, catalog_number, serial_number,
          equipment_type, asset_tag, location_label, identity_status, identity_confidence,
          identity_source_type, identity_observation, node_id, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::uuid, $15)
       RETURNING ${NOTEBOOK_COLS}`,
      [
        tenantId,
        name,
        input.manufacturer ?? null,
        input.model ?? null,
        input.catalogNumber ?? null,
        input.serialNumber ?? null,
        input.equipmentType ?? null,
        input.assetTag ?? null,
        input.locationLabel ?? null,
        input.identityStatus ?? "unknown",
        input.identityConfidence ?? null,
        input.identitySourceType ?? null,
        input.identityObservation ? JSON.stringify(input.identityObservation) : null,
        nodeId,
        input.createdBy ?? null,
      ],
    );
    return rowToNotebook(res.rows[0]);
  });
}

export async function listNotebooks(tenantId: string): Promise<EquipmentNotebook[]> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT ${NOTEBOOK_COLS},
              (SELECT count(*) FROM equipment_notebook_sources s
                WHERE s.notebook_id = n.id AND s.match_state <> 'rejected') AS source_count
         FROM equipment_notebooks n
        WHERE n.tenant_id = $1::uuid
        ORDER BY n.last_opened_at DESC NULLS LAST, n.created_at DESC
        LIMIT 100`,
      [tenantId],
    );
    return res.rows.map((r: Record<string, unknown>) =>
      rowToNotebook(r, Number(r.source_count ?? 0)),
    );
  });
}

export async function getNotebook(
  tenantId: string,
  notebookId: string,
): Promise<EquipmentNotebook | null> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT ${NOTEBOOK_COLS}
         FROM equipment_notebooks n
        WHERE n.tenant_id = $1::uuid AND n.id = $2::uuid`,
      [tenantId, notebookId],
    );
    if (res.rows.length === 0) return null;
    await c.query(
      `UPDATE equipment_notebooks SET last_opened_at = now(), updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId],
    );
    return rowToNotebook(res.rows[0]);
  });
}

export async function updateNotebook(
  tenantId: string,
  notebookId: string,
  patch: Partial<CreateNotebookInput>,
): Promise<boolean> {
  const fields: Record<string, unknown> = {};
  const map: Record<string, string> = {
    displayName: "display_name",
    manufacturer: "manufacturer",
    model: "model",
    catalogNumber: "catalog_number",
    serialNumber: "serial_number",
    equipmentType: "equipment_type",
    assetTag: "asset_tag",
    locationLabel: "location_label",
    identityStatus: "identity_status",
    identityConfidence: "identity_confidence",
    identitySourceType: "identity_source_type",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) fields[col] = (patch as Record<string, unknown>)[k];
  }
  if (Object.keys(fields).length === 0) return false;
  const sets = Object.keys(fields).map((col, i) => `${col} = $${i + 3}`);
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE equipment_notebooks
          SET ${sets.join(", ")}, updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId, ...Object.values(fields)],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

/** Attach an existing tenant document (hub_uploads row) as a notebook source.
 *  Validates the doc belongs to THIS tenant before attaching (IDOR guard). */
export async function attachSource(
  tenantId: string,
  notebookId: string,
  docId: string,
  opts: { matchState?: MatchState; sourceRole?: string | null; addedBy?: string | null } = {},
): Promise<{ ok: boolean; error?: string }> {
  // hub_uploads: raw pool + explicit tenant predicate (TEXT column vs UUID session).
  const doc = await pool.query(
    `SELECT id FROM hub_uploads WHERE tenant_id = $1 AND id = $2::uuid LIMIT 1`,
    [tenantId, docId],
  );
  if (doc.rows.length === 0) return { ok: false, error: "doc_not_found" };

  return withTenantContext(tenantId, async (c) => {
    const nb = await c.query(
      `SELECT id FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId],
    );
    if (nb.rows.length === 0) return { ok: false, error: "notebook_not_found" };
    const matchState = opts.matchState ?? "user_confirmed";
    await c.query(
      `INSERT INTO equipment_notebook_sources
         (notebook_id, doc_id, tenant_id, enabled_by_default, match_state, source_role, added_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)
       ON CONFLICT (notebook_id, doc_id)
       DO UPDATE SET match_state = EXCLUDED.match_state, source_role = EXCLUDED.source_role`,
      [
        notebookId,
        docId,
        tenantId,
        // PRD §7.1: only user_confirmed/verified sources are enabled by default.
        matchState === "user_confirmed" || matchState === "verified",
        matchState,
        opts.sourceRole ?? null,
        opts.addedBy ?? null,
      ],
    );
    return { ok: true };
  });
}

export async function setSourceState(
  tenantId: string,
  notebookId: string,
  docId: string,
  patch: { enabledByDefault?: boolean; matchState?: MatchState },
): Promise<boolean> {
  return withTenantContext(tenantId, async (c) => {
    const sets: string[] = [];
    const vals: unknown[] = [tenantId, notebookId, docId];
    if (patch.enabledByDefault !== undefined) {
      sets.push(`enabled_by_default = $${vals.length + 1}`);
      vals.push(patch.enabledByDefault);
    }
    if (patch.matchState !== undefined) {
      sets.push(`match_state = $${vals.length + 1}`);
      vals.push(patch.matchState);
    }
    if (sets.length === 0) return false;
    const res = await c.query(
      `UPDATE equipment_notebook_sources SET ${sets.join(", ")}
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
      vals,
    );
    return (res.rowCount ?? 0) > 0;
  });
}

export async function detachSource(
  tenantId: string,
  notebookId: string,
  docId: string,
): Promise<boolean> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `DELETE FROM equipment_notebook_sources
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
      [tenantId, notebookId, docId],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

export async function listSources(
  tenantId: string,
  notebookId: string,
): Promise<NotebookSource[]> {
  const memb = await withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT doc_id::text AS doc_id, enabled_by_default, match_state, source_role
         FROM equipment_notebook_sources
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
        ORDER BY created_at`,
      [tenantId, notebookId],
    );
    return res.rows as Record<string, unknown>[];
  });
  if (memb.length === 0) return [];
  const ids = memb.map((m) => String(m.doc_id));
  // Doc metadata: hub_uploads on the raw pool (no RLS there); parked-file id for
  // the viewer comes from namespace_direct_uploads keyed by upload_id.
  const docs = await pool.query(
    `SELECT u.id::text AS id, u.filename, u.status, u.kb_chunk_count,
            d.id::text AS file_id
       FROM hub_uploads u
       LEFT JOIN namespace_direct_uploads d ON d.upload_id = u.id
      WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  const byId = new Map<string, Record<string, unknown>>(
    docs.rows.map((r: Record<string, unknown>) => [String(r.id), r]),
  );
  return memb.map((m) => {
    const d = byId.get(String(m.doc_id));
    return {
      docId: String(m.doc_id),
      filename: d ? ((d.filename as string) ?? null) : null,
      status: d ? ((d.status as string) ?? null) : null,
      enabledByDefault: Boolean(m.enabled_by_default),
      matchState: m.match_state as MatchState,
      sourceRole: (m.source_role as string) ?? null,
      pages: null,
      fileId: d ? ((d.file_id as string) ?? null) : null,
    };
  });
}

/** Chat-boundary validation (PRD §12): every requested doc must belong to this
 *  tenant AND this notebook AND not be rejected. Returns the validated allowed
 *  set or an error — retrieval never sees an unvalidated id. */
export async function validateChatSources(
  tenantId: string,
  notebookId: string,
  requestedDocIds: string[],
): Promise<{ ok: true; docIds: string[]; nodeId: string } | { ok: false; error: string }> {
  if (!Array.isArray(requestedDocIds) || requestedDocIds.length === 0) {
    return { ok: false, error: "no_sources_selected" };
  }
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!requestedDocIds.every((d) => uuidRe.test(d))) {
    return { ok: false, error: "invalid_source_id" };
  }
  return withTenantContext(tenantId, async (c) => {
    const nb = await c.query(
      `SELECT node_id::text AS node_id FROM equipment_notebooks
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId],
    );
    if (nb.rows.length === 0) return { ok: false as const, error: "notebook_not_found" };
    const res = await c.query(
      `SELECT doc_id::text AS doc_id
         FROM equipment_notebook_sources
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND doc_id = ANY($3::uuid[])
          AND match_state <> 'rejected'`,
      [tenantId, notebookId, requestedDocIds],
    );
    const valid = new Set(res.rows.map((r: Record<string, unknown>) => String(r.doc_id)));
    const rejectedOrForeign = requestedDocIds.filter((d) => !valid.has(d));
    if (rejectedOrForeign.length > 0) {
      return { ok: false as const, error: "source_not_in_notebook" };
    }
    return { ok: true as const, docIds: requestedDocIds, nodeId: String(nb.rows[0].node_id) };
  });
}

export async function recordTurn(
  tenantId: string,
  notebookId: string,
  turn: {
    question: string;
    answerStatus: "answered" | "insufficient_evidence" | "error";
    answerText: string | null;
    enabledSourceDocIds: string[];
    evidence: unknown[];
    model: string | null;
  },
): Promise<void> {
  await withTenantContext(tenantId, async (c) => {
    await c.query(
      `INSERT INTO equipment_notebook_turns
         (notebook_id, tenant_id, question, answer_status, answer_text,
          enabled_source_doc_ids, evidence, model)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        notebookId,
        tenantId,
        turn.question,
        turn.answerStatus,
        turn.answerText,
        JSON.stringify(turn.enabledSourceDocIds),
        JSON.stringify(turn.evidence),
        turn.model,
      ],
    );
  });
}

export async function listTurns(
  tenantId: string,
  notebookId: string,
  limit = 50,
): Promise<
  {
    id: string;
    question: string;
    answerStatus: string;
    answerText: string | null;
    evidence: unknown[];
    createdAt: string;
  }[]
> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT id::text AS id, question, answer_status, answer_text, evidence, created_at
         FROM equipment_notebook_turns
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
        ORDER BY created_at ASC
        LIMIT $3`,
      [tenantId, notebookId, limit],
    );
    return res.rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      question: String(r.question),
      answerStatus: String(r.answer_status),
      answerText: (r.answer_text as string) ?? null,
      evidence: Array.isArray(r.evidence) ? (r.evidence as unknown[]) : [],
      createdAt: String(r.created_at),
    }));
  });
}
