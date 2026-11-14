// Bench runtime context contract — live/recorded machine evidence ON THE PILOT'S
// OWN PATH. The equipment-notebook chat route builds its MACHINE section with
// exactly these three functions (route.ts imports packetFromMachineMemoryResponse
// + renderMachineEvidenceSection; the summary and state come from
// deriveContextIntelligence + deriveCurrentState inside buildMachineMemoryResponse).
//
// Pure: no database, no provider call. It lives beside the graph contract so one
// command runs both. Nothing here is CI-enforced today.
//
// Clauses exercised: command is not feedback; a missing observation is unknown;
// stale data is labelled; timestamp + quality travel with every recorded row and
// are never invented. Route-level behaviour (empty window refused, tenant-bound
// SELECT-only re-fetch) is already proven by
// src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts —
// cited in the matrix, not duplicated here.
import { describe, expect, it } from "vitest";

import { deriveContextIntelligence } from "@/lib/machine-context-intelligence";
import { deriveCurrentState } from "@/lib/machine-current-state";
import {
  packetFromMachineMemoryResponse,
  renderMachineEvidenceSection,
  type MachineContextPacket,
} from "@/lib/machine-context-packet";
import type { LiveTag, MachineMemoryResponse } from "@/lib/machine-memory-response";

const NOW = new Date("2026-11-14T12:00:00Z").getTime();
const TENANT = "00000000-0000-0000-0000-00000be2c401";
const ASSET = "00000000-0000-0000-0000-0000000000a1";

function tag(leaf: string, over: Partial<LiveTag> = {}): LiveTag {
  return {
    tag_path: `[default]Bench/VFD1/${leaf}`,
    value: null,
    display: "—",
    numeric: null,
    unit: null,
    last_seen_at: new Date(NOW).toISOString(),
    last_changed_at: new Date(NOW).toISOString(),
    freshness: "live",
    ...over,
  };
}

const RUN_COMMAND = tag("vfd_cmd_word", { value: 18, display: "FWD+RUN", numeric: 18 });

function summary(machine_state: ReturnType<typeof deriveCurrentState>, live_tags: LiveTag[]): string {
  return deriveContextIntelligence({ machine_state, live_tags, latest_diffs: [], nowMs: NOW }).summary;
}

function packet(over: Partial<MachineMemoryResponse>): MachineContextPacket {
  const base = {
    uns_path: "enterprise.site.area.cv",
    latest_run: null,
    latest_window: null,
    evidence_window: null,
    live_tags: [],
    current_state: null,
    summary: "",
    active_conditions: [],
    changed_recently: [],
  } as unknown as MachineMemoryResponse;
  return packetFromMachineMemoryResponse(TENANT, ASSET, { ...base, ...over });
}

describe("pilot path: a command is not feedback", () => {
  it("a live RUN command with no state window never yields 'running'", () => {
    const state = deriveCurrentState(null, "live");
    expect(state).toEqual({ state: "unknown", since: null, fresh: true });
    expect(summary(state, [RUN_COMMAND])).not.toMatch(/machine running/i);
  });

  it("a RUN command while the recorded state is idle is summarised as idle, not running", () => {
    const state = deriveCurrentState({ state: "idle", started_at: "2026-11-14T11:00:00Z", ended_at: null }, "live");
    const text = summary(state, [RUN_COMMAND]);
    expect(text).toMatch(/^Machine idle/);
    expect(text).not.toMatch(/machine running/i);
  });

  it("positive control: 'running' is reported when the recorded state says so", () => {
    const state = deriveCurrentState({ state: "running", started_at: "2026-11-14T11:00:00Z", ended_at: null }, "live");
    expect(summary(state, [RUN_COMMAND])).toMatch(/^Machine running/);
  });
});

describe("pilot path: a missing observation is unknown, never healthy", () => {
  const IDLE = deriveCurrentState({ state: "idle", started_at: "2026-11-14T11:00:00Z", ended_at: null }, "live");

  it("no fault-code tag: the summary does not call the drive healthy or fault-free", () => {
    const text = summary(IDLE, [tag("vfd_frequency", { display: "0 Hz", numeric: 0 })]);
    expect(text).not.toMatch(/healthy|fault OK|no active fault/i);
    expect(text).toMatch(/Not enough decoded VFD evidence/);
  });

  it("positive control: a real zero fault code earns 'fault OK'", () => {
    const text = summary(IDLE, [
      tag("vfd_fault_code", { value: 0, display: "OK", numeric: 0 }),
      tag("vfd_dc_bus", { display: "328.6 V", numeric: 328.6 }),
    ]);
    expect(text).toMatch(/fault OK/);
  });

  it("no signals and no state window: there is no state at all (not a default one)", () => {
    expect(deriveCurrentState(null, "unknown")).toBeNull();
    expect(renderMachineEvidenceSection(packet({}))).toBe("");
  });

  it("a recorded tag with a null value renders as a dash, not as zero", () => {
    const text = renderMachineEvidenceSection(
      packet({ live_tags: [tag("vfd_current", { value: null, display: undefined })] }),
    );
    expect(text).toContain("vfd_current: — (live)");
  });
});

describe("pilot path: stale data is labelled and never backs a current state", () => {
  it("a closed state window with stale signals becomes comm_down, not the old state", () => {
    const state = deriveCurrentState(
      { state: "running", started_at: "2026-11-14T08:00:00Z", ended_at: "2026-11-14T09:00:00Z" },
      "stale",
    );
    expect(state).toEqual({ state: "comm_down", since: null, fresh: false });
    expect(summary(state, [RUN_COMMAND])).toMatch(/cannot be confirmed from live data/);
  });

  it("each rendered tag carries its own freshness word", () => {
    const text = renderMachineEvidenceSection(
      packet({ live_tags: [tag("vfd_frequency", { display: "30 Hz", freshness: "stale" })] }),
    );
    expect(text).toContain("vfd_frequency: 30 Hz (stale)");
  });
});

describe("pilot path: timestamp and quality travel with every recorded row", () => {
  const row = (over: Record<string, unknown>) =>
    ({
      kind: "event",
      tag: "enterprise.site.area.cv.vfd_fault_code",
      value: "4",
      prev_value: null,
      event_timestamp: "2026-11-14T11:59:58.000Z",
      ingested_at: "2026-11-14T11:59:59.500Z",
      quality: "good",
      ...over,
    }) as never;

  function replay(rows: never[]): string {
    const p = packet({});
    p.replay = {
      anchor_at: "2026-11-14T12:00:00.000Z",
      started_at: "2026-11-14T11:59:00.000Z",
      stopped_at: "2026-11-14T12:01:00.000Z",
      freshness: "stale",
      rows,
    };
    return renderMachineEvidenceSection(p);
  }

  it("a row shows when it was observed, when it was received, and its quality", () => {
    const text = replay([row({})]);
    expect(text).toContain("-2.00 s (2026-11-14T11:59:58.000Z, ingested 2026-11-14T11:59:59.500Z)");
    expect(text).toContain("vfd_fault_code: 4 (event, quality good)");
  });

  it("a row with no recorded quality shows none — quality is never invented", () => {
    const text = replay([row({ quality: null })]);
    expect(text).toContain("vfd_fault_code: 4 (event)");
    expect(text).not.toContain(", quality ");
  });

  it("an empty replay says nothing was recorded and forbids inferring", () => {
    const text = replay([]);
    expect(text).toContain("(no recorded observations in this window — do not infer any)");
    expect(text).toContain("a tag you do not see is NOT zero");
  });
});
