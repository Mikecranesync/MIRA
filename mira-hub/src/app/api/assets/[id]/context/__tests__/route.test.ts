// Vitest coverage for GET /api/assets/[id]/context.
//
// Regression: the route used to look the `[id]` param up in `kg_entities`, but
// that param is a `cmms_equipment.id` (the canonical asset id-space the rest of
// the asset API uses). A CMMS-registered asset with no promoted kg_entities row
// therefore 404'd — breaking the UNS confirmation-gate card for an asset that
// plainly exists. The route now resolves identity from cmms_equipment and
// enriches uns_path from kg_entities (null when there's no kg row).

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/demo-auth", () => ({ sessionOrDemo: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET } from "../route";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

const ID = "00000000-0000-0000-0000-000000001001";
const ctx = { userId: "u_1", tenantId: "00000000-0000-0000-0000-000000000099", email: "x@y", role: "owner" };
const params = Promise.resolve({ id: ID });

function mockClient(handlers: Array<[RegExp, { rows: unknown[] } | (() => { rows: unknown[] })]>) {
  return {
    query: vi.fn(async (sql: string) => {
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

const CMMS_ROW: [RegExp, { rows: unknown[] }] = [
  /FROM cmms_equipment/,
  { rows: [{ id: ID, equipment_number: "VFD-07", manufacturer: "Allen-Bradley", model_number: "PowerFlex 755" }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOrDemo).mockResolvedValue(ctx as never);
});

it("returns 200 (not 404) for a cmms asset with no kg_entities row — id-space regression", async () => {
  wire(
    mockClient([
      CMMS_ROW,
      [/FROM kg_entities/, { rows: [] }], // no promoted kg row → uns_path null
      [/FROM installed_component_instances/, { rows: [] }],
      [/live_signal_events/, { rows: [{ n: 0 }] }],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.asset.id).toBe(ID);
  expect(body.asset.name).toBe("VFD-07");
  expect(body.asset.manufacturer).toBe("Allen-Bradley");
  expect(body.asset.model).toBe("PowerFlex 755");
  expect(body.asset.uns_path).toBeNull();
  expect(body.ready_for_troubleshooting).toBe(false);
});

it("404 only when the asset is truly absent from cmms_equipment", async () => {
  wire(mockClient([[/FROM cmms_equipment/, { rows: [] }]]));
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(404);
});

// ── machine_memory block (T2 / seam 3) ──────────────────────────────────────

it("machine_memory is null when the asset has no uns_path", async () => {
  wire(
    mockClient([
      CMMS_ROW,
      [/FROM kg_entities/, { rows: [] }], // no kg row → no uns_path → no machine memory
      [/FROM installed_component_instances/, { rows: [] }],
      [/live_signal_events/, { rows: [{ n: 0 }] }],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.machine_memory).toBeNull();
});

it("machine_memory block present with latest run/window/diffs (≤3) + newest next_check", async () => {
  const run = {
    run_id: "r1", status: "closed", started_at: "2026-07-01T00:00:00Z",
    stopped_at: "2026-07-01T01:00:00Z", duration_seconds: 3600, run_trigger_tag: "cv101.run",
  };
  const win = { window_id: "w1", state: "idle", started_at: "2026-07-01T01:00:00Z", ended_at: null };
  const diffs = [1, 2, 3, 4, 5].map((n) => ({
    diff_id: `d${n}`, run_id: "r1", window_id: "w1", tag_path: `cv101.tag_${n}`,
    severity: "warning", diff_type: "anomaly_A1_COMM_STALE", observed: 5, baseline: 4,
    delta_percent: 25, from_event_id: null, to_event_id: null,
    event_timestamp: `2026-07-01T00:0${6 - n}:00Z`,
    metadata: n === 1 ? { next_check: "verify VFD comm cable" } : {},
  }));
  wire(
    mockClient([
      CMMS_ROW,
      [/FROM kg_entities/, { rows: [{ uns_path: "enterprise.garage.demo_cell.cv_101" }] }],
      [/FROM machine_run/, { rows: [run] }],
      [/FROM machine_state_window/, { rows: [win] }],
      [/FROM run_diff/, { rows: diffs }],
      [/FROM installed_component_instances/, { rows: [] }],
      [/live_signal_events/, { rows: [{ n: 0 }] }],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.machine_memory).not.toBeNull();
  expect(body.machine_memory.latest_run).toEqual(run);
  expect(body.machine_memory.latest_window).toEqual(win);
  expect(body.machine_memory.latest_diffs).toHaveLength(3); // capped at 3 of 5
  expect(body.machine_memory.latest_diffs[0].diff_id).toBe("d1");
  expect(body.machine_memory.next_check).toBe("verify VFD comm cable");
});

it("machine_memory is null (not a 500) when the 038 tables aren't applied in this env", async () => {
  wire(
    mockClient([
      CMMS_ROW,
      [/FROM kg_entities/, { rows: [{ uns_path: "enterprise.garage.demo_cell.cv_101" }] }],
      [
        /FROM machine_run/,
        () => {
          const err = new Error('relation "machine_run" does not exist') as Error & { code?: string };
          err.code = "42P01";
          throw err;
        },
      ],
      [/FROM installed_component_instances/, { rows: [] }],
      [/live_signal_events/, { rows: [{ n: 0 }] }],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.asset.uns_path).toBe("enterprise.garage.demo_cell.cv_101");
  expect(body.machine_memory).toBeNull();
});

it("enriches uns_path from kg_entities when a promoted row exists", async () => {
  wire(
    mockClient([
      CMMS_ROW,
      [/FROM kg_entities/, { rows: [{ uns_path: "enterprise.lake_wales.line_1.vfd_07" }] }],
      [/FROM installed_component_instances/, { rows: [{ id: "c1", component_name: "Drive", canonical_name: "vfd", plc_tag: "HR100" }] }],
      [/live_signal_events/, { rows: [{ n: 3 }] }],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.asset.uns_path).toBe("enterprise.lake_wales.line_1.vfd_07");
  expect(body.recent_signal_count_24h).toBe(3);
  expect(body.ready_for_troubleshooting).toBe(true);
});
