/**
 * UNS path backfill (CRA-14, ISA-95 hierarchy).
 *
 * Computes a hierarchical ltree address for every kg_entity by walking the
 * parent_of relationship graph upward to the plant root, then writes the
 * concatenated path into kg_entities.uns_path.
 *
 * Address shape (sanitized labels, dot-separated):
 *   enterprise.<plant>.<area>.<line>.<equipment>.<component>
 *
 * The graph stays the source of truth — uns_path is a cached projection so
 * "everything under plant A area 2" is an indexed prefix lookup instead of a
 * recursive CTE.
 *
 * Idempotent: re-running the backfill recomputes the path. Cycles in
 * parent_of are guarded by the same ARRAY ANY(path) check as traversal.ts.
 */
import pool from "@/lib/db";
import type { PoolClient } from "pg";

export interface UnsBackfillResult {
  tenantId: string;
  entitiesScanned: number;
  pathsAssigned: number;
  pathsUnchanged: number;
  unrooted: string[];
  durationMs: number;
}

const ROOT_LABEL = "enterprise";

const HIERARCHY_TYPES = new Set([
  "plant",
  "area",
  "line",
  "equipment",
  "component",
]);

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

interface EntityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  uns_path: string | null;
}

/**
 * ltree labels accept only [A-Za-z0-9_]. Lowercase, replace anything else
 * with underscore, collapse runs, trim leading/trailing underscore. Empty
 * strings fall back to the entity_type so we always get a valid label.
 */
export function sanitizeLabel(raw: string, fallback: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

function preferredLabel(row: EntityRow): string {
  // entity_id is usually a stable slug from the source system; fall back to
  // a sanitized name, then to entity_type to avoid empty labels.
  return sanitizeLabel(row.entity_id || row.name || "", sanitizeLabel(row.entity_type, "node"));
}

async function loadHierarchyEntities(
  client: PoolClient,
  tenantId: string,
): Promise<Map<string, EntityRow>> {
  const { rows } = await client.query<EntityRow>(
    `SELECT id, entity_type, entity_id, name, uns_path::text AS uns_path
       FROM kg_entities
       WHERE tenant_id = $1
         AND entity_type = ANY($2::text[])`,
    [tenantId, Array.from(HIERARCHY_TYPES)],
  );
  return new Map<string, EntityRow>(rows.map((r: EntityRow) => [r.id, r]));
}

interface ParentEdge {
  child_id: string;
  parent_id: string;
}

async function loadParentMap(
  client: PoolClient,
  tenantId: string,
): Promise<Map<string, string>> {
  // parent_of: source = parent, target = child (per traversal.ts §maintenanceContext).
  const { rows } = await client.query<ParentEdge>(
    `SELECT r.target_id AS child_id, r.source_id AS parent_id
       FROM kg_relationships r
       WHERE r.tenant_id = $1
         AND r.relationship_type = 'parent_of'`,
    [tenantId],
  );
  // If an entity has multiple incoming parent_of edges (shouldn't happen for
  // a hierarchy, but the schema allows it), keep the first deterministically.
  const map = new Map<string, string>();
  for (const edge of rows) {
    if (!map.has(edge.child_id)) map.set(edge.child_id, edge.parent_id);
  }
  return map;
}

function buildPath(
  entityId: string,
  entities: Map<string, EntityRow>,
  parents: Map<string, string>,
): string | null {
  const labels: string[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined = entityId;
  while (cursor) {
    if (visited.has(cursor)) return null; // cycle — bail
    visited.add(cursor);
    const row = entities.get(cursor);
    if (!row) return null; // ancestor missing from hierarchy snapshot
    labels.push(preferredLabel(row));
    if (row.entity_type === "plant") {
      labels.push(ROOT_LABEL);
      break;
    }
    cursor = parents.get(cursor);
    if (!cursor) {
      // Reached an entity that is not a plant and has no parent_of edge —
      // can't anchor it under the enterprise root.
      return null;
    }
  }
  return labels.reverse().join(".");
}

export async function runUnsBackfill(
  tenantId: string,
  dryRun: boolean,
): Promise<UnsBackfillResult> {
  const start = Date.now();
  let entitiesScanned = 0;
  let pathsAssigned = 0;
  let pathsUnchanged = 0;
  const unrooted: string[] = [];

  await withKgContext(tenantId, async (client) => {
    const entities = await loadHierarchyEntities(client, tenantId);
    const parents = await loadParentMap(client, tenantId);
    entitiesScanned = entities.size;

    for (const [id, row] of entities) {
      const newPath = buildPath(id, entities, parents);
      if (!newPath) {
        unrooted.push(`${row.entity_type}:${row.entity_id}`);
        continue;
      }
      if (row.uns_path === newPath) {
        pathsUnchanged++;
        continue;
      }
      if (!dryRun) {
        await client.query(
          `UPDATE kg_entities SET uns_path = $2::ltree, updated_at = now()
             WHERE id = $1 AND tenant_id = current_setting('app.current_tenant_id')::uuid`,
          [id, newPath],
        );
      }
      pathsAssigned++;
    }
  });

  return {
    tenantId,
    entitiesScanned,
    pathsAssigned,
    pathsUnchanged,
    unrooted,
    durationMs: Date.now() - start,
  };
}
