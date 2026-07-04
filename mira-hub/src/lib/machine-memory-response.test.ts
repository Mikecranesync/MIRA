import { describe, expect, it } from "vitest";

import { buildMachineMemoryResponse } from "./machine-memory-response";
import type { MachineMemoryClient } from "./machine-memory";

/**
 * Minimal fake query client — routes on a distinctive substring of the SQL
 * text (kg_entities uns_path lookup, machine_run, machine_state_window,
 * run_diff, live_signal_cache), mirroring the real query shapes in
 * machine-memory.ts / machine-memory-response.ts without a real DB.
 */
function makeClient(overrides: {
  unsPath?: string | null;
  latestRun?: Record<string, unknown> | null;
  latestWindow?: Record<string, unknown> | null;
  diffs?: Record<string, unknown>[];
  signals?: Record<string, unknown>[];
}): MachineMemoryClient {
  const {
    unsPath = "enterprise.garage.demo_cell.cv_101",
    latestRun = null,
    latestWindow = null,
    diffs = [],
    signals = [],
  } = overrides;

  return {
    query: async (sql: string) => {
      if (sql.includes("FROM kg_entities")) {
        return { rows: unsPath ? [{ uns_path: unsPath }] : [] };
      }
      if (sql.includes("FROM machine_run")) {
        return { rows: latestRun ? [latestRun] : [] };
      }
      if (sql.includes("FROM machine_state_window")) {
        return { rows: latestWindow ? [latestWindow] : [] };
      }
      if (sql.includes("FROM run_diff")) {
        return { rows: diffs };
      }
      if (sql.includes("FROM live_signal_cache")) {
        return { rows: signals };
      }
      throw new Error(`makeClient: unexpected query: ${sql}`);
    },
  };
}

describe("buildMachineMemoryResponse", () => {
  it("returns the empty-state shape when the asset has no resolvable uns_path", async () => {
    const client = makeClient({ unsPath: null });
    const result = await buildMachineMemoryResponse(client, "tenant-1", "asset-1");
    expect(result).toEqual({
      uns_path: null,
      latest_run: null,
      latest_window: null,
      latest_diffs: [],
      evidence_window: null,
      live_tags: [],
      current_state: null,
    });
  });

  it("returns the empty state when uns_path resolves but no machine_run/window/diff rows exist yet", async () => {
    const client = makeClient({});
    const result = await buildMachineMemoryResponse(client, "tenant-1", "asset-1");
    expect(result.uns_path).toBe("enterprise.garage.demo_cell.cv_101");
    expect(result.latest_run).toBeNull();
    expect(result.latest_window).toBeNull();
    expect(result.latest_diffs).toEqual([]);
    expect(result.live_tags).toEqual([]);
    // No window + no signals at all -> deriveCurrentState returns null (see
    // machine-current-state.ts: no windows yet + unknown freshness).
    expect(result.current_state).toBeNull();
  });

  it("assembles run + window + diffs + live_tags + current_state for a populated asset", async () => {
    const now = new Date();
    const client = makeClient({
      latestRun: {
        run_id: "r1",
        status: "closed",
        started_at: "2026-07-01T00:00:00Z",
        stopped_at: "2026-07-01T01:00:00Z",
        duration_seconds: 3600,
        run_trigger_tag: "cv101.run",
      },
      latestWindow: {
        window_id: "w1",
        state: "running",
        started_at: "2026-07-01T01:00:00Z",
        ended_at: null,
      },
      diffs: [
        {
          diff_id: "d1",
          run_id: "r1",
          window_id: "w1",
          tag_path: "cv101.motor_current",
          severity: "warning",
          diff_type: "anomaly_A1",
          observed: 5.2,
          baseline: 4.0,
          delta_percent: 30,
          from_event_id: null,
          to_event_id: null,
          event_timestamp: "2026-07-01T00:30:00Z",
          metadata: { next_check: "verify VFD comm cable" },
        },
      ],
      signals: [
        {
          plc_tag: "[default]MIRA_IOCheck/VFD/vfd_dc_bus",
          last_value_text: null,
          last_value_numeric: "3286",
          last_value_bool: null,
          last_seen_at: now.toISOString(),
          last_changed_at: now.toISOString(),
          simulated: false,
          expected_freshness_seconds: 60,
          uns_path: "enterprise.garage.demo_cell.cv_101",
        },
      ],
    });

    const result = await buildMachineMemoryResponse(client, "tenant-1", "asset-1");

    expect(result.uns_path).toBe("enterprise.garage.demo_cell.cv_101");
    expect(result.latest_run?.run_id).toBe("r1");
    expect(result.latest_window?.state).toBe("running");
    expect(result.latest_diffs).toHaveLength(1);
    expect(result.latest_diffs[0].next_check).toBe("verify VFD comm cable");
    expect(result.live_tags).toHaveLength(1);
    expect(result.live_tags?.[0].display).toBe("328.6 V");
    expect(result.live_tags?.[0].freshness).toBe("live");
    // Window is open (ended_at null) -> current_state mirrors it, fresh
    // because a live tag backs the asset's subtree right now.
    expect(result.current_state).toEqual({
      state: "running",
      since: "2026-07-01T01:00:00Z",
      fresh: true,
    });
    expect(result.evidence_window).toEqual({
      started_at: "2026-07-01T00:00:00Z",
      stopped_at: "2026-07-01T01:00:00Z",
      uns_path: "enterprise.garage.demo_cell.cv_101",
    });
  });

  it("downgrades current_state to comm_down when the window is closed and signals are stale", async () => {
    const stale = new Date(Date.now() - 10 * 60_000); // 10 min ago, past the 60s window
    const client = makeClient({
      latestWindow: {
        window_id: "w1",
        state: "idle",
        started_at: "2026-07-01T00:00:00Z",
        ended_at: "2026-07-01T00:30:00Z",
      },
      signals: [
        {
          plc_tag: "[default]MIRA_IOCheck/VFD/vfd_dc_bus",
          last_value_text: null,
          last_value_numeric: "3200",
          last_value_bool: null,
          last_seen_at: stale.toISOString(),
          last_changed_at: stale.toISOString(),
          simulated: false,
          expected_freshness_seconds: 60,
          uns_path: "enterprise.garage.demo_cell.cv_101",
        },
      ],
    });

    const result = await buildMachineMemoryResponse(client, "tenant-1", "asset-1");
    expect(result.live_tags?.[0].freshness).toBe("stale");
    expect(result.current_state).toEqual({ state: "comm_down", since: null, fresh: false });
  });
});
