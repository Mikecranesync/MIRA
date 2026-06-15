import type { KgEntity, KgRelationship, MiraReading } from "@/lib/i3x";
import { filterExposable } from "@/lib/i3x";

/** Minimal shape of the pg client passed by withTenantContext. */
export interface DbClient {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

/** The ltree parent of a uns_path (drops the last segment), or null at the root. */
export function parentUnsPath(path: string | null): string | null {
  if (!path) return null;
  const i = path.lastIndexOf(".");
  return i <= 0 ? null : path.slice(0, i);
}

interface EntityRow {
  id: string;
  entity_type: string;
  name: string;
  approval_state: string | null;
  uns_path: string | null;
  properties: Record<string, unknown> | null;
}

/**
 * Load verified entities by elementId (kg UUID), resolving parent_id from
 * uns_path ancestry against the same verified result set. Only verified rows
 * are returned AND only verified rows can act as a parent.
 */
export async function loadEntitiesByIds(client: DbClient, ids: string[]): Promise<KgEntity[]> {
  if (ids.length === 0) return [];
  try {
    const { rows } = await client.query<EntityRow>(
      `SELECT id, entity_type, name, approval_state, uns_path::text AS uns_path, properties
         FROM kg_entities
        WHERE id = ANY($1)`,
      [ids],
    );
    const verified = filterExposable(rows);
    const byPath = new Map<string, string>();
    for (const r of verified) if (r.uns_path) byPath.set(r.uns_path, r.id);

    return verified.map((r) => {
      const parentPath = parentUnsPath(r.uns_path);
      const parent_id = parentPath ? byPath.get(parentPath) ?? null : null;
      return {
        id: r.id,
        entity_type: r.entity_type,
        name: r.name,
        approval_state: r.approval_state,
        uns_path: r.uns_path,
        properties: r.properties,
        parent_id,
      } satisfies KgEntity;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "22P02") return [];
    throw err;
  }
}

interface CacheRow {
  uns_path: string | null;
  last_value_text: string | null;
  last_value_numeric: number | null;
  last_value_bool: boolean | null;
  latest_quality: string | null;
  freshness_status: string | null;
  last_seen_at: string;
}

/**
 * Reconstruct a MiraReading from a live_signal_cache row (type inferred by column).
 *
 * NOTE — valueType is INFERRED from which last_value_* column is non-null;
 * live_signal_cache has no value_type column, so a whole-number float reads back
 * as `int`. Known limitation until a value_type column is added; wire output is
 * identical (JSON 8 === 8.0). The history path (tag_events) carries an explicit
 * value_type and is authoritative.
 */
function cacheRowToReading(row: CacheRow): MiraReading {
  if (row.last_value_bool !== null) {
    return { value: row.last_value_bool, valueType: "bool", quality: row.latest_quality ?? "uncertain",
      freshness: row.freshness_status ?? "live", timestamp: row.last_seen_at };
  }
  if (row.last_value_numeric !== null) {
    const n = row.last_value_numeric;
    return { value: n, valueType: Number.isInteger(n) ? "int" : "float", quality: row.latest_quality ?? "uncertain",
      freshness: row.freshness_status ?? "live", timestamp: row.last_seen_at };
  }
  return { value: row.last_value_text, valueType: "string", quality: row.latest_quality ?? "uncertain",
    freshness: row.freshness_status ?? "live", timestamp: row.last_seen_at };
}

/**
 * Current value for an element. Chain: elementId → kg_entities.uns_path →
 * approved_tags (enabled) → live_signal_cache. Returns null if the element is
 * unknown, its tag is not on the allowlist, or there is no cached value.
 */
export async function readingForElement(client: DbClient, elementId: string): Promise<MiraReading | null> {
  try {
    const ent = await client.query<{ uns_path: string | null }>(
      "SELECT uns_path::text AS uns_path FROM kg_entities WHERE id = $1 LIMIT 1",
      [elementId],
    );
    const unsPath = ent.rows[0]?.uns_path;
    if (!unsPath) return null;

    const allowed = await client.query<{ uns_path: string }>(
      "SELECT uns_path::text AS uns_path FROM approved_tags WHERE uns_path = $1::ltree AND enabled = true LIMIT 1",
      [unsPath],
    );
    if (allowed.rows.length === 0) return null; // fail-closed

    const cache = await client.query<CacheRow>(
      `SELECT uns_path::text AS uns_path, last_value_text, last_value_numeric, last_value_bool,
              latest_quality, freshness_status, last_seen_at
         FROM live_signal_cache WHERE uns_path = $1::ltree LIMIT 1`,
      [unsPath],
    );
    const row = cache.rows[0];
    return row ? cacheRowToReading(row) : null;
  } catch (err) {
    if ((err as { code?: string }).code === "22P02") return null;
    throw err;
  }
}

interface EventRow {
  value: string | null;
  value_type: string | null;
  quality: string | null;
  event_timestamp: string;
}

/** Bounded history window for an element (approved-tag gated). */
export async function historyForElement(
  client: DbClient,
  elementId: string,
  opts: { startTime: string | null; endTime: string | null; limit: number },
): Promise<MiraReading[]> {
  try {
    const ent = await client.query<{ uns_path: string | null }>(
      "SELECT uns_path::text AS uns_path FROM kg_entities WHERE id = $1 LIMIT 1",
      [elementId],
    );
    const unsPath = ent.rows[0]?.uns_path;
    if (!unsPath) return [];
    const allowed = await client.query(
      "SELECT 1 FROM approved_tags WHERE uns_path = $1::ltree AND enabled = true LIMIT 1",
      [unsPath],
    );
    if (allowed.rows.length === 0) return [];

    // Clamp limit: negative or NaN reaches LIMIT $4 as 0 (Postgres errors on negative).
    const safeLimit = Math.max(0, Math.trunc(opts.limit) || 0);

    const { rows } = await client.query<EventRow>(
      `SELECT value, value_type, quality, event_timestamp
         FROM tag_events
        WHERE uns_path = $1::ltree
          AND ($2::timestamptz IS NULL OR event_timestamp >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR event_timestamp <= $3::timestamptz)
        ORDER BY event_timestamp ASC
        LIMIT $4`,
      [unsPath, opts.startTime, opts.endTime, safeLimit],
    );
    return rows.map((r) => ({
      value: r.value,
      valueType: (r.value_type ?? "string") as MiraReading["valueType"],
      quality: r.quality ?? "uncertain",
      freshness: "live",
      timestamp: r.event_timestamp,
    }));
  } catch (err) {
    if ((err as { code?: string }).code === "22P02") return [];
    throw err;
  }
}

/** Returns edges touching the element, filtered to verified in app code via filterExposable. */
export async function relationshipsForElement(client: DbClient, elementId: string): Promise<KgRelationship[]> {
  const { rows } = await client.query<KgRelationship & { approval_state: string }>(
    `SELECT source_id, target_id, relationship_type, approval_state
       FROM kg_relationships
      WHERE (source_id = $1 OR target_id = $1)`,
    [elementId],
  );
  return filterExposable(rows);
}
