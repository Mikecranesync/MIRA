// Vitest coverage for POST /api/decision-trace/[id]/feedback.

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const TRACE = "11111111-2222-3333-4444-555555555555";
const session = { userId: "u_1", tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", email: "x@y" };

// queue: array of row-sets returned by successive client.query calls
function wire(queue: unknown[][]) {
  let call = 0;
  const client = {
    query: vi.fn(async () => ({ rows: queue[call++] ?? [] })),
  };
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
  return client;
}
function post(id: string, body: unknown) {
  return POST(new Request("http://t", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
});

it("400 on a non-UUID id", async () => {
  const res = await post("nope", { verdict: "good" });
  expect(res.status).toBe(400);
});

it("422 on an invalid verdict", async () => {
  wire([[{ "?column?": 1 }]]);
  const res = await post(TRACE, { verdict: "maybe" });
  expect(res.status).toBe(422);
});

it("404 when the trace is not owned by the caller's tenant", async () => {
  wire([[]]); // ownership check returns no row
  const res = await post(TRACE, { verdict: "missing_context" });
  expect(res.status).toBe(404);
});

it("201 and records the verdict + creator for an owned trace", async () => {
  const client = wire([
    [{ "?column?": 1 }], // ownership check
    [{ feedback_id: "fb_1", verdict: "good", created_at: "2026-06-17" }], // insert
  ]);
  const res = await post(TRACE, { verdict: "good", note: "spot on" });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.verdict).toBe("good");
  // the INSERT bound trace id, tenant, verdict, and the creating user
  const insertArgs = (client.query.mock.calls[1] as unknown[])[1] as unknown[];
  expect(insertArgs).toContain(TRACE);
  expect(insertArgs).toContain(session.tenantId);
  expect(insertArgs).toContain("good");
  expect(insertArgs).toContain(session.userId);
});
