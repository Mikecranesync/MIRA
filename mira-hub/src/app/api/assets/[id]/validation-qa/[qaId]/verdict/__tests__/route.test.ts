// Vitest coverage for PUT /api/assets/[id]/validation-qa/[qaId]/verdict.

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { PUT } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const ID = "11111111-2222-3333-4444-555555555555";
const QA = "99999999-8888-7777-6666-555555555555";
const session = { userId: "u_1", tenantId: "tenant-aaaa", email: "x@y" };
const params = Promise.resolve({ id: ID, qaId: QA });

function wire(rows: unknown[]) {
  const client = {
    query: vi.fn(async () => ({ rows })),
  };
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
  return client;
}
function put(body: unknown) {
  return PUT(new Request("http://t", { method: "PUT", body: JSON.stringify(body) }), {
    params,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
});

it("400 on an invalid verdict", async () => {
  wire([]);
  const res = await put({ verdict: "maybe" });
  expect(res.status).toBe(400);
});

it("404 when the Q&A row is not found", async () => {
  wire([]);
  const res = await put({ verdict: "good" });
  expect(res.status).toBe(404);
});

it("maps the approve alias to 'good' and records the reviewer", async () => {
  const client = wire([
    { id: QA, reviewer_verdict: "good", reviewed_by: "human:u_1", reviewed_at: "2026-06-07" },
  ]);
  const res = await put({ verdict: "approve" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.reviewerVerdict).toBe("good");
  // verdict 'good' was written, not the raw alias
  const sqlArgs = (client.query.mock.calls[0] as unknown[])[1] as unknown[];
  expect(sqlArgs).toContain("good");
  expect(sqlArgs).toContain("human:u_1");
});

it("maps reject → bad", async () => {
  const client = wire([{ id: QA, reviewer_verdict: "bad" }]);
  await put({ verdict: "reject" });
  const sqlArgs = (client.query.mock.calls[0] as unknown[])[1] as unknown[];
  expect(sqlArgs).toContain("bad");
});
