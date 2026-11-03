/**
 * #5132 — through the notebook chat route, the [1] proof quote for the real page-28
 * chunks is the sinking/sourcing sentence, not the surge-suppressor (MOV) table, even
 * when the surge-suppressor chunk is retrieved first.
 *
 * Harness copied from correction-turn-route-5133.test.ts.
 * Run: npx vitest run src/capabilities/__tests__/supporting-quote-route-5132.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fx from "./fixtures/5132-page28-chunks.json";

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
    displayName: "Micro820 — Line 1",
    manufacturer: "Allen-Bradley",
    model: "Micro820",
  })),
  listSources: vi.fn(async () => [{ filename: "2080-UM001.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
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
const SINKING = "4…7 can only be wired as sinking";

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

// Surge-suppressor header chunk first: the order whose first-chunk quote misses the sentence.
const SURGE_FIRST = [1, 0, 2].map((i) => ({
  docId: DOC_A,
  filename: "2080-UM001.pdf",
  page: 28,
  content: fx.chunks[i].content,
}));

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
  ragMock.retrieveNodeChunks.mockResolvedValue(SURGE_FIRST as never);
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

async function citedQuotes(answer: string): Promise<string[]> {
  vi.stubGlobal("fetch", vi.fn(async () => completingProvider(answer)));
  const res = await POST(chatReq({ message: fx.question, sourceDocIds: [DOC_A] }), params);
  const raw = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled(), { timeout: 2000 }).catch(() => undefined);
  return raw
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .flatMap((l) => {
      try {
        const f = JSON.parse(l) as { citations?: { quote?: string | null }[] };
        return Array.isArray(f.citations) ? f.citations.map((c) => (c.quote ?? "").replace(/\s+/g, " ")) : [];
      } catch {
        return [];
      }
    });
}

describe("#5132 — page-28 proof quote through the route", () => {
  it("fixture precondition: the first chunk lacks the sentence and the page holds the MOV rows", () => {
    expect(SURGE_FIRST[0].content.replace(/\s+/g, " ")).not.toContain(SINKING);
    expect(SURGE_FIRST.some((c) => c.content.includes("24…48V DC 199-FSMA9 MOV"))).toBe(true);
  });

  it("an answer with no claimed value quotes the sinking sentence, not the first chunk", async () => {
    const quotes = await citedQuotes(
      "For DC inputs, terminals 0…3 can be wired as either sinking or sourcing, but 4…7 can only be wired as sinking inputs [1].",
    );
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) {
      expect(q).toContain(SINKING);
      expect(q).not.toContain("MOV");
    }
  });

  it("the staging answer (24V DC claimed) never takes the MOV row as its proof", async () => {
    const quotes = await citedQuotes(
      "Use the 24V DC sink input wiring example; for DC inputs, terminals 0…3 can be wired as either sinking or sourcing, but 4…7 can only be wired as sinking inputs [1].",
    );
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) {
      expect(q).toContain(SINKING);
      expect(q).not.toContain("MOV");
    }
  });
});
