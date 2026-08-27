/**
 * STRM-2 (server half) + PLAT-5 through the REAL notebook-chat handler.
 *
 * - PLAT-5: pins the ACTUAL wire order of an answered turn so the header
 *   comments in chat/route.ts and notebook-chat-types.ts cannot drift again.
 * - STRM-2: the client stops generation mid-stream → the provider read is
 *   cancelled, NO further provider is tried, and the turn is persisted as
 *   `answer_status='error'` with the partial text, no citations, no basis.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/__tests__/chat-stop-persist.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

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
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "PF525 — Line 1",
    manufacturer: "Allen-Bradley",
    model: "PowerFlex 525",
  })),
  listSources: vi.fn(async () => [{ filename: "PF525.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
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

const chatReq = (body: unknown, init: { signal?: AbortSignal } = {}) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...(init.signal ? { signal: init.signal } : {}),
  });
const params = { params: Promise.resolve({ id: NB }) };

function parseFrames(text: string): Record<string, unknown>[] {
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;

/** A provider stream that completes normally. */
function completingProvider(text: string): Response {
  const chunks = [
    ...text.split(" ").map((w) => delta(w + " ")),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200 },
  );
}

/**
 * A provider stream that emits `head` deltas and then HANGS (never closes),
 * like a slow model mid-answer. Exposes whether the route cancelled it.
 */
function hangingProvider(head: string[]) {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const w of head) c.enqueue(enc.encode(delta(w)));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { res: new Response(body, { status: 200 }), state };
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
  delete process.env.MIRA_CANONICAL_SEAM;
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(groundedChunks as never);
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe("PLAT-5 — real wire order of an answered turn", () => {
  it("streams content* → sources → evidence → status → [followups] → [DONE] (legacy path, no usage)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider("DC bus undervoltage [1]")));
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const text = await res.text();
    const kinds = parseFrames(text).map((f) => f.kind as string);

    expect(kinds[0]).toBe("content");
    const nonContent = kinds.filter((k) => k !== "content");
    // Every content delta precedes the first non-content frame: sources is
    // NOT first (it is filtered to the [n] the answer actually used).
    expect(kinds.lastIndexOf("content")).toBeLessThan(kinds.indexOf("sources"));
    expect(nonContent.slice(0, 3)).toEqual(["sources", "evidence", "status"]);
    // followups is optional and, when present, is the tail.
    expect(nonContent.slice(3).every((k) => k === "followups")).toBe(true);
    expect(kinds).not.toContain("usage");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("inserts usage between evidence and status when the seam is on", async () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider("DC bus undervoltage [1]")));
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const kinds = parseFrames(await res.text()).map((f) => f.kind as string);
    const nonContent = kinds.filter((k) => k !== "content");
    expect(nonContent.slice(0, 4)).toEqual(["sources", "evidence", "usage", "status"]);
  });
});

describe("STRM-2 — client stops generation mid-stream", () => {
  it("cancelling the response persists an error turn with the partial text, no citations, no basis", async () => {
    const provider = hangingProvider(["DC bus ", "undervoltage ", "[1] means "]);
    const fetchMock = vi.fn(async () => provider.res);
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let received = "";
    // Read until all three deltas have arrived, then stop.
    while (!received.includes("means")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += dec.decode(value, { stream: true });
    }
    await reader.cancel();

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn).toMatchObject({
      question: "what is F004",
      answerStatus: "error",
      answerText: "DC bus undervoltage [1] means ",
      evidence: [],
      basis: null,
      enabledSourceDocIds: [DOC_A],
    });
    expect(turn.model).toMatch(/^Groq:/);

    // Provider read was stopped and NO fallback provider was tried.
    await vi.waitFor(() => expect(provider.state.cancelled).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Only content frames ever reached the client — no sources/evidence/status.
    const kinds = parseFrames(received).map((f) => f.kind);
    expect(kinds.every((k) => k === "content")).toBe(true);
    // Legacy path: no spend ledger write.
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
  });

  it("an aborted request signal stops the turn the same way and records spend when the seam is on", async () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    const provider = hangingProvider(["Check ", "the "]);
    vi.stubGlobal("fetch", vi.fn(async () => provider.res));

    const ac = new AbortController();
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }, { signal: ac.signal }), params);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let received = "";
    while (!received.includes("the ")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += dec.decode(value, { stream: true });
    }
    ac.abort();

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn).toMatchObject({ answerStatus: "error", answerText: "Check the ", evidence: [], basis: null });

    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [scope, usage] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(scope).toMatchObject({ answerText: "Check the ", citationsPresent: false });
    expect(usage).toMatchObject({ provider: "Groq", status: "error", routeReason: "primary" });
    await vi.waitFor(() => expect(provider.state.cancelled).toBe(true));
  });

  it("a stop during the connect phase never falls through to the next provider (non-throwing continue path)", async () => {
    // Regression for the fix-pass finding: Groq is slow to answer, the
    // technician taps Stop, THEN Groq resolves 429/500. The non-OK branch
    // `continue`s without throwing, so the abort check in the catch block
    // never ran and Cerebras was opened for a turn that was already stopped.
    process.env.MIRA_CANONICAL_SEAM = "1";
    let resolveFirst: ((r: Response) => void) | null = null;
    const signals: (AbortSignal | undefined)[] = [];
    const second = hangingProvider(["x "]);
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      signals.push(init?.signal);
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve(second.res);
    });
    vi.stubGlobal("fetch", fetchMock);

    const ac = new AbortController();
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }, { signal: ac.signal }), params);
    // Let the route reach fetch #1 (still pending).
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    ac.abort();
    // The upstream request carries the client-stop signal: a stop during the
    // connect phase aborts the provider call rather than waiting on it.
    expect(signals[0]?.aborted).toBe(true);
    // Now the first provider answers non-OK — the path that used to `continue`.
    resolveFirst!(new Response(null, { status: 500 }));
    await res.text().catch(() => "");

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    // No provider ever streamed — nothing to attribute the stopped turn to.
    expect(turn).toMatchObject({ answerStatus: "error", answerText: null, model: null, evidence: [] });
    // The fallback provider was NEVER called.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.state.cancelled).toBe(false);
  });

  it("stopping with nothing streamed yet persists answer_text null", async () => {
    const provider = hangingProvider([]);
    vi.stubGlobal("fetch", vi.fn(async () => provider.res));

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    // Give the route a tick to open the provider stream before stopping.
    await new Promise((r) => setTimeout(r, 20));
    await res.body!.cancel();

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn).toMatchObject({ answerStatus: "error", answerText: null, evidence: [] });
  });
});
