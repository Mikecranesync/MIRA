/**
 * #5369 — when retrieval refuses every selected manual because none is shown to
 * cover the asked model number, the served reply says so: it names the asked
 * number (and, when the covers declare one, what they are for), calls no
 * provider and cites nothing. Without that proof the generic refusal is unchanged.
 *
 * Route-level: the real chat route, retrieval mocked at its seam (the same
 * harness as named-model-mismatch-reply.test.ts). The retrieval side — when the
 * diagnostic is published — is the synthetic-technician bench.
 *
 * Run: npx vitest run src/capabilities/__tests__/unlisted-model-refusal-reply.test.ts
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

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

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

// Invented model numbers ("Northfield RX4xx"); no real product.
const ASK = "What supply voltage does the RX420 accept?";
const GENERIC =
  "I couldn't find support for that in this notebook's manuals. Add the manual for the equipment you're asking about, or the page that covers it, and ask again.";

type Opts = { diagnostics?: Record<string, unknown> };
const retrievalReports = (diagnostic: Record<string, unknown>) =>
  ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
    const o = opts as Opts;
    if (o?.diagnostics) Object.assign(o.diagnostics, diagnostic);
    return [];
  });

async function ask(message = ASK) {
  const out = await frames(await POST(req({ message, sourceDocIds: [DOC_A] }), params));
  const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
  const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] };
  return { status, sources };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({
    id: NB,
    displayName: "Line 2 logic controller",
    manufacturer: "Northfield",
    model: "RX410",
    identityStatus: "user_confirmed",
  });
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  // If the route ever called a provider here, this is the wrong-manual value it would serve.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "The supply is 24 V DC." } }] })}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    ),
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#5369 — a model number no attached manual is shown to cover", () => {
  it("names the asked number and what the cover declares, with no provider call and no citation", async () => {
    retrievalReports({ unlistedModelRefusal: { kind: "other-model", asked: ["RX420"], declared: ["RX410"], source: "question" } });
    const { status, sources } = await ask();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("for the RX410, not the RX420 you asked about");
    expect(status.message).not.toMatch(/24 V/);
    expect(sources.citations).toEqual([]);
  });

  it("says coverage could not be confirmed when the cover only mentions the number", async () => {
    retrievalReports({ unlistedModelRefusal: { kind: "coverage-not-shown", asked: ["RX420"], declared: [], source: "question" } });
    const { status, sources } = await ask();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("I can't confirm that the manual in this notebook covers the RX420 you asked about");
    expect(sources.citations).toEqual([]);
  });

  it("names the notebook's machine when the number came from the notebook, not the question", async () => {
    retrievalReports({ unlistedModelRefusal: { kind: "other-model", asked: ["CA3KN22BD"], declared: ["CA3KN31BD"], source: "notebook" } });
    const { status } = await ask("What is the coil voltage?");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(status.message).toContain("for the CA3KN31BD, not the CA3KN22BD this notebook is set up for");
  });

  it("hands retrieval the notebook's catalog number beside its model", async () => {
    nbMock.getNotebook.mockResolvedValue({
      id: NB, displayName: "CV-101 controller", manufacturer: "Allen-Bradley", model: "Micro820", catalogNumber: "2080-LC20-20QBB", identityStatus: "user_confirmed",
    });
    ragMock.retrieveNodeChunks.mockImplementation(async () => []);
    await ask("What supply voltage does it need?");
    const scoped = ragMock.retrieveNodeChunks.mock.calls.map((c) => c[3] as { identityStatus?: unknown; catalogNumber?: unknown }).filter((o) => o.identityStatus !== undefined);
    expect(scoped.length).toBeGreaterThan(0);
    for (const o of scoped) expect(o).toMatchObject({ identity: { model: "Micro820" }, catalogNumber: "2080-LC20-20QBB", identityStatus: "user_confirmed" });
  });

  it("control: without that proof the generic refusal is unchanged", async () => {
    ragMock.retrieveNodeChunks.mockImplementation(async () => []);
    const { status } = await ask();
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toBe(GENERIC);
  });
});

describe("garage pilot L3/L4 — every passage found was another model's table", () => {
  const gs10 = () =>
    nbMock.getNotebook.mockResolvedValue({
      id: NB, displayName: "Bench drive", manufacturer: "AutomationDirect", model: "GS10", catalogNumber: "GS11N-20P2", identityStatus: "user_confirmed",
    });

  it("names the record's number and the page, with no provider call and no citation", async () => {
    gs10();
    retrievalReports({ excludedTables: [{ page: 27, models: ["GS13N20P2"] }] });
    const { status, sources } = await ask("What is its rated input current?");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("This manual's table for the GS11N-20P2 was not found");
    expect(status.message).toContain("GS13N20P2 table (page 27)");
    expect(status.message).not.toMatch(/24 V/);
    expect(sources.citations).toEqual([]);
  });

  it("control: with nothing excluded the generic refusal is unchanged", async () => {
    gs10();
    retrievalReports({ excludedTables: [] });
    const { status } = await ask("What is its rated input current?");
    expect(status.message).toBe(GENERIC);
  });

  // Cheap review of PR-2 (#5424 r1): the refusal must not fire on a MIXED result. The
  // refusal chain lives inside Gate G (`chunks.length === 0`), so one admissible passage
  // beside an excluded sibling table is answered from that passage, never refused.
  it("control: one admissible passage beside an excluded sibling table is answered, not refused", async () => {
    gs10();
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) Object.assign(o.diagnostics, { excludedTables: [{ page: 27, models: ["GS13N20P2"] }] });
      return [
        {
          content: "GS11N-20P2: CT Rated Input Current 5.1 A",
          docId: DOC_A,
          manufacturer: "",
          modelNumber: "",
          sourceUrl: "node-doc/u1/gs10_manual.pdf",
          sourcePage: 26,
          pageLabel: "26",
          chunkIndex: null,
          title: "GS10 User Manual.pdf",
          rank: 0.5,
          verified: true,
        },
      ];
    });
    const { status } = await ask("What is its rated input current?");
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    expect(status?.status ?? "answered").not.toBe("insufficient_evidence");
    expect(status?.message ?? "").not.toContain("was not found");
  });
});
