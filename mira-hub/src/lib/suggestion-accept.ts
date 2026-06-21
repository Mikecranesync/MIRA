import { withTenantContext } from "@/lib/tenant-context";
import { applyHubProposalTransition, type QueryClient } from "@/lib/proposal-transition";

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
 * On `reject`: transition status → 'rejected'. No entity is created.
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
  return rows[0]?.id ?? null;
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
