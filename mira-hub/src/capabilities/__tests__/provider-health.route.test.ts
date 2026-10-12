/**
 * D6 — provider health + honest exhaustion, proven at the route.
 *
 * Before: a provider that answered 402 (out of credit) or 401 (bad key) was
 * re-tried on every turn, and when every provider failed the technician saw
 * "No answer provider available." with nothing about why. Contract pinned
 * here:
 *
 *   - a 401/402/403 quarantines that provider for MIRA_PROVIDER_UNHEALTHY_S
 *     seconds: the NEXT turn skips it (no fetch) and falls through;
 *   - a 429 / 5xx does NOT quarantine (control) — the next turn tries again;
 *   - when nothing serves, the final `status: "error"` frame carries the
 *     friendly message, `reason: "all_providers_failed"`, and the attempt
 *     record `providers: [{provider, httpStatus, reason}]` in cascade order,
 *     and one structured `providers.exhausted` log line is emitted;
 *   - with no provider configured the reason is `no_provider_configured`.
 *
 * Mock scaffold mirrors stream-usage-drain.route.test.ts.
 *
 * Run: npx vitest run src/capabilities/__tests__/provider-health.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(async () => ({
    status: "claimed" as const,
    claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
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

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);
vi.mock("@/lib/visual-evidence-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visual-evidence-context")>()),
  loadVisualEvidenceForPhoto: vi.fn(async () => null),
  loadRecentLookObservations: vi.fn(async () => []),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { ALL_PROVIDERS_FAILED_MESSAGE, NO_PROVIDER_CONFIGURED_MESSAGE, resetProviderHealthForTests } from "@/capabilities/provider-health";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const GROQ_ANSWER = "Check the DC bus voltage first.";

const chatReq = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: NB }) };

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;
const STOP = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;

function completingProvider(text: string): Response {
  const chunks = [...text.split(" ").map((w) => delta(w + " ")), STOP, "data: [DONE]\n\n"];
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

type Script = { status: number } | { throws: Error } | "serve";

/**
 * fetch stub routed by host. Each provider's STREAMING calls follow its script
 * in order (the last entry repeats); judges and other calls complete normally.
 */
function stubFetch(scripts: { openai?: Script[]; groq?: Script[] }) {
  const calls = { openai: 0, groq: 0 };
  const next = (which: "openai" | "groq"): Script => {
    const list = scripts[which] ?? ["serve"];
    const idx = Math.min(calls[which], list.length - 1);
    calls[which] += 1;
    return list[idx];
  };
  const play = (s: Script, answer: string): Response => {
    if (s === "serve") return completingProvider(answer);
    if ("throws" in s) throw s.throws;
    return new Response(`provider said ${s.status}`, { status: s.status });
  };
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === "string" ? init.body : "";
    const streaming = body.includes('"stream":true');
    if (u.includes("api.openai.com") && streaming) return play(next("openai"), "OPENAI ANSWER");
    if (u.includes("api.groq.com") && streaming) return play(next("groq"), GROQ_ANSWER);
    return completingProvider("judge ok");
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function frames(sse: string): Record<string, unknown>[] {
  return sse
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .flatMap((l) => {
      try {
        return [JSON.parse(l.slice(6)) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}
const statusFrame = (sse: string) => frames(sse).find((f) => f.kind === "status") as Record<string, unknown> | undefined;
const usageFrame = (sse: string) => frames(sse).find((f) => f.kind === "usage") as Record<string, unknown> | undefined;

/** The structured `providers.exhausted` log lines, parsed. */
function exhaustedLogs(): Record<string, unknown>[] {
  return (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => c[0])
    .filter((a): a is string => typeof a === "string" && a.startsWith("{"))
    .map((s) => JSON.parse(s) as Record<string, unknown>)
    .filter((o) => o.event === "providers.exhausted");
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  resetProviderHealthForTests();
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "0";
  process.env.OPENAI_API_KEY = "k0";
  process.env.GROQ_API_KEY = "k1";
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  delete process.env.MIRA_PROVIDER_UNHEALTHY_S;
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue([
    { docId: DOC_A, filename: "PF525.pdf", page: 87, content: "Fault F004 indicates DC bus undervoltage." },
  ] as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run(turnNo = 1) {
  const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
  expect(res.status).toBe(200);
  const text = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(turnNo));
  const [, , turn] = domainMock.recordTurn.mock.calls[turnNo - 1] as unknown as [string, string, Record<string, unknown>];
  return { text, turn };
}

describe("D6 — honest exhaustion frame", () => {
  it("every provider failing yields the friendly message, reason, and the per-provider attempt record", async () => {
    stubFetch({ openai: [{ status: 402 }], groq: [{ status: 401 }] });
    const { text, turn } = await run();

    expect(turn).toMatchObject({ answerStatus: "error" });
    const status = statusFrame(text);
    expect(status).toMatchObject({
      kind: "status",
      status: "error",
      reason: "all_providers_failed",
      providers: [
        { provider: "OpenAI", httpStatus: 402, reason: "http_error" },
        { provider: "Groq", httpStatus: 401, reason: "http_error" },
      ],
    });
    expect(String(status?.message)).toContain("couldn't reach an answer service");
    expect(String(status?.message)).not.toContain("No answer provider available");
    expect(usageFrame(text)).toMatchObject({ provider: null, routeReason: "exhausted:OpenAI,Groq", status: "error" });
  });

  it("a thrown network error is recorded by its error name, with no HTTP status", async () => {
    stubFetch({ openai: [{ throws: new TypeError("fetch failed") }], groq: [{ status: 503 }] });
    const { text } = await run();
    expect(statusFrame(text)).toMatchObject({
      reason: "all_providers_failed",
      providers: [
        { provider: "OpenAI", httpStatus: null, reason: "TypeError" },
        { provider: "Groq", httpStatus: 503, reason: "http_error" },
      ],
    });
  });

  it("emits ONE structured providers.exhausted log line carrying the same attempt record and no text", async () => {
    stubFetch({ openai: [{ status: 402 }], groq: [{ status: 401 }] });
    await run();
    const logs = exhaustedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      service: "mira-hub",
      component: "notebook-chat",
      tenantId: TENANT_A,
      notebookId: NB,
      reason: "all_providers_failed",
      providers: [
        { provider: "OpenAI", httpStatus: 402 },
        { provider: "Groq", httpStatus: 401 },
      ],
    });
    expect(JSON.stringify(logs[0])).not.toContain("what is F004");
  });

  it("with no provider key configured the reason is no_provider_configured and the record is empty", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    const calls = stubFetch({});
    const { text, turn } = await run();
    expect(calls).toEqual({ openai: 0, groq: 0 });
    expect(turn).toMatchObject({ answerStatus: "error" });
    expect(statusFrame(text)).toMatchObject({ status: "error", reason: "no_provider_configured", providers: [] });
    expect(String(statusFrame(text)?.message)).toContain("No AI answer provider is configured");
  });

  it("control: with the canonical seam OFF the legacy frame is byte-identical (bare message, no reason, no log)", async () => {
    // The legacy inline cascade is the rollback path; D6 must not change a
    // single frame of it (the pre-existing chat-stop-persist contract pins the
    // bare message there).
    process.env.MIRA_CANONICAL_SEAM = "0";
    stubFetch({ openai: [{ status: 402 }], groq: [{ status: 401 }] });
    const { text, turn } = await run();
    expect(turn).toMatchObject({ answerStatus: "error" });
    expect(statusFrame(text)).toEqual({ kind: "status", status: "error", message: "No answer provider available." });
    expect(exhaustedLogs()).toHaveLength(0);
  });

  it("control: a served turn carries NO exhaustion fields and logs nothing", async () => {
    stubFetch({ openai: ["serve"] });
    const { text, turn } = await run();
    expect(turn).toMatchObject({ answerStatus: "answered" });
    expect(statusFrame(text)).toEqual({ kind: "status", status: "answered" });
    expect(exhaustedLogs()).toHaveLength(0);
  });
});

describe("D6 — provider quarantine on 401/402/403", () => {
  it("after a 402 the NEXT turn skips OpenAI without a fetch and Groq serves", async () => {
    const calls = stubFetch({ openai: [{ status: 402 }], groq: ["serve"] });

    const first = await run(1);
    expect(calls).toEqual({ openai: 1, groq: 1 });
    expect(first.turn).toMatchObject({ answerStatus: "answered" });
    expect(usageFrame(first.text)).toMatchObject({ provider: "Groq", routeReason: "fallback:OpenAI" });

    const second = await run(2);
    // The skip is the whole point: no round-trip to a provider that cannot
    // answer until a human fixes the balance.
    expect(calls).toEqual({ openai: 1, groq: 2 });
    expect(second.turn).toMatchObject({ answerStatus: "answered" });
    expect(usageFrame(second.text)).toMatchObject({ provider: "Groq", routeReason: "fallback:OpenAI" });
  });

  it("a quarantined provider that is the last hope shows as `quarantined` in the attempt record", async () => {
    const calls = stubFetch({ openai: [{ status: 401 }], groq: [{ status: 500 }] });
    await run(1);
    const { text } = await run(2);
    expect(calls).toEqual({ openai: 1, groq: 2 });
    expect(statusFrame(text)).toMatchObject({
      reason: "all_providers_failed",
      providers: [
        { provider: "OpenAI", httpStatus: null, reason: "quarantined" },
        { provider: "Groq", httpStatus: 500, reason: "http_error" },
      ],
    });
  });

  it("control: a 429 does NOT quarantine — the next turn tries OpenAI again", async () => {
    const calls = stubFetch({ openai: [{ status: 429 }, "serve"], groq: ["serve"] });
    await run(1);
    expect(calls).toEqual({ openai: 1, groq: 1 });
    const second = await run(2);
    expect(calls).toEqual({ openai: 2, groq: 1 });
    expect(usageFrame(second.text)).toMatchObject({ provider: "OpenAI", routeReason: "primary" });
  });

  it("control: a 5xx does NOT quarantine either", async () => {
    const calls = stubFetch({ openai: [{ status: 503 }, "serve"], groq: ["serve"] });
    await run(1);
    await run(2);
    expect(calls).toEqual({ openai: 2, groq: 1 });
  });

  it("MIRA_PROVIDER_UNHEALTHY_S=0 disables the quarantine (the window is the knob)", async () => {
    process.env.MIRA_PROVIDER_UNHEALTHY_S = "0";
    const calls = stubFetch({ openai: [{ status: 402 }, "serve"], groq: ["serve"] });
    await run(1);
    await run(2);
    expect(calls).toEqual({ openai: 2, groq: 1 });
  });
});

// #4374 Codex R1 F1: the durable turn carries the exhaustion REASON, so a
// reload renders the same technician copy the live frame did.
describe("#4374 — the persisted turn carries the provider-failure reason", () => {
  const markers = (turn: Record<string, unknown>) =>
    ((turn.evidence as unknown[]) ?? []).filter((e) => (e as { kind?: unknown }).kind === "provider_failure");

  it("every provider failing persists { kind: provider_failure, reason: all_providers_failed } and nothing operator-facing", async () => {
    stubFetch({ openai: [{ status: 402 }], groq: [{ status: 401 }] });
    const { text, turn } = await run();
    expect(turn).toMatchObject({ answerStatus: "error", answerText: null });
    expect(markers(turn)).toEqual([{ kind: "provider_failure", reason: "all_providers_failed" }]);
    // Live and durable agree on the reason.
    expect(statusFrame(text)).toMatchObject({ reason: "all_providers_failed" });
  });

  it("no provider configured persists reason no_provider_configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    stubFetch({});
    const { turn } = await run();
    expect(markers(turn)).toEqual([{ kind: "provider_failure", reason: "no_provider_configured" }]);
  });

  it("control: a served turn persists no provider-failure marker", async () => {
    stubFetch({ openai: ["serve"] });
    const { turn } = await run();
    expect(turn).toMatchObject({ answerStatus: "answered" });
    expect(markers(turn)).toEqual([]);
  });

  it("control: with the canonical seam OFF nothing new is persisted (legacy path unchanged)", async () => {
    process.env.MIRA_CANONICAL_SEAM = "0";
    stubFetch({ openai: [{ status: 402 }], groq: [{ status: 401 }] });
    const { turn } = await run();
    expect(turn).toMatchObject({ answerStatus: "error" });
    expect(markers(turn)).toEqual([]);
  });
});

// #4374 Codex R3 F1: an idempotent replay of a saved exhaustion turn (the
// stream broke before the status frame, the client retried with the same
// clientRequestId) must say what the live frame said — not the legacy copy.
describe("#4374 — replaying a saved exhaustion turn keeps its technician copy", () => {
  async function replay(evidence: unknown[]) {
    domainMock.claimNotebookTurnRequest.mockResolvedValueOnce({
      status: "replay",
      turn: {
        id: "turn-r", question: "what is F004", answerStatus: "error", answerText: null,
        enabledSourceDocIds: [DOC_A], evidence, model: null, basis: null,
      },
    } as never);
    const res = await POST(
      chatReq({ message: "what is F004", sourceDocIds: [DOC_A], clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
      params,
    );
    expect(res.status).toBe(200);
    return statusFrame(await res.text());
  }

  it("all_providers_failed marker → the technician message and reason", async () => {
    const status = await replay([{ kind: "provider_failure", reason: "all_providers_failed" }]);
    expect(status).toMatchObject({ kind: "status", status: "error", message: ALL_PROVIDERS_FAILED_MESSAGE, reason: "all_providers_failed" });
  });

  it("no_provider_configured marker → the admin message and reason", async () => {
    const status = await replay([{ kind: "provider_failure", reason: "no_provider_configured" }]);
    expect(status).toMatchObject({ status: "error", message: NO_PROVIDER_CONFIGURED_MESSAGE, reason: "no_provider_configured" });
  });

  it("control: a historical error row with no marker keeps the legacy frame byte-for-byte", async () => {
    expect(await replay([])).toEqual({ kind: "status", status: "error", message: "No answer provider available." });
  });
});
