import { describe, expect, it } from "vitest";

import { buildMachineContextPacket, renderMachineEvidenceSection } from "./machine-context-packet";
import type { MachineMemoryClient } from "./machine-memory";

const UNS = "enterprise.garage.demo_cell.cv_101";
const NOW = new Date("2026-07-04T12:00:00Z").getTime();

/** Records every SQL string so tests can assert the path is read-only. */
interface RecordingClient extends MachineMemoryClient {
  sql: string[];
}

function makeClient(overrides: {
  unsPath?: string | null;
  latestWindow?: Record<string, unknown> | null;
  diffs?: Record<string, unknown>[];
  signals?: Record<string, unknown>[];
}): RecordingClient {
  const { unsPath = UNS, latestWindow = null, diffs = [], signals = [] } = overrides;
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text);
      if (text.includes("FROM kg_entities")) return { rows: unsPath ? [{ uns_path: unsPath }] : [] };
      if (text.includes("FROM machine_run")) return { rows: [] };
      if (text.includes("FROM machine_state_window")) return { rows: latestWindow ? [latestWindow] : [] };
      if (text.includes("FROM run_diff")) return { rows: diffs };
      if (text.includes("FROM live_signal_cache")) return { rows: signals };
      throw new Error(`makeClient: unexpected query: ${text}`);
    },
  };
}

function sig(leafTag: string, numeric: string, seenMsAgo = 0): Record<string, unknown> {
  return {
    plc_tag: `[default]MIRA_IOCheck/VFD/${leafTag}`,
    last_value_text: null,
    last_value_numeric: numeric,
    last_value_bool: null,
    last_seen_at: new Date(NOW - seenMsAgo).toISOString(),
    last_changed_at: new Date(NOW - seenMsAgo).toISOString(),
    simulated: false,
    expected_freshness_seconds: 60,
    uns_path: UNS,
  };
}

/** Healthy VFD, machine idle: fault 0, status word with comms bit, DC bus present, 0 Hz. */
function healthyStoppedClient(): RecordingClient {
  return makeClient({
    latestWindow: { window_id: "w1", state: "idle", started_at: "2026-07-04T11:00:00Z", ended_at: null },
    diffs: [],
    signals: [
      sig("vfd_fault_code", "0"),
      sig("vfd_status_word", "1024"), // bit10 = comms present
      sig("vfd_dc_bus", "3286"), // ÷10 = 328.6 V
      sig("vfd_frequency", "0"),
      sig("vfd_cmd_word", "1"), // STOP
    ],
  });
}

describe("buildMachineContextPacket", () => {
  it("builds the packet from live tag values, decoding known tags to meaning", async () => {
    const client = healthyStoppedClient();
    const packet = await buildMachineContextPacket(client, "tenant-1", "asset-1", NOW);

    expect(packet.asset_id).toBe("asset-1");
    expect(packet.uns_path).toBe(UNS);
    expect(packet.has_live_data).toBe(true);
    expect(packet.live_tags).toHaveLength(5);

    // Known tags mapped to meaning (gs10-display decode reaches the packet).
    const byLeaf = Object.fromEntries(
      packet.live_tags.map((t) => [t.tag_path.split("/").pop(), t.display]),
    );
    expect(byLeaf["vfd_fault_code"]).toBe("OK");
    expect(byLeaf["vfd_dc_bus"]).toBe("328.6 V");
    expect(byLeaf["vfd_cmd_word"]).toBe("STOP");
    expect(byLeaf["vfd_frequency"]).toBe("0 Hz");
  });

  it("derives machine_state and the VFD-healthy-but-stopped summary", async () => {
    const client = healthyStoppedClient();
    const packet = await buildMachineContextPacket(client, "tenant-1", "asset-1", NOW);

    expect(packet.machine_state?.state).toBe("idle");
    expect(packet.machine_state?.fresh).toBe(true);
    expect(packet.active_conditions).toEqual([]);
    expect(packet.freshness.overall).toBe("live");
    expect(packet.freshness.live).toBe(5);

    expect(packet.summary).toMatch(/idle/);
    expect(packet.summary).toMatch(/healthy/i);
    expect(packet.summary).toMatch(/command\/permissive\/interlock/i);
    expect(packet.summary).not.toMatch(/replace the (drive|vfd)/i);
  });

  it("flags stale tags", async () => {
    const client = makeClient({
      latestWindow: { window_id: "w1", state: "idle", started_at: "2026-07-04T11:00:00Z", ended_at: "2026-07-04T11:30:00Z" },
      signals: [sig("vfd_dc_bus", "3200", 10 * 60_000)], // seen 10 min ago, past the 60s window
    });
    const packet = await buildMachineContextPacket(client, "tenant-1", "asset-1", NOW);
    expect(packet.live_tags[0].freshness).toBe("stale");
    expect(packet.freshness.overall).toBe("stale");
    // closed window + stale signals -> comm_down
    expect(packet.machine_state?.state).toBe("comm_down");
    expect(packet.summary).toMatch(/stale/i);
  });

  it("normalizes persisted anomalies into active_conditions with next_check", async () => {
    const client = makeClient({
      latestWindow: { window_id: "w1", state: "faulted", started_at: "2026-07-04T11:00:00Z", ended_at: null },
      diffs: [
        {
          diff_id: "d1",
          run_id: null,
          window_id: "w1",
          tag_path: "[default]MIRA_IOCheck/VFD/vfd_fault_code",
          severity: "critical",
          diff_type: "anomaly_A2_VFD_FAULT",
          observed: 7,
          baseline: 0,
          delta_percent: null,
          from_event_id: null,
          to_event_id: null,
          event_timestamp: "2026-07-04T11:59:00Z",
          metadata: { next_check: "clear the cause and reset the drive" },
        },
      ],
      signals: [sig("vfd_fault_code", "7")],
    });
    const packet = await buildMachineContextPacket(client, "tenant-1", "asset-1", NOW);
    expect(packet.active_conditions).toHaveLength(1);
    expect(packet.active_conditions[0].rule_id).toBe("A2_VFD_FAULT");
    expect(packet.active_conditions[0].next_check).toBe("clear the cause and reset the drive");
    expect(packet.summary).toMatch(/^Active fault:/);
  });

  it("returns first-class empty state when the asset has no uns_path", async () => {
    const client = makeClient({ unsPath: null });
    const packet = await buildMachineContextPacket(client, "tenant-1", "asset-1", NOW);
    expect(packet.uns_path).toBeNull();
    expect(packet.has_live_data).toBe(false);
    expect(packet.live_tags).toEqual([]);
    expect(packet.active_conditions).toEqual([]);
  });

  it("introduces NO tag write path — every query is a read (SELECT only)", async () => {
    const client = healthyStoppedClient();
    await buildMachineContextPacket(client, "tenant-1", "asset-1", NOW);
    expect(client.sql.length).toBeGreaterThan(0);
    for (const s of client.sql) {
      expect(s.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    }
  });
});

describe("renderMachineEvidenceSection (the Ask-MIRA bridge)", () => {
  it("renders the packet into a citable prompt section carrying live values + assessment", async () => {
    const packet = await buildMachineContextPacket(healthyStoppedClient(), "tenant-1", "asset-1", NOW);
    const section = renderMachineEvidenceSection(packet);

    // Header + the four-way separation instruction MIRA must follow.
    expect(section).toMatch(/## Live Machine Evidence/);
    expect(section).toMatch(/separate/i);
    expect(section).toMatch(/inference/i);
    expect(section).toMatch(/next checks/i);
    // The DECODED live tag values reach the prompt (not raw registers).
    expect(section).toMatch(/vfd_dc_bus: 328\.6 V/);
    expect(section).toMatch(/vfd_cmd_word: STOP/);
    // The deterministic assessment reaches the prompt.
    expect(section).toMatch(/Assessment:/);
    expect(section).toMatch(/healthy/i);
    // Machine state line.
    expect(section).toMatch(/Machine state: idle/);
  });

  it("applies the injected field sanitizer on every field (prompt-injection hook)", async () => {
    const packet = await buildMachineContextPacket(healthyStoppedClient(), "tenant-1", "asset-1", NOW);
    const section = renderMachineEvidenceSection(packet, () => "[X]");
    expect(section).toMatch(/Machine state: \[X\]/);
    // The raw decoded value must NOT survive when a redacting sanitizer is used.
    expect(section).not.toMatch(/328\.6 V/);
  });

  it("returns empty string when the asset has no evidence", async () => {
    const packet = await buildMachineContextPacket(makeClient({ unsPath: null }), "tenant-1", "asset-1", NOW);
    expect(renderMachineEvidenceSection(packet)).toBe("");
  });
});
