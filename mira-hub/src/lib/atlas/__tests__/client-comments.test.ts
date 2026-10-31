import { describe, expect, it, vi, afterEach } from "vitest";

import { AtlasClient, AtlasHttpError } from "../client";

const BASE_URL = "https://cmms.test.local";

interface RecordedCall {
  url: string;
  method?: string;
  body?: string;
  headers: Record<string, string>;
}

function stubFetch(responses: Record<string, { status: number; body: unknown }>) {
  const calls: RecordedCall[] = [];

  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init.method, body: init.body as string | undefined, headers });

    if (url === `${BASE_URL}/auth/signin`) {
      return new Response(JSON.stringify({ accessToken: "test-token" }), { status: 200 });
    }

    for (const [path, res] of Object.entries(responses)) {
      if (url === `${BASE_URL}${path}`) {
        return new Response(JSON.stringify(res.body), { status: res.status });
      }
    }

    throw new Error(`stubFetch: no stubbed response for ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function newClient(): AtlasClient {
  return new AtlasClient({ baseUrl: BASE_URL, user: "tech@factorylm.com", password: "pw" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AtlasClient comment methods", () => {
  it("countComments: GET /comments/count/{id} with a bearer token", async () => {
    const { calls } = stubFetch({
      "/comments/count/42": { status: 200, body: { count: 5 } },
    });

    const client = newClient();
    const result = await client.countComments(42);

    expect(result).toEqual({ count: 5 });

    const call = calls.find((c) => c.url === `${BASE_URL}/comments/count/42`);
    expect(call).toBeDefined();
    expect(call!.method).toBe("GET");
    expect(call!.headers.Authorization).toBe("Bearer test-token");
  });

  it("createComment: POST /comments with {workOrder:{id}, content} and a bearer token", async () => {
    const { calls } = stubFetch({
      "/comments": { status: 200, body: { id: 99, content: "hi", system: false } },
    });

    const client = newClient();
    const payload = { workOrder: { id: 42 }, content: "hi" };
    const result = await client.createComment(payload);

    expect(result).toEqual({ id: 99, content: "hi", system: false });

    const call = calls.find((c) => c.url === `${BASE_URL}/comments`);
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
    expect(JSON.parse(call!.body!)).toEqual(payload);
    expect(call!.headers.Authorization).toBe("Bearer test-token");
  });

  it("searchComments: POST /comments/search/{id} with an empty body and a bearer token", async () => {
    const { calls } = stubFetch({
      "/comments/search/42": { status: 200, body: [{ id: 1, content: "x", system: true }] },
    });

    const client = newClient();
    const result = await client.searchComments(42);

    expect(result).toEqual([{ id: 1, content: "x", system: true }]);

    const call = calls.find((c) => c.url === `${BASE_URL}/comments/search/42`);
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
    expect(JSON.parse(call!.body!)).toEqual({});
    expect(call!.headers.Authorization).toBe("Bearer test-token");
  });

  it("throws AtlasHttpError on a 404 (legacy Atlas without CommentController)", async () => {
    stubFetch({
      "/comments/count/999": { status: 404, body: "No static resource comments/count/999." },
    });

    const client = newClient();
    await expect(client.countComments(999)).rejects.toBeInstanceOf(AtlasHttpError);
  });
});
