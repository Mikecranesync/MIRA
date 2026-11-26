// #5746 r5 F1: the history read returns the bench component each turn was asked under
// (migration 115 stamps `component_id` on every turn asked under a selection, refusals and
// safety stops included). The detail route reads it to tell a component question from a
// whole-machine one; the saved attribution entry exists only on the paths that stream a
// component frame.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/list-turns-component-id

import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantMock = vi.hoisted(() => ({
  withTenantContext: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => tenantMock);
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { listTurns } from "@/lib/equipment-notebooks";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const COMPONENT = "33333333-3333-4333-8333-333333333333";

const row = (id: string, componentId: string | null) => ({
  id,
  question: "Can I work on the energized GS11N-20P25?",
  answer_status: "answered",
  answer_text: "Stop. Lock out the drive first.",
  evidence: [],
  basis: null,
  created_at: "2026-11-26T10:00:00.000Z",
  client_request_id: null,
  component_id: componentId,
});

function wire(rows: unknown[]) {
  const sql: string[] = [];
  const client = {
    query: vi.fn(async (q: string) => {
      sql.push(q);
      if (/FROM equipment_notebook_turns/.test(q)) return { rows };
      return { rows: [] };
    }),
  };
  tenantMock.withTenantContext.mockImplementation(async (_t: string, fn: (c: unknown) => unknown) => fn(client));
  return sql;
}

beforeEach(() => vi.clearAllMocks());

describe("listTurns returns the component a turn was asked under (#5746 r5 F1)", () => {
  it("selects component_id and returns it as componentId", async () => {
    const sql = wire([row("t1", COMPONENT)]);
    const turns = await listTurns(TENANT, NB);
    expect(sql.find((q) => /FROM equipment_notebook_turns/.test(q))).toMatch(/component_id/);
    expect(turns[0].componentId).toBe(COMPONENT);
  });

  it("control: a whole-machine turn returns null", async () => {
    wire([row("t2", null)]);
    const turns = await listTurns(TENANT, NB);
    expect(turns[0]).toHaveProperty("componentId", null);
  });
});
