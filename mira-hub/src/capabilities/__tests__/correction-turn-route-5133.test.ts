/**
 * #5133 — the notebook chat route (gated lane) does not send the previous
 * answer back to a correction turn:
 *   - a draft that repeats the last assistant turn is replaced by the
 *     clarifying question, in the stream and the persisted row, with no
 *     citations;
 *   - a genuinely new answer on a correction turn passes through (control);
 *   - the same repeat on an ordinary turn passes through (control).
 *
 * Harness copied from erase-advisory-route-5129.test.ts.
 * Run: npx vitest run src/capabilities/__tests__/correction-turn-route-5133.test.ts
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
    displayName: "PF4 — Line 1",
    manufacturer: "Allen-Bradley",
    model: "PowerFlex 4",
  })),
  listSources: vi.fn(async () => [{ filename: "PF4.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
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
import { CORRECTION_REPEAT_TEXT } from "@/capabilities/correction-turn";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

const chatReq = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: NB }) };

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;

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
  {
    docId: DOC_A,
    filename: "PF4.pdf",
    page: 10,
    content: "Output Current @ 200-240V Input: 2 HP, catalog code 8P0, 8.0 A. Motor Base RPM P0.03 default 1750 rpm.",
  },
];

const PREV = "The max output current for the 240V 2 HP PF4 is 8.0 A, code 8P0 [1].";
const REPEAT = "The max output current for the 240V 2 HP PF4 is 8.0 A, code 8P0 [1].";
const NEW_ANSWER = "Motor Base RPM is P0.03, default 1750 rpm [1].";
const HISTORY = [
  { role: "user", content: "max output current for the 2 hp" },
  { role: "assistant", content: PREV },
];

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
  delete process.env.MIRA_CANONICAL_SEAM;
  process.env.NOTEBOOK_ANSWER_GATE = "1";
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(groundedChunks as never);
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

type Recorded = { answerStatus: string; answerText: string | null };
function lastTurn() {
  const calls = domainMock.recordTurn.mock.calls as unknown as unknown[][];
  return calls[calls.length - 1]?.[2] as Recorded | undefined;
}

async function ask(message: string, answer: string) {
  vi.stubGlobal("fetch", vi.fn(async () => completingProvider(answer)));
  const res = await POST(chatReq({ message, sourceDocIds: [DOC_A], history: HISTORY }), params);
  const raw = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled(), { timeout: 2000 }).catch(() => undefined);
  const frames = raw
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => {
      try {
        return JSON.parse(l) as { kind?: string; content?: string; citations?: unknown[] };
      } catch {
        return {};
      }
    });
  const streamed = frames
    .filter((f) => f.kind === "content")
    .map((f) => f.content ?? "")
    .join("");
  const streamedCitations = frames.flatMap((f) => (Array.isArray(f.citations) ? f.citations : []));
  const turn = lastTurn();
  return { streamed, persisted: turn?.answerText ?? "", turn, streamedCitations };
}

describe("#5133 — correction turn does not get the previous answer back (route)", () => {
  it("a repeat on a correction turn is replaced, with no citations", async () => {
    const { streamed, persisted, turn, streamedCitations } = await ask("huh? thats not what i asked, i want the AMPS", REPEAT);
    expect(turn).toBeDefined();
    for (const text of [streamed, persisted]) {
      expect(text).toContain(CORRECTION_REPEAT_TEXT);
      expect(text).not.toContain("8P0");
    }
    expect(streamedCitations).toHaveLength(0);
  });

  it("control: a new answer on a correction turn passes through", async () => {
    const { streamed, persisted } = await ask("ignore that, base rpm default", NEW_ANSWER);
    for (const text of [streamed, persisted]) {
      expect(text).toContain("P0.03");
      expect(text).not.toContain(CORRECTION_REPEAT_TEXT);
    }
  });

  it("control: the same repeat on an ordinary turn passes through", async () => {
    const { streamed, persisted, streamedCitations } = await ask("what is the max output current again", REPEAT);
    for (const text of [streamed, persisted]) {
      expect(text).toContain("8P0");
      expect(text).not.toContain(CORRECTION_REPEAT_TEXT);
    }
    // Precondition for the zero-citation assertion above: the same draft cites.
    expect(streamedCitations.length).toBeGreaterThan(0);
  });

  it("gate off: nothing is replaced (the draft has already streamed)", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "0"; // the gate is on unless explicitly "0"
    const { streamed, persisted } = await ask("huh? thats not what i asked, i want the AMPS", REPEAT);
    expect(streamed).toContain("8P0");
    expect(persisted).toContain("8P0");
    expect(persisted).not.toContain(CORRECTION_REPEAT_TEXT);
  });
});
