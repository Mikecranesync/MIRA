/**
 * The notebook question pass keeps 8 passages with the rerank lane on (top 2 pinned, the rest
 * reranked) and today's 6 with it off, so a deployment without NOTEBOOK_RERANK=1 is unchanged.
 * Evidence: docs/evals/retrieval-eval/2026-11-04-pinned-rerank-k8.md.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/rerank-question-topk.test.ts"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
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

const req = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: NB }) };

async function questionTopK(): Promise<number | undefined> {
  const res = await POST(req({ message: "What deceleration time stops the overvoltage trip on this drive?" }), params);
  expect(res.status).toBe(200);
  await res.text();
  expect(ragMock.retrieveNodeChunks).toHaveBeenCalledTimes(1);
  return ((ragMock.retrieveNodeChunks.mock.calls[0] as unknown[])[3] as { topK?: number }).topK;
}

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("Lengthen the decel time."), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("notebook question pass: passage count follows the rerank flag", () => {
  it("flag off (production today): 6 passages", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "");
    expect(await questionTopK()).toBe(6);
  });

  it("flag set to anything but 1: still 6", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "true");
    expect(await questionTopK()).toBe(6);
  });

  it("flag on: 8 passages", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "1");
    expect(await questionTopK()).toBe(8);
  });
});
