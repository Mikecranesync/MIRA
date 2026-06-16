/**
 * Plan-vs-actual comparison (Phase 4 of KG multi-hop spec, #806).
 *
 * For every equipment that has both PM tasks (the plan) and recorded
 * had_fault occurrences (the actual), compute MTBF over the lookback window
 * and flag mismatches where reality is faster than the planned cadence.
 *
 * Mismatch rule: MTBF * 1.5 < pm_interval_days
 *   — i.e. real failures happen ≥50% faster than the PM cycle.
 *
 * Noise filter: require ≥3 fault occurrences before flagging (otherwise the
 * MTBF estimate is too noisy to be actionable).
 */

import pool from "@/lib/db";
import type { PoolClient } from "pg";

export interface PmMismatch {
  equipmentId: string;            // kg entity_id, e.g. "VFD-07"
  equipmentName: string;
  faultCode: string;              // entity_id of the fault, e.g. "F004"
  occurrences: number;            // count in the lookback window
  mtbfDays: number;               // mean time between failures
  pmTask: string;                 // name of the conflicting PM task
  pmIntervalDays: number;
  severity: "advisory" | "warning";
}

const MIN_OCCURRENCES = 3;
const DEFAULT_LOOKBACK_DAYS = 365;
const WARN_RATIO = 2.0;            // MTBF * 2 < interval → warning (vs advisory)

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

export interface FlagPmMismatchesOpts {
  lookbackDays?: number;
  /** Limit to a single equipment entity_id. */
  equipmentEntityId?: string;
}

interface RawMismatchRow {
  equipment_id: string;
  equipment_name: string;
  fault_code: string;
  occurrences: string;
  mtbf_days: string | null;
  pm_task: string;
  pm_interval_days: string | null;
}

/**
 * Mismatch classification. Pulled out so the test suite can verify the rules
 * without going to the database.
 */
export function classifyMismatch(
  occurrences: number,
  mtbfDays: number | null,
  pmIntervalDays: number | null,
): PmMismatch["severity"] | null {
  if (occurrences < MIN_OCCURRENCES) return null;
  if (mtbfDays == null || pmIntervalDays == null) return null;
  if (mtbfDays <= 0 || pmIntervalDays <= 0) return null;
  if (mtbfDays * WARN_RATIO < pmIntervalDays) return "warning";
  if (mtbfDays * 1.5 < pmIntervalDays) return "advisory";
  return null;
}

export async function flagPmMismatches(
  tenantId: string,
  opts: FlagPmMismatchesOpts = {},
): Promise<PmMismatch[]> {
  const lookback = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;

  return withKgContext(tenantId, async (client) => {
    // Per (equipment, fault_code) compute occurrences + MTBF in days.
    // Cross-join with the equipment's PM tasks to expose any conflicting
    // intervals; classification happens in TS so it stays testable.
    const { rows } = await client.query<RawMismatchRow>(
      `WITH faults AS (
         SELECT
           eq.id        AS equipment_uuid,
           eq.entity_id AS equipment_id,
           eq.name      AS equipment_name,
           f.entity_id  AS fault_code,
           COUNT(*)     AS occurrences,
           CASE WHEN COUNT(*) >= 2
                THEN EXTRACT(EPOCH FROM (
                  MAX(COALESCE((r.properties->>'occurred_at')::timestamptz, r.created_at))
                  - MIN(COALESCE((r.properties->>'occurred_at')::timestamptz, r.created_at))
                )) / 86400.0 / NULLIF(COUNT(*) - 1, 0)
                ELSE NULL
           END AS mtbf_days
         FROM kg_relationships r
         JOIN kg_entities eq ON eq.id = r.source_id AND eq.tenant_id = r.tenant_id
         JOIN kg_entities f  ON f.id  = r.target_id AND f.tenant_id  = r.tenant_id
         WHERE r.tenant_id = $1
           AND r.relationship_type = 'had_fault'
           AND eq.entity_type = 'equipment'
           AND f.entity_type  = 'fault_code'
           AND COALESCE((r.properties->>'occurred_at')::timestamptz, r.created_at)
               > now() - ($2 || ' days')::interval
           ${opts.equipmentEntityId ? "AND eq.entity_id = $3" : ""}
         GROUP BY eq.id, eq.entity_id, eq.name, f.entity_id
       ),
       pm AS (
         SELECT
           r.source_id AS equipment_uuid,
           p.name      AS pm_task,
           NULLIF(p.properties->>'interval_days','')::int AS pm_interval_days
         FROM kg_relationships r
         JOIN kg_entities p ON p.id = r.target_id AND p.tenant_id = r.tenant_id
         WHERE r.tenant_id = $1
           AND r.relationship_type = 'has_pm'
           AND p.entity_type = 'pm_task'
       )
       SELECT
         f.equipment_id,
         f.equipment_name,
         f.fault_code,
         f.occurrences::text,
         f.mtbf_days::text,
         pm.pm_task,
         pm.pm_interval_days::text
       FROM faults f
       JOIN pm ON pm.equipment_uuid = f.equipment_uuid
       WHERE f.occurrences >= $${opts.equipmentEntityId ? "4" : "3"}`,
      opts.equipmentEntityId
        ? [tenantId, lookback, opts.equipmentEntityId, MIN_OCCURRENCES]
        : [tenantId, lookback, MIN_OCCURRENCES],
    );

    const out: PmMismatch[] = [];
    for (const r of rows) {
      const occurrences = parseInt(r.occurrences, 10);
      const mtbf = r.mtbf_days != null ? parseFloat(r.mtbf_days) : null;
      const interval = r.pm_interval_days != null ? parseInt(r.pm_interval_days, 10) : null;
      const severity = classifyMismatch(occurrences, mtbf, interval);
      if (!severity) continue;
      out.push({
        equipmentId: r.equipment_id,
        equipmentName: r.equipment_name,
        faultCode: r.fault_code,
        occurrences,
        mtbfDays: mtbf!,
        pmTask: r.pm_task,
        pmIntervalDays: interval!,
        severity,
      });
    }
    return out;
  });
}

export function formatPmMismatchLine(m: PmMismatch): string {
  const tag = m.severity === "warning" ? "WARNING" : "ADVISORY";
  return (
    `${tag}: ${m.faultCode} on ${m.equipmentId} every ~${m.mtbfDays.toFixed(0)}d ` +
    `(${m.occurrences} occurrences) but PM "${m.pmTask}" runs every ${m.pmIntervalDays}d ` +
    `→ interval too long`
  );
}
