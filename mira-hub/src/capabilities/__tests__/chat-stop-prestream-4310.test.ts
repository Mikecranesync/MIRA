/**
 * #4310 — a Stop that lands DURING the pre-stream phase is persisted as a stop.
 *
 * The notebook chat route attaches its `req.signal` "abort" listener only
 * after the whole pre-stream phase (claim, validate, retrieval, LOOK) has
 * run. A technician who presses Stop inside that window — the field repro
 * pressed it 231 ms after send — aborts a signal nobody is listening to
 * yet, and `addEventListener` on an already-aborted signal never fires.
 * Before the fix the cascade still opened a provider and the turn persisted
 * as a full `answered` row, which replayed on reload and re-entered history
 * (PRD part-5 §19.13, STRM-2).
 *
 * Contract (notebook-chat-types.ts STOPPED-TURN CONTRACT): a stop before the
 * first content byte persists `answer_status='error'`, `answer_text=NULL`,
 * and NO provider is ever opened for it.
 *
 * The sibling suite `src/app/api/equipment-notebooks/__tests__/chat-stop-persist.test.ts`
 * covers aborts that land AFTER `POST` has returned its stream; it cannot see
 * this window. Mock scaffold mirrors that file.
 *
 * Run: npx vitest run src/capabilities/__tests__/chat-stop-prestream-4310.test.ts
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

describe("STRM-2 / #4310 — client stops during the pre-stream phase", () => {
  // Staging runs the answer gate ON (default); the kill-switch path must
  // behave the same, so both are pinned.
  for (const gate of ["1", "0"] as const) {
    it(`gate=${gate}: an abort that lands during retrieval persists an error turn with no text and opens no provider`, async () => {
      process.env.NOTEBOOK_ANSWER_GATE = gate;
      const ac = new AbortController();
      // Retrieval is a pre-stream await: abort while the route is inside it,
      // i.e. before any listener on req.signal exists.
      ragMock.retrieveNodeChunks.mockImplementationOnce(async () => {
        ac.abort();
        return groundedChunks as never;
      });
      const fetchMock = vi.fn(async () => completingProvider("Check the DC bus voltage first."));
      vi.stubGlobal("fetch", fetchMock);

      const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }, { signal: ac.signal }), params);
      expect(res.status).toBe(200);
      // Drain the stream so the route runs to its persistence step.
      await res.text();

      await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
      const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
      expect(turn).toMatchObject({ answerStatus: "error", answerText: null, evidence: [], basis: null });
      // A stopped turn must never spend provider tokens.
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("control: the same turn without a stop is answered from the provider", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "1";
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      completingProvider("Check the DC bus voltage first."),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    await res.text();

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    // Opposite-direction control: the provider's text reached persistence as
    // a real answer. (Judges on the answered path also call chat-completions
    // endpoints through the same stubbed global, so a call count would not
    // isolate the provider; the persisted text does.)
    expect(turn).toMatchObject({ answerStatus: "answered" });
    expect(String(turn.answerText)).toContain("Check the DC bus voltage");
    expect(fetchMock).toHaveBeenCalled();
  });
});
