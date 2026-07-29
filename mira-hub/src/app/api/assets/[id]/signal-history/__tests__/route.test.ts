// Vitest coverage for GET /api/assets/[id]/signal-history — the sparkline
// feed: recent numeric tag_events for the asset's UNS subtree, keyed on
// ingested_at (server receipt — the client event_timestamp freezes under
// Ignition report-by-exception), scaled to engineering units.

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

const KG_HIT: [RegExp, { rows: unknown[] }] = [/FROM kg_entities/, { rows: [{ uns_path: UNS_PATH }] }];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOrDemo).mockResolvedValue(ctx as never);
});

it("no kg uns_path -> 200 empty series", async () => {
  wire(mockClient([[/FROM kg_entities/, { rows: [] }]]));
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ uns_path: null, series: {} });
});

it("groups per tag and scales to engineering units", async () => {
  const rows = [
    { tag_path: "[default]MIRA_IOCheck/VFD/vfd_dc_bus", t: 100, v: 3204 },
    { tag_path: "[default]MIRA_IOCheck/VFD/vfd_dc_bus", t: 102, v: 3286 },
    { tag_path: "[default]MIRA_IOCheck/VFD/vfd_frequency", t: 100, v: 3000 },
  ];
  wire(mockClient([KG_HIT, [/FROM tag_events/, { rows }]]));
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.series["[default]MIRA_IOCheck/VFD/vfd_dc_bus"]).toEqual([
    { t: 100, v: 320.4 },
    { t: 102, v: 328.6 },
  ]);
  expect(body.series["[default]MIRA_IOCheck/VFD/vfd_frequency"]).toEqual([{ t: 100, v: 30 }]);
});

it("downsamples long series to <= 60 points keeping the freshest", async () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({
    tag_path: "[default]MIRA_IOCheck/VFD/vfd_dc_bus",
    t: 1000 + i,
    v: 3200 + i,
  }));
  wire(mockClient([KG_HIT, [/FROM tag_events/, { rows }]]));
  const body = await (await GET(new Request("http://t"), { params })).json();
  const series = body.series["[default]MIRA_IOCheck/VFD/vfd_dc_bus"];
  expect(series.length).toBe(60);
  expect(series[series.length - 1]).toEqual({ t: 1000 + 149, v: (3200 + 149) / 10 });
});

it("tag_events missing (42P01) -> 200 empty series", async () => {
  wire(
    mockClient([
      KG_HIT,
      [
        /FROM tag_events/,
        () => {
          const err = new Error('relation "tag_events" does not exist') as Error & { code?: string };
          err.code = "42P01";
          throw err;
        },
      ],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  expect((await res.json()).series).toEqual({});
});

it("SQL assertions: subtree-scoped, numeric-only, keyed on ingested_at", async () => {
  const client = mockClient([KG_HIT, [/FROM tag_events/, { rows: [] }]]);
  wire(client);
  await GET(new Request("http://t"), { params });
  const call = client.calls.find((c) => /FROM tag_events/.test(c.sql));
  expect(call).toBeDefined();
  expect(call!.sql).toMatch(/tenant_id = \$1::uuid/);
  expect(call!.sql).toMatch(/uns_path <@ \$2::ltree/);
  expect(call!.sql).toMatch(/value_type IN \('int', 'float'\)/);
  expect(call!.sql).toMatch(/ingested_at > NOW\(\)/);
  expect(call!.sql).toMatch(/ORDER BY tag_path, ingested_at ASC/);
});
