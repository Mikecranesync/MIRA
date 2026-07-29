import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({
    tenantId: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    email: "owner@example.com",
    status: "active",
    trialExpiresAt: null,
  })),
}));

describe("/api/cmms/sso", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.stubEnv("HUB_CMMS_API_URL", "http://cmms-backend:8080");
    vi.stubEnv("CMMS_PUBLIC_URL", "https://cmms.factorylm.com");
    vi.stubEnv("HUB_SSO_SECRET", "test-secret");
    vi.stubEnv("HUB_SSO_ISSUER", "factorylm-hub");
    vi.stubEnv("HUB_SSO_AUDIENCE", "atlas-cmms");
  });

  it("exchanges the Hub session for an Atlas token and redirects to the CMMS token handoff", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ accessToken: "atlas.jwt" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../route");
    const req = new NextRequest("https://app.factorylm.com/api/cmms/sso?redirect=/app/assets");

    const res = await GET(req);

    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://cmms.factorylm.com/oauth2/success?token=atlas.jwt&redirect=%2Fapp%2Fassets",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://cmms-backend:8080/auth/sso/hub",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.assertion).toEqual(expect.any(String));
    expect(body.assertion.split(".")).toHaveLength(3);
  });

  it("falls back to the work-order route when redirect is not an app path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ accessToken: "atlas.jwt" }), { status: 200 })),
    );

    const { GET } = await import("../route");
    const req = new NextRequest("https://app.factorylm.com/api/cmms/sso?redirect=https://evil.example");

    const res = await GET(req);

    expect(res.headers.get("location")).toBe(
      "https://cmms.factorylm.com/oauth2/success?token=atlas.jwt&redirect=%2Fapp%2Fwork-orders",
    );
  });

  it("returns 503 when the shared SSO secret is missing", async () => {
    vi.stubEnv("HUB_SSO_SECRET", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../route");
    const req = new NextRequest("https://app.factorylm.com/api/cmms/sso");

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe("cmms_sso_not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
