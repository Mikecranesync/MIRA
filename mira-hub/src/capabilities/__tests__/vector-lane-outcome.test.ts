/**
 * Every notebook retrieval records whether the vector lane ran, on the turn's
 * trace (`mira.retrieval.vector_lane`). On 2026-10-19 staging the lane was ON
 * yet the first asks after a deploy silently served BM25 only (the cold
 * embedder timed out) and nothing on the trace or in the flight recorder said
 * so. A skip also logs a warning.
 *
 * Run: npx vitest run src/capabilities/__tests__/vector-lane-outcome.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

const spanAttrs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/capabilities/observability/tracing", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  setSpanAttrs: (attrs: Record<string, unknown>) => {
    spanAttrs.push(attrs);
  },
}));

import { retrieveNodeChunks } from "../../lib/manual-rag";

const VEC = Array.from({ length: 768 }, (_, i) => (i % 5) / 10);
const LEXICAL = [
  { content: "Carrier frequency P2.04 sets the PWM switching frequency.", source_url: "node-doc/u1/gs10.pdf", source_page: 10, page_start: 10, section_path: null, filename: "gs10.pdf", doc_id: "d-1", rank: 0.4 },
];

function client(opts: { vectorFails?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (/^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(sql)) return { rows: [] };
    if (sql.includes("<=>")) {
      if (opts.vectorFails) throw Object.assign(new Error("statement timeout"), { code: "57014" });
      return { rows: [] };
    }
    if (sql.includes("ts_rank_cd")) return { rows: LEXICAL };
    return { rows: [] };
  });
  return { query } as unknown as PoolClient;
}

const ask = (c: PoolClient) =>
  retrieveNodeChunks(c, "t-1", "what carrier frequency should I use", {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    topK: 3,
  });

const lane = () => spanAttrs.map((a) => a["mira.retrieval.vector_lane"]).filter((v) => v !== undefined);

beforeEach(() => {
  spanAttrs.length = 0;
  process.env.OLLAMA_BASE_URL = "http://embedder.test";
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.NOTEBOOK_HYBRID_RETRIEVAL;
  delete process.env.OLLAMA_BASE_URL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mira.retrieval.vector_lane on the turn trace", () => {
  it("records 'off' when the flag is off, and never calls the embedder", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await ask(client());
    expect(lane()).toEqual(["off"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records 'ran' when the embed and the vector SELECT both succeed", async () => {
    process.env.NOTEBOOK_HYBRID_RETRIEVAL = "1";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: VEC }), { status: 200 })));
    await ask(client());
    expect(lane()).toEqual(["ran"]);
  });

  it("records 'skipped_timeout' and warns when the cold embedder times out (the 2026-10-19 staging case)", async () => {
    process.env.NOTEBOOK_HYBRID_RETRIEVAL = "1";
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); }));
    const chunks = await ask(client());
    expect(chunks.length).toBeGreaterThan(0); // lexical result still served
    expect(lane()).toEqual(["skipped_timeout"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/vector lane skipped.*timeout/i));
  });

  it("records 'failed' when the vector SELECT itself fails", async () => {
    process.env.NOTEBOOK_HYBRID_RETRIEVAL = "1";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: VEC }), { status: 200 })));
    await ask(client({ vectorFails: true }));
    expect(lane()).toEqual(["failed"]);
  });
});
