import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "tenant-1", userId: "user-1" })),
}));

describe("/api/cmms/health", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.HUB_CMMS_API_URL = "http://cmms-backend:8080";
    process.env.CMMS_PUBLIC_URL = "https://cmms.factorylm.com";
    process.env.ATLAS_API_USER = "atlas@example.com";
    process.env.ATLAS_API_PASSWORD = "secret";
  });

  it("returns a browser-reachable public URL instead of the internal Docker host", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    expect(res).toBeInstanceOf(NextResponse);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.url).toBe("https://cmms.factorylm.com");
    expect(body.url).not.toContain("cmms-backend");
  });
});
