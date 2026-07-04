// Vitest coverage for GET /api/assets/[id]/machine-memory.
//
// The minimal Hub surface for persisted machine memory (docs/discovery/
// 2026-07-03-machine-memory-buildout.md D7): latest run, latest state window,
// latest diffs/anomalies. Empty state (no kg_entities uns_path, or no rows) is
// first-class, not an error. The route must also tolerate a 038-only env
// where machine_state_window (040) does not exist yet.

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/demo-auth", () => ({ sessionOrDemo: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET } from "../route";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

const ID = "00000000-0000-0000-0000-000000001001";
const ctx = { userId: "u_1", tenantId: "00000000-0000-0000-0000-000000000099", email: "x@y", role: "owner" };
const params = Promise.resolve({ id: ID });
const UNS_PATH = "enterprise.garage.demo_cell.cv_101";

type QueryCall = { sql: string; values: unknown[] };

function mockClient(handlers: Array<[RegExp, { rows: unknown[] } | (() => { rows: unknown[] })]>) {
  const calls: QueryCall[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      for (const [re, res] of handlers) {
        if (re.test(sql)) {
          if (typeof res === "function") return res();
          return res;
        }
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

const KG_HIT: [RegExp, { rows: unknown[] }] = [
  /FROM kg_entities/,
  { rows: [{ uns_path: UNS_PATH }] },
];
const KG_MISS: [RegExp, { rows: unknown[] }] = [/FROM kg_entities/, { rows: [] }];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOrDemo).mockResolvedValue(ctx as never);
});

it("no kg uns_path -> 200 empty state", async () => {
  wire(mockClient([KG_MISS]));
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    uns_path: null,
    latest_run: null,
    latest_window: null,
    latest_diffs: [],
    evidence_window: null,
    live_tags: [],
    current_state: null,
  });
});

it("run + window + diffs -> mapped response incl. next_check surfaced from metadata", async () => {
  const run = {
    run_id: "r1", status: "closed", started_at: "2026-07-01T00:00:00Z",
    stopped_at: "2026-07-01T01:00:00Z", duration_seconds: 3600, run_trigger_tag: "cv101.run",
  };
  const win = { window_id: "w1", state: "idle", started_at: "2026-07-01T01:00:00Z", ended_at: null };
  const diff = {
    diff_id: "d1", run_id: "r1", window_id: null, tag_path: "cv101.motor_current",
    severity: "warning", diff_type: "anomaly_A1_COMM_STALE", observed: 5.2, baseline: 4.0,
    delta_percent: 30, from_event_id: "e1", to_event_id: "e2",
    event_timestamp: "2026-07-01T00:30:00Z", metadata: { next_check: "verify VFD comm cable" },
  };
  const freshSeen = new Date(Date.now() - 2_000).toISOString();
  const staleSeen = new Date(Date.now() - 10 * 60_000).toISOString();
  const freshSignal = {
    plc_tag: "[default]MIRA_IOCheck/VFD/vfd_dc_bus", last_value_text: null,
    last_value_numeric: "320.4", last_value_bool: null, last_seen_at: freshSeen,
    simulated: false, expected_freshness_seconds: null, uns_path: UNS_PATH,
  };
  const staleSignal = {
    plc_tag: "[default]MIRA_IOCheck/VFD/vfd_torque", last_value_text: null,
    last_value_numeric: null, last_value_bool: false, last_seen_at: staleSeen,
    simulated: false, expected_freshness_seconds: null, uns_path: UNS_PATH,
  };
  wire(
    mockClient([
      KG_HIT,
      [/FROM machine_run/, { rows: [run] }],
      [/FROM machine_state_window/, { rows: [win] }],
      [/FROM run_diff/, { rows: [diff] }],
      [/FROM live_signal_cache/, { rows: [freshSignal, staleSignal] }],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.uns_path).toBe(UNS_PATH);
  expect(body.latest_run).toEqual(run);
  expect(body.latest_window).toEqual(win);
  expect(body.latest_diffs).toHaveLength(1);
  expect(body.latest_diffs[0].next_check).toBe("verify VFD comm cable");
  expect(body.latest_diffs[0].diff_type).toBe("anomaly_A1_COMM_STALE");
  expect(body.evidence_window).toEqual({
    started_at: run.started_at,
    stopped_at: run.stopped_at,
    uns_path: UNS_PATH,
  });
  // Live signals: value coalescing (numeric / bool) + per-tag freshness.
  expect(body.live_tags).toEqual([
    { tag_path: freshSignal.plc_tag, value: "320.4", last_seen_at: freshSeen, freshness: "live" },
    { tag_path: staleSignal.plc_tag, value: false, last_seen_at: staleSeen, freshness: "stale" },
  ]);
  // The window fixture is OPEN (ended_at null) and a live signal exists →
  // current state = the open window's state, fresh.
  expect(body.current_state).toEqual({ state: win.state, since: win.started_at, fresh: true });
});

it("closed window + all-stale signals -> current_state downgrades to comm_down", async () => {
  const win = {
    window_id: "w1", state: "running",
    started_at: "2026-07-01T01:00:00Z", ended_at: "2026-07-01T02:00:00Z",
  };
  const staleSignal = {
    plc_tag: "[default]MIRA_IOCheck/VFD/vfd_dc_bus", last_value_text: null,
    last_value_numeric: "318.9", last_value_bool: null,
    last_seen_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    simulated: false, expected_freshness_seconds: null, uns_path: UNS_PATH,
  };
  wire(
    mockClient([
      KG_HIT,
      [/FROM machine_state_window/, { rows: [win] }],
      [/FROM live_signal_cache/, { rows: [staleSignal] }],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.latest_window).toEqual(win);
  expect(body.live_tags[0].freshness).toBe("stale");
  expect(body.current_state).toEqual({ state: "comm_down", since: null, fresh: false });
});

it("live_signal_cache missing (42P01) -> 200 with live_tags [] and current_state null (no window)", async () => {
  wire(
    mockClient([
      KG_HIT,
      [/FROM machine_run/, { rows: [{ run_id: "r1", status: "open", started_at: "2026-07-01T00:00:00Z", stopped_at: null, duration_seconds: null, run_trigger_tag: "t" }] }],
      [
        /FROM live_signal_cache/,
        () => {
          const err = new Error('relation "live_signal_cache" does not exist') as Error & { code?: string };
          err.code = "42P01";
          throw err;
        },
      ],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.live_tags).toEqual([]);
  // No window + no signals ("unknown" freshness) → null current_state.
  expect(body.current_state).toBeNull();
});

it("038-only env (state-window query throws relation-does-not-exist) -> 200 with latest_window null, latest_run still returned", async () => {
  const run = {
    run_id: "r1", status: "open", started_at: "2026-07-01T00:00:00Z",
    stopped_at: null, duration_seconds: null, run_trigger_tag: "cv101.run",
  };
  const client = mockClient([
    KG_HIT,
    [/FROM machine_run/, { rows: [run] }],
    [
      /FROM machine_state_window/,
      () => {
        const err = new Error('relation "machine_state_window" does not exist') as Error & { code?: string };
        err.code = "42P01";
        throw err;
      },
    ],
    [/FROM run_diff/, { rows: [] }],
  ]);
  wire(client);
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.latest_run).toEqual(run);
  expect(body.latest_window).toBeNull();
  expect(body.windows_available).toBe(false);
  expect(body.latest_diffs).toEqual([]);
  // evidence_window falls back to the run since there's no window.
  expect(body.evidence_window).toEqual({
    started_at: run.started_at,
    stopped_at: run.stopped_at,
    uns_path: UNS_PATH,
  });
});

it("generic error (no pg code) in machine_state_window query -> 500, not a silent empty state", async () => {
  const run = {
    run_id: "r1", status: "open", started_at: "2026-07-01T00:00:00Z",
    stopped_at: null, duration_seconds: null, run_trigger_tag: "cv101.run",
  };
  const client = mockClient([
    KG_HIT,
    [/FROM machine_run/, { rows: [run] }],
    [
      /FROM machine_state_window/,
      () => {
        // No .code — e.g. a connection error, permission error, or syntax
        // error. This must NOT be treated as "040 not applied" and must NOT
        // be swallowed into an empty state.
        throw new Error("connection terminated unexpectedly");
      },
    ],
    [/FROM run_diff/, { rows: [] }],
  ]);
  wire(client);
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body).toEqual({ error: "Query failed" });
});

it("missing NEON_DATABASE_URL -> 503", async () => {
  delete process.env.NEON_DATABASE_URL;
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(503);
});

it("SQL assertions: tenant_id = $1::uuid and $2::ltree present in the run/window/diff/signal queries", async () => {
  const client = mockClient([
    KG_HIT,
    [/FROM machine_run/, { rows: [] }],
    [/FROM machine_state_window/, { rows: [] }],
    [/FROM run_diff/, { rows: [] }],
    [/FROM live_signal_cache/, { rows: [] }],
  ]);
  wire(client);
  await GET(new Request("http://t"), { params });
  const scoped = client.calls.filter((c) =>
    /FROM machine_run|FROM machine_state_window|FROM run_diff/.test(c.sql),
  );
  expect(scoped.length).toBeGreaterThan(0);
  for (const call of scoped) {
    expect(call.sql).toMatch(/tenant_id = \$1::uuid/);
    expect(call.sql).toMatch(/uns_path = \$2::ltree/);
  }
  // live_signal_cache is subtree-scoped: ltree descendant operator, not =.
  const signalCalls = client.calls.filter((c) => /FROM live_signal_cache/.test(c.sql));
  expect(signalCalls.length).toBeGreaterThan(0);
  for (const call of signalCalls) {
    expect(call.sql).toMatch(/tenant_id = \$1::uuid/);
    expect(call.sql).toMatch(/uns_path <@ \$2::ltree/);
  }
});
