/**
 * Multi-hop traversal API (Phase 2 of KG multi-hop spec, #806).
 *
 * Four entry points:
 *   - traverseChain     — follow a specific chain of relationship types
 *   - impactAnalysis    — downstream feeds graph
 *   - rootCauseChain    — backward caused_by walk
 *   - maintenanceContext — aggregated structured payload for prompt injection
 *
 * All recursive walks are depth-bounded and cycle-protected.
 *
 * See spec §5 for signatures + latency budgets.
 */

import pool from "@/lib/db";
import type { PoolClient } from "pg";
import type { KGEntity } from "./types";
import { flagPmMismatches, type PmMismatch } from "./plan-vs-actual";

// ── Shared transaction helper ──────────────────────────────────────────────

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
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  properties: Record<string, unknown> | null;
  // Optional: the recursive CTEs in this file project a fixed column list
  // that doesn't include uns_path. Direct equipment / hierarchy lookups DO
  // select uns_path::text and surface it. Default to null when absent.
  uns_path?: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: EntityRow): KGEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    name: row.name,
    properties: row.properties ?? {},
    unsPath: row.uns_path ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ── UNS path resolvers ─────────────────────────────────────────────────────

/**
 * Loose ltree label validator — same charset psql allows in an ltree literal
 * label, plus wildcard segments are NOT permitted here. Callers needing
 * lquery semantics should compose an lquery and pass it explicitly.
 */
const LTREE_PATH_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

export function isValidUnsPath(s: string): boolean {
  return LTREE_PATH_RE.test(s);
}

/**
 * Resolve a UNS path to an entity. Exact match — for prefix queries use
 * entitiesUnderUnsPath. Returns null if no entity owns that path.
 */
export async function resolveEntityByUnsPath(
  tenantId: string,
  unsPath: string,
): Promise<KGEntity | null> {
  if (!isValidUnsPath(unsPath)) return null;
  return withKgContext(tenantId, async (client) => {
    const { rows } = await client.query<EntityRow>(
      `SELECT id, tenant_id, entity_type, entity_id, name, properties,
              uns_path::text AS uns_path, created_at, updated_at
         FROM kg_entities
         WHERE tenant_id = $1
           AND approval_state = 'verified'
           AND uns_path = $2::ltree
         LIMIT 1`,
      [tenantId, unsPath],
    );
    return rows.length > 0 ? rowToEntity(rows[0] as EntityRow) : null;
  });
}

/**
 * Return every entity at-or-below the given UNS path, ordered by depth then
 * name. Indexed: uses the GIST index on uns_path.
 */
export async function entitiesUnderUnsPath(
  tenantId: string,
  unsPath: string,
  limit = 500,
): Promise<KGEntity[]> {
  if (!isValidUnsPath(unsPath)) return [];
  return withKgContext(tenantId, async (client) => {
    const { rows } = await client.query<EntityRow>(
      `SELECT id, tenant_id, entity_type, entity_id, name, properties,
              uns_path::text AS uns_path, created_at, updated_at
         FROM kg_entities
         WHERE tenant_id = $1
           AND approval_state = 'verified'
           AND uns_path <@ $2::ltree
         ORDER BY nlevel(uns_path), name
         LIMIT $3`,
      [tenantId, unsPath, limit],
    );
    return rows.map(rowToEntity);
  });
}

// ── 1. traverseChain ───────────────────────────────────────────────────────

export interface ChainHop {
  entity: KGEntity;
  depth: number;
  path: string[];
}

/**
 * Follow a specific chain of relationship types, one hop per element.
 * Example: ["parent_of","parent_of","has_component"] starting at a Plant
 * walks Plant → Area → Line → all components on those lines.
 *
 * Cycle-protected; depth bounded by chain length (max 10 by default).
 */
export async function traverseChain(
  tenantId: string,
  startEntityId: string,
  relationshipChain: string[],
  maxDepth?: number,
): Promise<ChainHop[]> {
  if (relationshipChain.length === 0) return [];
  const cap = Math.min(maxDepth ?? relationshipChain.length, relationshipChain.length, 10);

  return withKgContext(tenantId, async (client) => {
    const { rows } = await client.query<EntityRow & { depth: number; path: string[] }>(
      `WITH RECURSIVE walk(id, tenant_id, entity_type, entity_id, name, properties,
                            created_at, updated_at, depth, path) AS (
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, 0, ARRAY[e.id::text]
           FROM kg_entities e
           WHERE e.id = $1
             AND e.tenant_id = $2
             AND e.approval_state = 'verified'
         UNION ALL
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, w.depth + 1, w.path || e.id::text
           FROM walk w
           JOIN kg_relationships r
             ON r.source_id = w.id
            AND r.tenant_id = $2
            AND r.relationship_type = ($3::text[])[w.depth + 1]
            AND r.approval_state = 'verified'
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = $2
            AND e.approval_state = 'verified'
          WHERE w.depth < $4
            AND NOT (e.id::text = ANY(w.path))
       )
       SELECT * FROM walk WHERE depth > 0 ORDER BY depth, name`,
      [startEntityId, tenantId, relationshipChain, cap],
    );

    return rows.map((r) => ({
      entity: rowToEntity(r),
      depth: r.depth,
      path: r.path,
    }));
  });
}

// ── 2. impactAnalysis ──────────────────────────────────────────────────────

export interface ImpactResult {
  downstream: ChainHop[];
  blockedLines: string[];
  partialImpact: string[];
}

const IMPACT_DEFAULT_DEPTH = 8;

/**
 * Walk `feeds` forward from the given entity. Returns every downstream node,
 * plus a split: lines that are entirely blocked vs. lines that have an
 * alternate `feeds` parent (partial impact).
 */
export async function impactAnalysis(
  tenantId: string,
  entityId: string,
): Promise<ImpactResult> {
  return withKgContext(tenantId, async (client) => {
    const { rows: downstreamRows } = await client.query<EntityRow & { depth: number; path: string[] }>(
      `WITH RECURSIVE downstream(id, tenant_id, entity_type, entity_id, name, properties,
                                  created_at, updated_at, depth, path) AS (
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, 0, ARRAY[e.id::text]
           FROM kg_entities e
           WHERE e.id = $1
             AND e.tenant_id = $2
             AND e.approval_state = 'verified'
         UNION ALL
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, d.depth + 1, d.path || e.id::text
           FROM downstream d
           JOIN kg_relationships r
             ON r.source_id = d.id
            AND r.tenant_id = $2
            AND r.relationship_type = 'feeds'
            AND r.approval_state = 'verified'
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = $2
            AND e.approval_state = 'verified'
          WHERE d.depth < $3
            AND NOT (e.id::text = ANY(d.path))
       )
       SELECT * FROM downstream WHERE depth > 0 ORDER BY depth, name`,
      [entityId, tenantId, IMPACT_DEFAULT_DEPTH],
    );

    const downstreamIds = downstreamRows.map((r) => r.id);

    // For each downstream node, check if it has any OTHER incoming `feeds`
    // edge (an alternate path that wouldn't be blocked by the failure).
    let partialImpactSet = new Set<string>();
    if (downstreamIds.length > 0) {
      const { rows: altRows } = await client.query<{ target_id: string }>(
        `SELECT DISTINCT r.target_id
           FROM kg_relationships r
           JOIN kg_entities src
             ON src.id = r.source_id
            AND src.tenant_id = r.tenant_id
            AND src.approval_state = 'verified'
           WHERE r.tenant_id = $1
             AND r.relationship_type = 'feeds'
             AND r.approval_state = 'verified'
             AND r.target_id = ANY($2)
             AND r.source_id <> $3
             AND NOT (r.source_id = ANY($2))`,
        [tenantId, downstreamIds, entityId],
      );
      partialImpactSet = new Set(altRows.map((r) => r.target_id));
    }

    const downstream = downstreamRows.map((r) => ({
      entity: rowToEntity(r),
      depth: r.depth,
      path: r.path,
    }));

    const blockedLines = downstream
      .filter((n) => n.entity.entityType === "line" && !partialImpactSet.has(n.entity.id))
      .map((n) => n.entity.entityId);
    const partialImpact = downstream
      .filter((n) => partialImpactSet.has(n.entity.id))
      .map((n) => n.entity.entityId);

    return { downstream, blockedLines, partialImpact };
  });
}

// ── 3. rootCauseChain ──────────────────────────────────────────────────────

export interface RootCauseStep {
  entity: KGEntity;
  confidence: number;
  depth: number;
}

export interface RootCauseResult {
  chain: RootCauseStep[];
  alternates: KGEntity[];
}

const ROOT_CAUSE_DEFAULT_DEPTH = 5;

/**
 * Walk `caused_by` edges forward from the given fault/event entity. We model
 * "X caused_by Y" as an edge X→Y, so following source→target outward gives the
 * cause chain. Multiplicative confidence along the path; siblings at the first
 * hop are returned as alternates.
 */
export async function rootCauseChain(
  tenantId: string,
  faultEntityId: string,
): Promise<RootCauseResult> {
  return withKgContext(tenantId, async (client) => {
    const { rows: chainRows } = await client.query<
      EntityRow & { depth: number; path: string[]; cum_conf: number }
    >(
      `WITH RECURSIVE chain(id, tenant_id, entity_type, entity_id, name, properties,
                             created_at, updated_at, depth, path, cum_conf) AS (
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, 0, ARRAY[e.id::text], 1.0
           FROM kg_entities e
           WHERE e.id = $1
             AND e.tenant_id = $2
             AND e.approval_state = 'verified'
         UNION ALL
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, c.depth + 1, c.path || e.id::text,
                c.cum_conf * COALESCE(r.confidence, 1.0)
           FROM chain c
           JOIN kg_relationships r
             ON r.source_id = c.id
            AND r.tenant_id = $2
            AND r.relationship_type = 'caused_by'
            AND r.approval_state = 'verified'
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = $2
            AND e.approval_state = 'verified'
          WHERE c.depth < $3
            AND NOT (e.id::text = ANY(c.path))
       )
       SELECT DISTINCT ON (id) * FROM chain ORDER BY id, depth, cum_conf DESC`,
      [faultEntityId, tenantId, ROOT_CAUSE_DEFAULT_DEPTH],
    );

    // Top-level alternates: all `caused_by` siblings at depth 1
    const { rows: altRows } = await client.query<EntityRow>(
      `SELECT e.*
         FROM kg_relationships r
         JOIN kg_entities e
           ON e.id = r.target_id
          AND e.tenant_id = r.tenant_id
          AND e.approval_state = 'verified'
        WHERE r.tenant_id = $1
          AND r.source_id = $2
          AND r.relationship_type = 'caused_by'
          AND r.approval_state = 'verified'
        ORDER BY r.confidence DESC NULLS LAST
        LIMIT 5`,
      [tenantId, faultEntityId],
    );

    const chain = chainRows
      .filter((r) => r.depth > 0)
      .sort((a, b) => a.depth - b.depth)
      .map((r) => ({
        entity: rowToEntity(r),
        confidence: r.cum_conf,
        depth: r.depth,
      }));

    return {
      chain,
      alternates: altRows.map((r) => rowToEntity(r)),
    };
  });
}

// ── 4. maintenanceContext ──────────────────────────────────────────────────

export interface FaultSummary {
  code: string;
  count: number;
  lastSeen: Date;
}

export interface PmScheduleSummary {
  task: string;
  intervalDays: number | null;
  lastRun: Date | null;
  nextDue: Date | null;
}

export interface MaintenanceContext {
  equipment: KGEntity;
  hierarchy: { plant: KGEntity | null; area: KGEntity | null; line: KGEntity | null };
  components: KGEntity[];
  recentFaults: FaultSummary[];
  recentWorkOrders: KGEntity[];
  knownParts: KGEntity[];
  manuals: KGEntity[];
  pmSchedule: PmScheduleSummary[];
  similarEquipment: KGEntity[];
  pmMismatches: PmMismatch[];
}

export interface MaintenanceContextOpts {
  faultWindowDays?: number;
  maxWorkOrders?: number;
  includeSimilar?: boolean;
}

/**
 * Aggregated payload the diagnostic engine needs before answering a question
 * about a piece of equipment. Single transaction, parallel sub-queries.
 *
 * Returns null if the equipment entity is not found.
 */
export async function maintenanceContext(
  tenantId: string,
  equipmentEntityId: string,
  opts: MaintenanceContextOpts = {},
): Promise<MaintenanceContext | null> {
  const faultWindow = opts.faultWindowDays ?? 90;
  const maxWO = opts.maxWorkOrders ?? 5;

  return withKgContext(tenantId, async (client) => {
    // Equipment lookup — accept both internal UUID and entity_id
    const { rows: eqRows } = await client.query<EntityRow>(
      `SELECT * FROM kg_entities
         WHERE tenant_id = $1
           AND entity_type = 'equipment'
           AND approval_state = 'verified'
           AND (id::text = $2 OR entity_id = $2)
         LIMIT 1`,
      [tenantId, equipmentEntityId],
    );
    if (eqRows.length === 0) return null;
    const equipment = rowToEntity(eqRows[0] as EntityRow);

    // Hierarchy — walk parent_of edges incoming (line → equipment, area → line, plant → area)
    const { rows: ancestorRows } = await client.query<EntityRow & { depth: number }>(
      `WITH RECURSIVE up(id, tenant_id, entity_type, entity_id, name, properties,
                          created_at, updated_at, depth, path) AS (
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, 0, ARRAY[e.id::text]
           FROM kg_entities e
           WHERE e.id = $1
             AND e.approval_state = 'verified'
         UNION ALL
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, u.depth + 1, u.path || e.id::text
           FROM up u
           JOIN kg_relationships r
             ON r.target_id = u.id
            AND r.tenant_id = $2
            AND r.relationship_type = 'parent_of'
            AND r.approval_state = 'verified'
           JOIN kg_entities e
             ON e.id = r.source_id
            AND e.tenant_id = $2
            AND e.approval_state = 'verified'
          WHERE u.depth < 5 AND NOT (e.id::text = ANY(u.path))
       )
       SELECT * FROM up WHERE depth > 0 ORDER BY depth`,
      [equipment.id, tenantId],
    );

    const hierarchy = {
      plant: ancestorRows.find((r) => r.entity_type === "plant") ?? null,
      area: ancestorRows.find((r) => r.entity_type === "area") ?? null,
      line: ancestorRows.find((r) => r.entity_type === "line") ?? null,
    };

    // Parallel sub-queries for the rest
    const [components, faults, workOrders, parts, manuals, pmTasks, similar] = await Promise.all([
      // Components
      client.query<EntityRow>(
        `SELECT e.* FROM kg_relationships r
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = r.tenant_id
            AND e.approval_state = 'verified'
          WHERE r.tenant_id = $1 AND r.source_id = $2 AND r.relationship_type = 'has_component'
            AND r.approval_state = 'verified'
          ORDER BY e.name LIMIT 20`,
        [tenantId, equipment.id],
      ),
      // Recent faults — count via had_fault relationships in window
      client.query<{ code: string; count: string; last_seen: string }>(
        `SELECT e.entity_id AS code, COUNT(*)::text AS count,
                MAX((r.properties->>'occurred_at')::timestamptz) AS last_seen
           FROM kg_relationships r
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = r.tenant_id
            AND e.approval_state = 'verified'
          WHERE r.tenant_id = $1
            AND r.source_id = $2
            AND r.relationship_type = 'had_fault'
            AND r.approval_state = 'verified'
            AND COALESCE((r.properties->>'occurred_at')::timestamptz, r.created_at)
                > now() - ($3 || ' days')::interval
          GROUP BY e.entity_id
          ORDER BY count DESC LIMIT 10`,
        [tenantId, equipment.id, faultWindow],
      ),
      // Work orders (most recent N)
      client.query<EntityRow>(
        `SELECT e.* FROM kg_relationships r
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = r.tenant_id
            AND e.approval_state = 'verified'
          WHERE r.tenant_id = $1 AND r.source_id = $2 AND r.relationship_type = 'has_work_order'
            AND r.approval_state = 'verified'
          ORDER BY e.created_at DESC LIMIT $3`,
        [tenantId, equipment.id, maxWO],
      ),
      // Parts
      client.query<EntityRow>(
        `SELECT e.* FROM kg_relationships r
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = r.tenant_id
            AND e.approval_state = 'verified'
          WHERE r.tenant_id = $1 AND r.source_id = $2 AND r.relationship_type = 'requires_part'
            AND r.approval_state = 'verified'
          ORDER BY e.name LIMIT 30`,
        [tenantId, equipment.id],
      ),
      // Manuals — both direct references and via references_drawing
      client.query<EntityRow>(
        `SELECT DISTINCT e.* FROM kg_relationships r
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = r.tenant_id
            AND e.approval_state = 'verified'
          WHERE r.tenant_id = $1
            AND r.source_id = $2
            AND e.entity_type = 'manual'
            AND r.approval_state = 'verified'
          LIMIT 10`,
        [tenantId, equipment.id],
      ),
      // PM tasks
      client.query<EntityRow>(
        `SELECT e.* FROM kg_relationships r
           JOIN kg_entities e
             ON e.id = r.target_id
            AND e.tenant_id = r.tenant_id
            AND e.approval_state = 'verified'
          WHERE r.tenant_id = $1 AND r.source_id = $2 AND r.relationship_type = 'has_pm'
            AND r.approval_state = 'verified'
          ORDER BY e.name LIMIT 10`,
        [tenantId, equipment.id],
      ),
      // Similar equipment (within tenant only, per resolved decision §12)
      opts.includeSimilar
        ? client.query<EntityRow>(
            `SELECT e.* FROM kg_relationships r
               JOIN kg_entities e
                 ON e.id = r.target_id
                AND e.tenant_id = r.tenant_id
                AND e.approval_state = 'verified'
              WHERE r.tenant_id = $1 AND r.source_id = $2 AND r.relationship_type = 'similar_to'
                AND r.approval_state = 'verified'
              ORDER BY (r.properties->>'similarity_score')::float DESC NULLS LAST
              LIMIT 5`,
            [tenantId, equipment.id],
          )
        : Promise.resolve({ rows: [] as EntityRow[] }),
    ]);

    // Phase 4: plan-vs-actual mismatches scoped to this equipment.
    // Cheap follow-up query — no second transaction needed because we're
    // already inside withKgContext via the outer caller. We do call into
    // flagPmMismatches which opens its own context, which is fine
    // (independent transaction, same RLS settings).
    let pmMismatches: PmMismatch[] = [];
    try {
      pmMismatches = await flagPmMismatches(tenantId, {
        equipmentEntityId: equipment.entityId,
      });
    } catch {
      pmMismatches = [];
    }

    return {
      equipment,
      hierarchy: {
        plant: hierarchy.plant ? rowToEntity(hierarchy.plant) : null,
        area: hierarchy.area ? rowToEntity(hierarchy.area) : null,
        line: hierarchy.line ? rowToEntity(hierarchy.line) : null,
      },
      components: components.rows.map(rowToEntity),
      recentFaults: faults.rows.map((r) => ({
        code: r.code,
        count: parseInt(r.count, 10),
        lastSeen: new Date(r.last_seen),
      })),
      recentWorkOrders: workOrders.rows.map(rowToEntity),
      knownParts: parts.rows.map(rowToEntity),
      manuals: manuals.rows.map(rowToEntity),
      pmSchedule: pmTasks.rows.map((r) => {
        const p = (r.properties ?? {}) as Record<string, unknown>;
        return {
          task: r.name,
          intervalDays: typeof p.interval_days === "number" ? p.interval_days : null,
          lastRun: p.last_run ? new Date(p.last_run as string) : null,
          nextDue: p.next_due ? new Date(p.next_due as string) : null,
        };
      }),
      similarEquipment: similar.rows.map(rowToEntity),
      pmMismatches,
    };
  });
}
