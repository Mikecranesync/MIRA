// mira-hub/src/lib/auth/__tests__/route-helpers.test.ts
//
// Unit tests for the auth wrapper. Pure-function — no DB, no network.
// Mocks the session module surface so we can drive each branch.
//
// Run: cd mira-hub && npx vitest run src/lib/auth/__tests__/route-helpers.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Mock the session module BEFORE importing the wrapper.
vi.mock("../session", async () => {
  const actual = await vi.importActual<typeof import("../session")>("../session");
  return {
    ...actual,
    requireSession: vi.fn(),
    getSession: vi.fn(),
    requireRole: vi.fn(),
  };
});

import {
  withSession,
  withSessionAndRole,
  withOptionalSession,
} from "../route-helpers";
import { requireSession, getSession, requireRole, HttpAuthError } from "../session";

const mockReq = (headers: Record<string, string> = {}): Request =>
  new Request("https://acme.factorylm.com/api/v1/anything", { headers });

const goodSession = {
  userId: "u_1",
  tenantId: "t_1",
  role: "member" as const,
  exp: Date.now() / 1000 + 3600,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("withSession", () => {
  it("calls fn with session when JWT is valid", async () => {
    vi.mocked(requireSession).mockResolvedValue(goodSession);
    const fn = vi.fn(async (_req, session) =>
      NextResponse.json({ tenantId: session.tenantId }),
    );

    const handler = withSession(fn);
    const res = await handler(mockReq(), {});

    expect(fn).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ tenantId: "t_1" });
  });

  it("returns 401 when no session", async () => {
    vi.mocked(requireSession).mockRejectedValue(new HttpAuthError(401, "unauthorized"));
    const fn = vi.fn();

    const handler = withSession(fn);
    const res = await handler(mockReq(), {});

    expect(fn).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: "unauthorized" },
    });
  });

  it("returns 401 when JWT tenant mismatches subdomain (replay attack)", async () => {
    vi.mocked(requireSession).mockRejectedValue(
      new HttpAuthError(401, "tenant_mismatch"),
    );
    const handler = withSession(vi.fn());
    const res = await handler(mockReq(), {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "tenant_mismatch", message: "tenant_mismatch" },
    });
  });

  it("translates HttpAuthError thrown inside fn", async () => {
    vi.mocked(requireSession).mockResolvedValue(goodSession);
    const handler = withSession(async () => {
      throw new HttpAuthError(403, "forbidden");
    });
    const res = await handler(mockReq(), {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "forbidden" },
    });
  });

  it("returns 500 with requestId on uncaught error inside fn", async () => {
    vi.mocked(requireSession).mockResolvedValue(goodSession);
    const handler = withSession(async () => {
      throw new Error("kaboom");
    });
    const res = await handler(mockReq({ "x-request-id": "req_test_123" }), {});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        code: "internal_error",
        message: "internal error",
        requestId: "req_test_123",
      },
    });
  });

  it("generates a requestId when caller doesn't supply one", async () => {
    vi.mocked(requireSession).mockResolvedValue(goodSession);
    const handler = withSession(async () => {
      throw new Error("kaboom");
    });
    const res = await handler(mockReq(), {});
    const body = await res.json();
    expect(body.error.requestId).toMatch(/.+/);
  });

  it("never throws — even unknown auth-path errors → 401", async () => {
    vi.mocked(requireSession).mockRejectedValue(new Error("WAT"));
    const handler = withSession(vi.fn());
    const res = await handler(mockReq(), {});
    expect(res.status).toBe(401);
  });
});

describe("withSessionAndRole", () => {
  it("denies when role mismatches", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ...goodSession, role: "member" });
    vi.mocked(requireRole).mockImplementation((_session, ...allowed) => {
      if (!allowed.includes(_session.role)) throw new HttpAuthError(403, "forbidden");
    });
    const handler = withSessionAndRole(["admin"], vi.fn());
    const res = await handler(mockReq(), {});
    expect(res.status).toBe(403);
  });

  it("allows when role matches", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ...goodSession, role: "admin" });
    vi.mocked(requireRole).mockImplementation(() => {
      // no-op = allowed
    });
    const fn = vi.fn(async () => NextResponse.json({ ok: true }));
    const handler = withSessionAndRole(["admin", "owner"], fn);
    const res = await handler(mockReq(), {});
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("withOptionalSession", () => {
  it("passes null session when no JWT", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const fn = vi.fn(async (_req, session) =>
      NextResponse.json({ anonymous: session === null }),
    );
    const handler = withOptionalSession(fn);
    const res = await handler(mockReq(), {});
    expect(await res.json()).toEqual({ anonymous: true });
  });

  it("passes session when JWT is valid", async () => {
    vi.mocked(getSession).mockResolvedValue(goodSession);
    const fn = vi.fn(async (_req, session) =>
      NextResponse.json({ tenantId: session?.tenantId }),
    );
    const handler = withOptionalSession(fn);
    const res = await handler(mockReq(), {});
    expect(await res.json()).toEqual({ tenantId: "t_1" });
  });

  it("treats malformed token as anonymous (does not 401)", async () => {
    vi.mocked(getSession).mockRejectedValue(new Error("bad jwt"));
    const fn = vi.fn(async (_req, session) =>
      NextResponse.json({ anonymous: session === null }),
    );
    const handler = withOptionalSession(fn);
    const res = await handler(mockReq(), {});
    expect(await res.json()).toEqual({ anonymous: true });
  });
});
