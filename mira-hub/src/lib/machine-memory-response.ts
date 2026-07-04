// Shared response assembly for the Machine Memory card (perf/hub-sse-live-signals):
// resolve uns_path from kg_entities, fetch persisted machine memory + live
// signals, classify freshness, derive the current state, and format tag
// values into one MachineMemoryResponse.
//
// Extracted from GET /api/assets/[id]/machine-memory (#2406 follow-up) so the
// polling GET route and the new SSE stream route
// (/api/assets/[id]/machine-memory/stream) assemble the byte-identical
// response from a single place. See docs/perf/live-latency-budget.md Tier 2.

import { fetchMachineMemory, fetchLiveSignals, type MachineMemoryClient } from "@/lib/machine-memory";
import { classifyTagFreshness, rollupFreshness, tagStatuses } from "@/lib/command-center-freshness";
import { deriveCurrentState, type WindowRow, type CurrentState } from "@/lib/machine-current-state";
import { formatTagValue } from "@/lib/gs10-display";

export type { CurrentState } from "@/lib/machine-current-state";

export interface LatestRun {
  run_id: string;
  status: "open" | "closed" | "anomalous";
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
  run_trigger_tag: string;
}

export interface LatestWindow {
  window_id: string;
  state: "idle" | "running" | "faulted" | "comm_down" | "estopped" | "unknown";
  started_at: string;
  ended_at: string | null;
}

export interface LatestDiff {
  diff_id: string;
  tag_path: string;
  severity: "info" | "warning" | "critical";
  diff_type: string | null;
  observed: number | null;
  baseline: number | null;
  delta_percent: number | null;
  event_timestamp: string | null;
  next_check: string | null;
}

export interface EvidenceWindow {
  started_at: string | null;
  stopped_at: string | null;
  uns_path: string;
}

export interface LiveTag {
  tag_path: string;
  value: string | number | boolean | null;
  /** Engineering-unit display string from gs10-display (e.g. "328.6 V"). */
  display?: string;
  numeric?: number | null;
  unit?: string | null;
  last_seen_at: string | null;
  last_changed_at?: string | null;
  freshness: "live" | "stale" | "simulated" | "unknown";
}

export interface MachineMemoryResponse {
  uns_path: string | null;
  latest_run: LatestRun | null;
  latest_window: LatestWindow | null;
  windows_available?: boolean;
  latest_diffs: LatestDiff[];
  evidence_window: EvidenceWindow | null;
  live_tags?: LiveTag[];
  current_state?: CurrentState | null;
}

/**
 * Build the full Machine Memory response for one asset (tenant + id).
 *
 * `client` is expected to be a tenant-scoped query client (the
 * `withTenantContext` callback client, or anything structurally compatible
 * with `MachineMemoryClient`). Read-only; empty state (no uns_path / no
 * machine_run/window/diff rows) is first-class, not an error.
 */
export async function buildMachineMemoryResponse(
  client: MachineMemoryClient,
  tenantId: string,
  id: string,
): Promise<MachineMemoryResponse> {
  // Resolve uns_path from kg_entities — the same bridge context/route.ts
  // uses. Do NOT join machine_run/run_diff to cmms_equipment directly:
  // cmms_equipment.tenant_id is TEXT, kg_entities/machine_run tenant_id is
  // UUID (uuid = text errors). This is a separate lookup, not a join.
  const unsPath = await client
    .query(
      `SELECT uns_path::text AS uns_path
         FROM kg_entities
        WHERE tenant_id = $1
          AND entity_type = 'equipment'
          AND (id::text = $2 OR entity_id = $2)
        LIMIT 1`,
      [tenantId, id],
    )
    .then((r) => (r.rows[0]?.uns_path as string | undefined) ?? null);

  if (!unsPath) {
    return {
      uns_path: null,
      latest_run: null,
      latest_window: null,
      latest_diffs: [],
      evidence_window: null,
      live_tags: [],
      current_state: null,
    };
  }

  const memory = await fetchMachineMemory(client, tenantId, unsPath);

  // Per-tag live signals + the freshness-aware CURRENT state. The newest
  // window may be closed/stale — deriveCurrentState downgrades to
  // comm_down/unknown when the signal stream dried up.
  const signals = await fetchLiveSignals(client, tenantId, unsPath);
  const nowMs = Date.now();
  const liveTags: LiveTag[] = signals.map((s) => {
    const raw = s.last_value_text ?? s.last_value_numeric ?? s.last_value_bool ?? null;
    const formatted = formatTagValue(s.plc_tag, raw);
    return {
      tag_path: s.plc_tag,
      value: raw,
      display: formatted.display,
      numeric: formatted.numeric,
      unit: formatted.unit,
      last_seen_at: s.last_seen_at,
      last_changed_at: s.last_changed_at,
      freshness: classifyTagFreshness(s, nowMs),
    };
  });
  const freshness = rollupFreshness(unsPath, tagStatuses(signals, nowMs));
  const currentState = deriveCurrentState(memory.latest_window as WindowRow | null, freshness);

  const evidenceWindow: EvidenceWindow | null = memory.latest_run
    ? {
        started_at: memory.latest_run.started_at as string | null,
        stopped_at: memory.latest_run.stopped_at as string | null,
        uns_path: unsPath,
      }
    : memory.latest_window
      ? {
          started_at: memory.latest_window.started_at as string | null,
          stopped_at: memory.latest_window.ended_at as string | null,
          uns_path: unsPath,
        }
      : null;

  return {
    uns_path: unsPath,
    latest_run: memory.latest_run as unknown as LatestRun | null,
    latest_window: memory.latest_window as unknown as LatestWindow | null,
    windows_available: memory.windows_available,
    latest_diffs: memory.latest_diffs as unknown as LatestDiff[],
    evidence_window: evidenceWindow,
    live_tags: liveTags,
    current_state: currentState,
  };
}
