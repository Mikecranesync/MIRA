/**
 * #4579 — the reranker's outcome is recorded on the retrieval span, not only
 * logged. A fallback used to reach `console.warn` alone, so no staging A/B could
 * say whether rerank actually ran. `mira.retrieval.rerank` is one of:
 *   off | ran | skipped_broad | skipped_short | fallback_<reason>
 * Same mechanism as `mira.retrieval.vector_lane` (#4549): setSpanAttrs on the
 * active span, plus opts.diagnostics for the caller's own span.
 *
 * Run: npx vitest run src/capabilities/__tests__/rerank-outcome.test.ts
 */
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spanAttrs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/capabilities/observability/tracing", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  setSpanAttrs: (attrs: Record<string, unknown>) => {
    spanAttrs.push(attrs);
  },
}));

import { retrieveNodeChunks } from "../../lib/manual-rag";

const mk = (page: number, content: string, rank: number) => ({
  content,
  doc_id: "d-1",
  source_url: "node-doc/u1/manual.pdf",
  source_page: page,
  page_start: page,
  section_path: null,
  filename: "manual.pdf",
  document_heading: "Drive User Manual",
  verified: false,
  rank,
});

const ROWS = [
  mk(10, "Drive mounting dimensions and clearance requirements for the enclosure.", 0.9),
  mk(20, "Keypad navigation: press MODE to cycle through the parameter groups.", 0.6),
  mk(30, "Braking resistor selection and wiring for fast deceleration.", 0.3),
];
const NARROW = "how do I set the braking resistor";
const BROAD = "what communication protocols does it support";

function client(rows: Record<string, unknown>[] = ROWS): PoolClient {
  return { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
}

type Diag = { rerank?: string; rerankMs?: number | null; searchPath?: string };
const ask = (question: string, opts: { diagnostics?: Diag; rows?: Record<string, unknown>[] } = {}) =>
  retrieveNodeChunks(client(opts.rows), "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    rawQuery: question,
    ...(opts.diagnostics ? { diagnostics: opts.diagnostics } : {}),
  });

const attr = (k: string) => spanAttrs.map((a) => a[k]).filter((v) => v !== undefined);
const rerankAttr = () => attr("mira.retrieval.rerank");
const scoresOk = () =>
  vi.fn(async (_url: string, init: RequestInit) => {
    const { passages } = JSON.parse(String(init.body)) as { passages: string[] };
    return new Response(JSON.stringify({ scores: passages.map((_, i) => i) }), { status: 200 });
  });

beforeEach(() => {
  spanAttrs.length = 0;
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
  vi.stubEnv("RERANKER_URL", "http://mira-reranker:8088");
  vi.stubEnv("NOTEBOOK_RERANK_POOL", "");
  vi.stubEnv("NOTEBOOK_RERANK", "1");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mira.retrieval.rerank on the retrieval span (#4579)", () => {
  it("records 'off' when NOTEBOOK_RERANK is off, and never calls the service", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    const svc = scoresOk();
    vi.stubGlobal("fetch", svc);
    await ask(NARROW);
    expect(rerankAttr()).toEqual(["off"]);
    expect(svc).not.toHaveBeenCalled();
  });

  it("records 'ran' when the service returns a valid score per passage", async () => {
    vi.stubGlobal("fetch", scoresOk());
    await ask(NARROW);
    expect(rerankAttr()).toEqual(["ran"]);
  });

  it("records 'skipped_broad' for a broad question and never calls the service", async () => {
    const svc = scoresOk();
    vi.stubGlobal("fetch", svc);
    await ask(BROAD);
    expect(rerankAttr()).toEqual(["skipped_broad"]);
    expect(svc).not.toHaveBeenCalled();
  });

  it("records 'skipped_short' when the pool has fewer than two rows to reorder", async () => {
    const svc = scoresOk();
    vi.stubGlobal("fetch", svc);
    await ask(NARROW, { rows: [ROWS[0]] });
    expect(rerankAttr()).toEqual(["skipped_short"]);
    expect(svc).not.toHaveBeenCalled();
  });

  it("records 'fallback_timeout' when the service times out, and still warns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }),
    );
    await ask(NARROW);
    expect(rerankAttr()).toEqual(["fallback_timeout"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/reranker_fallback reason=timeout/));
  });

  it("records 'fallback_http_error' on a non-2xx reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await ask(NARROW);
    expect(rerankAttr()).toEqual(["fallback_http_error"]);
  });

  it("records 'fallback_malformed' when the score count is wrong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ scores: [1] }), { status: 200 })));
    await ask(NARROW);
    expect(rerankAttr()).toEqual(["fallback_malformed"]);
  });

  it("records 'fallback_not_configured' when RERANKER_URL is unset", async () => {
    vi.stubEnv("RERANKER_URL", "");
    const svc = scoresOk();
    vi.stubGlobal("fetch", svc);
    await ask(NARROW);
    expect(rerankAttr()).toEqual(["fallback_not_configured"]);
    expect(svc).not.toHaveBeenCalled();
  });

  it("hands the same outcome back through opts.diagnostics, for the caller's own span", async () => {
    vi.stubGlobal("fetch", scoresOk());
    const diagnostics: { rerank?: string } = {};
    await ask(NARROW, { diagnostics });
    expect(diagnostics.rerank).toBe("ran");
  });
});

describe("search path and rerank wait on the retrieval span", () => {
  const timeout = () =>
    vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });

  it("names rerank in the path only when its order was served", async () => {
    vi.stubGlobal("fetch", scoresOk());
    await ask(NARROW);
    expect(attr("mira.retrieval.search_path")).toEqual(["lexical+rerank"]);
    expect(attr("mira.retrieval.rerank_ms")).toHaveLength(1);
    expect(typeof attr("mira.retrieval.rerank_ms")[0]).toBe("number");
  });

  it("a timeout serves the plain lexical path, records the wait, and returns the rerank-off order", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    const off = await ask(NARROW);
    spanAttrs.length = 0;
    vi.stubEnv("NOTEBOOK_RERANK", "1");
    vi.stubGlobal("fetch", timeout());
    const fellBack = await ask(NARROW);
    expect(attr("mira.retrieval.search_path")).toEqual(["lexical"]);
    expect(typeof attr("mira.retrieval.rerank_ms")[0]).toBe("number");
    expect(fellBack).toEqual(off);
  });

  it("records no wait when the service is never called", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    await ask(NARROW);
    expect(attr("mira.retrieval.rerank_ms")).toEqual([null]);
    expect(attr("mira.retrieval.search_path")).toEqual(["lexical"]);
  });

  it("names lexical_v2 when that flag is on", async () => {
    vi.stubEnv("NOTEBOOK_LEXICAL_V2", "1");
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    await ask(NARROW);
    expect(attr("mira.retrieval.search_path")).toEqual(["lexical_v2"]);
  });

  it("hands the path and wait back through opts.diagnostics", async () => {
    vi.stubGlobal("fetch", scoresOk());
    const diagnostics: Diag = {};
    await ask(NARROW, { diagnostics });
    expect(diagnostics.searchPath).toBe("lexical+rerank");
    expect(typeof diagnostics.rerankMs).toBe("number");
  });
});
