/** ASI-001: selected-manual retrieval query through the real notebook route. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  listTurns: vi.fn(async () => []),
  normalizeNotebookThreadId: (v: unknown) => typeof v === "string" ? v : null,
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  // 085: chat citations resolve canonical origin server-side
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string, _chunks: unknown[], look?: string) => look ? `${look}\n\n${q}` : q),
  corpusManufacturers: vi.fn(async () => []),
  resolveModelFromObservationText: vi.fn(() => ({ model: null, ambiguous: false })),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn((..._args: unknown[]) => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

const visualMock = vi.hoisted(() => ({
 photoLinkedToTarget: vi.fn(async () => ({ fileId: "44444444-4444-4444-8444-444444444444", capturedAt: "2026-10-09T00:00:00Z" })),
 loadVisualEvidenceForPhoto: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: visualMock.photoLinkedToTarget }));
vi.mock("@/lib/visual-evidence-context", async (original) => ({
 ...(await original<typeof import("@/lib/visual-evidence-context")>()),
 loadVisualEvidenceForPhoto: visualMock.loadVisualEvidenceForPhoto,
 loadRecentLookObservations: vi.fn(async () => []),
}));
import { POST } from "../app/api/equipment-notebooks/[id]/chat/route";

/** A provider SSE stream that emits `text` as one delta, then [DONE]. */
function providerStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };
const envBefore = { ...process.env };
afterEach(() => { process.env = { ...envBefore }; vi.unstubAllGlobals(); });

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const raw = await res.text();
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const p = line.slice(6);
    if (p === "[DONE]") continue;
    try {
      out.push(JSON.parse(p));
    } catch {
      /* partial */
    }
  }
  return out;
}

beforeEach(() => {
  // This suite pins its own seam (not the semantic judge, which is owned by
  // chat-answer-gate.test.ts). Iteration-9 judges EVERY served answer, so
  // disable the layer here rather than stub a judge in every test.
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream("Check the DC bus first."), { status: 200 })),
  );
});


describe("server photo context in selected-manual retrieval", () => {
  it.each(["Does this help?", "What am I looking at, and what should I check?"].flatMap(message => ["PERI\nRD\n1", "ovA", "ObF", "error ovA", "flashing ovA", "blinking ovA"].map(readout => [message, readout])))("uses the linked readout for %s with %s rather than a stale history subject", async (message, readout) => {
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["55555555-5555-4555-8555-555555555555"], nodeId: "n1" });
    ragMock.retrieveNodeChunks.mockResolvedValue([{ content: "Read Peripheral Fault mode: a peripheral fault is present if value 1 is displayed.", docId: "55555555-5555-4555-8555-555555555555", manufacturer: "Pepperl+Fuchs", modelNumber: "VBP-HH1-V3.0", sourceUrl: "https://files.pepperl-fuchs.com/manual.pdf", sourcePage: 18, title: "Family manual", rank: 1, verified: true }]);
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({ observationId: "obs", sessionId: "session", text: /^(?:error|flashing|blinking)\b/.test(readout) ? `LCD display shows ${readout}. Buttons read PRG.` : `LCD display shows:\n${readout}\nButtons read PRG.`, obsKind: "look", trust: "candidate", fileId: "44444444-4444-4444-8444-444444444444", hazards: [] });
    const res = await POST(req({ message, history: [{ role: "user", content: "What is Ethernet parameter P042?" }], sourceDocIds: ["55555555-5555-4555-8555-555555555555"], visualEvidence: { fileId: "44444444-4444-4444-8444-444444444444" } }), params);
    await frames(res);
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    const query = ragMock.retrieveNodeChunks.mock.calls.at(-1)?.[2];
    expect(ragMock.retrieveNodeChunks.mock.calls.at(-1)?.[3]).toMatchObject({ includeQueryRecall: true });
    for (const literal of readout.split("\n")) expect(query).toContain(literal);
    expect(query).not.toContain("P042");
    expect(query).not.toContain("PRG");
    expect(seamMock.buildRequestBody).toHaveBeenCalled();
    // History remains legitimate history, but must not be repeated as a directive
    // in the current evidence-bearing user message.
    expect(ragMock.buildManualUserContent.mock.calls.at(-1)?.[0]).toBe(message);
  });
});
