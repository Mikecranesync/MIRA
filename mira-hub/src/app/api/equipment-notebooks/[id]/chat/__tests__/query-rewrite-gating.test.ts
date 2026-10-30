/**
 * Query rewrite (NOTEBOOK_QUERY_REWRITE) is paid for and awaited ONLY by a
 * notebook-source turn — the one branch that reads `rewrittenQuery`. A general
 * turn and an OEM-corpus turn must make no rewrite call (Codex F3 on #5003).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 */
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

const rewriteMock = vi.hoisted(() => ({
  rewriteForManualSearch: vi.fn(async () => ({ rewritten: "Overcurrent Fault F12 Current Limit", status: "ran", provider: "OpenAI", durationMs: 3 })),
}));
vi.mock("@/capabilities/query-rewrite", () => rewriteMock);

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

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

const POST_TEXT = "PowerFlex 40 on a conveyor trips every time the belt loads up, no fault on the keypad. Ideas?";

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  ragMock.retrieveManualChunks.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("Check the DC bus first."), { status: 200 })));
});

describe("query rewrite is started only for a notebook-source turn", () => {
  it("a notebook-source turn calls the rewrite once and hands the result to retrieveNodeChunks", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" });
    ragMock.retrieveNodeChunks.mockResolvedValue([
      { docId: "d1", filename: "PF40.pdf", page: 61, content: "Overcurrent Fault F12: current exceeded the limit." },
    ]);
    const res = await POST(req({ message: POST_TEXT }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(rewriteMock.rewriteForManualSearch).toHaveBeenCalledTimes(1);
    expect(rewriteMock.rewriteForManualSearch).toHaveBeenCalledWith(POST_TEXT);
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalledTimes(1);
    const opts = (ragMock.retrieveNodeChunks.mock.calls[0] as unknown[])[3] as { rewrittenQuery?: string };
    expect(opts.rewrittenQuery).toBe("Overcurrent Fault F12 Current Limit");
  });

  it("a general turn (no sources, mode=general) never calls the rewrite", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const res = await POST(req({ message: POST_TEXT, mode: "general" }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(rewriteMock.rewriteForManualSearch).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });

  it("an OEM-corpus turn (no notebook sources, machine identity known) never calls the rewrite", async () => {
    // No validated sources → notebookRetrieval is false; the notebook's own
    // manufacturer/model route the turn to the shared OEM corpus instead.
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "PowerFlex 40", manufacturer: "Allen-Bradley", model: "PowerFlex 40" });
    const res = await POST(req({ message: POST_TEXT, mode: "general" }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(rewriteMock.rewriteForManualSearch).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });
});
