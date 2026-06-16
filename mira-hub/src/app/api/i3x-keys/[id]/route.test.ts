// TDD tests for DELETE /api/i3x-keys/[id] — revoke an API key.
//
// Run: cd mira-hub && npx vitest run 'src/app/api/i3x-keys/[id]/route.test.ts'
//
// Contract assertions:
//   - DELETE is scoped by BOTH id AND tenant_id (no cross-tenant revoke).
//   - Returns { deleted: true } on success.
//   - Returns 404 if no row matched.
//   - Returns 404 on Postgres 22P02 (malformed UUID in $1).
//   - Returns 401 when session is missing; DB never touched.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: { query: vi.fn() },
}));

import { DELETE } from "./route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_ID    = "uuuuuuuu-0000-0000-0000-000000000001";
const KEY_ID     = "12345678-1234-1234-1234-123456789abc";

const goodSession = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  email: "tech@plant.io",
  status: "active",
  trialExpiresAt: null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;
const sessionMock = sessionOr401 as ReturnType<typeof vi.fn>;

const makeDeleteReq = () =>
  new Request(`https://hub.test/api/i3x-keys/${KEY_ID}`, { method: "DELETE" });

const makeParams = (id: string) =>
  Promise.resolve({ id });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  sessionMock.mockResolvedValue(goodSession);
});

describe("DELETE /api/i3x-keys/[id] — revoke a key", () => {
  it("returns { deleted: true } when the row exists", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const res = await DELETE(makeDeleteReq(), { params: makeParams(KEY_ID) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deleted).toBe(true);
  });

  it("DELETE query is scoped by BOTH id ($1) AND tenant_id ($2)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    await DELETE(makeDeleteReq(), { params: makeParams(KEY_ID) });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
    expect(params[0]).toBe(KEY_ID);
    expect(params[1]).toBe(TENANT_ID);
  });

  it("returns 404 when no row matched (other tenant's key or already deleted)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });

    const res = await DELETE(makeDeleteReq(), { params: makeParams(KEY_ID) });
    expect(res.status).toBe(404);
  });

  it("returns 404 on Postgres 22P02 (malformed UUID)", async () => {
    const pgError = Object.assign(new Error("invalid input syntax for type uuid"), { code: "22P02" });
    queryMock.mockRejectedValueOnce(pgError);

    const res = await DELETE(makeDeleteReq(), { params: makeParams("not-a-uuid") });
    expect(res.status).toBe(404);
  });

  it("returns 401 and never queries DB when session is missing", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    sessionMock.mockResolvedValue(unauth);

    const res = await DELETE(makeDeleteReq(), { params: makeParams(KEY_ID) });
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
