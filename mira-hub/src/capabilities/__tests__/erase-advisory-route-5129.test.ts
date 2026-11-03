/**
 * #5129 — the notebook chat route puts a fixed back-up notice above an answer
 * that tells the technician to erase settings or a program (gated lane):
 *   - it reaches both the streamed answer and the persisted row, exactly once;
 *   - the restart banner stays ABOVE it. (The isolation-notice order is pinned
 *     in erase-advisory.test.ts: a flagged hands-on turn takes the semantic
 *     fail-closed fallback in this harness, which has no judge.)
 *   - an ordinary answer gets none (opposite direction).
 *
 * Harness copied from restart-advisory-route-4645.test.ts.
 * Run: npx vitest run src/capabilities/__tests__/erase-advisory-route-5129.test.ts
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
import { BACKUP_BANNER, FACTORY_NOT_FAULT_BANNER } from "@/capabilities/erase-advisory";

function lastTurn() {
  const calls = domainMock.recordTurn.mock.calls as unknown as unknown[][];
  return calls[calls.length - 1]?.[2] as { answerStatus: string; answerText: string | null } | undefined;
}

async function ask(message: string, answer: string) {
  vi.stubGlobal("fetch", vi.fn(async () => completingProvider(answer)));
  const res = await POST(chatReq({ message, sourceDocIds: [DOC_A] }), params);
  const raw = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled(), { timeout: 2000 }).catch(() => undefined);
  const streamed = raw
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
  return { streamed, persisted: lastTurn()?.answerText ?? "" };
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("#5129 — back-up notice on erase answers (route)", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_ANSWER_GATE = "1";
  });

  it("an erase answer carries the notice once, in the stream and the persisted row", async () => {
    const { streamed, persisted } = await ask(
      "How do I reset the drive to factory defaults?",
      "Set P041 to 1 to reset all parameters to defaults [1].",
    );
    for (const text of [streamed, persisted]) {
      expect(text.startsWith(BACKUP_BANNER)).toBe(true);
      expect(count(text, BACKUP_BANNER)).toBe(1);
      expect(text).toContain("Set P041 to 1");
    }
  });

  it("the restart banner stays above the notice on a fault-reset question", async () => {
    const { streamed, persisted } = await ask(
      "How do I reset fault F004?",
      "Set P041 to 1 to reset all parameters to defaults [1].",
    );
    for (const text of [streamed, persisted]) {
      expect(text.startsWith(RESTART_BANNER)).toBe(true);
      expect(text.indexOf(BACKUP_BANNER)).toBeGreaterThan(text.indexOf(RESTART_BANNER));
      expect(count(text, BACKUP_BANNER)).toBe(1);
    }
  });

  it("opposite direction: an ordinary answer gets no notice", async () => {
    const { streamed, persisted } = await ask("What does fault F004 indicate?", "F004 indicates DC bus undervoltage [1].");
    expect(streamed).not.toContain(BACKUP_BANNER);
    expect(persisted).not.toContain(BACKUP_BANNER);
  });
});

describe("#5131 — factory reset offered for a fault (route)", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_ANSWER_GATE = "1";
  });

  it("a fault-reset question answered with a factory reset carries the notice once, above the back-up notice", async () => {
    const { streamed, persisted } = await ask(
      "How do I reset fault F004?",
      "Set P041 to 1 to reset all parameters to defaults [1].",
    );
    for (const text of [streamed, persisted]) {
      expect(count(text, FACTORY_NOT_FAULT_BANNER)).toBe(1);
      expect(text.indexOf(FACTORY_NOT_FAULT_BANNER)).toBeGreaterThan(text.indexOf(RESTART_BANNER));
      expect(text.indexOf(BACKUP_BANNER)).toBeGreaterThan(text.indexOf(FACTORY_NOT_FAULT_BANNER));
    }
  });

  it("opposite direction: a factory reset the technician asked for gets no such notice", async () => {
    const { streamed, persisted } = await ask(
      "The drive faulted. How do I reset it to factory defaults?",
      "Set P041 to 1 to reset all parameters to defaults [1].",
    );
    expect(streamed).not.toContain(FACTORY_NOT_FAULT_BANNER);
    expect(persisted).not.toContain(FACTORY_NOT_FAULT_BANNER);
    expect(streamed).toContain(BACKUP_BANNER);
  });
});
