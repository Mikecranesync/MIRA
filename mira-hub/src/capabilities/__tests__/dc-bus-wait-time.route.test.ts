/**
 * Owner decision 4 (#4372) — route-level proof that an unsourced DC-bus
 * discharge wait time never reaches the stream or the saved turn, on the
 * zero-source passthrough and on a grounded turn whose sources do not state
 * the figure. A grounded turn whose source states it keeps the answer.
 *
 * Harness: the same mocks and request helpers as prompt-leak-guard-route.test.ts
 * (this directory hosts this route's tests; see that file's header for why).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  resolveBoundAsset: vi.fn(async (): Promise<Record<string, unknown>> => ({ state: "unbound" })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

vi.mock("@/lib/visual-evidence-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visual-evidence-context")>("@/lib/visual-evidence-context");
  return { ...actual, loadVisualEvidenceForAsset: vi.fn(async () => [] as unknown[]) };
});

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

vi.mock("@/lib/inference/canonical-cascade", () => ({
  canonicalSeamEnabled: vi.fn(() => false),
  canonicalProviders: vi.fn(() => []),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

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

async function streamed(res: Response): Promise<string> {
  let out = "";
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const f = JSON.parse(line.slice(6));
      if (f.kind === "content") out += String(f.content ?? "");
    } catch {
      /* partial */
    }
  }
  return out;
}

function persistedAnswer(): string {
  const call = nbMock.recordTurn.mock.calls.at(-1) as unknown[];
  return String((call[2] as Record<string, unknown>).answerText ?? "");
}

const QUESTION = "how long do I wait for the dc bus capacitors to discharge after power off";
const MODEL_ANSWER = "Lock out the drive. Wait 5 minutes for the DC bus capacitors to discharge, then measure DC+ to DC-.";
const FALLBACK_HEAD = "I won't give a capacitor discharge wait time for this drive";

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.NOTEBOOK_ANSWER_GATE; // the production default: gate on
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "test-key";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream(MODEL_ANSWER), { status: 200 })));
});

describe("decision 4 — zero-source passthrough (no sources attached)", () => {
  it("an unsourced wait time never reaches the stream or the saved turn", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const res = await POST(req({ message: QUESTION, mode: "general" }), params);
    expect(res.status).toBe(200);
    const text = await streamed(res);
    expect(text).toContain(FALLBACK_HEAD);
    expect(text).not.toContain("5 minutes");
    expect(persistedAnswer()).not.toContain("5 minutes");
  });
});

describe("decision 4 — grounded turn", () => {
  beforeEach(() => nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" }));

  it("sources that do not state the figure: replaced", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([
      { docId: DOC_A, filename: "manual.pdf", page: 3, content: "F004 is DC bus undervoltage." },
    ]);
    const text = await streamed(await POST(req({ message: QUESTION }), params));
    expect(text).toContain(FALLBACK_HEAD);
    expect(text).not.toContain("5 minutes");
    expect(persistedAnswer()).not.toContain("5 minutes");
  });

  it("a source that states the figure: the answer is kept", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([
      {
        docId: DOC_A,
        filename: "manual.pdf",
        page: 3,
        content: "WARNING: Wait 5 minutes after removing power for the DC bus capacitors to discharge.",
      },
    ]);
    const text = await streamed(await POST(req({ message: QUESTION }), params));
    expect(text).toContain("5 minutes");
    expect(text).not.toContain(FALLBACK_HEAD);
  });
});

describe("decision 4 — Codex round 1 F4 (route)", () => {
  it("a power-up charging answer is streamed and persisted unchanged", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const answer = "Wait 10 seconds after power-up for the DC bus to charge, then check the ready light.";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream(answer), { status: 200 })));
    const text = await streamed(await POST(req({ message: "How long after power-up does the DC bus take to charge?", mode: "general" }), params));
    expect(text).toContain("10 seconds after power-up");
    expect(text).not.toContain(FALLBACK_HEAD);
    expect(persistedAnswer()).toContain("10 seconds after power-up");
  });
});

describe("decision 4 — Codex round 2 F1 (sibling-model evidence is not support)", () => {
  it("a vendor_fallback chunk stating the figure does not authorize it for the bound drive", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
    ragMock.retrieveNodeChunks.mockResolvedValue([
      {
        docId: DOC_A,
        filename: "sibling-manual.pdf",
        page: 9,
        content: "WARNING: Wait 5 minutes after removing power for the DC bus capacitors to discharge.",
        retrievalScope: "vendor_fallback",
      },
    ]);
    const text = await streamed(await POST(req({ message: QUESTION }), params));
    expect(text).toContain(FALLBACK_HEAD);
    expect(text).not.toContain("5 minutes");
    expect(persistedAnswer()).not.toContain("5 minutes");
  });

  it("route: a fan clause does not let the unsupported figure through", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const answer = "Wait 5 minutes for the DC bus capacitors to discharge; the cooling fan may continue running.";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream(answer), { status: 200 })));
    const text = await streamed(await POST(req({ message: QUESTION, mode: "general" }), params));
    expect(text).not.toContain("5 minutes");
    expect(persistedAnswer()).not.toContain("5 minutes");
  });
});
