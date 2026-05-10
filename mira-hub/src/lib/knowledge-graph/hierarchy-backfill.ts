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

export interface HierarchyBackfillResult {
  tenantId: string;
  equipmentScanned: number;
  matchesFound: number;
  relationshipsCreated: number;
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
    `SELECT id, entity_id, name
     FROM kg_entities
     WHERE tenant_id = $1
       AND entity_type IN ('area','line')
       AND (entity_id = $2 OR name = $2)
     LIMIT 1`,
    [tenantId, location],
  );
  return rows[0] ?? null;
}

async function relationshipExists(
  client: PoolClient,
  tenantId: string,
  sourceId: string,
  targetId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM kg_relationships
       WHERE tenant_id = $1
         AND source_id = $2
         AND target_id = $3
         AND relationship_type = 'parent_of'
     ) AS exists`,
    [tenantId, sourceId, targetId],
  );
  return rows[0]?.exists ?? false;
}

async function createParentOf(
  client: PoolClient,
  tenantId: string,
  parentId: string,
  childId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO kg_relationships
       (tenant_id, source_id, target_id, relationship_type, confidence)
     VALUES ($1, $2, $3, 'parent_of', 1.0)
     ON CONFLICT DO NOTHING`,
    [tenantId, parentId, childId],
  );
}

export async function runHierarchyBackfill(
  tenantId: string,
  dryRun: boolean,
): Promise<HierarchyBackfillResult> {
  const start = Date.now();
  let equipmentScanned = 0;
  let matchesFound = 0;
  let relationshipsCreated = 0;
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
      const exists = await relationshipExists(client, tenantId, parent.id, eq.id);
      if (exists) {
        skippedExisting++;
        continue;
      }
      if (!dryRun) {
        await createParentOf(client, tenantId, parent.id, eq.id);
        relationshipsCreated++;
      }
    }
  });

  return {
    tenantId,
    equipmentScanned,
    matchesFound,
    relationshipsCreated,
    skippedExisting,
    unmatched,
    durationMs: Date.now() - start,
  };
}
