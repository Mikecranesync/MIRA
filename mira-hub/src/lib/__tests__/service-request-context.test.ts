import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const authHarness = vi.hoisted(() => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/session", () => authHarness);

import {
  internalServiceHeaders,
  requestContextOr401,
} from "@/lib/service-request-context";

const TOKEN = "test-only-shared-service-token-with-entropy";
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://hub.test/api/files", { headers });
}

async function responseBody(value: unknown): Promise<Record<string, unknown>> {
  expect(value).toBeInstanceOf(NextResponse);
  return (value as NextResponse).json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.HUB_INGEST_TOKEN = TOKEN;
  authHarness.sessionOr401.mockResolvedValue({
    userId: USER,
    tenantId: TENANT,
    email: "tech@example.test",
    status: "active",
    trialExpiresAt: null,
    role: "technician",
  });
});

describe("requestContextOr401", () => {
  it("preserves browser cookie auth when no Authorization header is present", async () => {
    const context = await requestContextOr401(request());
    expect(context).toMatchObject({
      authKind: "session",
      tenantId: TENANT,
      userId: USER,
      sourceChannel: null,
    });
    expect(authHarness.sessionOr401).toHaveBeenCalledTimes(1);
  });

  it("returns the existing browser auth response unchanged", async () => {
    authHarness.sessionOr401.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const result = await requestContextOr401(request());
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("accepts a valid service token with canonical UUID tenant and actor identity", async () => {
    const context = await requestContextOr401(
      request({
        Authorization: `Bearer ${TOKEN}`,
        "X-Mira-Tenant-Id": TENANT.toUpperCase(),
        "X-Mira-User-Id": USER.toUpperCase(),
        "X-Mira-Source-Channel": "telegram",
      }),
    );
    expect(context).toMatchObject({
      authKind: "service",
      tenantId: TENANT,
      userId: USER,
      sourceChannel: "telegram",
      role: "service",
    });
    expect(authHarness.sessionOr401).not.toHaveBeenCalled();
  });

  it("returns 503 when service authentication is requested but the server token is absent", async () => {
    delete process.env.HUB_INGEST_TOKEN;
    const result = await requestContextOr401(
      request({
        Authorization: `Bearer ${TOKEN}`,
        "X-Mira-Tenant-Id": TENANT,
        "X-Mira-User-Id": USER,
      }),
    );
    expect((result as NextResponse).status).toBe(503);
    expect(await responseBody(result)).toEqual({ error: "service_auth_not_configured" });
    expect(authHarness.sessionOr401).not.toHaveBeenCalled();
  });

  it("rejects bad and malformed Authorization without cookie-session fallback", async () => {
    for (const authorization of ["Bearer x", "Basic abc", "Bearer "]) {
      const result = await requestContextOr401(
        request({
          Authorization: authorization,
          "X-Mira-Tenant-Id": TENANT,
          "X-Mira-User-Id": USER,
        }),
      );
      expect((result as NextResponse).status).toBe(401);
      expect(await responseBody(result)).toEqual({ error: "service_unauthorized" });
    }
    expect(authHarness.sessionOr401).not.toHaveBeenCalled();
  });

  it("rejects missing or malformed service tenant and actor IDs", async () => {
    for (const headers of [
      { "X-Mira-User-Id": USER },
      { "X-Mira-Tenant-Id": "tenant-slug", "X-Mira-User-Id": USER },
      { "X-Mira-Tenant-Id": TENANT },
      { "X-Mira-Tenant-Id": TENANT, "X-Mira-User-Id": "telegram:42" },
    ]) {
      const result = await requestContextOr401(
        request({ Authorization: `Bearer ${TOKEN}`, ...headers }),
      );
      expect((result as NextResponse).status).toBe(422);
      expect(await responseBody(result)).toEqual({ error: "invalid_service_identity" });
    }
    expect(authHarness.sessionOr401).not.toHaveBeenCalled();
  });

  it("rejects an unknown source channel instead of trusting a free-form header", async () => {
    const result = await requestContextOr401(
      request({
        Authorization: `Bearer ${TOKEN}`,
        "X-Mira-Tenant-Id": TENANT,
        "X-Mira-User-Id": USER,
        "X-Mira-Source-Channel": "email",
      }),
    );
    expect((result as NextResponse).status).toBe(422);
    expect(await responseBody(result)).toEqual({ error: "invalid_source_channel" });
  });
});

describe("internalServiceHeaders", () => {
  it("builds the one canonical service-auth envelope", () => {
    const headers = new Headers(
      internalServiceHeaders({ tenantId: TENANT, userId: USER, sourceChannel: "slack" }),
    );
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("x-mira-tenant-id")).toBe(TENANT);
    expect(headers.get("x-mira-user-id")).toBe(USER);
    expect(headers.get("x-mira-source-channel")).toBe("slack");
  });

  it("fails before dispatch when service auth is unconfigured or identity is malformed", () => {
    delete process.env.HUB_INGEST_TOKEN;
    expect(() => internalServiceHeaders({ tenantId: TENANT, userId: USER })).toThrow(
      "service_auth_not_configured",
    );
    process.env.HUB_INGEST_TOKEN = TOKEN;
    expect(() => internalServiceHeaders({ tenantId: "bad", userId: USER })).toThrow(
      "invalid_service_identity",
    );
  });
});
