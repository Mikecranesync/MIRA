import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "tenant-1", userId: "user-1" })),
}));

// #5205: Atlas v1.8.0 returns 500 when one account sends concurrent searches,
// which turned this route into a permanent 502. It must send them one at a time.
describe("/api/cmms/stats", () => {
  let inFlight = 0;
  let maxInFlight = 0;

  beforeEach(() => {
    vi.resetModules();
    inFlight = 0;
    maxInFlight = 0;
    process.env.HUB_CMMS_API_URL = "http://cmms-backend:8080";
    process.env.ATLAS_API_USER = "atlas@example.com";
    process.env.ATLAS_API_PASSWORD = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/signin")) {
          return new Response(JSON.stringify({ accessToken: "tok" }), { status: 200 });
        }
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        const collided = inFlight > 1;
        inFlight -= 1;
        // Behave like Atlas v1.8.0: an overlapping request for the same user fails.
        if (collided) return new Response("race", { status: 500 });
        return new Response(JSON.stringify({ content: [], totalElements: 2 }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the five Atlas searches one at a time and returns the counts", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(maxInFlight).toBe(1);
    const body = await res.json();
    expect(body.workOrders).toMatchObject({ open: 2, inprogress: 2, completed: 2 });
    expect(body.assets.total).toBe(2);
    expect(body.pms.total).toBe(2);
  });

  it("stops at the first failed search instead of leaving the rest queued", async () => {
    const searches: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/signin")) {
          return new Response(JSON.stringify({ accessToken: "tok" }), { status: 200 });
        }
        searches.push(url);
        return new Response("down", { status: 500 });
      }),
    );
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(502);
    await new Promise((r) => setTimeout(r, 20));
    expect(searches).toHaveLength(1);
  });
});
