// Vitest coverage for GET /api/assets/[id]/history (Sensor REPLAY, contract
// §4.3). Same mocked-pool style as ../machine-memory/__tests__/route.test.ts.
//
// Pinned here: explicit anchor; latest faulted/estopped anchor; no window →
// 404 no_fault_window (never a synthesized anchor); missing tag_events →
// 200 + reason "unavailable" (never a fake timeline); chronological ordering
// across events + diffs; BOTH clocks on every row; a tenant predicate in every
// SQL statement; SELECT-only (no INSERT/UPDATE/DELETE ever issued).

import { it, expect, vi, beforeEach, describe } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@/lib/demo-auth", () => ({ sessionOrDemo: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET } from "../route";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { classifyProvenance, isCv101ApprovedProvenance } from "@/lib/machine-history-provenance";

// The shared provenance truth set (repo-root tests/fixtures), consumed here and
// by the later Python preflight/observer suites — one set of accepted rows and
// counterexamples for every reader of the replay window.
const here = dirname(fileURLToPath(import.meta.url));
const PROVENANCE_FIXTURE = JSON.parse(
  readFileSync(resolve(here, "../../../../../../../../tests/fixtures/machine-history-provenance.v1.json"), "utf8"),
) as {
  physicalSourceSystems: string[];
  syntheticSourceSystems: string[];
  cv101ApprovedPair: { source_system: string; source_connection_id: string };
  events: Array<{
    id: string;
    event_timestamp: string;
    ingested_at: string;
    tag_path: string;
    value: string;
    quality: string | null;
    source_system: string | null;
    source_connection_id: string | null;
    simulated: boolean | null;
    expected: { provenance: "physical" | "simulated" | "unknown"; admissible: boolean; badQuality: boolean; cv101Approved: boolean };
  }>;
  diffs: Array<{ id: string; event_timestamp: string; detected_at: string; tag_path: string; prev_value: string; new_value: string; diff_type: string; source_system: string | null; simulated: boolean | null }>;
  expectedCoverage: Record<string, number | string>;
};

const ID = "00000000-0000-0000-0000-000000001001";
const TENANT = "00000000-0000-0000-0000-000000000099";
const ctx = { userId: "u_1", tenantId: TENANT, email: "x@y", role: "owner" };
const params = Promise.resolve({ id: ID });
const UNS_PATH = "enterprise.home_garage.conveyor_lab.conveyor_1";
const FAULT_AT = "2026-08-27T23:16:31.000Z";

type QueryCall = { sql: string; values: unknown[] };

function mockClient(handlers: Array<[RegExp, { rows: unknown[] } | (() => { rows: unknown[] })]>) {
  const calls: QueryCall[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      for (const [re, res] of handlers) {
        if (re.test(sql)) return typeof res === "function" ? res() : res;
      }
      return { rows: [] };
    }),
  };
}
function wire(client: { query: ReturnType<typeof vi.fn> }) {
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
}
function undefinedTable(name: string) {
  return () => {
    const err = new Error(`relation "${name}" does not exist`) as Error & { code?: string };
    err.code = "42P01";
    throw err;
  };
}

const KG_HIT: [RegExp, { rows: unknown[] }] = [/FROM kg_entities/, { rows: [{ uns_path: UNS_PATH }] }];
const FAULT_WINDOW: [RegExp, { rows: unknown[] }] = [
  /FROM machine_state_window[\s\S]*state IN \('faulted', 'estopped'\)/,
  { rows: [{ window_id: "w-fault", state: "faulted", started_at: FAULT_AT, ended_at: null }] },
];

// Two events + one diff, deliberately supplied OUT of order, with an
// ingested_at that lags event_timestamp (the replay signature, D2).
const EVENTS = [
  { event_timestamp: "2026-08-27T23:16:31.160Z", ingested_at: "2026-08-27T23:16:33.100Z", uns_path: UNS_PATH, tag_path: "Conveyor/fault_alarm", value: "true", quality: "good", source_system: "ignition", source_connection_id: "conn-1", simulated: false },
  { event_timestamp: "2026-08-27T23:16:28.860Z", ingested_at: "2026-08-27T23:16:30.900Z", uns_path: UNS_PATH, tag_path: "Conveyor/photo_eye", value: "true", quality: "good", source_system: "ignition", source_connection_id: "conn-1", simulated: false },
];
const DIFFS = [
  { event_timestamp: "2026-08-27T23:16:29.180Z", detected_at: "2026-08-27T23:16:31.000Z", uns_path: UNS_PATH, tag_path: "Conveyor/run_cmd", prev_value: "false", new_value: "true", diff_type: "rising_edge", source_system: "ignition", simulated: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOrDemo).mockResolvedValue(ctx as never);
});

describe("anchor", () => {
  it("explicit ?at= wins and is reported as source 'explicit'; no state-window lookup runs", async () => {
    const client = mockClient([KG_HIT, [/FROM tag_events/, { rows: EVENTS }], [/FROM tag_event_diffs/, { rows: DIFFS }]]);
    wire(client);
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}&pre=3&post=1`), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anchor).toEqual({ at: FAULT_AT, source: "explicit" });
    expect(body.window).toEqual({ from: "2026-08-27T23:16:28.000Z", to: "2026-08-27T23:16:32.000Z", pre: 3, post: 1 });
    expect(body.provenance).toBe("machine_memory");
    // The anchor query (state IN (...)) is never issued when `at` is explicit.
    expect(client.calls.some((c) => /state IN \('faulted', 'estopped'\)/.test(c.sql))).toBe(false);
    // The window bounds reach the SQL as bound params, not string-built.
    const ev = client.calls.find((c) => /FROM tag_events/.test(c.sql))!;
    expect(ev.values).toEqual([TENANT, UNS_PATH, "2026-08-27T23:16:28.000Z", "2026-08-27T23:16:32.000Z"]);
  });

  it("explicit ?at= inside a machine_state_window → anchor carries that window's id + state (S5 D4); still source 'explicit'", async () => {
    const containing: [RegExp, { rows: unknown[] }] = [
      /FROM machine_state_window/,
      { rows: [{ window_id: "w-contain", state: "faulted", started_at: "2026-08-27T23:16:30.000Z", ended_at: null }] },
    ];
    const client = mockClient([KG_HIT, containing, [/FROM tag_events/, { rows: EVENTS }]]);
    wire(client);
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anchor).toEqual({ at: FAULT_AT, source: "explicit", windowId: "w-contain", state: "faulted" });
    // the CONTAINS query, not the latest-fault query; anchored on the explicit time as a bound param
    // (the Machine Memory header's own latest-window read is a separate statement)
    const win = client.calls.filter((c) => /FROM machine_state_window/.test(c.sql));
    expect(win.some((c) => /state IN \('faulted', 'estopped'\)/.test(c.sql))).toBe(false);
    const contains = win.filter((c) => /started_at <= \$3::timestamptz/.test(c.sql));
    expect(contains).toHaveLength(1);
    expect(contains[0].values).toEqual([TENANT, UNS_PATH, FAULT_AT]);
  });

  it("explicit ?at= with machine_state_window missing (040 not applied) → still 200, anchor without windowId", async () => {
    const client = mockClient([KG_HIT, [/FROM machine_state_window/, undefinedTable("machine_state_window")], [/FROM tag_events/, { rows: EVENTS }]]);
    wire(client);
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).anchor).toEqual({ at: FAULT_AT, source: "explicit" });
  });

  it("no ?at= → the latest faulted/estopped machine_state_window anchors the replay (source 'state_window')", async () => {
    wire(mockClient([KG_HIT, FAULT_WINDOW, [/FROM tag_events/, { rows: EVENTS }]]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history`), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anchor).toEqual({ at: FAULT_AT, source: "state_window", windowId: "w-fault", state: "faulted" });
    // defaults: 5 s before, 2 s after
    expect(body.window.pre).toBe(5);
    expect(body.window.post).toBe(2);
  });

  it("no faulted/estopped window → 404 no_fault_window carrying the latest window; NEVER a synthesized anchor", async () => {
    wire(
      mockClient([
        KG_HIT,
        [/FROM machine_state_window[\s\S]*state IN/, { rows: [] }],
        [/FROM machine_state_window/, { rows: [{ window_id: "w-idle", state: "idle", started_at: "2026-08-27T22:00:00.000Z", ended_at: null }] }],
      ]),
    );
    const res = await GET(new Request(`http://t/api/assets/${ID}/history`), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("no_fault_window");
    expect(body.latestWindow).toEqual({ state: "idle", started_at: "2026-08-27T22:00:00.000Z", ended_at: null });
    expect(body.windowsAvailable).toBe(true);
    expect(body).not.toHaveProperty("rows");
  });

  it("machine_state_window missing (040 not applied) and no ?at= → 404 no_fault_window with windowsAvailable=false", async () => {
    wire(mockClient([KG_HIT, [/FROM machine_state_window/, undefinedTable("machine_state_window")]]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history`), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("no_fault_window");
    expect(body.windowsAvailable).toBe(false);
    expect(body.latestWindow).toBeNull();
  });

  it("asset with no kg_entities uns_path → 404 no_uns_path (no machine memory to replay)", async () => {
    wire(mockClient([[/FROM kg_entities/, { rows: [] }]]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_uns_path");
  });

  it("malformed ?at= → 400 invalid_at", async () => {
    wire(mockClient([KG_HIT]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=yesterday`), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_at");
  });

  it("pre/post are clamped to the 120 s cap and floored at 0", async () => {
    wire(mockClient([KG_HIT]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}&pre=9999&post=-4`), { params });
    const body = await res.json();
    expect(body.window.pre).toBe(120);
    expect(body.window.post).toBe(0);
  });
});

describe("rows", () => {
  it("events + diffs are merged and ordered by event_timestamp; every row carries BOTH clocks and its quality", async () => {
    wire(mockClient([KG_HIT, [/FROM tag_events/, { rows: EVENTS }], [/FROM tag_event_diffs/, { rows: DIFFS }]]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params });
    const body = await res.json();
    expect(body.rows.map((r: { tag: string }) => r.tag)).toEqual([
      "Conveyor/photo_eye",
      "Conveyor/run_cmd",
      "Conveyor/fault_alarm",
    ]);
    expect(body.rows[0]).toEqual({
      kind: "event",
      event_timestamp: "2026-08-27T23:16:28.860Z",
      ingested_at: "2026-08-27T23:16:30.900Z",
      uns_path: UNS_PATH,
      tag: "Conveyor/photo_eye",
      value: "true",
      quality: "good",
      source_system: "ignition",
      source_connection_id: "conn-1",
      simulated: false,
    });
    // The diff row: prev → new, ingested_at = detected_at, quality null (037
    // records none — nothing is invented for it), no connection id (037
    // carries none).
    expect(body.rows[1]).toEqual({
      kind: "diff",
      event_timestamp: "2026-08-27T23:16:29.180Z",
      ingested_at: "2026-08-27T23:16:31.000Z",
      uns_path: UNS_PATH,
      tag: "Conveyor/run_cmd",
      value: "true",
      prev_value: "false",
      quality: null,
      source_system: "ignition",
      source_connection_id: null,
      simulated: false,
    });
    for (const r of body.rows) {
      expect(typeof r.event_timestamp).toBe("string");
      expect(typeof r.ingested_at).toBe("string");
      expect(r).toHaveProperty("quality");
    }
    // The clock divergence is preserved on the wire, never collapsed.
    expect(body.rows[2].ingested_at).not.toBe(body.rows[2].event_timestamp);
    expect(body).not.toHaveProperty("reason");
    expect(body.diffsAvailable).toBe(true);
  });

  it("a real empty window is rows: [] with NO reason (distinct from unavailable)", async () => {
    wire(mockClient([KG_HIT, [/FROM tag_events/, { rows: [] }], [/FROM tag_event_diffs/, { rows: [] }]]));
    const body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params })).json();
    expect(body.rows).toEqual([]);
    expect(body).not.toHaveProperty("reason");
  });

  it("tag_events missing (033 not applied) → 200 rows [] + reason 'unavailable' — never a fabricated timeline", async () => {
    wire(mockClient([KG_HIT, [/FROM tag_events/, undefinedTable("tag_events")]]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.reason).toBe("unavailable");
    expect(body.anchor.at).toBe(FAULT_AT);
  });

  it("tag_event_diffs missing (037 not applied) → events still returned, diffsAvailable=false", async () => {
    wire(mockClient([KG_HIT, [/FROM tag_events/, { rows: EVENTS }], [/FROM tag_event_diffs/, undefinedTable("tag_event_diffs")]]));
    const body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params })).json();
    expect(body.rows).toHaveLength(2);
    expect(body.diffsAvailable).toBe(false);
    expect(body).not.toHaveProperty("reason");
  });

  it("generic error (no pg code) → 500, not a silent empty timeline", async () => {
    wire(mockClient([KG_HIT, [/FROM tag_events/, () => { throw new Error("connection terminated unexpectedly"); }]]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params });
    expect(res.status).toBe(500);
  });
});

describe("header + freshness (existing model, never re-derived)", () => {
  it("summary is the Machine Memory response; freshness rolls up per-tag classifyTagFreshness", async () => {
    const freshSeen = new Date(Date.now() - 2_000).toISOString();
    const staleSeen = new Date(Date.now() - 10 * 60_000).toISOString();
    const signal = (tag: string, seen: string) => ({
      plc_tag: tag, last_value_text: null, last_value_numeric: "1", last_value_bool: null,
      last_seen_at: seen, last_changed_at: seen, simulated: false, expected_freshness_seconds: null, uns_path: UNS_PATH,
    });
    wire(
      mockClient([
        KG_HIT,
        [/FROM machine_run/, { rows: [{ run_id: "r1", status: "anomalous", started_at: "2026-08-27T23:00:00.000Z", stopped_at: null, duration_seconds: null, run_trigger_tag: "run" }] }],
        [/FROM machine_state_window/, { rows: [{ window_id: "w-fault", state: "faulted", started_at: FAULT_AT, ended_at: null }] }],
        [/FROM live_signal_cache/, { rows: [signal("a", freshSeen), signal("b", staleSeen)] }],
      ]),
    );
    const body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params })).json();
    expect(body.freshness).toEqual({ overall: "live", live: 1, stale: 1, simulated: 0, unknown: 0 });
    expect(body.summary.uns_path).toBe(UNS_PATH);
    expect(body.summary.latest_window.state).toBe("faulted");
    // The open run covers the anchor → runId is attached; nothing else is guessed.
    expect(body.anchor.runId).toBe("r1");
  });

  it("all-stale signals → freshness.overall 'stale' (a replay is never 'live' by default)", async () => {
    const staleSeen = new Date(Date.now() - 10 * 60_000).toISOString();
    wire(
      mockClient([
        KG_HIT,
        [/FROM live_signal_cache/, { rows: [{ plc_tag: "a", last_value_text: "x", last_value_numeric: null, last_value_bool: null, last_seen_at: staleSeen, last_changed_at: staleSeen, simulated: false, expected_freshness_seconds: null, uns_path: UNS_PATH }] }],
      ]),
    );
    const body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params })).json();
    expect(body.freshness.overall).toBe("stale");
  });

  it("only simulated signals → 'simulated', never 'live'", async () => {
    wire(
      mockClient([
        KG_HIT,
        [/FROM live_signal_cache/, { rows: [{ plc_tag: "a", last_value_text: "x", last_value_numeric: null, last_value_bool: null, last_seen_at: new Date().toISOString(), last_changed_at: null, simulated: true, expected_freshness_seconds: null, uns_path: UNS_PATH }] }],
      ]),
    );
    const body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params })).json();
    expect(body.freshness.overall).toBe("simulated");
  });
});

// ── Workstream C (PRD §9.2): current connection ≠ historical coverage ────────
//
// The cache's freshness ("is the machine talking to us NOW") and the served
// window's coverage ("what did Machine Memory RECORD then") are different
// facts. The wire carries both, explicitly, so no client can ever label an
// empty historical window "Live" because the current signals happen to be fresh.
describe("currentConnection vs historicalCoverage (PRD §9.2)", () => {
  const signal = (tag: string, seen: string, simulated = false) => ({
    plc_tag: tag, last_value_text: null, last_value_numeric: "1", last_value_bool: null,
    last_seen_at: seen, last_changed_at: seen, simulated, expected_freshness_seconds: null, uns_path: UNS_PATH,
  });
  const fresh = () => new Date(Date.now() - 2_000).toISOString();
  const stale = () => new Date(Date.now() - 10 * 60_000).toISOString();

  it("reports current live connection separately from an empty historical window", async () => {
    wire(
      mockClient([
        KG_HIT,
        [/FROM tag_events/, { rows: [] }],
        [/FROM tag_event_diffs/, { rows: [] }],
        [/FROM live_signal_cache/, { rows: [signal("a", fresh())] }],
      ]),
    );
    const body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}&pre=3&post=1`), { params })).json();
    // The connection is live NOW …
    expect(body.currentConnection).toEqual({ freshness: { overall: "live", live: 1, stale: 0, simulated: 0, unknown: 0 } });
    // … and the window recorded NOTHING — a valid quiet window, count 0, no bounds observed.
    expect(body.historicalCoverage).toEqual({
      available: true,
      returnedRowCount: 0,
      observationCount: 0,
      admissibleObservationCount: 0,
      physicalObservationCount: 0,
      simulatedObservationCount: 0,
      badQualityObservationCount: 0,
      unknownProvenanceCount: 0,
      from: "2026-08-27T23:16:28.000Z",
      to: "2026-08-27T23:16:32.000Z",
      firstObservedAt: null,
      lastObservedAt: null,
    });
    expect(body.rows).toEqual([]);
    expect(body).not.toHaveProperty("reason");
    // Coverage never carries a freshness word as a VALUE: "live" is a fact
    // about the cache, not about the window. (Keys such as
    // `simulatedObservationCount` name a provenance count, not a freshness.)
    expect(Object.values(body.historicalCoverage).join(" ")).not.toMatch(/live|stale|simulated/i);
    // Compatibility alias: the old top-level freshness is still the same object.
    expect(body.freshness).toEqual(body.currentConnection.freshness);
  });

  it("reports missing history tables as unavailable rather than zero", async () => {
    wire(mockClient([KG_HIT, [/FROM tag_events/, undefinedTable("tag_events")], [/FROM live_signal_cache/, { rows: [signal("a", fresh())] }]]));
    const res = await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.historicalCoverage.available).toBe(false);
    // null, NOT 0: nothing was counted because nothing could be read.
    expect(body.historicalCoverage).toEqual({
      available: false,
      returnedRowCount: null,
      observationCount: null,
      admissibleObservationCount: null,
      physicalObservationCount: null,
      simulatedObservationCount: null,
      badQualityObservationCount: null,
      unknownProvenanceCount: null,
      from: "2026-08-27T23:16:26.000Z",
      to: "2026-08-27T23:16:33.000Z",
      firstObservedAt: null,
      lastObservedAt: null,
    });
    expect(body.historicalCoverage.firstObservedAt).toBeNull();
    expect(body.historicalCoverage.lastObservedAt).toBeNull();
    expect(body.rows).toEqual([]);
    expect(body.reason).toBe("unavailable");
    // The current connection is still reported on its own — the cache is a
    // different table and it answered.
    expect(body.currentConnection.freshness.overall).toBe("live");
  });

  it("reports returned and observed bounds for non-empty history", async () => {
    wire(mockClient([KG_HIT, [/FROM tag_events/, { rows: EVENTS }], [/FROM tag_event_diffs/, { rows: DIFFS }]]));
    const body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}&pre=3&post=1`), { params })).json();
    expect(body.historicalCoverage).toEqual({
      available: true,
      // everything serialized: two events + one diff …
      returnedRowCount: 3,
      // … but a diff is not an observation: raw tag_events rows only
      observationCount: 2,
      // only the two good-quality physical RAW events unlock Ask MIRA; the
      // diff is served but enters no provenance/admission partition at all
      admissibleObservationCount: 2,
      physicalObservationCount: 2,
      simulatedObservationCount: 0,
      badQualityObservationCount: 0,
      unknownProvenanceCount: 0,
      // the RETURNED window (what was asked for, clamped) …
      from: "2026-08-27T23:16:28.000Z",
      to: "2026-08-27T23:16:32.000Z",
      // … and the OBSERVED bounds (earliest/latest row actually served) — the
      // two differ, and both are the server's numbers.
      firstObservedAt: "2026-08-27T23:16:28.860Z",
      lastObservedAt: "2026-08-27T23:16:31.160Z",
    });
    expect(body.historicalCoverage.returnedRowCount).toBe(body.rows.length);
    expect(body.historicalCoverage.observationCount).toBe(body.rows.filter((r: { kind: string }) => r.kind === "event").length);
    // No cache rows at all → the connection is unknown, and that is said as such.
    expect(body.currentConnection.freshness.overall).toBe("unknown");
    // every served row carries its quality AND provenance explicitly
    expect(body.rows.map((r: Record<string, unknown>) => [r.kind, r.quality, r.source_system, r.source_connection_id, r.simulated])).toEqual([
      ["event", "good", "ignition", "conn-1", false],
      ["diff", null, "ignition", null, false],
      ["event", "good", "ignition", "conn-1", false],
    ]);
  });

  it("simulated-only, bad-quality-only and unknown-provenance windows never produce an admissible observation", async () => {
    const at = (ts: string, extra: Record<string, unknown>) => ({
      event_timestamp: ts, ingested_at: ts, uns_path: UNS_PATH, tag_path: "Conveyor/photo_eye", value: "true", quality: "good",
      source_system: "ignition", source_connection_id: "conn-1", simulated: false, ...extra,
    });
    const run = async (events: unknown[], diffs: unknown[] = []) => {
      wire(mockClient([KG_HIT, [/FROM tag_events/, { rows: events }], [/FROM tag_event_diffs/, { rows: diffs }]]));
      return (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}&pre=3&post=1`), { params })).json();
    };
    // simulated flag, or a synthetic source system, is simulated either way
    let body = await run([at("2026-08-27T23:16:29.000Z", { simulated: true }), at("2026-08-27T23:16:30.000Z", { source_system: "simlab" })]);
    expect(body.historicalCoverage).toMatchObject({ available: true, observationCount: 2, admissibleObservationCount: 0, physicalObservationCount: 0, simulatedObservationCount: 2, badQualityObservationCount: 0, unknownProvenanceCount: 0 });
    // physical but not good quality
    body = await run([at("2026-08-27T23:16:29.000Z", { quality: "bad" }), at("2026-08-27T23:16:30.000Z", { quality: null })]);
    expect(body.historicalCoverage).toMatchObject({ observationCount: 2, admissibleObservationCount: 0, physicalObservationCount: 2, simulatedObservationCount: 0, badQualityObservationCount: 2, unknownProvenanceCount: 0 });
    // unknown provenance (null source, or a null simulated flag) is never physical
    body = await run([at("2026-08-27T23:16:29.000Z", { source_system: null }), at("2026-08-27T23:16:30.000Z", { simulated: null })]);
    expect(body.historicalCoverage).toMatchObject({ observationCount: 2, admissibleObservationCount: 0, physicalObservationCount: 0, simulatedObservationCount: 0, badQualityObservationCount: 0, unknownProvenanceCount: 2 });
    // a diff alone — even from a physical source — is returned but is NOT an
    // observation: it enters no provenance partition and never unlocks Ask MIRA
    body = await run([], DIFFS);
    expect(body.historicalCoverage).toMatchObject({
      returnedRowCount: 1,
      observationCount: 0,
      admissibleObservationCount: 0,
      physicalObservationCount: 0,
      simulatedObservationCount: 0,
      badQualityObservationCount: 0,
      unknownProvenanceCount: 0,
    });
    expect(body.rows[0]).toMatchObject({ kind: "diff", source_system: "ignition", source_connection_id: null, simulated: false });
    // an unrecognised source system with simulated:false is UNKNOWN, never physical
    body = await run([at("2026-08-27T23:16:29.000Z", { source_system: "historian_export" })]);
    expect(body.historicalCoverage).toMatchObject({ observationCount: 1, physicalObservationCount: 0, unknownProvenanceCount: 1, admissibleObservationCount: 0 });
    // a physical source without a connection id is UNKNOWN too
    body = await run([at("2026-08-27T23:16:29.000Z", { source_connection_id: null }), at("2026-08-27T23:16:30.000Z", { source_connection_id: "" })]);
    expect(body.historicalCoverage).toMatchObject({ observationCount: 2, physicalObservationCount: 0, unknownProvenanceCount: 2, admissibleObservationCount: 0 });
  });

  it("classifies and counts the shared provenance fixture (tests/fixtures/machine-history-provenance.v1.json): every counterexample, and returned ≠ observation", async () => {
    const fx = PROVENANCE_FIXTURE;
    // Each accepted row / counterexample is named and checked individually …
    for (const c of fx.events) {
      expect({ id: c.id, provenance: classifyProvenance(c) }).toEqual({ id: c.id, provenance: c.expected.provenance });
      expect({ id: c.id, cv101: isCv101ApprovedProvenance(c) }).toEqual({ id: c.id, cv101: c.expected.cv101Approved });
    }
    expect(fx.events.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "arbitrary_source_simulated_false",
        "ignition_missing_connection",
        "ignition_empty_connection",
        "spoofed_simulated_false_on_synthetic_source",
        "explicit_simulated_on_cv101_pair",
        "cv101_exact_pair_good",
      ]),
    );
    // … and the served window counts them exactly as the fixture states.
    const events = fx.events.map((c) => ({
      event_timestamp: c.event_timestamp, ingested_at: c.ingested_at, uns_path: UNS_PATH, tag_path: c.tag_path, value: c.value,
      quality: c.quality, source_system: c.source_system, source_connection_id: c.source_connection_id, simulated: c.simulated,
    }));
    const diffs = fx.diffs.map((d) => ({
      event_timestamp: d.event_timestamp, detected_at: d.detected_at, uns_path: UNS_PATH, tag_path: d.tag_path,
      prev_value: d.prev_value, new_value: d.new_value, diff_type: d.diff_type, source_system: d.source_system, simulated: d.simulated,
    }));
    wire(mockClient([KG_HIT, [/FROM tag_events/, { rows: events }], [/FROM tag_event_diffs/, { rows: diffs }]]));
    const body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}&pre=3&post=1`), { params })).json();
    expect(body.historicalCoverage).toEqual({
      available: true,
      from: "2026-08-27T23:16:28.000Z",
      to: "2026-08-27T23:16:32.000Z",
      ...fx.expectedCoverage,
    });
    // The fixture's own expectations are internally consistent with its cases.
    const exp = fx.events.map((c) => c.expected);
    expect(fx.expectedCoverage).toMatchObject({
      returnedRowCount: fx.events.length + fx.diffs.length,
      observationCount: fx.events.length,
      physicalObservationCount: exp.filter((e) => e.provenance === "physical").length,
      simulatedObservationCount: exp.filter((e) => e.provenance === "simulated").length,
      unknownProvenanceCount: exp.filter((e) => e.provenance === "unknown").length,
      admissibleObservationCount: exp.filter((e) => e.admissible).length,
      badQualityObservationCount: exp.filter((e) => e.badQuality).length,
    });
    // The partition is exhaustive over raw events and excludes diffs.
    const hc = body.historicalCoverage;
    expect(hc.physicalObservationCount + hc.simulatedObservationCount + hc.unknownProvenanceCount).toBe(hc.observationCount);
    expect(hc.returnedRowCount - hc.observationCount).toBe(fx.diffs.length);
    // Every diff row is serialized with a null connection id, whatever its source.
    for (const r of body.rows.filter((r: { kind: string }) => r.kind === "diff")) expect(r.source_connection_id).toBeNull();
    // The catalogues the reader uses are the fixture's, verbatim.
    expect(fx.physicalSourceSystems).toEqual(["ignition", "plc_bridge", "relay"]);
    expect(fx.cv101ApprovedPair).toMatchObject({ source_system: "ignition", source_connection_id: "cv101-bench-gw" });
  });

  it("keeps stale and simulated classifications under current connection", async () => {
    wire(mockClient([KG_HIT, [/FROM tag_events/, { rows: EVENTS }], [/FROM live_signal_cache/, { rows: [signal("a", stale())] }]]));
    let body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params })).json();
    expect(body.currentConnection.freshness.overall).toBe("stale");
    expect(body.historicalCoverage.observationCount).toBe(2);
    expect(body.historicalCoverage).not.toHaveProperty("freshness");

    wire(mockClient([KG_HIT, [/FROM tag_events/, { rows: EVENTS }], [/FROM live_signal_cache/, { rows: [signal("a", fresh(), true)] }]]));
    body = await (await GET(new Request(`http://t/api/assets/${ID}/history?at=${FAULT_AT}`), { params })).json();
    expect(body.currentConnection.freshness.overall).toBe("simulated");
    expect(body.historicalCoverage.available).toBe(true);
    expect(body.historicalCoverage).not.toHaveProperty("freshness");
  });
});

describe("read-only + tenant boundary", () => {
  it("every issued statement is a SELECT with a tenant predicate; no INSERT/UPDATE/DELETE ever", async () => {
    const client = mockClient([KG_HIT, FAULT_WINDOW, [/FROM tag_events/, { rows: EVENTS }], [/FROM tag_event_diffs/, { rows: DIFFS }]]);
    wire(client);
    await GET(new Request(`http://t/api/assets/${ID}/history`), { params });
    expect(client.calls.length).toBeGreaterThan(4);
    for (const call of client.calls) {
      expect(call.sql.trim()).toMatch(/^SELECT/i);
      expect(call.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
      expect(call.sql).toMatch(/tenant_id = \$1/);
      expect(call.values[0]).toBe(TENANT);
    }
    // The replay tables are subtree-scoped by ltree, bound as $2.
    for (const call of client.calls.filter((c) => /FROM tag_events|FROM tag_event_diffs/.test(c.sql))) {
      expect(call.sql).toMatch(/uns_path <@ \$2::ltree/);
      expect(call.sql).toMatch(/tenant_id = \$1::uuid/);
    }
  });

  it("missing NEON_DATABASE_URL → 503", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await GET(new Request(`http://t/api/assets/${ID}/history`), { params });
    expect(res.status).toBe(503);
  });
});
