/**
 * #5265 edge profile — "AI finds, manual speaks". On the sealed tablet the
 * notebook answer is the retrieved manual passages, verbatim with page, and no
 * model runs (w0-tablet-spike.md, 2026-11-07: the model-written path took 53 s
 * on the 1.5B and came back uncited).
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/edge-passages.test.ts"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const HOWTO_CHUNK = {
  content:
    "Weighing the aircraft. Drain the fuel, fill the oil, place the aircraft level on the scales, record each scale reading, and divide the total moment by the total weight to find the empty weight CG.",
  docId: DOC_A,
  manufacturer: "",
  modelNumber: "",
  sourceUrl: "node-doc/u1/faa-h-8083-1b.pdf",
  sourcePage: 43,
  pageLabel: "3-9",
  chunkIndex: null,
  title: "FAA-H-8083-1B Weight and Balance.pdf",
  rank: 0.4,
  verified: true,
};
// An index page: dotted leader lines and page numbers, no instruction.
const INDEX_CHUNK = {
  ...HOWTO_CHUNK,
  content:
    "E6-B flight compute .......................... 10-1 effects of weight ............................ 1-3 electronic calculator ................... 10-2",
  sourcePage: 111,
  pageLabel: "I-3",
  rank: 0.5,
};

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: vi.fn(async () => ({ rows: [] })) }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

import { POST } from "../route";

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.startsWith("data: [DONE]"))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}

const contentOf = (f: Record<string, unknown>[]) =>
  f.filter((x) => x.kind === "content").map((x) => String(x.content)).join("");

const ASK = "How do I find the empty weight center of gravity?";

function providerAnswers(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.GROQ_API_KEY;
  process.env.MIRA_PROFILE = "edge";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Aircraft weight and balance", manufacturer: "FAA", model: "FAA-H-8083-1B" });
  ragMock.retrieveNodeChunks.mockResolvedValue([INDEX_CHUNK, HOWTO_CHUNK]);
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  providerAnswers("Use the equipment list.");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.MIRA_PROFILE;
});

describe("#5265 edge profile — the manual speaks", () => {
  it("answers with the passage verbatim and its page, skips the index page, calls no model", async () => {
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    const out = await frames(res);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = contentOf(out);
    expect(content).toContain(HOWTO_CHUNK.content);
    expect(content).toContain("page 43");
    expect(content).not.toContain("equipment list");
    expect(content).not.toContain("E6-B");

    const sources = out.find((f) => f.kind === "sources") as { citations: Array<{ citationId: string; page: number | null }> };
    expect(sources.citations.map((c) => c.page)).toEqual([43]);
    expect(content).toContain(`[${sources.citations[0].citationId}]`);

    const evidence = out.find((f) => f.kind === "evidence") as { basis: string; label: string };
    expect(evidence.label).toMatch(/word for word/);
    expect((out.find((f) => f.kind === "status") as { status: string }).status).toBe("answered");

    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as {
      answerStatus: string;
      answerText: string;
      model: string | null;
    };
    expect(persisted.answerStatus).toBe("answered");
    expect(persisted.answerText).toBe(content);
    expect(persisted.model).toBeNull();
  });

  it("only an index page retrieved: says nothing matched, records insufficient_evidence, calls no model", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([INDEX_CHUNK]);
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(contentOf(out)).toMatch(/qualified person/);
    expect((out.find((f) => f.kind === "status") as { status: string }).status).toBe("insufficient_evidence");
    expect((out.find((f) => f.kind === "sources") as { citations: unknown[] }).citations).toEqual([]);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as { answerStatus: string };
    expect(persisted.answerStatus).toBe("insufficient_evidence");
  });

  it("control: with the profile off the same turn goes to the model", async () => {
    delete process.env.MIRA_PROFILE;
    process.env.GROQ_API_KEY = "k";
    await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).toHaveBeenCalled();
  });
});
