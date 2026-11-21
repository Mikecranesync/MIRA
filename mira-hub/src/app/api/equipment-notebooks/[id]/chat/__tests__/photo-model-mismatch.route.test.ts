/**
 * Photo-to-manual (#5706, staging tablet walk 2026-11-21, revision 7401002fc):
 * in a project confirmed as AutomationDirect GS11N-20P2 with the GS10 manual
 * enabled, a GS20-23P0 nameplate photo plus "Find me the manual" was answered
 * from the GS10 manual. The photo had been read; retrieval was never given it.
 *
 * The route hands retrieval the reading of the photo sent WITH this question
 * (never an earlier photo's, #3966), and serves the photo refusal with no
 * provider call and no citation. Retrieval's decision itself is proven over
 * real SQL in src/lib/__tests__/manual-rag-photo-model.integration.test.ts.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/photo-model-mismatch.route.test.ts"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const PHOTO = "44444444-4444-4444-8444-444444444444";
const PRIOR_PHOTO = "55555555-5555-4555-8555-555555555555";

// Verbatim staging reading of the walk's photo (turn b6429301).
const GS20_READING =
  'A light blue/gray printed cover or sheet fills the frame, bordered by a thin double-line rectangular frame. Near the upper left is the blue text "AutomationDirect". Below it, in black text, are lines reading "GS20-23P0", "AC Variable Frequency Drive", "Input 3Ph 230VAC 3HP 11.2A", "Output 3Ph 0-230V 60Hz 9.6A", and "S/N: GS20-US-0031482". No connectors, wiring, indicators, damage, debris, or moisture are visible.';

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  listTurns: vi.fn(async () => [] as unknown[]),
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

const lookRow = (fileId: string, text: string) => ({
  observationId: `o-${fileId}`,
  sessionId: "s1",
  text,
  obsKind: "property",
  trust: "candidate" as const,
  confidence: null,
  fileId,
  photoHash: "h",
  observedAt: "2026-11-21T20:57:09Z",
  hazards: [] as { code: "arcing" | "exposed_conductor" | "active_fire" | "smoke"; confidence: number }[],
});
const veMock = vi.hoisted(() => ({
  blockingLookHazard: vi.fn(() => null),
  loadVisualEvidenceForAsset: vi.fn(async () => [] as unknown[]),
  loadRecentLookObservations: vi.fn(async () => [] as unknown[]),
  renderVisualEvidenceSection: vi.fn(() => ""),
  loadVisualEvidenceForPhoto: vi.fn(async (): Promise<unknown> => null),
  renderLookObservationSection: vi.fn(() => ""),
  renderPriorLookObservationsSection: vi.fn(() => ""),
}));
vi.mock("@/lib/visual-evidence-context", () => veMock);

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

type Opts = { photoText?: string; diagnostics?: Record<string, unknown> };
const passOpts = () => ragMock.retrieveNodeChunks.mock.calls.map((c) => c[3] as Opts);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({
    id: NB,
    displayName: "QA BRAVO 7401002fc walk Nov 21",
    manufacturer: "AutomationDirect",
    model: "GS11N-20P2",
    identityStatus: "user_confirmed",
  });
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  veMock.loadVisualEvidenceForPhoto.mockResolvedValue(null);
  veMock.loadRecentLookObservations.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "The GS10 manual covers it." } }] })}\n\ndata: [DONE]\n\n`, {
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

describe("#5706 — a nameplate photo of another drive is not answered from the project's manual", () => {
  it("hands retrieval the reading of the photo sent with this question", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, GS20_READING));
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params)).text();
    expect(passOpts().length).toBeGreaterThan(0);
    expect(passOpts()[0].photoText).toBe(GS20_READING);
  });

  it("serves the photo refusal: names both models, asks one question, no provider call, no citation", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, GS20_READING));
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.namedModelMismatch = { requested: ["GS20", "GS20-23P0"], declared: ["GS10"], source: "photo" };
      return [];
    });
    const out = await frames(await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("Your photo shows a GS20 / GS20-23P0, but the manual in this notebook is for the GS10");
    expect(status.message).toContain("Is this a different machine from the one this project is for?");
    expect(status.message).not.toContain("GS20-US");
    expect(out.some((f) => f.kind === "citation" || f.kind === "citations")).toBe(false);
  });

  it("serves the look-alike photo refusal in the photo's words", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, 'The label shows "MODEL: GS11N-20P5".'));
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.siblingOfRecordAsk = { asked: ["GS11N-20P5"], record: "GS11N-20P2", source: "photo" };
      return [];
    });
    const out = await frames(await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.message).toContain("This project is set up for the GS11N-20P2. Your photo shows the GS11N-20P5, which is a different unit");
  });

  it("the safety stop's searches are held to the photo's machine too", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, GS20_READING));
    await (await POST(req({ message: "How do I pull the RFI jumper with it powered?", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params)).text();
    // The answer pass plus the stop's lockout and warning passes.
    expect(passOpts().length).toBeGreaterThan(1);
    expect(passOpts().every((o) => o.photoText === GS20_READING)).toBe(true);
  });

  it("control: a question with no photo passes no photo reading", async () => {
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A] }), params)).text();
    expect(passOpts().length).toBeGreaterThan(0);
    expect(passOpts().every((o) => o.photoText === undefined)).toBe(true);
  });

  it("an earlier photo's reading is never passed (#3966: it may show another machine)", async () => {
    veMock.loadRecentLookObservations.mockResolvedValue([lookRow(PRIOR_PHOTO, GS20_READING)]);
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A] }), params)).text();
    expect(passOpts().length).toBeGreaterThan(0);
    expect(passOpts().every((o) => o.photoText === undefined)).toBe(true);
  });
});
