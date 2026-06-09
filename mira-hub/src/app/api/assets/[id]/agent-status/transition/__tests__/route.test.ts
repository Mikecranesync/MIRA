// Vitest coverage for POST /api/assets/[id]/agent-status/transition.
// transitionAssetAgent (the real helper) runs against the mocked client, so
// the SQL dispatcher answers its SELECT … FOR UPDATE + UPDATE too.

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const ID = "11111111-2222-3333-4444-555555555555";
const session = { userId: "u_1", tenantId: "tenant-aaaa", email: "x@y" };
const params = Promise.resolve({ id: ID });

function mockClient(handlers: Array<[RegExp, { rows: unknown[] }]>) {
  return {
    query: vi.fn(async (sql: string) => {
      for (const [re, res] of handlers) if (re.test(sql)) return res;
      return { rows: [] };
    }),
  };
}
function wire(client: { query: ReturnType<typeof vi.fn> }) {
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
}
function post(body: unknown) {
  return POST(new Request("http://t", { method: "POST", body: JSON.stringify(body) }), {
    params,
  });
}

const ASSET_OK: [RegExp, { rows: unknown[] }] = [
  /SELECT 1 FROM cmms_equipment/,
  { rows: [{ "?column?": 1 }] },
];
const INSERT_OK: [RegExp, { rows: unknown[] }] = [/INSERT INTO asset_agent_status/, { rows: [] }];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
});

it("400 on an invalid target state", async () => {
  const res = await post({ to: "wizard" });
  expect(res.status).toBe(400);
});

it("404 when the asset does not exist", async () => {
  wire(mockClient([[/SELECT 1 FROM cmms_equipment/, { rows: [] }]]));
  const res = await post({ to: "training" });
  expect(res.status).toBe(404);
});

it("advances draft → training (200)", async () => {
  wire(
    mockClient([
      ASSET_OK,
      INSERT_OK,
      [/SELECT state FROM asset_agent_status/, { rows: [{ state: "draft" }] }],
      [/RETURNING id, equipment_id, state/, { rows: [{ id: "x", equipment_id: ID, state: "training" }] }],
    ]),
  );
  const res = await post({ to: "training" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status.state).toBe("training");
});

it("409 on an illegal transition (draft → deployed)", async () => {
  wire(
    mockClient([
      ASSET_OK,
      INSERT_OK,
      [/SELECT state FROM asset_agent_status/, { rows: [{ state: "draft" }] }],
    ]),
  );
  const res = await post({ to: "deployed" });
  expect(res.status).toBe(409);
});

it("422 when approving without meeting the §5 gate", async () => {
  wire(
    mockClient([
      ASSET_OK,
      INSERT_OK,
      [/FROM asset_validation_qa/, { rows: [{ good_cited: 1, min_ground: 4 }] }],
    ]),
  );
  const res = await post({ to: "approved" });
  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.reasons?.length).toBeGreaterThan(0);
});

it("approves when the §5 gate passes (200, records actor)", async () => {
  const client = mockClient([
    ASSET_OK,
    INSERT_OK,
    [/FROM asset_validation_qa/, { rows: [{ good_cited: 5, min_ground: 4 }] }],
    [/SET citation_coverage/, { rows: [] }],
    [/SELECT state FROM asset_agent_status/, { rows: [{ state: "validating" }] }],
    [
      /RETURNING id, equipment_id, state/,
      { rows: [{ id: "x", equipment_id: ID, state: "approved", approved_by: "human:u_1" }] },
    ],
  ]);
  wire(client);
  const res = await post({ to: "approved" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status.state).toBe("approved");
  expect(body.status.approved_by).toBe("human:u_1");
});
