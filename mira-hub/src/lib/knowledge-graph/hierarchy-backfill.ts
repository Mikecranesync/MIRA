/**
 * Hierarchy backfill (Phase 1 of KG multi-hop spec, #806).
 *
 * Walks every `equipment` entity for the given tenant and, when its
 * `properties.location` matches the entity_id (or name) of an existing
 * `area` or `line` entity, creates a `parent_of` relationship pointing
 * from the parent down to the equipment. Idempotent.
 *
 * Zero matches is a clean exit — Mike hand-authors plant/area/line
 * entities first, then this script links existing equipment to them.
 */

import pool from "@/lib/db";
import type { PoolClient } from "pg";
import { mapToCanonicalEdge, upsertInferredProposal } from "./proposals-writer";

// The parent match is a heuristic location-string compare, so the edge is
// INFERRED, not deliberate structure — it is PROPOSED for human review (Iron
// Rule, ADR-0017), never auto-verified. `parent_of` maps to LOCATED_IN flipped
// (equipment LOCATED_IN area/line). Moderate confidence: an exact id/name
// match is reliable but still a string heuristic.
const HIERARCHY_RELATIONSHIP_CONFIDENCE = 0.7;

export interface HierarchyBackfillResult {
  tenantId: string;
  equipmentScanned: number;
  matchesFound: number;
  /**
   * Kept for API back-compat. The location match is inferred, so the edge is
   * now PROPOSED for human review (Iron Rule, ADR-0017), never written directly
   * to kg_relationships — always 0. See relationshipsProposed.
   */
  relationshipsCreated: number;
  /** New (#1721): LOCATED_IN edges proposed this run (0 on dry-run). */
  relationshipsProposed: number;
  /** Matches skipped because a verified edge or open proposal already exists. */
  skippedExisting: number;
  unmatched: string[];
  durationMs: number;
}

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

interface EquipmentRow {
  id: string;
  entity_id: string;
  name: string;
  location: string | null;
}

interface ParentRow {
  id: string;
  entity_id: string;
  name: string;
  entity_type: string;
}

async function findEquipmentWithLocation(
  client: PoolClient,
  tenantId: string,
): Promise<EquipmentRow[]> {
  const { rows } = await client.query<EquipmentRow>(
    `SELECT id, entity_id, name,
            (properties->>'location') AS location
     FROM kg_entities
     WHERE tenant_id = $1
       AND entity_type = 'equipment'
       AND properties ? 'location'
       AND length(coalesce(properties->>'location','')) > 0`,
    [tenantId],
  );
  return rows;
}

async function findParentByLocation(
  client: PoolClient,
  tenantId: string,
  location: string,
): Promise<ParentRow | null> {
  const { rows } = await client.query<ParentRow>(
    `SELECT id, entity_id, name, entity_type
     FROM kg_entities
     WHERE tenant_id = $1
       AND entity_type IN ('area','line')
       AND (entity_id = $2 OR name = $2)
     LIMIT 1`,
    [tenantId, location],
  );
  return rows[0] ?? null;
}

/**
 * Propose `equipment LOCATED_IN parent` for human review instead of writing a
 * `parent_of` edge straight to kg_relationships (Iron Rule, ADR-0017).
 * `parent_of` maps to LOCATED_IN flipped, so the parent (area/line) → child
 * (equipment) match is proposed as child LOCATED_IN parent. Dedup (verified
 * edge OR open proposal, either direction) is handled inside
 * upsertInferredProposal. Returns true when a new proposal was written
 * (false = deduped — an edge/proposal already exists).
 */
async function proposeLocatedIn(
  client: PoolClient,
  tenantId: string,
  parent: { id: string; type: string },
  equipment: { id: string; type: string },
): Promise<boolean> {
  const edge = mapToCanonicalEdge("parent_of");
  if (!edge) return false;
  // parent_of has flip:true → source/target swap so the equipment is LOCATED_IN
  // the parent. raw source = parent, raw target = equipment.
  const source = edge.flip ? equipment : parent;
  const target = edge.flip ? parent : equipment;
  const proposalId = await upsertInferredProposal(client, tenantId, {
    sourceEntityId: source.id,
    sourceEntityType: source.type,
    targetEntityId: target.id,
    targetEntityType: target.type,
    relationshipType: edge.type,
    confidence: HIERARCHY_RELATIONSHIP_CONFIDENCE,
    reasoning: `Hierarchy backfill — equipment location string matched a ${parent.type} entity (original predicate "parent_of").`,
    evidence: [
      {
        evidenceType: "manifest",
        sourceDescription: `Location-string match against ${parent.type} "${parent.id}"`,
        confidenceContribution: HIERARCHY_RELATIONSHIP_CONFIDENCE,
      },
    ],
  });
  return proposalId !== null;
}

export async function runHierarchyBackfill(
  tenantId: string,
  dryRun: boolean,
): Promise<HierarchyBackfillResult> {
  const start = Date.now();
  let equipmentScanned = 0;
  let matchesFound = 0;
  let relationshipsProposed = 0;
  let skippedExisting = 0;
  const unmatched: string[] = [];

  await withKgContext(tenantId, async (client) => {
    const equipment = await findEquipmentWithLocation(client, tenantId);
    equipmentScanned = equipment.length;

    for (const eq of equipment) {
      if (!eq.location) continue;
      const parent = await findParentByLocation(client, tenantId, eq.location);
      if (!parent) {
        unmatched.push(`${eq.entity_id} (location="${eq.location}")`);
        continue;
      }
      matchesFound++;
      // dryRun reports candidate matches (matchesFound) but proposes nothing —
      // upsertInferredProposal always writes, so it must be skipped here.
      if (dryRun) continue;
      const proposed = await proposeLocatedIn(
        client,
        tenantId,
        { id: parent.id, type: parent.entity_type },
        { id: eq.id, type: "equipment" },
      );
      if (proposed) relationshipsProposed++;
      else skippedExisting++; // deduped: a verified edge or open proposal already exists
    }
  });

  return {
    tenantId,
    equipmentScanned,
    matchesFound,
    relationshipsCreated: 0,
    relationshipsProposed,
    skippedExisting,
    unmatched,
    durationMs: Date.now() - start,
  };
}
