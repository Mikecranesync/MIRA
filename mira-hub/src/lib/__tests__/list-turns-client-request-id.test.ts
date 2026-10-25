// #4639: a persisted turn carries the id its asking client minted, so the
// phone can tell ITS saved turn from a same-question turn asked on web. The
// history read must return that id, and null (never a fabricated id) for a
// row sent without one.
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/list-turns-client-request-id

import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantMock = vi.hoisted(() => ({
  withTenantContext: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => tenantMock);
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { listTurns } from "../equipment-notebooks";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const PHONE_REQ = "c0000000-0000-4000-8000-000000000001";

const row = (id: string, clientRequestId: string | null) => ({
  id,
  question: "What trips F0003?",
  answer_status: "answered",
  answer_text: "F0003 trips at 135 C.",
  evidence: [],
  basis: null,
  created_at: "2026-10-25T10:00:00.000Z",
  client_request_id: clientRequestId,
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

describe("listTurns exposes the client request id (#4639)", () => {
  it("selects client_request_id and returns it as clientRequestId", async () => {
    const sql = wire([row("t1", PHONE_REQ)]);
    const turns = await listTurns(TENANT, NB);
    expect(sql.find((q) => /FROM equipment_notebook_turns/.test(q))).toMatch(/client_request_id/);
    expect(turns[0].clientRequestId).toBe(PHONE_REQ);
  });

  it("control: a row sent without an id returns null, not an invented id", async () => {
    wire([row("t2", null)]);
    const turns = await listTurns(TENANT, NB);
    expect(turns[0]).toHaveProperty("clientRequestId", null);
  });
});
