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

import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import { deriveReadiness, type Readiness } from "@/lib/document-readiness";

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
  /** Canonical asset binding (081). `null` when the notebook is unbound. */
  asset: NotebookAssetBinding | null;
};

/**
 * How the asset arrived. A QR scan is a SELECTION, not a confirmation —
 * stickers get swapped during a rebuild, and two identical bench conveyors are
 * indistinguishable to a sticker. Confirmation is a separate, human act.
 *
 * There is no `gps` member: GPS cannot resolve one machine from its neighbour
 * indoors, so recording it as identity provenance would launder a guess.
 */
export const ASSET_SELECTION_METHODS = [
  "asset_picker",
  "qr",
  "nfc",
  "work_order",
  "nameplate",
  "manual_entry",
] as const;
export type AssetSelectionMethod = (typeof ASSET_SELECTION_METHODS)[number];

export type NotebookAssetBinding = {
  /** kg_entities.entity_id — the cmms_equipment UUID as text. */
  entityId: string;
  selectedVia: AssetSelectionMethod | null;
  /** Null means selected-but-unconfirmed; the UI must show that state. */
  confirmedBy: string | null;
  confirmedAt: string | null;
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
  /** Persisted applicability evidence (075 match_evidence) — matched tokens,
   *  evidence pages, decision method, discovery/final URLs, confidence. */
  matchEvidence: unknown | null;
  /** "Ready to Ask" contract (see lib/document-readiness.ts). Derived, not
   *  stored — a projection of upload status + materialized chunk facts. The
   *  composer gates on `readiness.canChat`, which never depends on embeddings. */
  readiness: Readiness;
};

// Aliased for SELECTs that join the source-count subquery (needs `n.`).
const NOTEBOOK_COLS = `
  n.id::text AS id, n.display_name, n.manufacturer, n.model, n.catalog_number,
  n.serial_number, n.equipment_type, n.asset_tag, n.location_label,
  n.identity_status, n.identity_confidence, n.identity_source_type,
  n.node_id::text AS node_id, n.last_opened_at, n.created_at,
  n.equipment_entity_id, n.asset_selected_via, n.asset_confirmed_by, n.asset_confirmed_at`;
// Un-aliased for RETURNING / single-table SELECTs — a RETURNING clause has no
// table alias, so the `n.` form errors ("missing FROM-clause entry for n").
const NOTEBOOK_COLS_BARE = NOTEBOOK_COLS.replace(/\bn\./g, "");

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
    // Without this the read path cannot see what the write path stored — the
    // binding would be invisible everywhere except the database.
    asset: r.equipment_entity_id
      ? {
          entityId: String(r.equipment_entity_id),
          selectedVia: (r.asset_selected_via as AssetSelectionMethod) ?? null,
          confirmedBy: (r.asset_confirmed_by as string) ?? null,
          confirmedAt: r.asset_confirmed_at ? String(r.asset_confirmed_at) : null,
        }
      : null,
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
       RETURNING ${NOTEBOOK_COLS_BARE}`,
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
/**
 * Bind a notebook to a canonical asset (migration 081).
 *
 * The predicate is the whole security and correctness story, so it is spelled
 * out rather than assembled:
 *
 *   entity_type = 'equipment'  — LOAD-BEARING. Every user-created namespace node
 *     is minted `verified` with a uns_path regardless of kind
 *     (api/namespace/node/route.ts:102-110), so without this a notebook could
 *     legally bind to an AREA. A later live-evidence probe scoped by `uns_path <@`
 *     would then scale to the whole area and render a sibling machine's
 *     "Motor_Speed: 1740 rpm" as this conveyor's current state on a stopped belt.
 *     That failure is silent and plausible, which is the worst combination.
 *
 *   approval_state = 'verified' — an unapproved graph row is a proposal, and a
 *     proposal must not become an asset identity by being bound to.
 *
 *   uns_path IS NOT NULL — a notebook's own backing node has no uns_path, so this
 *     also refuses the degenerate self-binding.
 *
 *   (id::text = $2 OR entity_id = $2) — accepts either the kg row id or the
 *     cmms UUID mirrored into entity_id, matching how every other resolver in
 *     the Hub accepts an asset reference.
 *
 * Distinct error codes because they mean different things to a technician:
 * `asset_not_equipment` is "you picked a line, not a machine";
 * `asset_not_found` is "that is not yours, or does not exist".
 */
export type BindAssetResult =
  | { ok: true; notebook: EquipmentNotebook }
  | { ok: false; error: "asset_not_found" | "asset_not_equipment" | "asset_not_verified" | "notebook_not_found" | "asset_already_bound"; boundNotebookId?: string };

export async function bindNotebookAsset(
  tenantId: string,
  notebookId: string,
  assetRef: string,
  opts: { selectedVia: AssetSelectionMethod; confirmedBy?: string | null },
): Promise<BindAssetResult> {
  return withTenantContext(tenantId, async (c) => {
    const asset = await c.query(
      `SELECT entity_id, entity_type, approval_state, uns_path::text AS uns_path
         FROM kg_entities
        WHERE tenant_id = $1::uuid
          AND (id::text = $2 OR entity_id = $2)
        LIMIT 1`,
      [tenantId, assetRef],
    );
    const row = asset.rows[0];
    if (!row) return { ok: false as const, error: "asset_not_found" as const };
    if (row.entity_type !== "equipment") {
      return { ok: false as const, error: "asset_not_equipment" as const };
    }
    if (row.approval_state !== "verified" || !row.uns_path) {
      return { ok: false as const, error: "asset_not_verified" as const };
    }

    // One notebook per asset (081's partial-unique index). Checked here so the
    // caller gets the existing id rather than a bare constraint violation.
    const taken = await c.query(
      `SELECT id::text AS id FROM equipment_notebooks
        WHERE tenant_id = $1::uuid AND equipment_entity_id = $2 AND id <> $3::uuid
        LIMIT 1`,
      [tenantId, row.entity_id, notebookId],
    );
    if (taken.rows[0]) {
      return {
        ok: false as const,
        error: "asset_already_bound" as const,
        boundNotebookId: String(taken.rows[0].id),
      };
    }

    // Confirmation is server-derived. A caller may say HOW the asset was
    // selected; it may never assert that a human confirmed it.
    const confirmedBy = opts.selectedVia === "qr" || opts.selectedVia === "nfc" ? null : opts.confirmedBy ?? null;

    const updated = await c.query(
      `UPDATE equipment_notebooks
          SET equipment_entity_id = $3,
              asset_selected_via  = $4,
              asset_confirmed_by  = $5,
              asset_confirmed_at  = CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,
              updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid
        RETURNING ${NOTEBOOK_COLS_BARE}`,
      [tenantId, notebookId, row.entity_id, opts.selectedVia, confirmedBy],
    );
    if (!updated.rows[0]) return { ok: false as const, error: "notebook_not_found" as const };
    return { ok: true as const, notebook: rowToNotebook(updated.rows[0]) };
  });
}

/** Clear the binding. All four columns move together — a half-cleared binding
 *  would leave a confirmation timestamp attached to no asset. */
export async function unbindNotebookAsset(
  tenantId: string,
  notebookId: string,
): Promise<{ ok: boolean }> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE equipment_notebooks
          SET equipment_entity_id = NULL,
              asset_selected_via  = NULL,
              asset_confirmed_by  = NULL,
              asset_confirmed_at  = NULL,
              updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId],
    );
    return { ok: (res.rowCount ?? 0) > 0 };
  });
}

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
    await upsertNotebookSourceTx(c, {
      tenantId,
      notebookId,
      docId,
      matchState: opts.matchState ?? "user_confirmed",
      sourceRole: opts.sourceRole ?? null,
      addedBy: opts.addedBy ?? null,
    });
    return { ok: true };
  });
}

/**
 * Source-membership upsert on an existing tenant-scoped client — the seam that
 * lets workspace-files.ts write the file link AND the source row in ONE
 * transaction. Callers own notebook/doc validation; this only writes.
 */
export async function upsertNotebookSourceTx(
  c: PoolClient,
  opts: {
    tenantId: string;
    notebookId: string;
    docId: string;
    matchState: MatchState;
    sourceRole?: string | null;
    addedBy?: string | null;
    matchEvidence?: unknown;
  },
): Promise<void> {
  const evidence =
    opts.matchEvidence === undefined || opts.matchEvidence === null
      ? null
      : JSON.stringify(opts.matchEvidence);
  // Conflict transitions never DOWNGRADE trust (a candidate re-suggestion must
  // not demote a user-confirmed row) and enabled_by_default is recomputed from
  // the RESULTING state in the same statement — the candidate->user_confirmed
  // upsert used to leave enabled_by_default=false behind, silently keeping a
  // confirmed source out of chat (Codex P1, 2026-08-16). An explicit re-attach
  // by a USER over a rejected row un-rejects it (the re-attach IS the user
  // decision) — but an incoming 'candidate' is a SYSTEM re-suggestion, never a
  // user decision: it must not resurrect a human-rejected row, and it must not
  // flip enabled_by_default on a row a human already ruled on (re-enabling a
  // source the user explicitly disabled would be the system overriding the
  // human — the same trust inversion as client-minted "verified").
  await c.query(
    `INSERT INTO equipment_notebook_sources
       (notebook_id, doc_id, tenant_id, enabled_by_default, match_state,
        source_role, added_by, match_evidence)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (notebook_id, doc_id)
     DO UPDATE SET
       match_state = CASE
         WHEN equipment_notebook_sources.match_state = 'verified' THEN 'verified'
         WHEN EXCLUDED.match_state = 'verified' THEN 'verified'
         WHEN equipment_notebook_sources.match_state IN ('user_confirmed', 'rejected')
              AND EXCLUDED.match_state = 'candidate'
           THEN equipment_notebook_sources.match_state
         ELSE EXCLUDED.match_state
       END,
       enabled_by_default = CASE
         WHEN EXCLUDED.match_state = 'verified' THEN true
         WHEN equipment_notebook_sources.match_state IN ('verified', 'user_confirmed', 'rejected')
              AND EXCLUDED.match_state = 'candidate'
           THEN equipment_notebook_sources.enabled_by_default
         ELSE EXCLUDED.match_state IN ('user_confirmed', 'verified')
       END,
       source_role    = EXCLUDED.source_role,
       match_evidence = COALESCE(EXCLUDED.match_evidence,
                                 equipment_notebook_sources.match_evidence)`,
    [
      opts.notebookId,
      opts.docId,
      opts.tenantId,
      // PRD §7.1: only user_confirmed/verified sources are enabled by default.
      opts.matchState === "user_confirmed" || opts.matchState === "verified",
      opts.matchState,
      opts.sourceRole ?? null,
      opts.addedBy ?? null,
      evidence,
    ],
  );
}

export async function setSourceState(
  tenantId: string,
  notebookId: string,
  docId: string,
  patch: { enabledByDefault?: boolean; matchState?: MatchState; matchEvidence?: unknown },
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
    if (patch.matchEvidence !== undefined) {
      sets.push(`match_evidence = $${vals.length + 1}::jsonb`);
      vals.push(patch.matchEvidence === null ? null : JSON.stringify(patch.matchEvidence));
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

export type DeleteNotebookResult = {
  deleted: boolean;
  /** Rows removed per dependent table -- surfaced so the caller can log/assert
   *  that dependants were actually cleaned rather than silently orphaned. */
  sources: number;
  turns: number;
  fileLinks: number;
};

/**
 * Permanently delete a notebook and every notebook-scoped dependent row.
 *
 * NONE of the dependent tables declare a foreign key to equipment_notebooks
 * (073 keys `equipment_notebook_sources` / `equipment_notebook_turns` by
 * notebook_id with no FK; 075 `workspace_file_links` is polymorphic on
 * `target_type`/`target_id`, which cannot carry one). So there is no ON DELETE
 * CASCADE to rely on -- deleting only the parent row would leave orphans that
 * still match `notebook_id`/`target_id` and would be silently re-adopted by a
 * future notebook issued the same UUID. Every dependant is therefore removed
 * explicitly, in dependency order, inside ONE transaction.
 *
 * What is deliberately NOT deleted:
 *   - the uploaded documents themselves (`namespace_direct_uploads` /
 *     `hub_uploads` / `knowledge_entries`). One file may be linked to many
 *     targets (075 "one file, many links"), so a notebook owns its LINKS, never
 *     the bytes. `workspace_file_links.file_id` is ON DELETE RESTRICT, which
 *     encodes exactly that.
 *   - the wrapped `kg_entities` node (`node_id`). The knowledge graph outlives
 *     the notebook that surfaced it, and kg rows are approval-governed
 *     (ADR-0017) -- deleting one here would be an unreviewed graph mutation.
 *
 * withTenantContext supplies BEGIN/COMMIT + ROLLBACK-on-throw and
 * `SET LOCAL ROLE factorylm_app`, so tenant isolation is enforced twice: by the
 * explicit `tenant_id` predicate on every statement AND by RLS. A notebook
 * belonging to another tenant is invisible, so this returns deleted:false
 * rather than removing anything.
 */
export async function deleteNotebook(
  tenantId: string,
  notebookId: string,
): Promise<DeleteNotebookResult> {
  return withTenantContext(tenantId, async (c) => {
    // Parent first as an existence + ownership probe. FOR UPDATE serializes
    // against a concurrent delete of the same row, so exactly one caller sees
    // deleted:true and the other gets a clean 404 instead of a partial pass.
    const owned = await c.query(
      `SELECT id FROM equipment_notebooks
        WHERE tenant_id = $1::uuid AND id = $2::uuid
        FOR UPDATE`,
      [tenantId, notebookId],
    );
    if (owned.rows.length === 0) {
      return { deleted: false, sources: 0, turns: 0, fileLinks: 0 };
    }

    const links = await c.query(
      `DELETE FROM workspace_file_links
        WHERE tenant_id = $1::uuid
          AND target_type = 'equipment_notebook'
          AND target_id = $2::uuid`,
      [tenantId, notebookId],
    );
    const turns = await c.query(
      `DELETE FROM equipment_notebook_turns
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid`,
      [tenantId, notebookId],
    );
    const sources = await c.query(
      `DELETE FROM equipment_notebook_sources
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid`,
      [tenantId, notebookId],
    );
    const parent = await c.query(
      `DELETE FROM equipment_notebooks
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId],
    );

    return {
      deleted: (parent.rowCount ?? 0) > 0,
      sources: sources.rowCount ?? 0,
      turns: turns.rowCount ?? 0,
      fileLinks: links.rowCount ?? 0,
    };
  });
}

export async function listSources(
  tenantId: string,
  notebookId: string,
): Promise<NotebookSource[]> {
  const memb = await withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT doc_id::text AS doc_id, enabled_by_default, match_state, source_role,
              match_evidence
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

  // Materialized-chunk facts for the readiness contract. Counted per doc:
  //   n         -> citable chunks (what makes a doc askable)
  //   emb       -> chunks carrying a vector (enhancement progress ONLY)
  //   anchored  -> chunks with a real page locator (citations must resolve)
  // Raw pool, explicitly tenant-scoped. These are the caller's OWN uploads
  // (doc ids came from hub_uploads for this tenant), so this is a pure-tenant
  // read, NOT the hybrid OEM-corpus case in
  // .claude/rules/knowledge-entries-tenant-scoping.md — no `is_private = false`
  // arm, which would count another corpus into this tenant's readiness.
  const counts = await pool.query(
    `SELECT doc_id::text AS doc_id,
            count(*)::int                                   AS n,
            count(embedding)::int                           AS emb,
            count(*) FILTER (WHERE source_page IS NOT NULL)::int AS anchored
       FROM knowledge_entries
      WHERE tenant_id = $1::uuid AND doc_id = ANY($2::uuid[])
      GROUP BY doc_id`,
    [tenantId, ids],
  );
  const chunksById = new Map<string, { n: number; emb: number; anchored: number }>(
    counts.rows.map((r: Record<string, unknown>) => [
      String(r.doc_id),
      { n: Number(r.n), emb: Number(r.emb), anchored: Number(r.anchored) },
    ]),
  );

  return memb.map((m) => {
    const d = byId.get(String(m.doc_id));
    const c = chunksById.get(String(m.doc_id)) ?? { n: 0, emb: 0, anchored: 0 };
    const status = d ? ((d.status as string) ?? null) : null;
    const readiness = deriveReadiness({
      // An upload row exists at all => the bytes were durably accepted.
      bytesDurable: Boolean(d),
      parseFailed: status === "failed" && c.n === 0,
      // Zero chunks after the parser finished = no text layer (a scan).
      // While status is still 'queued'/'parsing' this stays false so the doc
      // reports "preparing text", not a premature OCR verdict.
      noExtractableText: status === "parsed" && c.n === 0,
      chunkCount: c.n,
      hasPageAnchors: c.anchored > 0,
      scopeValidated: true, // membership was proven by the query above
      originalResolvable: Boolean(d?.file_id),
      embeddedChunkCount: c.emb,
    });
    return {
      docId: String(m.doc_id),
      filename: d ? ((d.filename as string) ?? null) : null,
      status,
      enabledByDefault: Boolean(m.enabled_by_default),
      matchState: m.match_state as MatchState,
      sourceRole: (m.source_role as string) ?? null,
      pages: null,
      fileId: d ? ((d.file_id as string) ?? null) : null,
      matchEvidence: m.match_evidence ?? null,
      readiness,
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
    // Chat grounding requires POSITIVE trust, not merely "not rejected": a
    // candidate (system-suggested, never human-confirmed) source must not be
    // citable, and a source the user disabled must not ride along (Codex P1,
    // 2026-08-16).
    const res = await c.query(
      `SELECT doc_id::text AS doc_id
         FROM equipment_notebook_sources
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND doc_id = ANY($3::uuid[])
          AND match_state IN ('user_confirmed', 'verified')
          AND enabled_by_default = true`,
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
    /** 081 snapshot: which asset this specific answer was about. Point-in-time
     *  and never backfilled — rewriting it when a notebook is rebound would
     *  destroy the only record of what an answer was actually grounded on. */
    equipmentEntityId?: string | null;
    assetUnsPath?: string | null;
  },
): Promise<void> {
  await withTenantContext(tenantId, async (c) => {
    await c.query(
      `INSERT INTO equipment_notebook_turns
         (notebook_id, tenant_id, question, answer_status, answer_text,
          enabled_source_doc_ids, evidence, model,
          equipment_entity_id, asset_uns_path)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)`,
      [
        notebookId,
        tenantId,
        turn.question,
        turn.answerStatus,
        turn.answerText,
        JSON.stringify(turn.enabledSourceDocIds),
        JSON.stringify(turn.evidence),
        turn.model,
        turn.equipmentEntityId ?? null,
        turn.assetUnsPath ?? null,
      ],
    );
  });
}

/**
 * What asset is this notebook's turn about?
 *
 * Three outcomes, and the middle one is why this exists as its own function:
 *
 *   unbound      — no asset was ever bound. Today's behaviour, unchanged.
 *   resolved     — the binding still resolves to a verified equipment node.
 *   unresolvable — a binding EXISTS but no longer resolves: the asset was
 *                  deleted, un-verified, or re-seeded under a new key.
 *
 * `unresolvable` must fail closed. The tempting alternative — fall back to
 * "unbound" and answer anyway — is precisely the downgrade
 * .claude/rules/direct-connection-uns-certified.md forbids: the notebook would
 * keep displaying the last stored asset name while answering about nothing in
 * particular. A stale identity that still looks confident is worse than a
 * refusal.
 */
export type ResolvedAsset =
  | { state: "unbound" }
  | {
      state: "resolved";
      entityId: string;
      name: string;
      unsPath: string;
      selectedVia: AssetSelectionMethod | null;
      confirmedAt: string | null;
    }
  | { state: "unresolvable"; entityId: string };

export async function resolveBoundAsset(
  tenantId: string,
  notebookId: string,
): Promise<ResolvedAsset> {
  return withTenantContext(tenantId, async (c) => {
    const nb = await c.query(
      `SELECT equipment_entity_id, asset_selected_via, asset_confirmed_at
         FROM equipment_notebooks
        WHERE tenant_id = $1::uuid AND id = $2::uuid
        LIMIT 1`,
      [tenantId, notebookId],
    );
    const row = nb.rows[0];
    if (!row?.equipment_entity_id) return { state: "unbound" as const };

    // Same predicate as bindNotebookAsset — an asset that could not be bound
    // today must not keep working because it was bound yesterday.
    const asset = await c.query(
      `SELECT entity_id, name, uns_path::text AS uns_path
         FROM kg_entities
        WHERE tenant_id = $1::uuid
          AND entity_type = 'equipment'
          AND entity_id = $2
          AND approval_state = 'verified'
          AND uns_path IS NOT NULL
        LIMIT 1`,
      [tenantId, String(row.equipment_entity_id)],
    );
    const a = asset.rows[0];
    if (!a) return { state: "unresolvable" as const, entityId: String(row.equipment_entity_id) };

    return {
      state: "resolved" as const,
      entityId: String(a.entity_id),
      name: String(a.name ?? ""),
      unsPath: String(a.uns_path),
      selectedVia: (row.asset_selected_via as AssetSelectionMethod) ?? null,
      confirmedAt: row.asset_confirmed_at ? String(row.asset_confirmed_at) : null,
    };
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
    // Take the MOST RECENT `limit` turns (inner DESC), then present them
    // chronologically (outer ASC). A plain `ORDER BY created_at ASC LIMIT n`
    // returns the OLDEST n — so past n turns the recent conversation vanishes
    // from the notebook on reload. Recent-window + chronological display fixes
    // that while keeping the render order the UI expects.
    const res = await c.query(
      `SELECT id, question, answer_status, answer_text, evidence, created_at
         FROM (
           SELECT id::text AS id, question, answer_status, answer_text, evidence, created_at
             FROM equipment_notebook_turns
            WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
            ORDER BY created_at DESC
            LIMIT $3
         ) recent
        ORDER BY created_at ASC`,
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
