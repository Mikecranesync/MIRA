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
 * On `reject`: transition status → 'rejected'. No entity is created.
 *
 * Promotion of `tag_mapping` (→ `tag_entities`) and the other non-edge types is deliberately
 * status-only here; only `kg_entity` creates an entity in this slice.
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
    if (decision === "verify" && s.suggestion_type === "kg_entity") {
      entityId = await createKgEntity(c, tenantId, s.extracted_data ?? {});
    }

    return {
      kind: "ok" as const,
      decision,
      status: decision === "verify" ? "accepted" : "rejected",
      entityId,
    };
  });
}
