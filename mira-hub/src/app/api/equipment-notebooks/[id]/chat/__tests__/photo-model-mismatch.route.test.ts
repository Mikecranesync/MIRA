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
const THREAD = "66666666-6666-4666-8666-666666666666";

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
  normalizeNotebookThreadId: (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null),
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

type Opts = { photoText?: string; subjectQueries?: string[]; diagnostics?: Record<string, unknown> };
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

  // Codex r1 on #5764 F3: another conversation's newer reading of the same
  // linked file never decides which manual this conversation is held to; the
  // hazard stop still reads the photo file-wide.
  it("holds retrieval to THIS conversation's reading; the hazard check stays file-wide", async () => {
    const OTHER = 'The label reads "MODEL: GS11N-20P2".';
    const fileWide = { ...lookRow(PHOTO, OTHER), hazards: [{ code: "smoke" as const, confidence: 0.5 }] };
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => {
      const scope = args[3] as { notebookId: string; ownerUserId: string; threadId: string | null } | undefined;
      if (!scope) return fileWide;
      return scope.notebookId === NB && scope.ownerUserId === "u1" && scope.threadId === THREAD ? lookRow(PHOTO, GS20_READING) : null;
    });
    await (
      await POST(req({ message: "How do I pull the RFI jumper with it powered?", sourceDocIds: [DOC_A], threadId: THREAD, visualEvidence: { fileId: PHOTO } }), params)
    ).text();
    expect(passOpts().length).toBeGreaterThan(1);
    expect(passOpts().every((o) => o.photoText === GS20_READING)).toBe(true);
    expect(veMock.blockingLookHazard).toHaveBeenCalledWith(fileWide.hazards);
  });

  it("a photo this conversation never read passes no reading (never another conversation's)", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => (args[3] ? null : lookRow(PHOTO, GS20_READING)));
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD, visualEvidence: { fileId: PHOTO } }), params)).text();
    expect(passOpts().length).toBeGreaterThan(0);
    expect(passOpts().every((o) => o.photoText === undefined)).toBe(true);
  });

  it("a reading stored under this notebook's legacy thread (app before #3968) is this technician's own", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => {
      const scope = args[3] as { threadId: string | null } | undefined;
      if (!scope) return lookRow(PHOTO, GS20_READING);
      return scope.threadId === null ? lookRow(PHOTO, GS20_READING) : null;
    });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD, visualEvidence: { fileId: PHOTO } }), params)).text();
    expect(passOpts()[0].photoText).toBe(GS20_READING);
  });

  // Codex r1 F5: the follow-up to a photo refusal is still about the photo's
  // machine. The open question's photo is read in this conversation and folded
  // into its subject (public text only — the serial never travels).
  it("a follow-up carries the open question's photo machine into retrieval", async () => {
    nbMock.listTurns.mockResolvedValue([
      {
        id: "t1",
        threadId: THREAD,
        question: "Find me the manual",
        answerStatus: "insufficient_evidence",
        basis: null,
        evidence: [{ kind: "visual_observation", fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z", provenance: "phone_photo" }],
      },
    ]);
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) =>
      args[2] === PRIOR_PHOTO && (args[3] as { threadId?: string | null } | undefined)?.threadId === THREAD ? lookRow(PRIOR_PHOTO, GS20_READING) : null,
    );
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    const first = passOpts()[0];
    expect(first.photoText).toBeUndefined();
    expect(first.subjectQueries?.[0]).toContain("Find me the manual");
    expect(first.subjectQueries?.[0]).toContain("GS20-23P0");
    expect(first.subjectQueries?.[0]).not.toContain("GS20-US");
  });

  it("an open question's photo read under the legacy thread is carried too", async () => {
    nbMock.listTurns.mockResolvedValue([
      {
        id: "t1",
        threadId: THREAD,
        question: "Find me the manual",
        answerStatus: "insufficient_evidence",
        basis: null,
        evidence: [{ kind: "visual_observation", fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z", provenance: "phone_photo" }],
      },
    ]);
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) =>
      (args[3] as { threadId?: string | null } | undefined)?.threadId === null ? lookRow(PRIOR_PHOTO, GS20_READING) : null,
    );
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries?.[0]).toContain("GS20-23P0");
  });

  it("control: a photo turn a document answer closed is never carried", async () => {
    nbMock.listTurns.mockResolvedValue([
      {
        id: "t1",
        threadId: THREAD,
        question: "Find me the manual",
        answerStatus: "insufficient_evidence",
        basis: null,
        evidence: [{ kind: "visual_observation", fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z", provenance: "phone_photo" }],
      },
      { id: "t2", threadId: THREAD, question: "What is the GS11N-20P2 input voltage?", answerStatus: "answered", basis: "workspace_evidence", evidence: [] },
    ]);
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async () => lookRow(PRIOR_PHOTO, GS20_READING));
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries ?? []).toEqual([]);
    // Its photo is not even read (#3966): a closed turn's photo is never recalled.
    expect((veMock.loadVisualEvidenceForPhoto.mock.calls as unknown[][]).some((c) => c[2] === PRIOR_PHOTO)).toBe(false);
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
