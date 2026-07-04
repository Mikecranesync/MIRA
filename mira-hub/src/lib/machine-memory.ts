// Shared read helper for persisted machine memory (master-plan T2 / seam 3):
// the latest machine run (038 machine_run), the latest state window (040
// machine_state_window), and the latest typed-anomaly diffs (run_diff with 040
// columns, 038 fallback) for one tenant + uns_path. Read-only.
//
// Extracted from GET /api/assets/[id]/machine-memory (#2406) so the asset
// context route and the asset chat route can ground on the same queries.
// Callers resolve uns_path themselves (kg_entities bridge) — this helper only
// runs the machine-memory queries.

// Postgres error codes for "relation does not exist" / "column does not
// exist" — the only cases that legitimately mean "040 not applied in this
// env yet". Any other error (permission, syntax, connection, etc.) must
// rethrow and hit the caller's outer error handler, not be swallowed as a
// silent empty/fallback state.
const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";

export function isUndefinedRelationOrColumn(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === UNDEFINED_TABLE || code === UNDEFINED_COLUMN;
}

/** Minimal pg-client shape shared by the tenant-context client and pool clients. */
export interface MachineMemoryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface MachineMemoryDiff extends Record<string, unknown> {
  next_check: string | null;
}

export interface MachineMemory {
  latest_run: Record<string, unknown> | null;
  latest_window: Record<string, unknown> | null;
  latest_diffs: MachineMemoryDiff[];
  windows_available: boolean;
}

/**
 * Fetch the machine-memory rows for one asset (tenant + uns_path).
 *
 * - `latest_run`: newest machine_run row, or null (038 missing rethrows —
 *   callers that must tolerate an 038-less env catch via
 *   `isUndefinedRelationOrColumn`).
 * - `latest_window` / `windows_available`: newest machine_state_window row;
 *   040-not-applied is tolerated (null + windows_available=false).
 * - `latest_diffs`: newest ≤5 run_diff rows, each with `next_check` surfaced
 *   from metadata; 040 columns missing falls back to the 038 column set.
 */
export async function fetchMachineMemory(
  client: MachineMemoryClient,
  tenantId: string,
  unsPath: string,
): Promise<MachineMemory> {
  const latestRun = await client
    .query(
      `SELECT run_id, status, started_at, stopped_at, duration_seconds, run_trigger_tag
         FROM machine_run
        WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
        ORDER BY started_at DESC
        LIMIT 1`,
      [tenantId, unsPath],
    )
    .then((r) => r.rows[0] ?? null);

  // machine_state_window is 040 — may not exist yet in every env.
  let latestWindow: Record<string, unknown> | null = null;
  let windowsAvailable = true;
  try {
    latestWindow = await client
      .query(
        `SELECT window_id, state, started_at, ended_at
           FROM machine_state_window
          WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
          ORDER BY started_at DESC
          LIMIT 1`,
        [tenantId, unsPath],
      )
      .then((r) => r.rows[0] ?? null);
  } catch (err) {
    if (!isUndefinedRelationOrColumn(err)) throw err;
    console.error("[lib/machine-memory] machine_state_window unavailable (040 not applied?)", err);
    windowsAvailable = false;
  }

  // run_diff 040 columns (window_id, from_event_id, to_event_id) may not
  // exist yet either. Fall back to the 038-only column set.
  let latestDiffs: Array<Record<string, unknown>> = [];
  try {
    latestDiffs = await client
      .query(
        `SELECT diff_id, run_id, window_id, tag_path, severity, diff_type,
                observed, baseline, delta_percent, from_event_id, to_event_id,
                event_timestamp, metadata
           FROM run_diff
          WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
          ORDER BY event_timestamp DESC NULLS LAST
          LIMIT 5`,
        [tenantId, unsPath],
      )
      .then((r) => r.rows);
  } catch (err) {
    if (!isUndefinedRelationOrColumn(err)) throw err;
    console.error("[lib/machine-memory] run_diff 040 columns unavailable, falling back to 038 columns", err);
    latestDiffs = await client
      .query(
        `SELECT diff_id, run_id, tag_path, severity,
                observed, baseline, delta_percent, event_timestamp, metadata
           FROM run_diff
          WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
          ORDER BY event_timestamp DESC NULLS LAST
          LIMIT 5`,
        [tenantId, unsPath],
      )
      .then((r) => r.rows);
  }

  return {
    latest_run: latestRun,
    latest_window: latestWindow,
    windows_available: windowsAvailable,
    latest_diffs: latestDiffs.map((d) => ({
      ...d,
      next_check: (d.metadata as { next_check?: string } | null)?.next_check ?? null,
    })),
  };
}

/** A live_signal_cache row for one asset subtree (migrations 020 + 036). */
export interface LiveSignalRow {
  plc_tag: string;
  last_value_text: string | null;
  last_value_numeric: number | string | null; // pg numeric arrives as string
  last_value_bool: boolean | null;
  last_seen_at: string | null;
  last_changed_at: string | null;
  simulated: boolean | null;
  expected_freshness_seconds: number | null;
  uns_path: string | null;
}

/**
 * Latest cached value per tag under one asset's UNS subtree — the per-tag
 * companion to fetchMachineMemory for live-signal display. Kept separate so
 * the context/chat callers of fetchMachineMemory don't pay for it.
 * live_signal_cache (020) / its uns_path column (036) may not be applied in
 * every env — degrade to [] like the machine_state_window block above.
 */
export async function fetchLiveSignals(
  client: MachineMemoryClient,
  tenantId: string,
  unsPath: string,
): Promise<LiveSignalRow[]> {
  try {
    const res = await client.query(
      `SELECT plc_tag, last_value_text, last_value_numeric, last_value_bool,
              last_seen_at, last_changed_at, simulated, expected_freshness_seconds,
              uns_path::text AS uns_path
         FROM live_signal_cache
        WHERE tenant_id = $1::uuid
          AND uns_path IS NOT NULL
          AND uns_path <@ $2::ltree
        ORDER BY plc_tag`,
      [tenantId, unsPath],
    );
    return res.rows as unknown as LiveSignalRow[];
  } catch (err) {
    if (!isUndefinedRelationOrColumn(err)) throw err;
    console.error("[lib/machine-memory] live_signal_cache unavailable (020/036 not applied?)", err);
    return [];
  }
}
