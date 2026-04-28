/**
 * Graph context injection for MIRA chat (#794).
 *
 * buildGraphContext(tenantId, questionText, anchorAssetId?)
 *   → structured text block prepended to the LLM system prompt
 *
 * Pipeline:
 *   1. Extract entity mentions from question (equipment tags, fault codes, parts)
 *   2. Batch-lookup those entity_ids in kg_entities (single transaction)
 *   3. Fetch relationships + recent triples for each found entity
 *   4. Format into human-readable context blocks
 *   5. Return "" if nothing found (graceful fallback to vector-only)
 */

import pool from "@/lib/db";
import type { PoolClient } from "pg";
import { extractEntitiesFromText } from "./extractor";

// ── DB helpers ─────────────────────────────────────────────────────────────

async function withKgContext<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Raw row types ───────────────────────────────────────────────────────────

interface EntityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  properties: Record<string, unknown>;
}

interface RelRow {
  id: string;
  source_id: string;
  target_id: string;
  relationship_type: string;
  source_entity_id: string | null;
  target_entity_id: string | null;
  target_name: string | null;
  source_name: string | null;
}

interface TripleRow {
  subject: string;
  predicate: string;
  object: string;
  extracted_at: string;
}

interface EntityFull {
  entity: EntityRow;
  outgoing: RelRow[];
  incoming: RelRow[];
  triples: TripleRow[];
}

async function fetchEntitiesByIds(
  client: PoolClient,
  tenantId: string,
  entityIds: string[],
  entityTypes: string[],
): Promise<EntityRow[]> {
  if (entityIds.length === 0) return [];
  const { rows } = await client.query<EntityRow>(
    `SELECT id, entity_type, entity_id, name,
            COALESCE(properties, '{}')::jsonb AS properties
     FROM kg_entities
     WHERE tenant_id = $1
       AND entity_id = ANY($2)
       AND entity_type = ANY($3)
     LIMIT 20`,
    [tenantId, entityIds, entityTypes],
  );
  return rows;
}

async function fetchEntityFull(
  client: PoolClient,
  tenantId: string,
  entityUuid: string,
  entityName: string,
): Promise<{ outgoing: RelRow[]; incoming: RelRow[]; triples: TripleRow[] }> {
  const [outRes, inRes, triRes] = await Promise.all([
    // Outgoing: join target entity for its name and entity_id
    client.query<RelRow>(
      `SELECT r.id, r.source_id, r.target_id, r.relationship_type,
              src.entity_id AS source_entity_id, tgt.entity_id AS target_entity_id,
              tgt.name AS target_name, src.name AS source_name
       FROM kg_relationships r
       LEFT JOIN kg_entities src ON src.id = r.source_id
       LEFT JOIN kg_entities tgt ON tgt.id = r.target_id
       WHERE r.tenant_id = $1 AND r.source_id = $2
       ORDER BY r.created_at DESC
       LIMIT 30`,
      [tenantId, entityUuid],
    ),
    // Incoming: join source entity for its name and entity_id
    client.query<RelRow>(
      `SELECT r.id, r.source_id, r.target_id, r.relationship_type,
              src.entity_id AS source_entity_id, tgt.entity_id AS target_entity_id,
              tgt.name AS target_name, src.name AS source_name
       FROM kg_relationships r
       LEFT JOIN kg_entities src ON src.id = r.source_id
       LEFT JOIN kg_entities tgt ON tgt.id = r.target_id
       WHERE r.tenant_id = $1 AND r.target_id = $2
       ORDER BY r.created_at DESC
       LIMIT 30`,
      [tenantId, entityUuid],
    ),
    // Recent triples mentioning this entity by name
    client.query<TripleRow>(
      `SELECT subject, predicate, object, extracted_at::text
       FROM kg_triples_log
       WHERE tenant_id = $1
         AND (subject = $2 OR object = $2)
       ORDER BY extracted_at DESC
       LIMIT 40`,
      [tenantId, entityName],
    ),
  ]);

  return { outgoing: outRes.rows, incoming: inRes.rows, triples: triRes.rows };
}

// ── Formatting ─────────────────────────────────────────────────────────────

function relsByType(rels: RelRow[], type: string): RelRow[] {
  return rels.filter((r) => r.relationship_type === type);
}

function triplesByPredicate(triples: TripleRow[], predicate: string): TripleRow[] {
  return triples.filter((t) => t.predicate === predicate);
}

function faultSummary(triples: TripleRow[]): string {
  const faults = triplesByPredicate(triples, "exhibited_fault");
  if (faults.length === 0) return "";

  // Count occurrences per fault code
  const counts = new Map<string, number>();
  for (const t of faults) {
    counts.set(t.object, (counts.get(t.object) ?? 0) + 1);
  }
  const recent = faults[0]?.extracted_at?.slice(0, 10) ?? "";
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, n]) => (n > 1 ? `${code} ×${n}` : code));
  return `${parts.join(", ")}${recent ? ` (last: ${recent})` : ""}`;
}

function actionSummary(triples: TripleRow[]): string {
  const actions = triplesByPredicate(triples, "performed_action");
  if (actions.length === 0) return "";
  const unique = [...new Set(actions.map((t) => t.object))].slice(0, 6);
  return unique.join(", ");
}

export function formatEntityContext(full: EntityFull): string {
  const { entity, outgoing, incoming, triples } = full;
  const p = entity.properties;
  const lines: string[] = [];

  lines.push(`[GRAPH CONTEXT for ${entity.entity_id}]`);

  // Type line
  const typeParts = [
    p.manufacturer as string | null,
    p.model_number as string | null,
    p.equipment_type as string | null,
  ].filter(Boolean);
  if (typeParts.length > 0) lines.push(`Type: ${typeParts.join(" — ")}`);
  else lines.push(`Type: ${entity.entity_type}`);

  // Location (prefer located_at relationship, fall back to property)
  const locRel = relsByType(outgoing, "located_at")[0];
  const location = locRel?.target_name ?? (p.location as string | null) ?? null;
  if (location) lines.push(`Location: ${location}`);

  // Criticality
  if (p.criticality) lines.push(`Criticality: ${p.criticality}`);

  // Open work orders
  const woRels = relsByType(outgoing, "has_work_order");
  if (woRels.length > 0) lines.push(`Work orders on record: ${woRels.length}`);

  // PM schedules
  const pmRels = relsByType(outgoing, "has_pm");
  if (pmRels.length > 0) {
    const pmNames = pmRels
      .map((r) => r.target_name)
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    lines.push(`PM schedules: ${pmRels.length}${pmNames ? ` (${pmNames})` : ""}`);
  }

  // Recent faults (from triples extracted during conversations)
  const faults = faultSummary(triples);
  if (faults) lines.push(`Recent faults: ${faults}`);

  // Parts on record
  const partRels = relsByType(outgoing, "requires_part");
  if (partRels.length > 0) {
    const partNames = partRels
      .map((r) => r.target_entity_id ?? r.target_name)
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    lines.push(`Parts on record: ${partNames}`);
  }

  // Related equipment tags mentioned in same conversations
  const tagRels = relsByType(outgoing, "mentioned_tag");
  const relatedEquip = tagRels
    .map((r) => r.target_entity_id ?? r.target_name)
    .filter(Boolean)
    .slice(0, 4);
  if (relatedEquip.length > 0) lines.push(`Related equipment tags: ${relatedEquip.join(", ")}`);

  // Also check incoming relationships to find equipment that references this entity
  const incomingEquip = incoming
    .filter((r) => r.relationship_type === "mentioned_tag")
    .map((r) => r.source_entity_id ?? r.source_name)
    .filter(Boolean)
    .slice(0, 3);
  if (incomingEquip.length > 0 && incomingEquip.length !== relatedEquip.length) {
    lines.push(`Also referenced by: ${incomingEquip.join(", ")}`);
  }

  // Recent actions
  const actions = actionSummary(triples);
  if (actions) lines.push(`Recent maintenance actions: ${actions}`);

  return lines.join("\n");
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function buildGraphContext(
  tenantId: string,
  questionText: string,
  anchorAssetId?: string,
): Promise<string> {
  if (!process.env.NEON_DATABASE_URL) return "";

  const extracted = extractEntitiesFromText(questionText);

  // Combine all candidate entity_ids to look up
  const equipmentIds = [...new Set(extracted.equipment)];
  const faultIds = [...new Set(extracted.faultCodes)];
  const partIds = [...new Set(extracted.parts)];

  // If anchor asset provided, include it as an equipment lookup
  const allEquipment = anchorAssetId
    ? [...new Set([anchorAssetId, ...equipmentIds])]
    : equipmentIds;

  // Nothing to look up → return empty (graceful fallback)
  if (allEquipment.length === 0 && faultIds.length === 0 && partIds.length === 0) {
    return "";
  }

  try {
    const contextBlocks = await withKgContext(tenantId, async (client) => {
      // Batch-lookup all mentioned entities
      const [equipRows, faultRows, partRows] = await Promise.all([
        allEquipment.length > 0
          ? fetchEntitiesByIds(client, tenantId, allEquipment, ["equipment", "equipment_tag"])
          : Promise.resolve([] as EntityRow[]),
        faultIds.length > 0
          ? fetchEntitiesByIds(client, tenantId, faultIds, ["fault_code"])
          : Promise.resolve([] as EntityRow[]),
        partIds.length > 0
          ? fetchEntitiesByIds(client, tenantId, partIds, ["part"])
          : Promise.resolve([] as EntityRow[]),
      ]);

      // For each found entity, fetch relationships + triples
      const allRows = [...equipRows, ...faultRows, ...partRows].slice(0, 6); // cap at 6 entities
      const blocks: string[] = [];

      for (const entity of allRows) {
        const { outgoing, incoming, triples } = await fetchEntityFull(
          client, tenantId, entity.id, entity.name,
        );
        const block = formatEntityContext({ entity, outgoing, incoming, triples });
        blocks.push(block);
      }

      return blocks;
    });

    return contextBlocks.length > 0 ? contextBlocks.join("\n\n") : "";
  } catch {
    // KG not yet populated or table missing — graceful fallback
    return "";
  }
}
