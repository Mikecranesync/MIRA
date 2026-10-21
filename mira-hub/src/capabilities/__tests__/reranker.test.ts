/**
 * CU-RR1 — cross-encoder reranker lane in retrieveNodeChunks (NOTEBOOK_RERANK, default off).
 * Invariants (docs/architecture/convergence/units/CU-RR1.md):
 *  1. flag off ⇒ the service is never called and the order is today's;
 *  2. flag on and the service fails in any way ⇒ the order is today's;
 *  3. the code the technician named still leads, however low the reranker scores it;
 *  4. broad questions are never reranked.
 * Run: npx vitest run src/capabilities/__tests__/reranker.test.ts
 */
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "../../lib/manual-rag";
import { orderByScores, rerankPool, rerankScores, rerankTimeoutMs } from "../reranker";

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

function clientWith(rows: Record<string, unknown>[]): PoolClient {
  return { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
}

const ask = (question: string, rows = ROWS) =>
  retrieveNodeChunks(clientWith(rows), "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    rawQuery: question,
  });
const pages = (cs: { sourcePage: number | null }[]) => cs.map((c) => c.sourcePage);

/** A fake service: score = position from the END of the list (so it reverses the pool). */
function reversingService() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { passages } = JSON.parse(String(init.body)) as { passages: string[] };
    return new Response(JSON.stringify({ scores: passages.map((_, i) => i) }), { status: 200 });
  });
}

beforeEach(() => {
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
  vi.stubEnv("RERANKER_URL", "http://mira-reranker:8088");
  vi.stubEnv("NOTEBOOK_RERANK_POOL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CU-RR1 reranker lane", () => {
  it("1. flag off: the service is never called and the order is today's", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    const svc = reversingService();
    vi.stubGlobal("fetch", svc);
    const baseline = pages(await ask("How do I select a braking resistor?"));
    expect(svc).not.toHaveBeenCalled();
    expect(baseline.length).toBe(3);
  });

  it("flag on: the pool is reordered by the reranker's scores", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    const baseline = pages(await ask("How do I select a braking resistor?"));
    vi.stubEnv("NOTEBOOK_RERANK", "1");
    vi.stubGlobal("fetch", reversingService());
    const reranked = pages(await ask("How do I select a braking resistor?"));
    expect(reranked).toEqual([...baseline].reverse());
  });

  it("2. flag on but the service fails (HTTP 500, timeout, wrong count, NaN, no URL): today's order", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    const baseline = pages(await ask("How do I select a braking resistor?"));
    vi.stubEnv("NOTEBOOK_RERANK", "1");
    const failures: Array<() => unknown> = [
      () => vi.fn(async () => new Response("boom", { status: 500 })),
      () => vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }),
      () => vi.fn(async () => new Response(JSON.stringify({ scores: [1] }), { status: 200 })),
      () => vi.fn(async () => new Response(JSON.stringify({ scores: [1, Number.NaN, 2] }), { status: 200 })),
    ];
    for (const f of failures) {
      vi.stubGlobal("fetch", f());
      expect(pages(await ask("How do I select a braking resistor?"))).toEqual(baseline);
    }
    vi.stubEnv("RERANKER_URL", "");
    vi.stubGlobal("fetch", reversingService());
    expect(pages(await ask("How do I select a braking resistor?"))).toEqual(baseline);
  });

  it("3. the fault code the technician named still leads, even when the reranker scores it last", async () => {
    const rows = [mk(40, "F046 Overvoltage during deceleration: lengthen the decel time.", 0.2), ...ROWS];
    vi.stubEnv("NOTEBOOK_RERANK", "1");
    // Score the F046 chunk lowest of all.
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const { passages } = JSON.parse(String(init.body)) as { passages: string[] };
      return new Response(JSON.stringify({ scores: passages.map((p) => (p.includes("F046") ? -100 : 1)) }), { status: 200 });
    }));
    const got = await ask("What does fault F046 mean on this drive?", rows);
    expect(got[0].content).toContain("F046");
  });

  it("4. a broad question is never reranked", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "1");
    const svc = reversingService();
    vi.stubGlobal("fetch", svc);
    await ask("What are all the communication options this drive supports?");
    expect(svc).not.toHaveBeenCalled();
  });
});

describe("reranker client", () => {
  it("orderByScores is stable on ties and sorts highest first", () => {
    expect(orderByScores(["a", "b", "c", "d"], [1, 3, 3, 0])).toEqual(["b", "c", "a", "d"]);
  });
  it("rerankPool is bounded 6–100 and defaults to 50", () => {
    vi.stubEnv("NOTEBOOK_RERANK_POOL", "");
    expect(rerankPool()).toBe(50);
    vi.stubEnv("NOTEBOOK_RERANK_POOL", "500");
    expect(rerankPool()).toBe(100);
    vi.stubEnv("NOTEBOOK_RERANK_POOL", "2");
    expect(rerankPool()).toBe(6);
  });
  it("rerankTimeoutMs is bounded 200–5000 and defaults to 1500", () => {
    vi.stubEnv("NOTEBOOK_RERANK_TIMEOUT_MS", "");
    expect(rerankTimeoutMs()).toBe(1500);
    vi.stubEnv("NOTEBOOK_RERANK_TIMEOUT_MS", "2500");
    expect(rerankTimeoutMs()).toBe(2500);
    vi.stubEnv("NOTEBOOK_RERANK_TIMEOUT_MS", "60000");
    expect(rerankTimeoutMs()).toBe(5000);
    vi.stubEnv("NOTEBOOK_RERANK_TIMEOUT_MS", "5");
    expect(rerankTimeoutMs()).toBe(200);
    vi.stubEnv("NOTEBOOK_RERANK_TIMEOUT_MS", "abc");
    expect(rerankTimeoutMs()).toBe(1500);
  });
  it("the request waits exactly the configured timeout", async () => {
    vi.stubEnv("NOTEBOOK_RERANK_TIMEOUT_MS", "2500");
    const spy = vi.spyOn(AbortSignal, "timeout");
    const f = vi.fn(async () => new Response(JSON.stringify({ scores: [1] }), { status: 200 }));
    await rerankScores("q", ["p"], { fetch: f as unknown as typeof fetch, log: () => {} });
    expect(spy).toHaveBeenCalledWith(2500);
    spy.mockRestore();
  });
  it("sends only the query and trimmed passages — no tenant or identity", async () => {
    const svc = vi.fn(async (_u: string, _init: RequestInit) => new Response(JSON.stringify({ scores: [0.5] }), { status: 200 }));
    expect(await rerankScores("q", ["x".repeat(5000)], { fetch: svc as unknown as typeof fetch, log: () => {} })).toEqual([0.5]);
    const sent = JSON.parse(String(svc.mock.calls[0][1].body));
    expect(Object.keys(sent).sort()).toEqual(["passages", "query"]);
    expect(sent.passages[0].length).toBe(2000);
  });
});
