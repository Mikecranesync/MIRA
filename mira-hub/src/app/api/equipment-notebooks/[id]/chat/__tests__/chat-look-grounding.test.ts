/**
 * #3788 — the WIRING test (product, not pipe): when the attached photo VERIFIES,
 * the persisted LOOK observation must actually reach the model's user content —
 * and it must ride the injection-hardened user-data channel (buildManualUserContent),
 * keyed on the SERVER-VERIFIED file id, never the client string.
 *
 * The ledger round-trip is proven in visual-evidence-context.{test,integration}.
 * Here we prove the chat route CONNECTS that store to the prompt:
 *   - verified fileId ⇒ loadVisualEvidenceForPhoto is called with the SERVER
 *     fileId, and its rendered output is passed as buildManualUserContent's
 *     visual-context arg (the turn still completes);
 *   - unverified fileId ⇒ no lookup, no block (arg empty), turn still completes.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/[id]/chat/__tests__/chat-look-grounding
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const PHOTO = "44444444-4444-4444-8444-444444444444";
const CAPTURED_AT = "2026-09-19T11:09:23.000Z";
const LOOK_SENTINEL = "## LOOK-OBS-SENTINEL\ngreen indicator lit; no burn marks";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  listTurns: vi.fn(async () => [] as unknown[]),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string, _c: unknown[], v?: string) => (v ? `${v}\n\n${q}` : q)),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);

// The store is proven elsewhere; here we control its output to prove the wiring.
const veMock = vi.hoisted(() => ({
  blockingLookHazard: vi.fn((hazards: { code: string; confidence: number }[] | undefined) =>
    hazards?.filter((h) => h.confidence >= 0.85).sort((a, b) => b.confidence - a.confidence)[0] ?? null,
  ),
  loadVisualEvidenceForAsset: vi.fn(async () => [] as unknown[]),
  renderVisualEvidenceSection: vi.fn(() => ""),
  loadVisualEvidenceForPhoto: vi.fn(async () => ({
    observationId: "o1",
    sessionId: "s1",
    text: "green indicator lit; no burn marks",
    obsKind: "property",
    trust: "candidate" as const,
    confidence: null,
    fileId: PHOTO,
    photoHash: "h",
    observedAt: null,
    hazards: [] as { code: "arcing" | "exposed_conductor" | "active_fire" | "smoke"; confidence: number }[],
  })),
  renderLookObservationSection: vi.fn((row: unknown | null) => (row ? LOOK_SENTINEL : "")),
  renderPriorLookObservationsSection: vi.fn((rows: unknown[]) => (rows && rows.length ? "## PRIOR-LOOK-CTX" : "")),
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "CV-101", manufacturer: null, model: null });
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  // Provider exhausts (buildManualUserContent is already called before streaming);
  // the turn still returns 200. We only assert on the message-assembly wiring.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("#3788 — a verified photo's observation reaches the model's user content", () => {
  it("verified fileId: loadVisualEvidenceForPhoto is called with the SERVER fileId, and its render rides buildManualUserContent's visual-context arg", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });

    const res = await POST(
      req({
        message: "what am I looking at here",
        mode: "general",
        visualEvidence: { fileId: PHOTO, capturedAt: "client-supplied-and-ignored" },
      }),
      params,
    );
    expect(res.status).toBe(200);

    // Loaded by the SERVER-verified fileId (photoLinkedToTarget's return), never the client string.
    expect(veMock.loadVisualEvidenceForPhoto).toHaveBeenCalledWith(expect.anything(), TENANT, PHOTO);

    // The rendered observation is handed to buildManualUserContent as its 3rd (visual-context) arg.
    expect(ragMock.buildManualUserContent).toHaveBeenCalled();
    const call = vi.mocked(ragMock.buildManualUserContent).mock.calls.at(-1) as unknown as [string, unknown[], string?];
    expect(call[2]).toBe(LOOK_SENTINEL);
  });

  it("unverified fileId: no lookup, no observation block, and the turn still answers", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue(null);

    const res = await POST(
      req({ message: "what am I looking at here", mode: "general", visualEvidence: { fileId: PHOTO } }),
      params,
    );
    expect(res.status).toBe(200);

    // No verified photo → the LOOK loader is never reached (a client string can't summon an observation).
    expect(veMock.loadVisualEvidenceForPhoto).not.toHaveBeenCalled();
    const call = vi.mocked(ragMock.buildManualUserContent).mock.calls.at(-1) as unknown as [string, unknown[], string?];
    expect(call[2] ?? "").toBe("");
  });

  it("a server-stored high-confidence photo hazard stops before any answer provider", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({
      observationId: "o1",
      sessionId: "s1",
      text: "Visible arcing at an uncovered terminal.",
      obsKind: "property",
      trust: "candidate",
      confidence: null,
      fileId: PHOTO,
      photoHash: "h",
      observedAt: null,
      hazards: [{ code: "arcing", confidence: 0.99 }],
    });

    const res = await POST(
      req({
        message: "what am I looking at here",
        visualEvidence: { fileId: PHOTO },
      }),
      params,
    );

    expect(res.headers.get("X-Safety-Stop")).toBe("visual:arcing");
    expect(fetch).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).toHaveBeenCalledWith(
      TENANT,
      NB,
      expect.objectContaining({
        answerText: expect.stringContaining("SAFETY STOP"),
        evidence: expect.arrayContaining([
          expect.objectContaining({ kind: "safety_stop", trigger: "visual:arcing" }),
          expect.objectContaining({ kind: "visual_observation", fileId: PHOTO }),
        ]),
      }),
    );
  });

  it("preserves the zero-source refusal for an unverified photo claim", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue(null);

    const res = await POST(
      req({ message: "what am I looking at here", visualEvidence: { fileId: PHOTO } }),
      params,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_sources_selected" });
    expect(veMock.loadVisualEvidenceForPhoto).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a server-stored photo hazard overrides a non-terminal energized-question directive", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({
      observationId: "o1",
      sessionId: "s1",
      text: "Visible arcing at an uncovered terminal.",
      obsKind: "property",
      trust: "candidate",
      confidence: null,
      fileId: PHOTO,
      photoHash: "h",
      observedAt: null,
      hazards: [{ code: "arcing", confidence: 0.99 }],
    });

    const res = await POST(
      req({
        message: "480V main panel. Can I measure voltage while it's running?",
        mode: "general",
        visualEvidence: { fileId: PHOTO },
      }),
      params,
    );

    expect(res.headers.get("X-Safety-Stop")).toBe("visual:arcing");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied photo hazard when the server-stored descriptor is healthy", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({
      observationId: "o1",
      sessionId: "s1",
      text: "No exposed wiring, guards in place, no burn marks.",
      obsKind: "property",
      trust: "candidate",
      confidence: null,
      fileId: PHOTO,
      photoHash: "h",
      observedAt: null,
      hazards: [],
    });

    const res = await POST(
      req({
        message: "what am I looking at here",
        mode: "general",
        visualEvidence: {
          fileId: PHOTO,
          hazards: [{ code: "arcing", confidence: 1 }],
        },
      }),
      params,
    );
    await res.text();

    expect(res.headers.get("X-Safety-Stop")).toBeNull();
    expect(fetch).toHaveBeenCalled();
  });

  it("F2: when a verified photo is present and descriptor load throws, fails closed (no provider call)", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });
    veMock.loadVisualEvidenceForPhoto.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await POST(
      req({ message: "what am I looking at here", mode: "general", visualEvidence: { fileId: PHOTO } }),
      params,
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "visual_descriptor_load_failed" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F1 sticky MAX: older LOOK with high hazard + newer LOOK with empty hazards → still stops (MAX across all active rows)", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });
    // loadVisualEvidenceForPhoto now aggregates: returns latest text but MAX hazard across all rows.
    // Simulates: older LOOK arcing@0.9 + newer LOOK hazards:[] → MAX is arcing@0.9, still blocks.
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({
      observationId: "o2",
      sessionId: "s1",
      text: "No visible hazards at this time.", // latest observation text
      obsKind: "property",
      trust: "candidate",
      confidence: null,
      fileId: PHOTO,
      photoHash: "h",
      observedAt: null,
      hazards: [{ code: "arcing", confidence: 0.9 }], // MAX from older row
    });

    const res = await POST(
      req({
        message: "what am I looking at here",
        visualEvidence: { fileId: PHOTO },
      }),
      params,
    );

    // Even though the latest LOOK says no hazards, the older high-confidence hazard is sticky.
    expect(res.headers.get("X-Safety-Stop")).toBe("visual:arcing");
    expect(fetch).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).toHaveBeenCalledWith(
      TENANT,
      NB,
      expect.objectContaining({
        answerText: expect.stringContaining("SAFETY STOP"),
        evidence: expect.arrayContaining([
          expect.objectContaining({ kind: "safety_stop", trigger: "visual:arcing" }),
        ]),
      }),
    );
  });
});
