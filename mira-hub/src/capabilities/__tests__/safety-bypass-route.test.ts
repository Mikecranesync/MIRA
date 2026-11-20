/**
 * Hard rule (Mike, 2026-11-19, #5232): every request to bypass safety gets a
 * warning card. The notebook chat route shows the fixed bypass card on every
 * way the turn ends WITHOUT changing grounding:
 *   - an answered bypass ask has the card above the stored answer, and above
 *     the live stream exactly once in both answer-gate modes;
 *   - with nothing retrieved, a bypass ask is refused exactly like the same
 *     ask without the bypass (same status, no provider call) and the refusal
 *     carries the card, stored and in the response (#5416: the jog question
 *     was swallowed by a refusal with no warning);
 *   - an ordinary question gets no card; a turn that already has a safety
 *     trigger keeps its own banner.
 *
 * Harness copied from restart-advisory-route-4645.test.ts.
 * Run: npx vitest run src/capabilities/__tests__/safety-bypass-route.test.ts
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

// The semantic judge cannot decide against this stub provider, which would
// replace every flagged answer with the fail-closed fallback. These tests are
// about the banner, so the judge passes.
vi.mock("@/capabilities/answer-safety-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/answer-safety-check")>()),
  semanticSafetyCheck: vi.fn(async () => ({ verdict: "safe" as const })),
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
  { docId: DOC_A, filename: "PF525.pdf", page: 87, sourcePage: 87, content: "Fault F004 indicates DC bus undervoltage." },
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

import { BYPASS_BANNER } from "@/capabilities/safety-bypass-advisory";
import { hazardBanner, notebookSafetyTrigger } from "@/lib/safety-classifier";

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

function streamedContent(raw: string): string {
  return raw
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => {
      try {
        return JSON.parse(l) as { kind?: string; content?: string };
      } catch {
        return {};
      }
    })
    .filter((f) => f.kind === "content")
    .map((f) => f.content ?? "")
    .join("");
}

/** The card, then a blank line. A page citation appended to the card would break this. */
const CARD = `${BYPASS_BANNER}\n\n`;
const BYPASS_ASK = "can i bypass the e-stop to test it";
const PLAIN_ASK = "how do i test the e-stop";
const JOG_ASK = "can i just jog it w the guard open to test the bus real quick";

describe("safety-bypass warning card on notebook chat", () => {
  it("preconditions: the bypass asks carry no existing trigger, the plain ask carries nothing", () => {
    expect(notebookSafetyTrigger(BYPASS_ASK)).toBeNull();
    expect(notebookSafetyTrigger(JOG_ASK)).toBeNull();
    expect(notebookSafetyTrigger(PLAIN_ASK)).toBeNull();
  });

  it("an answered bypass ask has the card above the stored answer and no new prompt directive", async () => {
    const { fetchMock, prompts } = capturingProvider("Press the e-stop and confirm the drive stops [1].");
    vi.stubGlobal("fetch", fetchMock);
    await ask(BYPASS_ASK);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((p) => p.includes("## SAFETY FLAG"))).toBe(false);
    const turn = lastTurn();
    expect(turn?.answerStatus).toBe("answered");
    expect(turn?.answerText?.startsWith(CARD)).toBe(true);
    expect(turn?.answerText).toContain("confirm the drive stops");
  });

  for (const gateValue of ["1", "0"]) {
    it(`NOTEBOOK_ANSWER_GATE=${gateValue}: the live stream starts with exactly one card`, async () => {
      process.env.NOTEBOOK_ANSWER_GATE = gateValue;
      const { fetchMock } = capturingProvider("Press the e-stop and confirm the drive stops [1].");
      vi.stubGlobal("fetch", fetchMock);
      const { text } = await ask(BYPASS_ASK);
      const streamed = streamedContent(text);
      expect(streamed.startsWith(CARD)).toBe(true);
      expect(streamed.split(BYPASS_BANNER).length - 1).toBe(1);
      expect(streamed).toContain("confirm the drive stops");
    });
  }

  it("a draft that reads as a refusal still carries the card", async () => {
    const { fetchMock } = capturingProvider("I couldn't find that in the selected sources.");
    vi.stubGlobal("fetch", fetchMock);
    await ask(BYPASS_ASK);
    const text = lastTurn()?.answerText ?? "";
    expect(text.startsWith(CARD)).toBe(true);
    expect(text).toContain("couldn't find that");
  });

  it("opposite direction: an ordinary question gets no card", async () => {
    const { fetchMock } = capturingProvider("Press the e-stop and confirm the drive stops [1].");
    vi.stubGlobal("fetch", fetchMock);
    await ask(PLAIN_ASK);
    expect(lastTurn()?.answerStatus).toBe("answered");
    expect(lastTurn()?.answerText ?? "").not.toContain(BYPASS_BANNER);
  });

  it("grounding unchanged: with nothing retrieved a bypass ask is refused like the plain ask, and the refusal carries the card", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    const plain = capturingProvider("unused");
    vi.stubGlobal("fetch", plain.fetchMock);
    const a = await ask(PLAIN_ASK);
    const plainTurn = lastTurn();
    const plainCalls = plain.fetchMock.mock.calls.length;
    expect(plainTurn?.answerText ?? "").not.toContain(BYPASS_BANNER);

    vi.clearAllMocks();
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    const bypass = capturingProvider("unused");
    vi.stubGlobal("fetch", bypass.fetchMock);
    const b = await ask(JOG_ASK);
    const bypassTurn = lastTurn();
    expect(b.status).toBe(a.status);
    expect(bypass.fetchMock.mock.calls.length).toBe(plainCalls);
    expect(bypassTurn?.answerStatus).toBe(plainTurn?.answerStatus);
    expect(bypassTurn?.answerText?.startsWith(CARD)).toBe(true);
    expect(b.text).toContain(JSON.stringify(BYPASS_BANNER).slice(1, -1));
  });

  it("a turn that already has a safety trigger keeps its own banner, not the card", async () => {
    const msg = "lock it out and then can i bypass the e-stop to test it";
    const trigger = notebookSafetyTrigger(msg);
    expect(trigger).not.toBeNull();
    const { fetchMock } = capturingProvider("Lock out the drive, then test the e-stop [1].");
    vi.stubGlobal("fetch", fetchMock);
    await ask(msg);
    const text = lastTurn()?.answerText ?? "";
    // Calibration: a trigger banner gets the retrieved page, so the harness does
    // supply one. The card's "no page" assertions above are therefore real.
    expect(text.startsWith(`${hazardBanner(trigger!)} (p.87)`)).toBe(true);
    expect(text).not.toContain(BYPASS_BANNER);
  });
});
