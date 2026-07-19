import { withTenantContext } from "@/lib/tenant-context";
import { applyHubProposalTransition, type QueryClient } from "@/lib/proposal-transition";
import { normalizeTagPath } from "@/lib/normalize-tag-path";

/**
 * Decide an `ai_suggestions` proposal (the non-edge accept path the offline PLC chain needs).
 *
 * The existing `/api/proposals/[id]/decide` route is `relationship_proposals`-only (kg_edge). This
 * handles the other suggestion types written by ingestion — notably the PLC parser's `kg_entity`
 * (proposed equipment UNS node) and `tag_mapping` proposals.
 *
 * On `verify`:
 *   1. Transition `ai_suggestions.status` → 'accepted' via the ADR-0017 helper (status changes go
 *      through the helper, never a raw UPDATE).
 *   2. For a `kg_entity` proposal, create a **verified** `kg_entities` row from the proposal payload
 *      (entity_type, name, uns_path). Because the merged i3X server selects `approval_state='verified'`,
 *      the accepted asset is immediately served over `/api/i3x/v1/objects` — closing the loop.
 *
 *   3. For a `tag_mapping` proposal, create a **verified** `tag_entities` row (mig 025) from the
 *      proposal payload (tag, uns_path, declared data_type), so an approved tag becomes a typed,
 *      queryable signal the relay / engine / MCP read — not just a flipped status. A tag whose
 *      export carried no declarable type (the CCW name-only case) is transitioned but NOT
 *      materialized: the typed table must not hold an invented type. Enrich types via the CCW
 *      variables CSV (parser correlate path), then re-import.
 *
 *      T5 (master plan) bridge: when a tag_mapping DOES materialize, also upsert `approved_tags`
 *      (mig 035) so the tag is immediately ingestible by the relay allowlist — no follow-up SQL.
 *      See `docs/discovery/integration-seams-register.md` Seam 6 ("PLC-import proposals never
 *      became ingest-approved"). `source_system` provenance: the PLC-import `ai_suggestions`
 *      payload (`plc-proposals.ts::plcReportToSuggestions`) carries no explicit source-system field
 *      (verified by reading the extractedData shape) — it is always an offline L5X/CSV parse, and
 *      'ignition' is the only live producer the relay allowlist gates today
 *      (`mira-relay/tag_ingest.py`'s VALID set is {ignition, plc_bridge, relay, simulator}), so we
 *      default to 'ignition' and record the bridge's provenance in `notes` rather than inventing a
 *      new source_system value.
 *
 *   4. For a `drive_pack_update` proposal (mig 062), ENQUEUE a build+grade instead of just
 *      flipping status. The extractor+grader is a Python CLI
 *      (`tools/drive-pack-extract/registry/update_candidate.py`); the Hub must NOT shell out to it
 *      synchronously inside the HTTP request. So accept writes a durable "build requested" marker
 *      onto the suggestion's own `extracted_data` (no new table — the row IS the queue), and a
 *      separate Python drain worker (`drain_build_requests.py`) invokes the CLI, which produces a
 *      staged `candidates/<family>/` + grading report. It NEVER promotes into the live
 *      `mira-bots/shared/drive_packs/packs/` tree — auto-promotion is forbidden (trust doctrine,
 *      ADR-0025, `.claude/rules/train-before-deploy.md`). #2544.
 *
 * On `reject`: transition status → 'rejected'. No entity is created; `approved_tags` is untouched;
 * no build is enqueued.
 *
 * The other non-edge suggestion types (`component_profile`, `uns_confirmation`, `namespace_move`)
 * remain status-only here.
 */

export type Decision = "verify" | "reject";

interface SuggestionRow {
  id: string;
  suggestion_type: string;
  extracted_data: Record<string, unknown> | null;
  status: string;
}

export type DecideResult =
  | { kind: "not_found" }
  | { kind: "wrong_state"; status: string }
  | { kind: "ok"; decision: Decision; status: string; entityId: string | null };

/**
 * Convert a UNS *topic* path (slash-separated, as the parser emits) to an ltree label path
 * (dot-separated, as `kg_entities.uns_path` requires). Parser slugs are `[a-z0-9_]`, which are valid
 * ltree labels, so only the separator changes.
 */
export function unsPathToLtree(path: string): string {
  return path
    .trim()
    .replace(/\/+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

async function createKgEntity(
  c: QueryClient,
  tenantId: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const unsPath = typeof data.uns_path === "string" ? unsPathToLtree(data.uns_path) : "";
  const name = typeof data.name === "string" ? data.name : "";
  const entityType = typeof data.entity_type === "string" && data.entity_type ? data.entity_type : "equipment";
  // Defensive: a kg_entity proposal with no name/path has nothing to materialize — transition only.
  if (!unsPath || !name) return null;

  // Mirrors the canonical create in /api/namespace/node, plus approval_state='verified' so the
  // accepted node is exposed by the i3X server (which filters approval_state='verified').
  const res = await c.query(
    `INSERT INTO kg_entities (entity_type, name, uns_path, tenant_id, approval_state)
     VALUES ($1, $2, $3::ltree, $4::uuid, 'verified')
     RETURNING id`,
    [entityType, name, unsPath, tenantId],
  );
  const rows = res.rows as { id: string }[];
  return rows[0]?.id ?? null;
}

// Parser/IEC/Rockwell declared types → the `tag_entities.data_type` CHECK enum (mig 025). The
// parser reports the type the export *declares*; we never infer it from a name (plc-tag-mapper rule).
// Bit-string types (WORD/DWORD/…) map to the unsigned int of matching width — the conventional
// read mapping the relay/app layer expects. Anything unmapped or empty → null = "no declarable
// type", which makes the caller skip materialization rather than invent one.
const TAG_DATA_TYPE_MAP: Record<string, string> = {
  BOOL: "BOOL",
  BIT: "BOOL",
  SINT: "INT16",
  INT: "INT16",
  DINT: "INT32",
  LINT: "INT64",
  USINT: "UINT16",
  UINT: "UINT16",
  WORD: "UINT16",
  BYTE: "UINT16",
  UDINT: "UINT32",
  DWORD: "UINT32",
  ULINT: "UINT64",
  LWORD: "UINT64",
  REAL: "REAL",
  FLOAT: "REAL",
  LREAL: "LREAL",
  STRING: "STRING",
};

export function mapTagDataType(raw: unknown): string | null {
  const key = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return TAG_DATA_TYPE_MAP[key] ?? null;
}

// T5 bridge decision (see module docstring): PLC-import tag_mapping proposals carry no
// source_system field. 'ignition' is the only live producer of the relay's approved_tags
// allowlist today; a future connector-specific source_system can be threaded through
// `extracted_data` once one exists.
const APPROVED_TAGS_SOURCE_SYSTEM = "ignition";

/**
 * T5 bridge: upsert `approved_tags` (mig 035) for a tag_mapping proposal that materialized a
 * `tag_entities` row, so the tag is ingestible by the relay allowlist with zero manual SQL.
 * `source_tag_path` is the raw, pre-UNS symbol the PLC export used to name the tag (the same value
 * `tag_entities.symbolic_name`/`source_address` stores) — the natural allowlist key, since
 * `approved_tags` gates on the RAW path, not the resolved UNS path. Idempotent via
 * ON CONFLICT (tenant_id, source_system, source_tag_path): re-accepting (or a re-import that
 * re-approves the same raw tag) re-enables the row rather than erroring or duplicating.
 */
async function upsertApprovedTag(
  c: QueryClient,
  tenantId: string,
  sourceTagPath: string,
  unsPath: string,
): Promise<void> {
  const normalizedTagPath = normalizeTagPath(sourceTagPath);
  await c.query(
    `INSERT INTO approved_tags
       (tenant_id, source_system, source_tag_path, normalized_tag_path, uns_path, enabled, notes)
     VALUES ($1::uuid, $2, $3, $4, $5::ltree, true, $6)
     ON CONFLICT (tenant_id, source_system, source_tag_path) DO UPDATE
       SET enabled = true,
           normalized_tag_path = EXCLUDED.normalized_tag_path,
           uns_path = COALESCE(EXCLUDED.uns_path, approved_tags.uns_path),
           notes = COALESCE(approved_tags.notes, EXCLUDED.notes),
           updated_at = now()`,
    [tenantId, APPROVED_TAGS_SOURCE_SYSTEM, sourceTagPath, normalizedTagPath, unsPath, "plc_import_bridge"],
  );
}

async function createTagEntity(
  c: QueryClient,
  tenantId: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const unsPath = typeof data.uns_path === "string" ? unsPathToLtree(data.uns_path) : "";
  const symbolic = typeof data.tag === "string" ? data.tag : "";
  const dataType = mapTagDataType(data.data_type);
  // The typed table needs a real path, symbol, AND a declarable type. A name-only tag (no declared
  // type) is left status-only — do not invent a type to satisfy NOT NULL.
  if (!unsPath || !symbolic || !dataType) return null;

  // An offline program parse has no live address; the program addresses the signal by its symbol,
  // so source_address = the symbolic name (source_kind='plc_address'). A real address/topic arrives
  // later when Ignition/relay binds the tag (the VQT-attach story) — UNIQUE(tenant_id, uns_path)
  // lets that re-import upsert this row rather than duplicate it.
  const evidence = {
    signal: data.signal ?? "",
    asset: data.asset ?? "",
    confidence_band: data.confidence_band ?? "",
    evidence: data.evidence ?? "",
    controller: data.controller ?? "",
    vendor: data.vendor ?? "",
    source: "plc_parser",
  };
  const res = await c.query(
    `INSERT INTO tag_entities
       (tenant_id, uns_path, symbolic_name, data_type, source_kind, source_address,
        approval_state, proposed_by, evidence_summary)
     VALUES ($1::uuid, $2::ltree, $3, $4, 'plc_address', $5, 'verified', 'import:plc_parser', $6::jsonb)
     ON CONFLICT (tenant_id, uns_path) DO UPDATE
       SET approval_state = 'verified',
           symbolic_name = EXCLUDED.symbolic_name,
           data_type = EXCLUDED.data_type,
           source_address = EXCLUDED.source_address,
           evidence_summary = EXCLUDED.evidence_summary,
           updated_at = now()
     RETURNING id`,
    [tenantId, unsPath, symbolic, dataType, symbolic, JSON.stringify(evidence)],
  );
  const rows = res.rows as { id: string }[];
  const entityId = rows[0]?.id ?? null;

  // T5 bridge: the tag_entities row materialized — feed the ingest allowlist too.
  if (entityId) {
    await upsertApprovedTag(c, tenantId, symbolic, unsPath);
  }

  return entityId;
}

/**
 * Enqueue a drive-pack build+grade for an accepted `drive_pack_update` suggestion by writing a
 * durable "build requested" marker onto the suggestion's own `extracted_data`. The row IS the
 * queue — no new table. A Python drain worker
 * (`tools/drive-pack-extract/registry/drain_build_requests.py`) reads rows where
 * `status='accepted'` AND `build_requested=true` AND `build_status='requested'`, runs
 * `update_candidate.py` (generator + grader as subprocesses), and flips `build_status` off
 * `requested` when done — so a marker is drained at most once. The worker only stages a
 * `candidates/<family>/` + grading report; it never promotes to the live `packs/` tree.
 *
 * This is a data annotation, not a status transition, so it does NOT go through the ADR-0017
 * helper (which governs the `status` column). Idempotent by `|| jsonb_build_object(...)`; a second
 * decide is already blocked by the `status='pending'` guard in {@link decideSuggestion}.
 */
async function markDrivePackBuildRequested(
  c: QueryClient,
  tenantId: string,
  id: string,
): Promise<void> {
  await c.query(
    `UPDATE ai_suggestions
        SET extracted_data = COALESCE(extracted_data, '{}'::jsonb)
            || jsonb_build_object(
                 'build_requested', true,
                 'build_requested_at', now(),
                 'build_status', 'requested')
      WHERE id = $1 AND tenant_id = $2::uuid`,
    [id, tenantId],
  );
}

export async function decideSuggestion(
  tenantId: string,
  userId: string | undefined,
  id: string,
  decision: Decision,
  reason: string,
): Promise<DecideResult> {
  return withTenantContext(tenantId, async (c) => {
    const sel = await c.query(
      `SELECT id, suggestion_type, extracted_data, status
         FROM ai_suggestions
        WHERE id = $1 AND tenant_id = $2::uuid
        FOR UPDATE`,
      [id, tenantId],
    );
    const rows = sel.rows as SuggestionRow[];
    if (rows.length === 0) return { kind: "not_found" as const };
    const s = rows[0];
    if (s.status !== "pending") return { kind: "wrong_state" as const, status: s.status };

    // ADR-0017: status transitions go through the helper, never a raw UPDATE.
    await applyHubProposalTransition(c, {
      trigger: decision === "verify" ? "accept" : "reject",
      aiSuggestionId: id,
      reviewerLabel: `human:${userId ?? tenantId}`,
      reason,
    });

    let entityId: string | null = null;
    if (decision === "verify") {
      const data = s.extracted_data ?? {};
      if (s.suggestion_type === "kg_entity") {
        entityId = await createKgEntity(c, tenantId, data);
      } else if (s.suggestion_type === "tag_mapping") {
        entityId = await createTagEntity(c, tenantId, data);
      } else if (s.suggestion_type === "drive_pack_update") {
        // Not a KG/tag entity — enqueue a build+grade (no auto-promote). #2544.
        await markDrivePackBuildRequested(c, tenantId, id);
      }
    }

    return {
      kind: "ok" as const,
      decision,
      status: decision === "verify" ? "accepted" : "rejected",
      entityId,
    };
  });
}
