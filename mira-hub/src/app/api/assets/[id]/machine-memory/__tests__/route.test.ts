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
  wire(
    mockClient([
      KG_HIT,
      [/FROM machine_run/, { rows: [run] }],
      [/FROM machine_state_window/, { rows: [win] }],
      [/FROM run_diff/, { rows: [diff] }],
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
        throw new Error('relation "machine_state_window" does not exist');
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

it("missing NEON_DATABASE_URL -> 503", async () => {
  delete process.env.NEON_DATABASE_URL;
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(503);
});

it("SQL assertions: tenant_id = $1::uuid and $2::ltree present in the run/window/diff queries", async () => {
  const client = mockClient([
    KG_HIT,
    [/FROM machine_run/, { rows: [] }],
    [/FROM machine_state_window/, { rows: [] }],
    [/FROM run_diff/, { rows: [] }],
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
});
