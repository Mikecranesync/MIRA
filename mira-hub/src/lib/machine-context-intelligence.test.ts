import { describe, expect, it } from "vitest";

import { deriveContextIntelligence } from "./machine-context-intelligence";
import type { LiveTag, LatestDiff } from "./machine-memory-response";
import type { CurrentState } from "./machine-current-state";

const NOW = new Date("2026-07-04T12:00:00Z").getTime();

function tag(overrides: Partial<LiveTag> & { tag_path: string }): LiveTag {
  return {
    value: null,
    display: "—",
    numeric: null,
    unit: null,
    last_seen_at: new Date(NOW).toISOString(),
    last_changed_at: new Date(NOW).toISOString(),
    freshness: "live",
    ...overrides,
  };
}

/** A healthy-VFD live-tag set (comms OK, no fault, DC bus present, 0 Hz out). */
function healthyVfdTags(): LiveTag[] {
  return [
    tag({ tag_path: "[default]MIRA_IOCheck/VFD/vfd_fault_code", value: 0, display: "OK", numeric: 0 }),
    tag({
      tag_path: "[default]MIRA_IOCheck/VFD/vfd_status_word",
      display: "Stopped · FWD · comms",
      numeric: 1024,
    }),
    tag({ tag_path: "[default]MIRA_IOCheck/VFD/vfd_dc_bus", display: "328.6 V", numeric: 328.6, unit: "V" }),
    tag({ tag_path: "[default]MIRA_IOCheck/VFD/vfd_frequency", display: "0 Hz", numeric: 0, unit: "Hz" }),
    tag({ tag_path: "[default]MIRA_IOCheck/VFD/vfd_cmd_word", display: "STOP", numeric: 1 }),
  ];
}

const IDLE: CurrentState = { state: "idle", since: "2026-07-04T11:00:00Z", fresh: true };

describe("deriveContextIntelligence", () => {
  it("produces the VFD-healthy-but-stopped summary (no fault, drive healthy, stopped)", () => {
    const out = deriveContextIntelligence({
      machine_state: IDLE,
      live_tags: healthyVfdTags(),
      latest_diffs: [],
      nowMs: NOW,
    });
    expect(out.active_conditions).toEqual([]);
    // References the live evidence and points at command/permissive/interlock,
    // NOT the drive.
    expect(out.summary).toMatch(/no active fault/i);
    expect(out.summary).toMatch(/healthy/i);
    expect(out.summary).toMatch(/comms OK/i);
    expect(out.summary).toMatch(/fault OK/i);
    expect(out.summary).toMatch(/DC bus 328\.6 V/);
    expect(out.summary).toMatch(/command\/permissive\/interlock/i);
    // The whole point: it must NOT tell the tech to replace the drive.
    expect(out.summary).not.toMatch(/replace the (drive|vfd)/i);
  });

  it("leads with an active fault and its next check when one is present", () => {
    const diffs: LatestDiff[] = [
      {
        diff_id: "d1",
        tag_path: "[default]MIRA_IOCheck/VFD/vfd_fault_code",
        severity: "critical",
        diff_type: "anomaly_A2_VFD_FAULT",
        observed: 7,
        baseline: 0,
        delta_percent: null,
        event_timestamp: "2026-07-04T11:59:00Z",
        next_check: "clear the cause and reset the drive",
      },
    ];
    const out = deriveContextIntelligence({
      machine_state: { state: "faulted", since: null, fresh: true },
      live_tags: healthyVfdTags(),
      latest_diffs: diffs,
      nowMs: NOW,
    });
    expect(out.active_conditions[0].rule_id).toBe("A2_VFD_FAULT");
    expect(out.active_conditions[0].severity).toBe("critical");
    expect(out.summary).toMatch(/^Active fault:/);
    expect(out.summary).toMatch(/clear the cause and reset the drive/);
  });

  it("sorts active_conditions most-severe first", () => {
    const mk = (severity: LatestDiff["severity"], tag_path: string): LatestDiff => ({
      diff_id: tag_path,
      tag_path,
      severity,
      diff_type: `anomaly_${tag_path}`,
      observed: null,
      baseline: null,
      delta_percent: null,
      event_timestamp: null,
      next_check: null,
    });
    const out = deriveContextIntelligence({
      machine_state: IDLE,
      live_tags: [],
      latest_diffs: [mk("info", "a"), mk("critical", "b"), mk("warning", "c")],
      nowMs: NOW,
    });
    expect(out.active_conditions.map((c) => c.severity)).toEqual(["critical", "warning", "info"]);
  });

  it("reports stale/comms-down when the state is comm_down", () => {
    const out = deriveContextIntelligence({
      machine_state: { state: "comm_down", since: null, fresh: false },
      live_tags: [tag({ tag_path: "x/vfd_dc_bus", display: "320 V", numeric: 320, freshness: "stale" })],
      latest_diffs: [],
      nowMs: NOW,
    });
    expect(out.summary).toMatch(/stale/i);
    expect(out.summary).toMatch(/comms|collector/i);
  });

  it("flags only tags changed within the recent-change window (live only)", () => {
    const recent = new Date(NOW - 10_000).toISOString(); // 10s ago
    const old = new Date(NOW - 10 * 60_000).toISOString(); // 10 min ago
    const out = deriveContextIntelligence({
      machine_state: IDLE,
      live_tags: [
        tag({ tag_path: "x/vfd_frequency", last_changed_at: recent, freshness: "live" }),
        tag({ tag_path: "x/vfd_dc_bus", last_changed_at: old, freshness: "live" }),
        tag({ tag_path: "x/vfd_current", last_changed_at: recent, freshness: "stale" }),
      ],
      latest_diffs: [],
      nowMs: NOW,
      recentChangeWindowS: 120,
    });
    expect(out.changed_recently).toEqual(["x/vfd_frequency"]);
  });

  it("is honest when the drive health cannot be confirmed while stopped", () => {
    const out = deriveContextIntelligence({
      machine_state: IDLE,
      // fault present -> not healthy, but no historized anomaly diff
      live_tags: [
        tag({ tag_path: "x/vfd_fault_code", display: "code 12", numeric: 12 }),
        tag({ tag_path: "x/vfd_dc_bus", display: "320 V", numeric: 320 }),
      ],
      latest_diffs: [],
      nowMs: NOW,
    });
    expect(out.summary).toMatch(/unconfirmed|fault/i);
    expect(out.summary).not.toMatch(/looks healthy/i);
  });
});
