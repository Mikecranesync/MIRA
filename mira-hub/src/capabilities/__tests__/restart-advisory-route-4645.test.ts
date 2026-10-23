/**
 * #4645 defect 1 — the notebook chat route adds restart-safety framing to a
 * reset / restart-after-fault question WITHOUT changing grounding:
 *   - a reset question gets the fixed restart banner above the persisted answer
 *     and the restart directive in the provider prompt;
 *   - an ordinary question gets neither (opposite direction);
 *   - with nothing retrieved, a reset question is refused exactly like an
 *     ordinary one — the advisory is NOT a safety trigger, so it never unlocks
 *     the "flagged turns are answered without evidence" path.
 *
 * Harness mirrors chat-stop-prestream-4310.test.ts.
 * Run: npx vitest run src/capabilities/__tests__/restart-advisory-route-4645.test.ts
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

const chatReq = (body: unknown, init: { signal?: AbortSignal } = {}) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...(init.signal ? { signal: init.signal } : {}),
  });
const params = { params: Promise.resolve({ id: NB }) };

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;

/** A provider stream that completes normally — what the route would spend on if the stop were lost. */
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
afterEach(async () => {
  // Usage persistence is deliberately scheduled after the response closes.
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});


import { RESTART_BANNER } from "@/capabilities/restart-advisory";

function lastTurn() {
  const calls = domainMock.recordTurn.mock.calls as unknown as unknown[][];
  return calls[calls.length - 1]?.[2] as { answerStatus: string; answerText: string | null } | undefined;
}

/** Provider stub that records the system prompt of every call. */
function capturingProvider(answer: string) {
  const prompts: string[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages?: { role: string; content: unknown }[] };
    const sys = body.messages?.find((m) => m.role === "system")?.content;
    prompts.push(typeof sys === "string" ? sys : JSON.stringify(sys ?? ""));
    return completingProvider(answer);
  });
  return { fetchMock, prompts };
}

async function ask(message: string) {
  const res = await POST(chatReq({ message, sourceDocIds: [DOC_A] }), params);
  const text = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled(), { timeout: 2000 }).catch(() => undefined);
  return { status: res.status, text };
}

describe("#4645 — restart-safety framing on reset / restart-after-fault questions", () => {
  it("a reset question gets the restart banner above the answer and the restart directive in the prompt", async () => {
    const { fetchMock, prompts } = capturingProvider("Clear fault F004 by pressing STOP/RESET [1].");
    vi.stubGlobal("fetch", fetchMock);
    await ask("How do I reset fault F004 and get it running again?");
    expect(prompts.some((p) => p.includes("RESET / RESTART AFTER A FAULT"))).toBe(true);
    const turn = lastTurn();
    expect(turn?.answerStatus).toBe("answered");
    expect(turn?.answerText?.startsWith(RESTART_BANNER)).toBe(true);
    expect(turn?.answerText).toContain("pressing STOP/RESET");
  });

  it("opposite direction: an ordinary question gets no restart banner and no restart directive", async () => {
    const { fetchMock, prompts } = capturingProvider("F004 indicates DC bus undervoltage [1].");
    vi.stubGlobal("fetch", fetchMock);
    await ask("What does fault F004 indicate?");
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((p) => p.includes("RESET / RESTART AFTER A FAULT"))).toBe(false);
    expect(lastTurn()?.answerText ?? "").not.toContain(RESTART_BANNER);
  });

  it("grounding unchanged: with nothing retrieved a reset question is refused exactly like an ordinary one", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    const plain = capturingProvider("unused");
    vi.stubGlobal("fetch", plain.fetchMock);
    const a = await ask("What does fault F004 indicate?");
    const plainCalls = plain.fetchMock.mock.calls.length;
    vi.clearAllMocks();
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    const reset = capturingProvider("unused");
    vi.stubGlobal("fetch", reset.fetchMock);
    const b = await ask("How do I reset fault F004 and get it running again?");
    expect(b.status).toBe(a.status);
    expect(reset.fetchMock.mock.calls.length).toBe(plainCalls);
  });
});
