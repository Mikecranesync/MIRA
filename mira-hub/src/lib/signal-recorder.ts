/**
 * Signal recorder — single write path for `live_signal_events` + `live_signal_cache`.
 *
 * `recordSignalValue` is the only function that should INSERT into
 * live_signal_events. It also UPSERTs live_signal_cache with the latest
 * value and detects edges (boolean transitions, numeric change, text change)
 * so the cache row always carries `last_changed_at` and the previous value.
 *
 * Trend-session auto-capture is deliberately NOT wired here — keeping
 * recorder and trends decoupled means the recorder can't break the trend
 * read path or vice versa. `diagnostic_trend_signals` is populated by a
 * JOIN at read time (live_signal_events filtered by trend.watched_topics
 * and trend window) or by an explicit append endpoint.
 *
 * Spec: docs/plans/2026-05-14-demo-backend-plan.md (Phase 4 of the
 * 2026-05-15 PR).
 */

import type { PoolClient } from "pg";

export type SignalValue = {
  text?: string | null;
  numeric?: number | null;
  bool?: boolean | null;
};

export interface RecordOptions {
  tenantId: string;
  plcTag?: string | null;       // either plcTag OR componentId required
  componentId?: string | null;
  value: SignalValue;
  source?: string;              // default "demo_simulator"
  simulated?: boolean;          // default true
  properties?: Record<string, unknown>;
}

export interface RecordResult {
  eventId: string;
  plcTag: string | null;
  componentId: string | null;
  edge: "rising" | "falling" | "changed" | "steady";
  lastChangedAt: string;        // ISO string from cache
  previousValue: SignalValue | null;
}

function pickValueFlavor(v: SignalValue): "bool" | "numeric" | "text" | null {
  if (v.bool !== undefined && v.bool !== null) return "bool";
  if (v.numeric !== undefined && v.numeric !== null) return "numeric";
  if (v.text !== undefined && v.text !== null) return "text";
  return null;
}

function valuesEqual(a: SignalValue, b: SignalValue): boolean {
  // Compare on whichever flavor the new value declared; the cache row may
  // have multiple columns populated from prior writes, but only one is the
  // authoritative reading for this signal's type.
  if (a.bool !== undefined && a.bool !== null) return a.bool === b.bool;
  if (a.numeric !== undefined && a.numeric !== null) return a.numeric === b.numeric;
  if (a.text !== undefined && a.text !== null) return a.text === b.text;
  return false;
}

/**
 * Write one signal sample. Returns the event id, the resolved subject,
 * and the detected edge classification:
 *   - "rising"   : boolean transition false → true
 *   - "falling"  : boolean transition true → false
 *   - "changed"  : numeric or text value differs from previous
 *   - "steady"   : value matches previous (no edge)
 *
 * The caller is the API endpoint layer (toggle / set). RLS is enforced by
 * the surrounding `withTenantContext` transaction.
 */
export async function recordSignalValue(
  client: PoolClient,
  opts: RecordOptions,
): Promise<RecordResult> {
  const { tenantId, value } = opts;
  let { plcTag, componentId } = opts;

  if (!plcTag && !componentId) {
    throw Object.assign(new Error("plcTag_or_componentId_required"), { status: 400 });
  }
  const flavor = pickValueFlavor(value);
  if (!flavor) {
    throw Object.assign(new Error("no_value_supplied"), { status: 400 });
  }

  // Resolve plcTag from componentId (or vice versa) when the caller only
  // supplied one. The cache is keyed on plcTag; component_id is denormalized.
  if (componentId && !plcTag) {
    const r = await client.query<{ plc_tag: string | null }>(
      `SELECT plc_tag FROM installed_component_instances
        WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, componentId],
    );
    plcTag = r.rows[0]?.plc_tag ?? null;
    if (!plcTag) {
      throw Object.assign(new Error("component_has_no_plc_tag"), { status: 400 });
    }
  } else if (plcTag && !componentId) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM installed_component_instances
        WHERE tenant_id = $1 AND plc_tag = $2 LIMIT 1`,
      [tenantId, plcTag],
    );
    componentId = r.rows[0]?.id ?? null;
  }

  const simulated = opts.simulated ?? true;
  const source = opts.source ?? "demo_simulator";
  const properties = opts.properties ?? {};

  // 1. Insert the immutable event.
  const eventRow = await client
    .query<{ id: string }>(
      `INSERT INTO live_signal_events
         (tenant_id, component_id, plc_tag, value_text, value_numeric, value_bool,
          simulated, source, properties)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id`,
      [
        tenantId,
        componentId,
        plcTag,
        value.text ?? null,
        value.numeric ?? null,
        value.bool ?? null,
        simulated,
        source,
        JSON.stringify(properties),
      ],
    )
    .then((r: { rows: Array<{ id: string }> }) => r.rows[0]);

  // 2. Read the existing cache row to compute edge + previous value.
  type CacheRow = {
    last_value_text: string | null;
    last_value_numeric: number | null;
    last_value_bool: boolean | null;
  };
  const prevRow: CacheRow | null = plcTag
    ? await client
        .query<CacheRow>(
          `SELECT last_value_text, last_value_numeric, last_value_bool
             FROM live_signal_cache
            WHERE tenant_id = $1 AND plc_tag = $2 LIMIT 1`,
          [tenantId, plcTag],
        )
        .then((r: { rows: CacheRow[] }) => r.rows[0] ?? null)
    : null;

  let edge: RecordResult["edge"];
  let previousValue: SignalValue | null = null;
  if (prevRow === null) {
    edge = "changed"; // first sample for this topic — treat as a change so
                     // last_changed_at gets stamped to now.
  } else {
    const prev: SignalValue = {
      text: prevRow.last_value_text,
      numeric: prevRow.last_value_numeric,
      bool: prevRow.last_value_bool,
    };
    previousValue = prev;
    if (valuesEqual(value, prev)) {
      edge = "steady";
    } else if (flavor === "bool") {
      edge = value.bool === true ? "rising" : "falling";
    } else {
      edge = "changed";
    }
  }

  // 3. UPSERT the cache. last_changed_at and prev_value_* only update on a
  // real change; steady samples bump last_seen_at + properties only.
  const upserted = await client
    .query<{ last_changed_at: string }>(
      edge === "steady"
        ? `INSERT INTO live_signal_cache
             (tenant_id, plc_tag, component_id,
              last_value_text, last_value_numeric, last_value_bool,
              simulated, source, properties)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (tenant_id, plc_tag) DO UPDATE SET
             -- COALESCE so a write that arrives before the component
             -- binding resolves doesn't null a previously-known component_id.
             component_id = COALESCE(EXCLUDED.component_id, live_signal_cache.component_id),
             last_seen_at = now(),
             simulated = EXCLUDED.simulated,
             source = EXCLUDED.source,
             properties = EXCLUDED.properties,
             updated_at = now()
           RETURNING last_changed_at::text AS last_changed_at`
        : `INSERT INTO live_signal_cache
             (tenant_id, plc_tag, component_id,
              last_value_text, last_value_numeric, last_value_bool,
              prev_value_text, prev_value_numeric, prev_value_bool,
              simulated, source, properties,
              last_seen_at, last_changed_at)
           VALUES ($1, $2, $3, $4, $5, $6,
                   $10, $11, $12,
                   $7, $8, $9::jsonb,
                   now(), now())
           ON CONFLICT (tenant_id, plc_tag) DO UPDATE SET
             -- COALESCE so a write that arrives before the component
             -- binding resolves doesn't null a previously-known component_id.
             component_id = COALESCE(EXCLUDED.component_id, live_signal_cache.component_id),
             prev_value_text = live_signal_cache.last_value_text,
             prev_value_numeric = live_signal_cache.last_value_numeric,
             prev_value_bool = live_signal_cache.last_value_bool,
             last_value_text = EXCLUDED.last_value_text,
             last_value_numeric = EXCLUDED.last_value_numeric,
             last_value_bool = EXCLUDED.last_value_bool,
             simulated = EXCLUDED.simulated,
             source = EXCLUDED.source,
             properties = EXCLUDED.properties,
             last_seen_at = now(),
             last_changed_at = now(),
             updated_at = now()
           RETURNING last_changed_at::text AS last_changed_at`,
      edge === "steady"
        ? [
            tenantId,
            plcTag,
            componentId,
            value.text ?? null,
            value.numeric ?? null,
            value.bool ?? null,
            simulated,
            source,
            JSON.stringify(properties),
          ]
        : [
            tenantId,
            plcTag,
            componentId,
            value.text ?? null,
            value.numeric ?? null,
            value.bool ?? null,
            simulated,
            source,
            JSON.stringify(properties),
            previousValue?.text ?? null,
            previousValue?.numeric ?? null,
            previousValue?.bool ?? null,
          ],
    )
    .then((r: { rows: Array<{ last_changed_at: string }> }) => r.rows[0]);

  return {
    eventId: eventRow.id,
    plcTag: plcTag ?? null,
    componentId: componentId ?? null,
    edge,
    lastChangedAt: upserted.last_changed_at,
    previousValue,
  };
}

/**
 * Count value transitions for a topic over a recent window. A "transition"
 * is a row whose value differs from the immediately-prior row for the same
 * topic (the rising and falling edges of a boolean, or any change in a
 * numeric/text signal).
 *
 * Used to answer "how many times did I flag PE-001 in the last minute?".
 *
 * Returns the count and the window bounds. Uses a LAG window function so
 * we don't need to maintain a transition counter column.
 */
export async function countTransitions(
  client: PoolClient,
  opts: {
    tenantId: string;
    plcTag?: string | null;
    componentId?: string | null;
    sourceSystem?: string | null;
    windowSeconds: number;
  },
): Promise<{
  transitions: number;
  windowSeconds: number;
  windowStart: string;
  windowEnd: string;
  topic: string | null;
}> {
  const { tenantId, windowSeconds } = opts;
  let topicFilter: { sql: string; param: string } | null = null;
  if (opts.plcTag) {
    topicFilter = { sql: "plc_tag = $2", param: opts.plcTag };
  } else if (opts.componentId) {
    topicFilter = { sql: "component_id = $2", param: opts.componentId };
  }
  if (!topicFilter) {
    throw Object.assign(new Error("plcTag_or_componentId_required"), { status: 400 });
  }
  const sourceFilterSql = opts.sourceSystem
    ? "AND (CASE WHEN source IN ('demo_simulator', 'simulator') THEN 'simulator' ELSE source END) = $4"
    : "";
  const params = opts.sourceSystem
    ? [tenantId, topicFilter.param, String(windowSeconds), opts.sourceSystem]
    : [tenantId, topicFilter.param, String(windowSeconds)];

  const { rows } = await client.query<{
    transitions: string;
    window_start: string;
    window_end: string;
  }>(
    `WITH window_events AS (
       SELECT
         created_at,
         value_text,
         value_numeric,
         value_bool,
         LAG(value_text)    OVER (ORDER BY created_at) AS prev_text,
         LAG(value_numeric) OVER (ORDER BY created_at) AS prev_numeric,
         LAG(value_bool)    OVER (ORDER BY created_at) AS prev_bool
       FROM live_signal_events
       WHERE tenant_id = $1
         AND ${topicFilter.sql}
         ${sourceFilterSql}
         AND created_at > now() - ($3::text || ' seconds')::interval
     )
     SELECT
       count(*) FILTER (
         WHERE prev_text    IS DISTINCT FROM value_text
            OR prev_numeric IS DISTINCT FROM value_numeric
            OR prev_bool    IS DISTINCT FROM value_bool
       )::text AS transitions,
       (now() - ($3::text || ' seconds')::interval)::text AS window_start,
       (now())::text AS window_end
       FROM window_events`,
    params,
  );

  const row = rows[0] ?? { transitions: "0", window_start: "", window_end: "" };
  return {
    transitions: Number(row.transitions ?? "0"),
    windowSeconds,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    topic: opts.plcTag ?? opts.componentId ?? null,
  };
}
