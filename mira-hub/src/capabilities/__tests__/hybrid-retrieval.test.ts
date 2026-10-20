/**
 * Item 4 (2026-10-17 prod test): the vector lane + RRF merge, in isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBED_DIM, EMBED_MODEL } from "@/lib/node-knowledge-ingest";
import {
  QUERY_EMBED_DIM,
  QUERY_EMBED_MODEL,
  QUERY_EMBED_KEEP_ALIVE,
  __resetQueryEmbedderWarmForTests,
  embedQuery,
  embedQueryDetailed,
  hybridRetrievalEnabled,
  warmQueryEmbedder,
  rrfMerge,
  vectorLiteral,
} from "../hybrid-retrieval";

afterEach(() => {
  delete process.env.NOTEBOOK_HYBRID_RETRIEVAL;
  delete process.env.OLLAMA_BASE_URL;
  vi.unstubAllGlobals();
});

describe("embedding contract parity", () => {
  it("the query embeds with exactly the model + dimension the write path stores", () => {
    expect(QUERY_EMBED_MODEL).toBe(EMBED_MODEL);
    expect(QUERY_EMBED_DIM).toBe(EMBED_DIM);
  });
});

describe("hybridRetrievalEnabled", () => {
  it("defaults OFF and only '1' enables it", () => {
    expect(hybridRetrievalEnabled()).toBe(false);
    process.env.NOTEBOOK_HYBRID_RETRIEVAL = "1";
    expect(hybridRetrievalEnabled()).toBe(true);
    process.env.NOTEBOOK_HYBRID_RETRIEVAL = "true";
    expect(hybridRetrievalEnabled()).toBe(false);
  });
});

describe("embedQuery", () => {
  const vec = Array.from({ length: 768 }, (_, i) => (i % 7) / 10);
  beforeEach(() => {
    process.env.OLLAMA_BASE_URL = "http://embedder.test";
  });

  it("posts the question to the embedder with the write path's model and returns the 768-vector", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ embedding: vec }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await embedQuery("carrier frequency")).toEqual(vec);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://embedder.test/api/embeddings");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "nomic-embed-text",
      prompt: "carrier frequency",
      keep_alive: QUERY_EMBED_KEEP_ALIVE,
    });
  });

  it("returns null (lexical only) when no embedder is configured, on HTTP error, on a wrong dimension, or on a thrown fetch", async () => {
    delete process.env.OLLAMA_BASE_URL;
    expect(await embedQuery("x")).toBeNull();
    process.env.OLLAMA_BASE_URL = "http://embedder.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await embedQuery("x")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: [1, 2, 3] }), { status: 200 })));
    expect(await embedQuery("x")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await embedQuery("x")).toBeNull();
  });

  it("never embeds an empty question", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await embedQuery("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("vectorLiteral", () => {
  it("renders the pgvector text form", () => {
    expect(vectorLiteral([0.1, -2, 3])).toBe("[0.1,-2,3]");
  });
});

describe("rrfMerge", () => {
  const key = (s: string) => s;

  it("with an empty vector list the output IS the lexical list (byte-identical fallback)", () => {
    expect(rrfMerge(["a", "b", "c"], [], key)).toEqual(["a", "b", "c"]);
  });

  it("a chunk ranked low lexically but first by vector rises; a vector-only chunk is added, not dropped", () => {
    const out = rrfMerge(["a", "b", "c", "d"], ["d", "z", "a"], key);
    expect(out.indexOf("d")).toBeLessThan(out.indexOf("b"));
    expect(out).toContain("z");
    // present in both lists beats present in one, all else equal
    expect(out[0]).toBe("a");
  });

  it("keeps the lexical object for an item in both lists and breaks ties toward lexical order", () => {
    type Row = { id: string; from: string };
    const lex: Row[] = [{ id: "a", from: "lex" }, { id: "b", from: "lex" }];
    const vec: Row[] = [{ id: "b", from: "vec" }, { id: "a", from: "vec" }];
    const out = rrfMerge(lex, vec, (r) => r.id);
    expect(out.map((r) => r.from)).toEqual(["lex", "lex"]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]); // equal scores → lexical order
  });

  it("is deterministic and never duplicates a key", () => {
    const out = rrfMerge(["a", "a", "b"], ["b", "b", "c"], key);
    expect(out).toEqual([...new Set(out)]);
    expect(out).toEqual(rrfMerge(["a", "a", "b"], ["b", "b", "c"], key));
  });
});

// 2026-10-19 staging: after a deploy the embedder's first call loaded the model
// cold, blew the 5 s timeout, and the turn silently fell back to BM25 (traces
// bc2aac99…, 36a27118…); with the model warm the same TQ-06 ask cited p.238.
describe("keeping the query embedder warm", () => {
  const vec = Array.from({ length: 768 }, (_, i) => (i % 7) / 10);
  beforeEach(() => {
    process.env.OLLAMA_BASE_URL = "http://embedder.test";
    __resetQueryEmbedderWarmForTests();
  });

  it("asks Ollama to keep the model loaded long enough to outlive idle gaps", () => {
    expect(QUERY_EMBED_KEEP_ALIVE).toBe("24h");
  });

  it("names why an embed failed, so the caller can record it", async () => {
    delete process.env.OLLAMA_BASE_URL;
    expect(await embedQueryDetailed("x")).toEqual({ reason: "not_configured" });
    process.env.OLLAMA_BASE_URL = "http://embedder.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await embedQueryDetailed("x")).toEqual({ reason: "http_error" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: [1, 2, 3] }), { status: 200 })));
    expect(await embedQueryDetailed("x")).toEqual({ reason: "bad_dimension" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); }));
    expect(await embedQueryDetailed("x")).toEqual({ reason: "timeout" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await embedQueryDetailed("x")).toEqual({ reason: "unreachable" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: vec }), { status: 200 })));
    expect(await embedQueryDetailed("x")).toEqual({ vec });
  });

  it("warms once per process, and only when the vector lane is on", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ embedding: vec }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await warmQueryEmbedder()).toBe("off");
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.NOTEBOOK_HYBRID_RETRIEVAL = "1";
    expect(await warmQueryEmbedder()).toBe("ok");
    expect(await warmQueryEmbedder()).toBe("already_started");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).keep_alive).toBe(QUERY_EMBED_KEEP_ALIVE);
  });

  it("a failed warm-up is reported, never thrown", async () => {
    process.env.NOTEBOOK_HYBRID_RETRIEVAL = "1";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(warmQueryEmbedder()).resolves.toBe("unreachable");
  });
});
