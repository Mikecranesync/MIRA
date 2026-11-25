/**
 * #4095 gap 1 — a blank chat that names a library model but no maker, end to
 * end through the notebook chat route (AI-panel battery 2026-11-25).
 *
 * Lives under src/capabilities/__tests__/ rather than the route's own
 * __tests__/ dir: the Legacy UI Lifecycle Guard guards sibling test files in
 * that directory (see prompt-leak-guard-route.test.ts for the same reasoning).
 * The harness below is the one candidate-identity-acquisition.test.ts uses.
 *
 * Run: npx vitest run src/capabilities/__tests__/library-model-proposal-route.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";

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
  listTurns: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

// Unlike general-mode.test.ts's harness, this suite needs corpusManufacturers
// to be a REAL, controllable mock — RC1 is specifically the case where it
// returns an empty/unmatching list and proposeIdentityFromText finds nothing.
const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  corpusManufacturers: vi.fn(async () => [] as string[]),
  corpusModelLabels: vi.fn(async () => [] as { manufacturer: string; model: string; rows: number }[]),
  manufacturerFromObservationText: vi.fn(() => null as string | null),
  resolveModelFromObservationText: vi.fn((_text: string) => ({ model: null as string | null, ambiguous: false })),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
// pool.connect() backs the identityProposal block's corpusManufacturers(client)
// call — corpusManufacturers itself is mocked above, so the client shape does
// not matter, only that connect()/release() exist.
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  },
}));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn((provider: { model: string }, messages: unknown) => ({ model: provider.model, messages, stream: true })),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

// The S6 capability layer: a controllable spy so this suite proves WIRING
// (is it called, with what, when) without re-proving the fencing SQL
// (notebook-manual-acquisition.test.ts, migration-104 integration test).
const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => true),
  startManualAcquisition: vi.fn(async (_input: Pick<Parameters<typeof import("@/capabilities/notebook-manual-acquisition").startManualAcquisition>[0], "identity">) => true),
  readAcquisition: vi.fn(async () => null as unknown),
  reconcileAcquisition: vi.fn(async (_t: string, _n: string, rec: unknown) => rec),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>();
  return {
    ...actual,
    acquisitionEnabled: acqMock.acquisitionEnabled,
    startManualAcquisition: acqMock.startManualAcquisition,
    readAcquisition: acqMock.readAcquisition,
    reconcileAcquisition: acqMock.reconcileAcquisition,
    // acquisitionKey / acquisitionDeclineText stay REAL — they are pure and
    // already unit-proven; this suite checks the route calls them correctly.
  };
});

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
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine", nodeId: NODE, manufacturer: null, model: null });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  ragMock.corpusManufacturers.mockResolvedValue([]); // RC1: the corpus does not know this maker
  ragMock.corpusModelLabels.mockResolvedValue([]);
  acqMock.acquisitionEnabled.mockReturnValue(true);
  acqMock.startManualAcquisition.mockResolvedValue(true);
  acqMock.readAcquisition.mockResolvedValue(null);
  acqMock.reconcileAcquisition.mockImplementation(async (_t: string, _n: string, rec: unknown) => rec);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream("That's a pneumatic manifold valve."), { status: 200 })),
  );
});


describe("#4095 gap 1 — a library model typed with no maker (AI-panel battery 2026-11-25)", () => {
  const PF525 = [{ manufacturer: "Rockwell Automation", model: "PowerFlex 525", rows: 7547 }];

  it("proposes the library's maker for 'PowerFlex 525' and starts no search for a fault question", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["Rockwell Automation"]);
    ragMock.corpusModelLabels.mockResolvedValue(PF525);
    const f = await frames(await POST(req({ message: "What does PowerFlex 525 fault F004 mean?", mode: "general" }), params));
    expect(f.find((x) => x.kind === "identity_proposal")).toMatchObject({ manufacturer: "Rockwell Automation", model: "PowerFlex 525" });
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
  });

  it("control: a typed maker keeps the corpus reader's proposal, in the technician's spelling", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["Rockwell Automation"]);
    ragMock.corpusModelLabels.mockResolvedValue([...PF525, { manufacturer: "Rockwell Automation", model: "SLC 5/03", rows: 900 }]);
    const f = await frames(await POST(req({ message: "Find the manual for my Allen-Bradley SLC 5/03", mode: "general" }), params));
    expect(f.find((x) => x.kind === "identity_proposal")).toMatchObject({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });

  it("a manual request keeps its pre-existing path: no library-inferred maker keys a search (PR #5957 review F3)", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["AutomationDirect"]);
    ragMock.corpusModelLabels.mockResolvedValue([{ manufacturer: "AutomationDirect", model: "GS10", rows: 2449 }]);
    const f = await frames(await POST(req({ message: "Find the manual for my GS10", mode: "general" }), params));
    expect(f).not.toContainEqual(expect.objectContaining({ kind: "identity_proposal", manufacturer: "AutomationDirect" }));
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ manufacturer: "AutomationDirect" }), expect.anything(),
    );
    expect(ragMock.corpusModelLabels).not.toHaveBeenCalled();
  });

  it("control: a model the library does not hold proposes nothing", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["Rockwell Automation"]);
    ragMock.corpusModelLabels.mockResolvedValue([]);
    const f = await frames(await POST(req({ message: "What does PowerFlex 525 fault F004 mean?", mode: "general" }), params));
    expect(f.find((x) => x.kind === "identity_proposal")).toBeUndefined();
  });
});
