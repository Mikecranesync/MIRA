// TDD tests for POST /api/i3x-keys (mint) and GET /api/i3x-keys (list).
//
// Run: cd mira-hub && npx vitest run src/app/api/i3x-keys/route.test.ts
//
// Mocks @/lib/session and @/lib/db to keep this fully unit-level (no DB needed).
// Core contract assertions:
//   POST — returns plaintext once; INSERT receives the hash (not plaintext);
//           INSERT is scoped to ctx.tenantId; plaintext has the mira_i3x_ prefix.
//   GET  — returns rows; SELECT never includes key_hash column.
//   Auth — 401 response propagated to caller; DB never touched when unauthorised.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: { query: vi.fn() },
}));

import { POST, GET } from "./route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_ID    = "uuuuuuuu-0000-0000-0000-000000000001";

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

const makePostReq = (body?: unknown) =>
  new Request("https://hub.test/api/i3x-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const makeGetReq = () => new Request("https://hub.test/api/i3x-keys");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  sessionMock.mockResolvedValue(goodSession);
});

// ─── POST (mint) ──────────────────────────────────────────────────────────────

describe("POST /api/i3x-keys — mint a key", () => {
  it("returns the plaintext key (starts with mira_i3x_) exactly once", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "key-uuid-1", label: "My key", created_at: "2026-06-16T00:00:00Z" }],
    });

    const res = await POST(makePostReq({ label: "My key" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.key).toBeDefined();
    expect(body.key).toMatch(/^mira_i3x_/);
    expect(body.id).toBe("key-uuid-1");
    expect(body.label).toBe("My key");
  });

  it("stores the hash, NOT the plaintext, in the INSERT", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "key-uuid-2", label: null, created_at: "2026-06-16T00:00:00Z" }],
    });

    const res = await POST(makePostReq({ label: "test" }));
    const body = await res.json();

    const [_sql, params] = queryMock.mock.calls[0] as [string, unknown[]];

    const plaintext = body.key as string;

    // params[0] = tenant_id, params[1] = hash, params[2] = label
    const storedHash = params[1] as string;
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedHash).not.toBe(plaintext);
  });

  it("INSERT is scoped to ctx.tenantId as $1", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "key-uuid-3", label: null, created_at: "2026-06-16T00:00:00Z" }],
    });

    await POST(makePostReq({}));

    const [_sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(TENANT_ID);
  });

  it("tolerates missing / malformed body and still mints a key", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "key-uuid-4", label: null, created_at: "2026-06-16T00:00:00Z" }],
    });

    // No body at all
    const res = await POST(new Request("https://hub.test/api/i3x-keys", { method: "POST" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^mira_i3x_/);
  });

  it("returns 401 and never queries DB when session is missing", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    sessionMock.mockResolvedValue(unauth);

    const res = await POST(makePostReq({ label: "x" }));
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

// ─── GET (list) ───────────────────────────────────────────────────────────────

describe("GET /api/i3x-keys — list tenant keys", () => {
  it("returns rows under a 'keys' key", async () => {
    const fakeRows = [
      { id: "k1", label: "Prod key", enabled: true, created_at: "2026-06-01T00:00:00Z", last_used_at: null },
      { id: "k2", label: null,       enabled: false, created_at: "2026-06-02T00:00:00Z", last_used_at: "2026-06-10T00:00:00Z" },
    ];
    queryMock.mockResolvedValueOnce({ rows: fakeRows });

    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.keys).toHaveLength(2);
    expect(body.keys[0].id).toBe("k1");
  });

  it("SELECT does NOT include key_hash column", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await GET(makeGetReq());

    const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/key_hash/);
  });

  it("SELECT is scoped to ctx.tenantId", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await GET(makeGetReq());

    const [_sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(TENANT_ID);
  });

  it("returns 401 and never queries DB when session is missing", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    sessionMock.mockResolvedValue(unauth);

    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
