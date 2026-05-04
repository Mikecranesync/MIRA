// Tests for the CMMS stats degraded path (CRA-37).
//
// The route used to return 503 when Atlas creds were missing and 502 when
// Atlas POSTs failed; both lit up the /cmms page with red errors in the
// browser network tab and Lighthouse audits. It now returns 200 with a
// `degraded: true` marker so the client falls back to STATIC_SUMMARY
// without surfacing a 5xx response.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));

import { sessionOr401 } from "@/lib/session";
import { GET } from "../route";

const goodCtx = { userId: "u_1", tenantId: "t_1", role: "member" as const };

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.resetAllMocks();
  (sessionOr401 as ReturnType<typeof vi.fn>).mockResolvedValue(goodCtx);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ATLAS_API_USER;
  delete process.env.ATLAS_API_PASSWORD;
});

describe("GET /api/cmms/stats — CRA-37 degraded path", () => {
  it("returns 200 + degraded:credentials_not_configured when Atlas creds are missing", async () => {
    // Both env vars absent → getToken short-circuits to null
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      degraded: true,
      reason: "credentials_not_configured",
    });
  });

  it("returns 200 + degraded:atlas_unreachable when Atlas search throws", async () => {
    process.env.ATLAS_API_USER = "user@example.com";
    process.env.ATLAS_API_PASSWORD = "pw";

    // First fetch (signin) succeeds; subsequent searches throw.
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ token: "fake" }), { status: 200 });
      }
      return new Response("upstream down", { status: 503 });
    }) as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      degraded: true,
      reason: "atlas_unreachable",
    });
  });

  it("returns 200 + real stats on the happy path (regression guard)", async () => {
    process.env.ATLAS_API_USER = "user@example.com";
    process.env.ATLAS_API_PASSWORD = "pw";

    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ token: "fake" }), { status: 200 });
      }
      // Each search responds with a totalElements payload
      return new Response(JSON.stringify({ totalElements: call }), { status: 200 });
    }) as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("degraded");
    expect(body.workOrders).toBeDefined();
    expect(body.assets).toBeDefined();
    expect(body.pms).toBeDefined();
    expect(typeof body.fetchedAt).toBe("string");
  });

  it("returns the 401 short-circuit when sessionOr401 fails", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    (sessionOr401 as ReturnType<typeof vi.fn>).mockResolvedValue(unauthorized);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
