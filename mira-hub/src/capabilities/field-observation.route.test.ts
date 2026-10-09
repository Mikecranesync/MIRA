/** ASI-001: backend provider-request regression, not a legacy UI test. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  // 085: chat citations resolve canonical origin server-side
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
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
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream("Check the DC bus first."), { status: 200 })),
  );
});

/** Field observation: the technician reported the color, not its PLC meaning. */
describe("field observation evidence contract", () => {
  it.each(["general", "grounded"])("delivers the case policy through the real %s route", async (mode) => {
    const question = "Our Bihl+Wiedemann AS-i lap-bar seat goes green to red in station after a minute or so. Why?";
    nbMock.validateChatSources.mockResolvedValue(mode === "general"
      ? { ok: false, error: "no_sources_selected" }
      : { ok: true, docIds: ["d1"], nodeId: "n1" });
    ragMock.retrieveNodeChunks.mockResolvedValue(mode === "general" ? [] : [
      { docId: "d1", filename: "ASi-diagnostics.pdf", page: 1, content: "Communication faults and safety input states are separate diagnostics." },
    ]);
    const res = await POST(req({ message: question, ...(mode === "general" ? { mode } : {}) }), params);
    await frames(res);
    expect(res.status).toBe(200);
    expect(seamMock.buildRequestBody).toHaveBeenCalled();
    const messages = seamMock.buildRequestBody.mock.calls.at(-1)?.[1] as unknown as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("FIELD OBSERVATIONS");
    expect(system).toContain("does not prove a physical failure");
    expect(system).toContain("elapsed time alone does not establish a configured timeout");
    expect(system).toContain("HMI indication or a device LED");
    expect(system).toContain("one device or several");
    expect(system).toContain("hypotheses, not confirmed causes");
    expect(system).toContain("Do not recommend bypassing an interlock");
    expect(messages.at(-1)?.content).toContain(question);
    if (mode === "general") {
      expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
      expect(system).toContain("You searched NO documentation");
    } else {
      expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
      expect(system).toContain("Answer ONLY from the numbered reference excerpts");
    }
  });
});
