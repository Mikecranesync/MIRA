/**
 * Canonical seam through the REAL notebook-chat handler.
 *
 * Not a unit test of the seam module — this drives `POST` end to end with a
 * simulated provider stream, so it proves the wiring: which URL is actually
 * called, whether usage is actually requested, what frames a client actually
 * receives, and that the flag-off path is genuinely unchanged.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/__tests__/chat-canonical-seam.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "99999999-9999-4999-8999-999999999999";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({
    tenantId: "11111111-1111-4111-8111-111111111111",
    userId: "u1",
  })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  recordTurn: vi.fn(async () => undefined),
  // I3: the route resolves the notebook's bound asset; unbound keeps the
  // pre-081 behaviour these suites assert.
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  // The route also loads identity + source list to build the coverage
  // directive; omitting them fails at the mock boundary, not in the seam.
  getNotebook: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "PF525 — Line 1",
    manufacturer: "Allen-Bradley",
    model: "PowerFlex 525",
  })),
  listSources: vi.fn(async () => [{ filename: "PF525.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

const persistMock = vi.hoisted(() => ({
  persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "trace-1" })),
}));
vi.mock("@/lib/inference/persist-usage", () => persistMock);

import { POST } from "../[id]/chat/route";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

const chatReq = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: NB }) };

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    });
}

/** A provider SSE stream: deltas, then the include_usage final chunk. */
function providerStream(text: string, usage?: Record<string, unknown>): Response {
  const chunks = [
    ...text.split(" ").map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w + " " } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], ...(usage ? { usage } : {}) })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

const groundedChunks = [
  { docId: DOC_A, filename: "PF525.pdf", page: 87, content: "Fault F004 indicates DC bus undervoltage." },
];

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
  process.env.GEMINI_API_KEY = "kg";
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(groundedChunks as never);
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("flag OFF — production path unchanged (rollback behaviour)", () => {
  it("uses the LEGACY cascade and emits NO usage frame", async () => {
    delete process.env.MIRA_CANONICAL_SEAM;
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("DC bus undervoltage [1]")));

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const f = await frames(res);

    expect(f.some((x) => x.kind === "usage")).toBe(false);
    // Legacy body must NOT request usage — proves the flag-off path is the
    // original request, not the new one with the flag merely hiding the frame.
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream_options).toBeUndefined();
  });

  it("still streams content and status in the original order", async () => {
    delete process.env.MIRA_CANONICAL_SEAM;
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("answer [1]")));
    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    expect(f.some((x) => x.kind === "content")).toBe(true);
    expect(f.at(-1)?.kind).toBe("status");
  });
});

describe("flag ON — canonical seam", () => {
  beforeEach(() => {
    process.env.MIRA_CANONICAL_SEAM = "1";
  });

  it("calls Groq first and requests usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("F004 is DC bus undervoltage [1]", {
      prompt_tokens: 1500,
      completion_tokens: 42,
    })));

    await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("api.groq.com");
    expect(JSON.parse((init as RequestInit).body as string).stream_options).toEqual({
      include_usage: true,
    });
  });

  it("emits a usage frame with real tokens and a cost estimate, BEFORE status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("grounded [1]", {
      prompt_tokens: 1500,
      completion_tokens: 42,
      prompt_tokens_details: { cached_tokens: 500 },
    })));

    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    const usageIdx = f.findIndex((x) => x.kind === "usage");
    const statusIdx = f.findIndex((x) => x.kind === "status");

    expect(usageIdx).toBeGreaterThan(-1);
    expect(usageIdx).toBeLessThan(statusIdx); // a client stopping at status still got it
    expect(f[usageIdx]).toMatchObject({
      provider: "Groq",
      routeReason: "primary",
      inputTokens: 1500,
      cachedInputTokens: 500,
      outputTokens: 42,
      status: "ok",
    });
    expect(Number(f[usageIdx].costUsdEstimate)).toBeGreaterThan(0);
  });

  it("NEVER routes to Gemini even when GEMINI_API_KEY is set", async () => {
    // The legacy cascade would fall to Gemini third. The seam must not.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("googleapis")) throw new Error("Gemini must not be called");
        throw Object.assign(new Error("provider down"), { name: "TypeError" });
      }),
    );
    await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    for (const [url] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).not.toContain("googleapis");
    }
  });

  it("preserves grounded retrieval, citations and history on the seam path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("DC bus undervoltage [1]", { prompt_tokens: 10, completion_tokens: 5 })));
    const f = await frames(await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params));

    // retrieval boundary still enforced at SQL level
    // signature: (client, tenantId, query, opts) — the doc-set boundary is opts.docIds
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_A,
      expect.any(String),
      expect.objectContaining({ docIds: [DOC_A] }),
    );
    // citations still shipped
    expect(f.some((x) => x.kind === "sources")).toBe(true);
    // conversation history still persisted
    expect(domainMock.recordTurn).toHaveBeenCalledWith(
      TENANT_A,
      NB,
      expect.objectContaining({ answerStatus: "answered", enabledSourceDocIds: [DOC_A] }),
    );
  });
});

describe("tenant isolation is unaffected by the seam", () => {
  it("passes the SESSION tenant to retrieval and persistence, not a client value", async () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_B, userId: "u9" } as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("x [1]", { prompt_tokens: 1, completion_tokens: 1 })));

    // Drain the stream: the body is a ReadableStream whose start() does the
    // work, and recordTurn runs after controller.close(). Asserting without
    // reading tests a stream that never ran.
    await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A], tenantId: TENANT_A }), params));

    expect(domainMock.validateChatSources).toHaveBeenCalledWith(TENANT_B, NB, [DOC_A]);
    // and retrieval is scoped to the session tenant too, not the body value
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_B,
      expect.any(String),
      expect.anything(),
    );
    expect(domainMock.recordTurn).toHaveBeenCalledWith(TENANT_B, NB, expect.anything());
  });

  it("still rejects an out-of-notebook source before any provider call", async () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    domainMock.validateChatSources.mockResolvedValue({ ok: false, error: "source_not_in_notebook" } as never);
    vi.stubGlobal("fetch", vi.fn());
    const res = await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("failure paths", () => {
  beforeEach(() => {
    process.env.MIRA_CANONICAL_SEAM = "1";
  });

  it("falls back to the next provider and records the fallback chain", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response(null, { status: 500 }); // Groq down
        return providerStream("served by cerebras [1]", { prompt_tokens: 9, completion_tokens: 3 });
      }),
    );
    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    const usage = f.find((x) => x.kind === "usage")!;
    expect(usage.provider).toBe("Cerebras");
    expect(usage.routeReason).toBe("fallback:Groq");
  });

  it("reports exhaustion honestly — error status, null provider, and an error frame", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    const usage = f.find((x) => x.kind === "usage")!;
    expect(usage.status).toBe("error");
    expect(usage.provider).toBeNull();
    expect(usage.costUsdEstimate).toBeNull(); // not 0 — nothing was billed, nothing is known
    expect(f.find((x) => x.kind === "status")?.status).toBe("error");
  });

  it("does not fabricate usage when the provider omits the usage block", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("answer [1]"))); // no usage
    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    const usage = f.find((x) => x.kind === "usage")!;
    expect(usage.provider).toBe("Groq"); // it DID serve
    expect(usage.inputTokens).toBeNull(); // but tokens are unknown, not zero
    expect(usage.outputTokens).toBeNull();
  });

  it("still abstains with insufficient_evidence and calls no provider on zero chunks", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    vi.stubGlobal("fetch", vi.fn());
    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    expect(fetch).not.toHaveBeenCalled();
    expect(f.find((x) => x.kind === "status")?.status).toBe("insufficient_evidence");
  });
});

describe("cost cap", () => {
  it("stops a runaway turn and marks the usage record `capped`", async () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "5"; // ~20 chars
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerStream("word ".repeat(400), { prompt_tokens: 10, completion_tokens: 9999 })),
    );
    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    const usage = f.find((x) => x.kind === "usage")!;
    expect(usage.status).toBe("capped");
    // and it actually stopped early rather than merely labelling the result
    const emitted = f.filter((x) => x.kind === "content").map((x) => String(x.content)).join("");
    expect(emitted.length).toBeLessThan(400 * 5);
  });

  it("caps the requested max_tokens so the provider is never asked for more than the ceiling", async () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "100";
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("x [1]", { prompt_tokens: 1, completion_tokens: 1 })));
    await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_tokens).toBeLessThanOrEqual(100);
  });
});

describe("telemetry persistence through the real route", () => {
  beforeEach(() => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    persistMock.persistTurnUsage.mockResolvedValue({ persisted: true, traceId: "trace-1" } as never);
  });

  it("persists the SAME record it streamed as the usage frame", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("grounded [1]", {
      prompt_tokens: 1351, completion_tokens: 134, prompt_tokens_details: { cached_tokens: 200 },
    })));
    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    const streamed = f.find((x) => x.kind === "usage")!;

    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    const [scope, usage] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // The ledger and the wire must not be able to disagree about a turn.
    expect(usage.provider).toBe(streamed.provider);
    expect(usage.inputTokens).toBe(streamed.inputTokens);
    expect(usage.outputTokens).toBe(streamed.outputTokens);
    expect(usage.costUsdEstimate).toBe(streamed.costUsdEstimate);
    expect(scope.tenantId).toBe(TENANT_A);
    expect(scope.notebookId).toBe(NB);
    expect(Number(scope.latencyMs)).toBeGreaterThanOrEqual(0);
  });

  it("persists AFTER the stream closed — telemetry never delays the answer", async () => {
    let closedAt = 0;
    persistMock.persistTurnUsage.mockImplementation(async () => {
      // if this ran before the body resolved, closedAt would still be 0
      expect(closedAt).toBeGreaterThan(0);
      return { persisted: true, traceId: "t" } as never;
    });
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("x [1]", { prompt_tokens: 1, completion_tokens: 1 })));
    const res = await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    await res.text();
    closedAt = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    expect(persistMock.persistTurnUsage).toHaveBeenCalled();
  });

  it("a ledger failure does NOT break an otherwise valid cited answer", async () => {
    // The whole point of the non-fatal posture: telemetry down != chat down.
    persistMock.persistTurnUsage.mockResolvedValue({ persisted: false, reason: "42703" } as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("DC bus undervoltage [1]", {
      prompt_tokens: 10, completion_tokens: 5,
    })));
    const f = await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    expect(f.find((x) => x.kind === "status")?.status).toBe("answered");
    expect(f.some((x) => x.kind === "sources")).toBe(true);
    expect(f.some((x) => x.kind === "content")).toBe(true);
  });

  it("survives persistence THROWING, not just returning failure", async () => {
    persistMock.persistTurnUsage.mockRejectedValue(new Error("connection terminated"));
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("answer [1]", { prompt_tokens: 3, completion_tokens: 2 })));
    const res = await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    const f = await frames(res);
    expect(f.find((x) => x.kind === "status")?.status).toBe("answered");
  });

  it("does NOT persist when the seam is off (legacy path writes no spend rows)", async () => {
    delete process.env.MIRA_CANONICAL_SEAM;
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("answer [1]")));
    await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
  });

  it("persists an exhausted turn too — a failed turn is still a turn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    await frames(await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params));
    const [, usage] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(usage.status).toBe("error");
    expect(usage.provider).toBeNull();
    expect(usage.costUsdEstimate).toBeNull();
  });
});
