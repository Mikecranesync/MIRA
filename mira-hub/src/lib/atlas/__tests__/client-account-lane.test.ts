import { afterEach, describe, expect, it, vi } from "vitest";

import { AtlasClient, AtlasHttpError } from "../client";

// #5205: Atlas v1.8.0 fails concurrent requests for one account, so the client
// must never have two in flight for the same base URL + user.

const BASE_URL = "https://cmms.lane.test";

function stubSlowAtlas(failPaths: string[] = []) {
  const inFlight = new Map<string, number>();
  const maxInFlight = new Map<string, number>();
  const order: string[] = [];

  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/auth/signin")) {
      const { email } = JSON.parse(String(init.body)) as { email: string };
      return new Response(JSON.stringify({ accessToken: `tok-${email}` }), { status: 200 });
    }
    const auth = String((init.headers as Record<string, string>).Authorization);
    const now = (inFlight.get(auth) ?? 0) + 1;
    inFlight.set(auth, now);
    maxInFlight.set(auth, Math.max(maxInFlight.get(auth) ?? 0, now));
    await new Promise((r) => setTimeout(r, 5));
    inFlight.set(auth, (inFlight.get(auth) ?? 1) - 1);
    order.push(url.slice(BASE_URL.length));
    if (failPaths.some((p) => url.endsWith(p))) {
      return new Response("boom", { status: 500 });
    }
    return new Response(JSON.stringify({ content: [], totalElements: 1 }), { status: 200 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { maxInFlight, order };
}

function client(user = "tech@factorylm.com"): AtlasClient {
  return new AtlasClient({ baseUrl: BASE_URL, user, password: "pw" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AtlasClient one-request-at-a-time per account (#5205)", () => {
  it("never sends two requests at once for the same account, even across client instances", async () => {
    const { maxInFlight } = stubSlowAtlas();
    const a = client();
    const b = client();
    await Promise.all([
      a.searchWorkOrders({ status: "OPEN" }),
      a.searchWorkOrders({ status: "IN_PROGRESS" }),
      b.searchWorkOrders({ status: "COMPLETE" }),
      b.searchAssets({}),
      a.searchPMs({}),
    ]);
    expect(maxInFlight.get("Bearer tok-tech@factorylm.com")).toBe(1);
  });

  it("a failed request does not block the next one in the queue", async () => {
    stubSlowAtlas(["/assets/search"]);
    const c = client();
    const results = await Promise.allSettled([c.searchAssets({}), c.searchPMs({})]);
    expect(results[0].status).toBe("rejected");
    expect((results[0] as PromiseRejectedResult).reason).toBeInstanceOf(AtlasHttpError);
    expect(results[1].status).toBe("fulfilled");
  });

  it("control: different accounts are not queued behind each other", async () => {
    const { maxInFlight } = stubSlowAtlas();
    let overlapped = false;
    const one = client("one@factorylm.com");
    const two = client("two@factorylm.com");
    const p1 = one.searchAssets({});
    const p2 = two.searchAssets({});
    await new Promise((r) => setTimeout(r, 2));
    overlapped = vi.mocked(fetch).mock.calls.filter((c) => !String(c[0]).endsWith("/auth/signin")).length === 2;
    await Promise.all([p1, p2]);
    expect(overlapped).toBe(true);
    expect(maxInFlight.get("Bearer tok-one@factorylm.com")).toBe(1);
  });
});
