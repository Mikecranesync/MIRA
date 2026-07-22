// Run: npx vitest run src/app/api/visual/__tests__/sessions.test.ts
//
// Visual sessions collection — SQL-contract tests (repo pattern from
// api/documents/__tests__/route.test.ts): mock session + tenant-context,
// assert the emitted SQL carries the explicit tenant predicate.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const queryMock = vi.fn();
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: (_tenantId: string, fn: (c: unknown) => unknown) =>
    fn({ query: queryMock }),
}));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));

process.env.NEON_DATABASE_URL ||= "postgres://unit-test/none";

import { GET, POST } from "@/app/api/visual/sessions/route";
import { sessionOr401 } from "@/lib/session";

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CTX = {
  userId: "u-1",
  tenantId: TENANT,
  email: "tech@example.com",
  status: "active",
  trialExpiresAt: null,
};

beforeEach(() => {
  queryMock.mockReset();
  vi.mocked(sessionOr401).mockResolvedValue(CTX as never);
});

describe("GET /api/visual/sessions", () => {
  it("returns 401 passthrough when unauthenticated", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await GET(new Request("http://x/api/visual/sessions"));
    expect(res.status).toBe(401);
  });

  it("lists with an explicit tenant predicate and clamped limit", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await GET(new Request("http://x/api/visual/sessions?limit=9999"));
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FROM visual_session/);
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(params[0]).toBe(TENANT);
    expect(params[1]).toBe(100); // clamped
  });
});

describe("POST /api/visual/sessions", () => {
  it("creates with the caller's tenant and returns 201", async () => {
    queryMock.mockResolvedValue({
      rows: [{ session_id: "s-1", title: "Panel A", status: "active" }],
    });
    const res = await POST(
      new Request("http://x/api/visual/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "  Panel A  " }),
      }),
    );
    expect(res.status).toBe(201);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO visual_session/);
    expect(params[0]).toBe(TENANT);
    expect(params[1]).toBe("Panel A"); // trimmed
    const body = await res.json();
    expect(body.session.session_id).toBe("s-1");
  });

  it("tolerates an empty body (untitled session)", async () => {
    queryMock.mockResolvedValue({ rows: [{ session_id: "s-2" }] });
    const res = await POST(new Request("http://x/api/visual/sessions", { method: "POST" }));
    expect(res.status).toBe(201);
    expect(queryMock.mock.calls[0][1][1]).toBeNull();
  });
});
