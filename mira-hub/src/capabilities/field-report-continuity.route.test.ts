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
  listTurns: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
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
  nbMock.listTurns.mockImplementation(async () => []);
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


describe("older technician reports through the real notebook provider seam", () => {
 it("does not restore the notebook machine's reports when current identity is disputed", async () => {
   nbMock.resolveBoundAsset.mockResolvedValue({ state: "resolved", entityId: "machine-A", unsPath: "plant/line/A", name: "Machine A", confirmedAt: "2026-10-09T00:00:00Z" } as never);
   nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Machine A", asset: { entityId: "machine-A" } });
   nbMock.listTurns.mockImplementation(async (...args) => args[2] === 24 ? [{ id: "prior-A", question: "Machine A has one slave per seat", ownerUserId: "u1", createdAt: "2026-10-09T01:00:00Z" }] : []);
   const res = await POST(req({ message: "What do we know now?", mode: "general", threadId: "case-thread", machineEvidence: { assetId: "machine-B", anchorAt: "2026-10-09T01:00:00Z" } }), params);
   await frames(res);
   expect(seamMock.buildRequestBody).toHaveBeenCalled();
   expect(nbMock.listTurns.mock.calls.some(args => args[2] === 24)).toBe(false);
   const messages = seamMock.buildRequestBody.mock.calls.at(-1)?.[1] as { content: string }[];
   expect(messages.some(m => m.content.includes("Machine A has one slave per seat"))).toBe(false);
 });
 it("uses the turn snapshot rather than a notebook binding refreshed after resolution", async () => {
   nbMock.resolveBoundAsset.mockResolvedValue({ state: "resolved", entityId: "machine-A", unsPath: "plant/line/A", name: "Machine A", confirmedAt: "2026-10-09T00:00:00Z" } as never);
   nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Machine B", asset: { entityId: "machine-B" } });
   const res = await POST(req({ message: "What do we know now?", mode: "general", threadId: "case-thread" }), params);
   await frames(res);
   expect(seamMock.buildRequestBody).toHaveBeenCalled();
   expect(nbMock.listTurns).toHaveBeenCalledWith(TENANT, NB, 24, { viewerUserId: "u1", threadId: "case-thread", expectedEquipmentEntityId: "machine-A" });
 });
 it("retains a correction outside client history without replaying the old assistant theory", async () => {
   const prior = Array.from({ length: 24 }, (_, i) => ({ id: `turn-${i}`, question: i === 3 ? "No, each seat has its own AS-i slave in the back of it." : `Report ${i}: we observed the seat indication.`, answerStatus: "answered", answerText: "Both seats share one slave; replace it.", evidence: [], createdAt: "2026-10-09T01:00:00Z", ownerUserId: "u1", threadId: "case-thread" }));
   nbMock.listTurns.mockResolvedValue([...prior, { ...prior[0], id: "legacy", ownerUserId: null, question: "Shared legacy report about a different technician" }]);
   visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({ observationId: "obs", sessionId: "session", text: "A teal handheld device.", obsKind: "look", trust: "candidate", fileId: "44444444-4444-4444-8444-444444444444", hazards: [] });
   const history = prior.slice(-6).flatMap(t => [{ role: "user", content: t.question }, { role: "assistant", content: "What indication changed?" }]);
   const res = await POST(req({ message: "What do we know now?", mode: "general", threadId: "case-thread", history, visualEvidence: { fileId: "44444444-4444-4444-8444-444444444444" } }), params);
   await frames(res);
   expect(seamMock.buildRequestBody).toHaveBeenCalled();
   const messages = seamMock.buildRequestBody.mock.calls.at(-1)?.[1] as { role: string; content: string }[];
   const reports = messages.find(m => m.content.includes("EARLIER TECHNICIAN REPORTS"));
   expect(reports?.role).toBe("user");
   expect(reports?.content).toContain("each seat has its own AS-i slave");
   expect(reports?.content).not.toContain("Both seats share one slave");
   expect(reports?.content).not.toContain("Shared legacy report");
   expect(nbMock.listTurns).toHaveBeenCalledWith(TENANT, NB, 24, { viewerUserId: "u1", threadId: "case-thread", expectedEquipmentEntityId: null });
   expect(messages.at(-1)?.content).toContain("What do we know now?");
 });
 it("keeps unavailable prior-report coverage explicit in the provider input", async () => {
   nbMock.listTurns.mockImplementation(async (...args) => { if (args[2] === 24) throw new Error("report store unavailable"); return []; });
   visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({ observationId: "obs", sessionId: "session", text: "A teal handheld device.", obsKind: "look", trust: "candidate", fileId: "44444444-4444-4444-8444-444444444444", hazards: [] });
   const res = await POST(req({ message: "What do we know now?", mode: "general", threadId: "case-thread", visualEvidence: { fileId: "44444444-4444-4444-8444-444444444444" } }), params);
   await frames(res);
   expect(seamMock.buildRequestBody).toHaveBeenCalled();
   const messages = seamMock.buildRequestBody.mock.calls.at(-1)?.[1] as { role: string; content: string }[];
   expect(messages.some(m => m.role === "user" && m.content.includes("EARLIER TECHNICIAN REPORTS: unavailable"))).toBe(true);
 });

});
