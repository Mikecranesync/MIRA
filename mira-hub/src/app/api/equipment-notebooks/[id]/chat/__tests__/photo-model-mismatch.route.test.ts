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

type Opts = { photoText?: string; subjectQueries?: string[]; subjectUnclear?: boolean[]; diagnostics?: Record<string, unknown> };
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
  // clearAllMocks keeps a mockResolvedValue: each test states its own turns.
  nbMock.listTurns.mockResolvedValue([]);
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

  // Codex r2 (F2 + parity): a photo that does not say which machine is meant
  // gets one focused question — no provider call, no citation, no answer.
  it("serves the which-machine question for an unclear photo", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, "A GS10 drive beside a Micro820 module."));
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.photoSubjectUnclear = { shown: ["GS10", "Micro820"], earlier: [] };
      return [];
    });
    const out = await frames(await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("Your photo shows GS10 / Micro820");
    expect(status.message).toContain("Which one is this question about?");
    expect(status.message).not.toContain("I saw your photo");
    expect(out.some((f) => f.kind === "citation" || f.kind === "citations")).toBe(false);
  });

  it("serves the photo's unlisted-number refusal ahead of the generic photo text", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, "Micro820 plate, catalog 2080-LC20-20QWB"));
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.unlistedModelRefusal = { kind: "other-model", asked: ["2080-LC20-20QWB"], declared: ["2080-LC20-20AWB"], source: "photo" };
      return [];
    });
    const out = await frames(await POST(req({ message: "What is the input voltage?", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.message).toContain("not the 2080-LC20-20QWB in your photo");
  });

  it("passes which carried questions came from an unclear photo", async () => {
    nbMock.listTurns.mockResolvedValue([
      { id: "t0", threadId: THREAD, question: "What about the GS11N-20P5?", answerStatus: "insufficient_evidence", basis: null, evidence: [] },
      {
        id: "t1",
        threadId: THREAD,
        question: "Find me the manual",
        answerStatus: "insufficient_evidence",
        basis: null,
        evidence: [{ kind: "visual_observation", fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z", provenance: "phone_photo" }],
      },
    ]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) =>
      (args[3] as { threadId?: string } | undefined)?.threadId === THREAD ? lookRow(PRIOR_PHOTO, "Two drives labeled GS20-23P0 and GS20-21P0.") : null,
    );
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectUnclear).toEqual([true, false]);
  });

  it("serves the which-machine question for a carried unclear photo", async () => {
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.photoSubjectUnclear = { shown: ["GS20-23P0", "GS20-21P0"], earlier: [], carried: true };
      return [];
    });
    const out = await frames(await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.message).toContain("Earlier in this conversation your photo showed GS20-23P0 / GS20-21P0");
  });

  it("the safety stop's searches are held to the photo's machine too", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, GS20_READING));
    await (await POST(req({ message: "How do I pull the RFI jumper with it powered?", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params)).text();
    // The answer pass plus the stop's lockout and warning passes.
    expect(passOpts().length).toBeGreaterThan(1);
    expect(passOpts().every((o) => o.photoText === GS20_READING)).toBe(true);
  });

  // The which-machine ask never withholds the safety stop: an energized-work
  // ask with an unclear photo still stops before any provider call, whether
  // the photo is this turn's or carried from an earlier one.
  it("an unclear photo still gets the safety stop, live and carried", async () => {
    const unclear = async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.photoSubjectUnclear = { shown: ["GS10", "Micro820"], earlier: [] };
      return [];
    };
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, "A GS10 drive beside a Micro820 module."));
    ragMock.retrieveNodeChunks.mockImplementation(unclear);
    const live = await frames(await POST(req({ message: "How do I pull the RFI jumper with it powered?", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params));
    expect(live.some((f) => f.kind === "safety")).toBe(true);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.photoSubjectUnclear = { shown: ["GS20-23P0", "GS20-21P0"], earlier: [], carried: true };
      return [];
    });
    const carried = await frames(await POST(req({ message: "How do I pull the RFI jumper with it powered?", sourceDocIds: [DOC_A], threadId: THREAD }), params));
    expect(carried.some((f) => f.kind === "safety")).toBe(true);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
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

  // Codex r2 F3: another conversation's reading never decides this turn — not
  // even one stored under the notebook's legacy thread for the same owner.
  it("a legacy-thread reading of the same file never decides a new thread's photo", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => {
      const scope = args[3] as { threadId: string | null; allowLegacy?: boolean } | undefined;
      if (!scope) return lookRow(PHOTO, GS20_READING);
      return scope.threadId === null || scope.allowLegacy ? lookRow(PHOTO, GS20_READING) : null;
    });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD, visualEvidence: { fileId: PHOTO } }), params)).text();
    expect(passOpts().length).toBeGreaterThan(0);
    expect(passOpts().every((o) => o.photoText === undefined)).toBe(true);
  });

  it("control: a legacy conversation's own photo is read under its own (legacy) thread", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => {
      const scope = args[3] as { threadId: string | null; allowLegacy?: boolean } | undefined;
      return !scope || (scope.threadId === null && !scope.allowLegacy) ? lookRow(PHOTO, GS20_READING) : null;
    });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params)).text();
    expect(passOpts()[0].photoText).toBe(GS20_READING);
  });

  // Codex r1 F5: the follow-up to a photo refusal is still about the photo's
  // machine. The open question's photo is read exactly as the live turn reads
  // its own (still linked, exact thread) and joined by the same rule.
  const openPhotoTurn = (question = "Find me the manual") => ({
    id: "t1",
    threadId: THREAD,
    question,
    answerStatus: "insufficient_evidence",
    basis: null,
    evidence: [{ kind: "visual_observation", fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z", provenance: "phone_photo" }],
  });
  const exactThreadReading = async (...args: unknown[]) => {
    const scope = args[3] as { threadId?: string | null; allowLegacy?: boolean } | undefined;
    return args[2] === PRIOR_PHOTO && scope?.threadId === THREAD && !scope.allowLegacy ? lookRow(PRIOR_PHOTO, GS20_READING) : null;
  };

  it("a follow-up carries the open question's photo machine into retrieval", async () => {
    nbMock.listTurns.mockResolvedValue([openPhotoTurn()]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(exactThreadReading);
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    const first = passOpts()[0];
    expect(first.photoText).toBeUndefined();
    expect(first.subjectQueries?.[0]).toContain("Find me the manual");
    expect(first.subjectQueries?.[0]).toContain("GS20-23P0");
    expect(first.subjectQueries?.[0]).not.toContain("GS20-US");
  });

  it("a photo since detached from the notebook is never read for the follow-up (Codex r2 F7)", async () => {
    nbMock.listTurns.mockResolvedValue([openPhotoTurn()]);
    filesMock.photoLinkedToTarget.mockResolvedValue(null);
    veMock.loadVisualEvidenceForPhoto.mockImplementation(exactThreadReading);
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries?.[0]).not.toContain("GS20");
    expect((veMock.loadVisualEvidenceForPhoto.mock.calls as unknown[][]).some((c) => c[2] === PRIOR_PHOTO)).toBe(false);
  });

  it("an open question's photo read only under the legacy thread is not carried (Codex r2 F3)", async () => {
    nbMock.listTurns.mockResolvedValue([openPhotoTurn()]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => {
      const scope = args[3] as { threadId?: string | null; allowLegacy?: boolean } | undefined;
      return scope?.threadId === null || scope?.allowLegacy ? lookRow(PRIOR_PHOTO, GS20_READING) : null;
    });
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries?.[0]).not.toContain("GS20");
  });

  it("an explicit return to the project's unit keeps its photo out of the follow-up (Codex r2 F5)", async () => {
    nbMock.getNotebook.mockResolvedValue({
      id: NB,
      displayName: "QA BRAVO 7401002fc walk Nov 21",
      manufacturer: "AutomationDirect",
      model: "GS11N-20P2",
      catalogNumber: "GS11N-20P2",
      identityStatus: "user_confirmed",
    });
    nbMock.listTurns.mockResolvedValue([openPhotoTurn("Back to mine. What was its original firmware build?")]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(exactThreadReading);
    await (await POST(req({ message: "What is its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries?.[0]).toContain("Back to mine");
    expect(passOpts()[0].subjectQueries?.[0]).not.toContain("GS20");
  });

  it("control: without a catalog number on record 'back to mine' is no return, so its photo joins", async () => {
    nbMock.listTurns.mockResolvedValue([openPhotoTurn("Back to mine. What was its original firmware build?")]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(exactThreadReading);
    await (await POST(req({ message: "What is its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
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
    // Still linked, so only the closed run keeps it out (not the F7 link check).
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async () => lookRow(PRIOR_PHOTO, GS20_READING));
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries ?? []).toEqual([]);
    // Its photo is not even read (#3966): a closed turn's photo is never recalled.
    expect((veMock.loadVisualEvidenceForPhoto.mock.calls as unknown[][]).some((c) => c[2] === PRIOR_PHOTO)).toBe(false);
  });

  // #5706 review of 185f15c, findings 4 + 5: an open photo whose reading
  // cannot be read back is marked unread, so the follow-up asks (never answers).
  it("a failed link check on an open photo marks it unread (finding 4)", async () => {
    nbMock.listTurns.mockResolvedValue([openPhotoTurn()]);
    filesMock.photoLinkedToTarget.mockRejectedValue(new Error("pool exhausted"));
    veMock.loadVisualEvidenceForPhoto.mockImplementation(exactThreadReading);
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectUnclear).toEqual([true]);
  });

  it("a failed reading of an open photo marks it unread (finding 4)", async () => {
    nbMock.listTurns.mockResolvedValue([openPhotoTurn()]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockRejectedValue(new Error("connection reset"));
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectUnclear).toEqual([true]);
  });

  it("control: a cleanly detached open photo is not read and not flagged (F7)", async () => {
    nbMock.listTurns.mockResolvedValue([openPhotoTurn()]);
    filesMock.photoLinkedToTarget.mockResolvedValue(null);
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectUnclear).toBeUndefined();
  });

  it("an open photo past the read limit is marked unread, not silently dropped (finding 5)", async () => {
    const turns = [1, 2, 3, 4].map((n) => ({
      ...openPhotoTurn(`Photo ${n}`),
      id: `t${n}`,
      evidence: [{ kind: "visual_observation", fileId: `9999999${n}-9999-4999-8999-999999999999`, capturedAt: "2026-11-21T20:57:06.047Z", provenance: "phone_photo" }],
    }));
    nbMock.listTurns.mockResolvedValue(turns); // oldest first
    filesMock.photoLinkedToTarget.mockImplementation((async (_t: string, fileId: string) => ({ fileId, capturedAt: "2026-11-21T20:57:06.047Z" })) as never);
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => lookRow(args[2] as string, "A drive label too blurred to read."));
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    // Newest first: the three newest are read (nothing named), the oldest is unread.
    expect(passOpts()[0].subjectUnclear).toEqual([false, false, false, true]);
    expect((veMock.loadVisualEvidenceForPhoto.mock.calls as unknown[][]).some((c) => c[2] === turns[0].evidence[0].fileId)).toBe(false);
  });

  // #5706 review of 185f15c, finding 2: a photo LOOKed at in this conversation
  // but not sent with a question is part of the open run too.
  const look = (observedAt: string) => ({ ...lookRow(PRIOR_PHOTO, GS20_READING), observedAt });
  it("a text follow-up after a LOOK carries the LOOK's machine (finding 2)", async () => {
    veMock.loadRecentLookObservations.mockResolvedValue([look("2026-11-21T20:57:09Z")]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    const first = passOpts()[0];
    expect(first.photoText).toBeUndefined();
    expect(first.subjectQueries?.[0]).toContain("GS20-23P0");
    expect(first.subjectQueries?.[0]).not.toContain("GS20-US");
    // This conversation's LOOKs only, by exact scope.
    expect(veMock.loadRecentLookObservations).toHaveBeenCalledWith(expect.anything(), TENANT, { notebookId: NB, ownerUserId: "u1", threadId: THREAD });
  });

  it("the LOOK sits at its place in time: newer than an open question, it is the newest subject", async () => {
    nbMock.listTurns.mockResolvedValue([{ ...openPhotoTurn("What about the GS11N-20P5?"), evidence: [], createdAt: "2026-11-21T20:50:00Z" }]);
    veMock.loadRecentLookObservations.mockResolvedValue([look("2026-11-21T20:57:09Z")]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries?.[0]).toContain("GS20-23P0");
    expect(passOpts()[0].subjectQueries?.[1]).toContain("GS11N-20P5");
  });

  it("a LOOK whose time cannot be read is placed newest (it is judged, never hidden)", async () => {
    nbMock.listTurns.mockResolvedValue([{ ...openPhotoTurn("What about the GS11N-20P5?"), evidence: [], createdAt: "2026-11-21T20:50:00Z" }]);
    veMock.loadRecentLookObservations.mockResolvedValue([{ ...lookRow(PRIOR_PHOTO, GS20_READING), observedAt: null }]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries?.[0]).toContain("GS20-23P0");
    // Only this conversation's LOOKs: the exact notebook, owner and thread.
    // Every ledger read (the recall above and the subject carry) uses that scope.
    expect(veMock.loadRecentLookObservations.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of veMock.loadRecentLookObservations.mock.calls) {
      expect((call as unknown[])[2]).toMatchObject({ notebookId: expect.any(String), ownerUserId: expect.any(String), threadId: THREAD });
    }
  });

  it("the carried LOOK does not use up the read window: one turn short of each limit plus a LOOK is still a complete read", async () => {
    // Every read returns one turn fewer than asked: complete only if the LOOK is not counted against the limit.
    nbMock.listTurns.mockImplementation((async (_t: string, _n: string, limit: number) =>
      Array.from({ length: limit - 1 }, (_, n) => ({ ...openPhotoTurn(`Question ${n}`), id: `q${n}`, evidence: [], createdAt: "2026-11-21T20:40:00Z" }))) as never);
    veMock.loadRecentLookObservations.mockResolvedValue([look("2026-11-21T20:57:09Z")]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    const first = passOpts()[0] as Opts & { subjectOutOfReach?: boolean };
    expect(first.subjectQueries?.[0]).toContain("GS20-23P0");
    expect(first.subjectOutOfReach).toBe(false);
  });

  it("control: a LOOK older than the run's closing document answer is not carried", async () => {
    nbMock.listTurns.mockResolvedValue([
      { id: "t2", threadId: THREAD, question: "What is the input voltage?", answerStatus: "answered", basis: "workspace_evidence", evidence: [], createdAt: "2026-11-21T21:00:00Z" },
    ]);
    veMock.loadRecentLookObservations.mockResolvedValue([look("2026-11-21T20:57:09Z")]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries ?? []).toEqual([]);
  });

  it("control: a LOOK newer than the closing answer is carried; an unreadable closing time hides nothing", async () => {
    nbMock.listTurns.mockResolvedValue([
      { id: "t2", threadId: THREAD, question: "What is the input voltage?", answerStatus: "answered", basis: "workspace_evidence", evidence: [], createdAt: "2026-11-21T20:50:00Z" },
    ]);
    veMock.loadRecentLookObservations.mockResolvedValue([look("2026-11-21T20:57:09Z")]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries?.[0]).toContain("GS20-23P0");
    vi.clearAllMocks();
    nbMock.listTurns.mockResolvedValue([
      { id: "t2", threadId: THREAD, question: "What is the input voltage?", answerStatus: "answered", basis: "workspace_evidence", evidence: [], createdAt: "not a time" },
    ]);
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries?.[0]).toContain("GS20-23P0");
  });

  it("control: a LOOK whose photo is no longer linked is not carried", async () => {
    veMock.loadRecentLookObservations.mockResolvedValue([look("2026-11-21T20:57:09Z")]);
    filesMock.photoLinkedToTarget.mockResolvedValue(null);
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries ?? []).toEqual([]);
  });

  it("control: a turn sending its own photo does not carry a LOOK (that photo owns the turn)", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(lookRow(PHOTO, "A drive label too blurred to read."));
    veMock.loadRecentLookObservations.mockResolvedValue([look("2026-11-21T20:57:09Z")]);
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO }, threadId: THREAD }), params)).text();
    expect(passOpts()[0].subjectQueries ?? []).toEqual([]);
  });

  // Advisor check 3: the LOOK ledger also holds the photos SENT with questions.
  // A LOOK of a turn's own photo is that turn's — never a second, unjoined turn.
  it("a LOOK of an open turn's own photo is not carried twice (the turn's join rule speaks for it)", async () => {
    nbMock.listTurns.mockResolvedValue([{ ...openPhotoTurn("Find me the manual for AutomationDirect GS11N-20P2"), createdAt: "2026-11-21T20:50:00Z" }]);
    // Corrected AFTER its turn, so it is newer than the turn.
    veMock.loadRecentLookObservations.mockResolvedValue([look("2026-11-21T20:58:00Z")]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(exactThreadReading);
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    // The typed model outranks that turn's photo; no unjoined GS20 turn appears.
    expect(passOpts()[0].subjectQueries).toEqual(["Find me the manual for AutomationDirect GS11N-20P2"]);
  });

  it("a LOOK of a closed turn's own photo stays closed, whichever is newer", async () => {
    for (const observedAt of ["2026-11-21T20:40:00Z", "2026-11-21T21:10:00Z"]) {
      vi.clearAllMocks();
      nbMock.listTurns.mockResolvedValue([
        { ...openPhotoTurn(), answerStatus: "answered", basis: "workspace_evidence", createdAt: "2026-11-21T20:50:00Z" },
      ]);
      veMock.loadRecentLookObservations.mockResolvedValue([look(observedAt)]);
      filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
      await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
      expect(passOpts()[0].subjectQueries ?? []).toEqual([]);
    }
  });

  it("passes the open questions' private-field codes for the check", async () => {
    nbMock.listTurns.mockResolvedValue([openPhotoTurn()]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    veMock.loadVisualEvidenceForPhoto.mockImplementation(async () => lookRow(PRIOR_PHOTO, "Allen-Bradley Micro820. Unit: 2080-LC20-20QWB"));
    await (await POST(req({ message: "What's its rated current?", sourceDocIds: [DOC_A], threadId: THREAD }), params)).text();
    const first = passOpts()[0] as Opts & { subjectHidden?: string[][] };
    expect(first.subjectHidden).toEqual([["2080-LC20-20QWB"]]);
    expect(first.subjectQueries?.[0]).not.toContain("QWB");
  });

  it("control: a question with no photo passes no photo reading", async () => {
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A] }), params)).text();
    expect(passOpts().length).toBeGreaterThan(0);
    expect(passOpts().every((o) => o.photoText === undefined)).toBe(true);
  });

  it("an earlier photo's reading is never passed as this turn's photo (#3966); an open LOOK carries as a subject", async () => {
    veMock.loadRecentLookObservations.mockResolvedValue([lookRow(PRIOR_PHOTO, GS20_READING)]);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PRIOR_PHOTO, capturedAt: "2026-11-21T20:57:06.047Z" });
    await (await POST(req({ message: "Find me the manual", sourceDocIds: [DOC_A] }), params)).text();
    expect(passOpts().length).toBeGreaterThan(0);
    expect(passOpts().every((o) => o.photoText === undefined)).toBe(true);
    // Never this turn's photo — but an open subject of the conversation (finding 2).
    expect(passOpts()[0].subjectQueries?.[0]).toContain("GS20-23P0");
  });
});
