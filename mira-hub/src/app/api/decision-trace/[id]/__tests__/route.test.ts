// Vitest coverage for GET /api/decision-trace/[id].

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const TRACE = "11111111-2222-3333-4444-555555555555";
const session = { userId: "u_1", tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", email: "x@y" };

function wire(rows: unknown[]) {
  const client = { query: vi.fn(async () => ({ rows })) };
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
  return client;
}
function get(id: string) {
  return GET(new Request("http://t"), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
});

it("400 on a non-UUID id", async () => {
  const res = await get("not-a-uuid");
  expect(res.status).toBe(400);
});

it("404 when the trace is not found (or owned by another tenant)", async () => {
  wire([]); // tenant predicate yields no row
  const res = await get(TRACE);
  expect(res.status).toBe(404);
});

it("returns the shaped trace row for the owning tenant", async () => {
  const client = wire([
    {
      trace_id: TRACE,
      platform: "hub",
      user_question: "why won't it start?",
      manual_evidence: [{ doc: "GS10 manual", page: 12 }],
      recommendation: "Check the drive-enable permissive.",
      citations_present: true,
      confidence: "medium",
      outcome: "resolved",
      model_used: "Groq",
      latency_ms: 1200,
    },
  ]);
  const res = await get(TRACE);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.trace_id).toBe(TRACE);
  expect(body.confidence).toBe("medium");
  // tenant scoping: the query was filtered by trace_id AND tenant_id
  const sqlArgs = (client.query.mock.calls[0] as unknown[])[1] as unknown[];
  expect(sqlArgs).toContain(TRACE);
  expect(sqlArgs).toContain(session.tenantId);
});
