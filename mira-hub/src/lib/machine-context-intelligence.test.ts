import { describe, expect, it } from "vitest";

import { deriveContextIntelligence } from "./machine-context-intelligence";
import { ANOMALY_CATALOG, canonicalAnomalyTitle, canonicalDiffTitle } from "./machine-anomaly-catalog";
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

  describe("canonical anomaly titles (PRD §9.2 — one shared catalog, no raw fragments)", () => {
    const diff = (over: Partial<LatestDiff>): LatestDiff => ({
      diff_id: "d",
      tag_path: "x",
      severity: "critical",
      diff_type: null,
      observed: null,
      baseline: null,
      delta_percent: null,
      event_timestamp: null,
      next_check: null,
      ...over,
    });

    it("A0 on the _stale_s pseudo-topic renders 'PLC/bridge offline' — never the internal field name", () => {
      const out = deriveContextIntelligence({
        machine_state: { state: "comm_down", since: null, fresh: false },
        live_tags: [],
        latest_diffs: [diff({ diff_type: "anomaly_A0_OFFLINE", tag_path: "_stale_s", next_check: "check the bridge service" })],
        nowMs: NOW,
      });
      expect(out.active_conditions[0].title).toBe("PLC/bridge offline");
      expect(out.active_conditions[0].title).not.toMatch(/_stale_s/);
      // the active-fault summary leads with the canonical title AND keeps the next check
      expect(out.summary).toBe("Active fault: PLC/bridge offline. Next: check the bridge service");
    });

    it("A2 stays canonical and the persisted metadata title can NOT override a known rule", () => {
      const out = deriveContextIntelligence({
        machine_state: null,
        live_tags: [],
        latest_diffs: [diff({ diff_type: "anomaly_A2_VFD_FAULT", tag_path: "[default]MIRA_IOCheck/VFD/vfd_fault_code", title: "something a row said" })],
        nowMs: NOW,
      });
      expect(out.active_conditions[0].title).toBe("GS10 drive fault active");
    });

    it("the complete known catalog is A0–A10 plus A12 — there is no A11", () => {
      expect(Object.keys(ANOMALY_CATALOG).sort()).toEqual(
        [
          "A0_OFFLINE",
          "A1_COMM_STALE",
          "A2_VFD_FAULT",
          "A3_ESTOP_WIRING",
          "A4_DIRECTION_FAULT",
          "A5_ILLEGAL_RUN",
          "A6_DRIVE_NOT_RESPONDING",
          "A7_FREQ_NOT_TRACKING",
          "A8_OVERCURRENT",
          "A9_DC_BUS",
          "A10_FREQ_STUCK_ZERO",
          "A12_PHOTOEYE_JAM",
        ].sort(),
      );
      expect(Object.keys(ANOMALY_CATALOG).some((k) => k.startsWith("A11"))).toBe(false);
      for (const t of Object.values(ANOMALY_CATALOG)) expect(t).not.toMatch(/_stale_s|\[default\]|enterprise\./);
    });

    it("raw UNS paths / [default] provider prefixes / pseudo-topics never enter a title", () => {
      expect(canonicalAnomalyTitle("A9_DC_BUS", "enterprise.home_garage.conveyor_lab.conveyor_1")).toBe("DC bus voltage out of range");
      // unknown rule with an internal-looking persisted title: the title is rejected
      const t = canonicalAnomalyTitle("A99_CUSTOM", "[default]MIRA_IOCheck/VFD/_stale_s", "enterprise.site.area._stale_s");
      expect(t).not.toMatch(/_stale_s|\[default\]|enterprise\./);
      expect(t).toBe("custom");
      // unknown rule with a sane persisted title: it is used (sanitized)
      expect(canonicalAnomalyTitle("A99_CUSTOM", "x/y", "  Custom   thing  ")).toBe("Custom thing");
    });

    it("unknown non-anomaly diffs degrade deterministically to '<kind> on <leaf>'", () => {
      expect(canonicalAnomalyTitle(null, "[default]MIRA_IOCheck/VFD/vfd_dc_bus")).toBe("deviation on vfd dc bus");
      expect(canonicalDiffTitle("[default]MIRA_IOCheck", "x/vfd_current")).toBe("deviation on vfd current");
      expect(canonicalDiffTitle("enterprise.site.area", "x/vfd_current")).toBe("deviation on vfd current");
      const out = deriveContextIntelligence({
        machine_state: null,
        live_tags: [],
        latest_diffs: [diff({ diff_type: "baseline_deviation", tag_path: "x/vfd_current", severity: "info" })],
        nowMs: NOW,
      });
      expect(out.active_conditions[0].title).toBe("baseline deviation on vfd current");
    });
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
