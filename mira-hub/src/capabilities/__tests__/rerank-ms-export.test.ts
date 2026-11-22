/**
 * #5168 — `mira.retrieval.rerank_ms` on the EXPORTED span, not a mocked
 * setSpanAttrs bag. tracing.ts drops null, so a producer that sets
 * `rerank_ms: null` never appears on the wire. Contract:
 *
 *   - Attribute ABSENT when no rerank HTTP request was attempted.
 *   - Attribute is a number of milliseconds when a request was sent
 *     (success, timeout, HTTP error, malformed body).
 *
 * Proven through `__testing__installInMemoryExporter` (the same harness as
 * tracing.test.ts). Do not mock setSpanAttrs here.
 *
 * Run: npx vitest run src/capabilities/__tests__/rerank-ms-export.test.ts
 */
import type { PoolClient } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing__installInMemoryExporter, withSpan } from "@/capabilities/observability/tracing";
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
const SPAN = "retrieval.execute";

function client(rows: Record<string, unknown>[] = ROWS): PoolClient {
  return { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
}

const ask = (question: string) =>
  retrieveNodeChunks(client(), "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    rawQuery: question,
  });

function scoresOk() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { passages } = JSON.parse(String(init.body)) as { passages: string[] };
    return new Response(JSON.stringify({ scores: passages.map((_, i) => i) }), { status: 200 });
  });
}

let handle: ReturnType<typeof __testing__installInMemoryExporter>;
beforeAll(() => {
  handle = __testing__installInMemoryExporter();
});
beforeEach(() => {
  handle.reset();
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

async function retrieveOnSpan(question: string = NARROW) {
  await withSpan(SPAN, {}, async () => {
    await ask(question);
  });
  const span = handle.finished().find((s) => s.name === SPAN);
  expect(span, "retrieval.execute span was not exported").toBeDefined();
  return span!.attributes as Record<string, unknown>;
}

describe("exported mira.retrieval.rerank_ms (#5168)", () => {
  it("is absent when NOTEBOOK_RERANK is off — no request, no measured wait", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    const svc = scoresOk();
    vi.stubGlobal("fetch", svc);
    const attrs = await retrieveOnSpan();
    expect(attrs["mira.retrieval.rerank"]).toBe("off");
    expect("mira.retrieval.rerank_ms" in attrs).toBe(false);
    expect(svc).not.toHaveBeenCalled();
  });

  it("is absent when the flag is on but RERANKER_URL is unset (no request attempted)", async () => {
    vi.stubEnv("RERANKER_URL", "");
    const svc = scoresOk();
    vi.stubGlobal("fetch", svc);
    const attrs = await retrieveOnSpan();
    expect(attrs["mira.retrieval.rerank"]).toBe("fallback_not_configured");
    expect("mira.retrieval.rerank_ms" in attrs).toBe(false);
    expect(svc).not.toHaveBeenCalled();
  });

  it("is a number of milliseconds when a rerank request actually ran", async () => {
    vi.stubGlobal("fetch", scoresOk());
    const attrs = await retrieveOnSpan();
    expect(attrs["mira.retrieval.rerank"]).toBe("ran");
    expect(typeof attrs["mira.retrieval.rerank_ms"]).toBe("number");
    expect(attrs["mira.retrieval.rerank_ms"]).toBeGreaterThanOrEqual(0);
  });
});
