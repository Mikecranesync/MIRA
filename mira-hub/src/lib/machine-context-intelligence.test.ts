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

// ── Workstream C (PRD §9.2) — technician-facing fault titles ────────────────
//
// The A0–A12 writer stores the anomaly's evidence topic as `tag_path`, which
// for A0_OFFLINE is the pseudo-topic `_stale_s`. The title must come from the
// canonical anomaly summary (persisted `metadata.title`, else the rule
// catalog ported from rules_core), never from a raw tag suffix.
describe("condition titles never leak internal identifiers (§9.2)", () => {
  const stale: CurrentState = { state: "comm_down", since: null, fresh: false };

  function diff(over: Partial<LatestDiff>): LatestDiff {
    return {
      diff_id: "d1",
      tag_path: "_stale_s",
      severity: "critical",
      diff_type: "anomaly_A0_OFFLINE",
      observed: null,
      baseline: null,
      delta_percent: null,
      event_timestamp: new Date(NOW).toISOString(),
      next_check: "Check the PLC bridge / Modbus link.",
      title: null,
      ...over,
    };
  }

  it("A0_OFFLINE on the _stale_s pseudo-topic renders the canonical rule title, no suffix leak", () => {
    const out = deriveContextIntelligence({ machine_state: stale, live_tags: [], latest_diffs: [diff({})], nowMs: NOW });
    expect(out.active_conditions[0].title).toBe("PLC/bridge offline");
    expect(out.active_conditions[0].title).not.toMatch(/_stale_s/);
    expect(out.summary).toBe("Active fault: PLC/bridge offline. Next: Check the PLC bridge / Modbus link.");
    expect(out.summary).not.toMatch(/_stale_s|offline on/);
  });

  it("a persisted metadata.title wins over the catalog and over the tag leaf", () => {
    const out = deriveContextIntelligence({
      machine_state: stale,
      live_tags: [],
      latest_diffs: [diff({ title: "GS10 drive fault active (ocA)", diff_type: "anomaly_A2_VFD_FAULT", tag_path: "vfd/vfd101/fault_code" })],
      nowMs: NOW,
    });
    expect(out.active_conditions[0].title).toBe("GS10 drive fault active (ocA)");
  });

  it("every catalogued rule renders its canonical title; the internal tag never appears", () => {
    for (const rule of ["A1_COMM_STALE", "A3_ESTOP_WIRING", "A8_OVERCURRENT", "A12_PHOTOEYE_JAM"]) {
      const out = deriveContextIntelligence({
        machine_state: stale,
        live_tags: [],
        latest_diffs: [diff({ diff_type: `anomaly_${rule}`, tag_path: "[default]MIRA_IOCheck/VFD/_internal_x", severity: "warning" })],
        nowMs: NOW,
      });
      expect(out.active_conditions[0].title).not.toMatch(/_internal_x|\[default\]|MIRA_IOCheck/);
      expect(out.active_conditions[0].title.length).toBeGreaterThan(5);
    }
  });

  it("an uncatalogued anomaly on a pseudo-topic still never renders the pseudo-topic", () => {
    const out = deriveContextIntelligence({
      machine_state: stale,
      live_tags: [],
      latest_diffs: [diff({ diff_type: "anomaly_A99_FUTURE_RULE", tag_path: "_freq_frozen_s" })],
      nowMs: NOW,
    });
    expect(out.active_conditions[0].title).not.toMatch(/_freq_frozen_s/);
    expect(out.active_conditions[0].title).toMatch(/future rule/);
  });

  it("a statistical (non-anomaly) deviation on a real tag keeps the readable leaf", () => {
    const out = deriveContextIntelligence({
      machine_state: stale,
      live_tags: [],
      latest_diffs: [diff({ diff_type: "deviation", tag_path: "[default]MIRA_IOCheck/VFD/vfd_dc_bus", severity: "warning" })],
      nowMs: NOW,
    });
    expect(out.active_conditions[0].title).toBe("deviation on vfd_dc_bus");
  });
});
