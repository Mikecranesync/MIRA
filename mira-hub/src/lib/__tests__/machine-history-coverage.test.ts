// Workstream C (PRD §9.2) — historical-window COVERAGE is a server-owned fact.
//
// `live now?` and `what was recorded in this window?` are two different
// questions (PRD §6.8). fetchMachineHistory already returns the current-cache
// freshness roll-up; it must ALSO return the window's coverage — recorded
// count, bounds, whether the history source answered, both-clock divergence —
// and the single boolean the UI gates "Ask MIRA what happened" on:
// `admissible` = at least one recorded observation AND reason != unavailable.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/machine-memory-response", () => ({
  buildMachineMemoryResponse: vi.fn(async () => ({
    uns_path: "enterprise.home_garage.conveyor_lab.conveyor_1",
    latest_run: null,
    latest_window: null,
    latest_diffs: [],
    evidence_window: null,
    live_tags: [
      { tag_path: "cv101/photo_eye", value: true, last_seen_at: "2026-08-27T23:16:31.000Z", freshness: "live" },
    ],
    summary: "x",
    active_conditions: [],
    changed_recently: [],
  })),
}));

import { fetchMachineHistory, historyResponseBody } from "../machine-history";
import type { MachineMemoryClient } from "../machine-memory";

const TENANT = "00000000-0000-0000-0000-000000000099";
const ASSET = "00000000-0000-0000-0000-000000001001";
const UNS = "enterprise.home_garage.conveyor_lab.conveyor_1";
const AT = "2026-08-27T23:16:31.000Z";

type H = [RegExp, { rows: unknown[] } | (() => { rows: unknown[] })];
function client(handlers: H[]): MachineMemoryClient {
  return {
    query: async (sql: string) => {
      for (const [re, res] of handlers) if (re.test(sql)) return typeof res === "function" ? res() : res;
      return { rows: [] };
    },
  } as unknown as MachineMemoryClient;
}
const KG: H = [/FROM kg_entities/, { rows: [{ uns_path: UNS }] }];
const EVENTS = [
  { event_timestamp: "2026-08-27T23:16:28.860Z", ingested_at: "2026-08-27T23:16:30.900Z", uns_path: UNS, tag_path: "cv101/photo_eye", value: "true", quality: "good" },
  { event_timestamp: "2026-08-27T23:16:31.160Z", ingested_at: "2026-08-27T23:16:33.100Z", uns_path: UNS, tag_path: "cv101/fault_alarm", value: "true", quality: "good" },
];
const DIFFS = [
  { event_timestamp: "2026-08-27T23:16:29.180Z", detected_at: "2026-08-27T23:16:29.300Z", uns_path: UNS, tag_path: "cv101/run_cmd", prev_value: "false", new_value: "true", diff_type: "rising_edge" },
];
function undefinedTable(): { rows: unknown[] } {
  const e = new Error("no relation") as Error & { code?: string };
  e.code = "42P01";
  throw e;
}

describe("coverage (server-owned window truth)", () => {
  it("non-empty window: recorded count, bounds, both-clock lag, admissible=true, history available", async () => {
    const r = await fetchMachineHistory(
      client([KG, [/FROM tag_events/, { rows: EVENTS }], [/FROM tag_event_diffs/, { rows: DIFFS }]]),
      TENANT,
      ASSET,
      { at: AT, pre: 5, post: 2 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.history.coverage;
    expect(c).toEqual({
      recorded: 3,
      events: 2,
      diffs: 1,
      historyAvailable: true,
      diffsAvailable: true,
      admissible: true,
      from: "2026-08-27T23:16:26.000Z",
      to: "2026-08-27T23:16:33.000Z",
      earliest: "2026-08-27T23:16:28.860Z",
      latest: "2026-08-27T23:16:31.160Z",
      // the largest ingest-vs-event divergence in the window (2.04 s) — the
      // replay signature, surfaced so a client can label it (§9.2 both clocks)
      ingestLagMaxMs: 2040,
    });
    // and the current-connection freshness is a SEPARATE fact, untouched
    expect(r.history.freshness.overall).toBe("live");
    expect(historyResponseBody(r.history).coverage).toEqual(c);
  });

  it("valid window with ZERO rows: available but not admissible — never confused with unavailable", async () => {
    const r = await fetchMachineHistory(
      client([KG, [/FROM tag_events/, { rows: [] }], [/FROM tag_event_diffs/, { rows: [] }]]),
      TENANT,
      ASSET,
      { at: AT },
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.history.coverage).toMatchObject({
      recorded: 0,
      historyAvailable: true,
      admissible: false,
      earliest: null,
      latest: null,
      ingestLagMaxMs: null,
    });
    expect(r.history.reason).toBeUndefined();
    // live cache freshness does NOT make an empty window admissible
    expect(r.history.freshness.overall).toBe("live");
  });

  it("tag_events missing: historyAvailable=false, admissible=false, reason unavailable", async () => {
    const r = await fetchMachineHistory(client([KG, [/FROM tag_events/, undefinedTable]]), TENANT, ASSET, { at: AT });
    if (!r.ok) throw new Error("expected ok");
    expect(r.history.reason).toBe("unavailable");
    expect(r.history.coverage).toMatchObject({ recorded: 0, historyAvailable: false, admissible: false });
  });

  it("diffs table missing but events present: admissible on events alone, diffsAvailable=false", async () => {
    const r = await fetchMachineHistory(
      client([KG, [/FROM tag_events/, { rows: EVENTS }], [/FROM tag_event_diffs/, undefinedTable]]),
      TENANT,
      ASSET,
      { at: AT },
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.history.coverage).toMatchObject({
      recorded: 2,
      events: 2,
      diffs: 0,
      diffsAvailable: false,
      admissible: true,
      historyAvailable: true,
    });
  });
});
