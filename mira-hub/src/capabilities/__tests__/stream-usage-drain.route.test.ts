/**
 * Codex F1 on #4354 — a failure while draining for the usage block must not
 * open a fallback provider.
 *
 * With the canonical seam on, the route keeps reading after `finish_reason:
 * "stop"` until OpenAI's usage chunk lands (D9). If the connection drops or the
 * composed timeout fires in that window, the extra read rejects. Before this
 * fix that rejection fell into the provider-failure catch, which opened the
 * next provider — and because `responseBuffer` lives outside the cascade, the
 * fallback's answer was APPENDED to the completed one and persisted under the
 * fallback model (or, with no fallback left, a finished answer became an error
 * turn with no text).
 *
 * Contract pinned here: after a stop marker, a post-stop read failure finalizes
 * the completed answer, attributed to the provider that produced it, with usage
 * honestly unknown; no fallback is opened. The usage-arrives path (the D9 fix
 * itself) is the control. Mock scaffold mirrors chat-stop-prestream-4310.
 *
 * Run: npx vitest run src/capabilities/__tests__/stream-usage-drain.route.test.ts
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

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const FIRST = "Check the DC bus voltage first.";
const FALLBACK = "FALLBACK ANSWER FROM GROQ";

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
const USAGE = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`;

/** A provider that completes normally in one go (fallbacks and judges). */
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

/**
 * A PULL-driven OpenAI stream: content on the first read, the stop marker on
 * the second, then either the usage block + [DONE] (control) or a timeout
 * rejection before usage ever arrives (the defect).
 */
function openAiStream(afterStop: "timeout" | "usage"): Response {
  let step = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        step += 1;
        if (step === 1) {
          for (const w of FIRST.split(" ")) c.enqueue(enc.encode(delta(w + " ")));
          return;
        }
        if (step === 2) {
          c.enqueue(enc.encode(STOP));
          return;
        }
        if (afterStop === "usage") {
          c.enqueue(enc.encode(USAGE + "data: [DONE]\n\n"));
          c.close();
          return;
        }
        c.error(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      },
    }),
    { status: 200 },
  );
}

const groundedChunks = [
  { docId: DOC_A, filename: "PF525.pdf", page: 87, content: "Fault F004 indicates DC bus undervoltage." },
];

/** fetch stub routed by host: OpenAI's STREAMING call gets the scripted stream; Groq is the fallback; everything else (judges) completes. */
function stubFetch(afterStop: "timeout" | "usage") {
  const streams = { openai: 0, groq: 0 };
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === "string" ? init.body : "";
    const streaming = body.includes('"stream":true');
    if (u.includes("api.openai.com") && streaming) {
      streams.openai += 1;
      return openAiStream(afterStop);
    }
    if (u.includes("api.groq.com") && streaming) {
      streams.groq += 1;
      return completingProvider(FALLBACK);
    }
    return completingProvider("judge ok");
  });
  vi.stubGlobal("fetch", fetchMock);
  return streams;
}

/** Join the `content` SSE frames the route streamed (one word per frame). */
function streamedContent(sse: string): string {
  return sse
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => {
      try {
        const f = JSON.parse(l.slice(6)) as { kind?: string; content?: string };
        return f.kind === "content" ? (f.content ?? "") : "";
      } catch {
        return "";
      }
    })
    .join("");
}

function persistedUsage(): { provider: string | null; inputTokens: number | null; outputTokens: number | null } {
  const call = persistMock.persistTurnUsage.mock.calls.at(-1) as unknown as [unknown, Record<string, unknown>] | undefined;
  const u = (call?.[1] ?? {}) as { provider?: string | null; inputTokens?: number | null; outputTokens?: number | null };
  return { provider: u.provider ?? null, inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null };
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "0";
  process.env.OPENAI_API_KEY = "k0";
  process.env.GROQ_API_KEY = "k1";
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(groundedChunks as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run() {
  const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
  expect(res.status).toBe(200);
  const text = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalled());
  const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
  return { text, turn };
}

describe("post-stop usage drain failure (Codex F1 on #4354)", () => {
  it("a timeout after the stop marker finalizes the completed answer and NEVER opens the fallback", async () => {
    const streams = stubFetch("timeout");
    const { text, turn } = await run();

    expect(streams.openai).toBe(1);
    expect(streams.groq).toBe(0);
    expect(streamedContent(text)).toContain("Check the DC bus");
    expect(streamedContent(text)).not.toContain(FALLBACK);
    expect(turn).toMatchObject({ answerStatus: "answered" });
    expect(String(turn.answerText)).toContain("Check the DC bus");
    expect(String(turn.answerText)).not.toContain(FALLBACK);
    // Attributed to the provider that produced it, usage honestly unknown.
    expect(persistedUsage()).toEqual({ provider: "OpenAI", inputTokens: null, outputTokens: null });
  });

  it("with no fallback configured the completed answer is still an answered turn, not an error", async () => {
    delete process.env.GROQ_API_KEY;
    const streams = stubFetch("timeout");
    const { turn } = await run();

    expect(streams.openai).toBe(1);
    expect(turn).toMatchObject({ answerStatus: "answered" });
    expect(String(turn.answerText)).toContain("Check the DC bus");
    expect(persistedUsage().provider).toBe("OpenAI");
  });

  it("control: when the usage chunk lands after the stop marker it is recorded (the D9 fix)", async () => {
    const streams = stubFetch("usage");
    const { turn } = await run();

    expect(streams.openai).toBe(1);
    expect(streams.groq).toBe(0);
    expect(turn).toMatchObject({ answerStatus: "answered" });
    expect(persistedUsage()).toEqual({ provider: "OpenAI", inputTokens: 12, outputTokens: 7 });
  });
});
