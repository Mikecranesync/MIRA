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
  normalizeNotebookThreadId: (value: unknown) => typeof value === "string" ? value : null,
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
  loadRecentLookObservations: vi.fn(async () => [] as unknown[]),
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

const screenMock = vi.hoisted(() => ({ loadScreenTextLines: vi.fn(async () => null as string[] | null) }));
vi.mock("@/capabilities/screen-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/screen-text")>()),
  loadScreenTextLines: screenMock.loadScreenTextLines,
}));
import { SCREEN_FAIL_SAFE } from "@/capabilities/alarm-screens.fixture";
import { persistTurnUsage } from "@/lib/inference/persist-usage";

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

/** Joins every "content" SSE frame's `content` field into one string — the
 *  release chunker can split a phrase across frame boundaries, so a raw
 *  substring check on the whole SSE text is not reliable. */
function releasedContentOf(rawSSEText: string): string {
  return rawSSEText
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((f): f is Record<string, unknown> => f?.kind === "content")
    .map((f) => String(f.content ?? ""))
    .join("");
}

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

describe("alarm card fast path", () => {
  beforeEach(() => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });
    screenMock.loadScreenTextLines.mockResolvedValue([...SCREEN_FAIL_SAFE]);
  });

  it("answers an alarm question from the card: no provider call, turn persisted as answered with both evidence entries", async () => {
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(releasedContentOf(body)).toContain("**What it means**");
    expect(body).toContain('"status":"answered"');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const persisted = (nbMock.recordTurn.mock.calls[0] as unknown[])[2] as { answerStatus: string; evidence: { kind: string }[]; model: unknown };
    expect(persisted.answerStatus).toBe("answered");
    expect(persisted.model).toBeNull();
    expect(persisted.evidence.map((e) => e.kind)).toEqual(expect.arrayContaining(["visual_observation", "alarm_reading"]));
    expect(screenMock.loadScreenTextLines).toHaveBeenCalledWith(expect.anything(), TENANT, "s1", PHOTO);
  });

  it("records the photo as the card's evidence, so the turn recorder raises no false anomaly", async () => {
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    await res.text();
    const persisted = JSON.stringify(vi.mocked(persistTurnUsage).mock.calls);
    expect(vi.mocked(persistTurnUsage)).toHaveBeenCalled();
    expect(persisted).not.toContain("PHOTO_WITH_NO_OBSERVATIONS");
    expect(persisted).not.toContain("EQUIPMENT_ANSWER_WITH_NO_EVIDENCE");
  });

  it("falls through on an unrelated question", async () => {
    await POST(req({ message: "what is the torque spec for the motor mount", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    const persisted = nbMock.recordTurn.mock.calls.length
      ? ((nbMock.recordTurn.mock.calls[0] as unknown[])[2] as { evidence: { kind: string }[] })
      : { evidence: [] };
    expect(persisted.evidence.map((e) => e.kind)).not.toContain("alarm_reading");
  });

  it("falls through when no lines are stored", async () => {
    screenMock.loadScreenTextLines.mockResolvedValue(null);
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    expect(releasedContentOf(await res.text())).not.toContain("**What it means**");
  });

  it("falls through when loading the lines throws", async () => {
    screenMock.loadScreenTextLines.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    expect(res.status).toBe(200);
    expect(releasedContentOf(await res.text())).not.toContain("**What it means**");
  });

  it("never claims a turn whose photo carries a blocking hazard", async () => {
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({
      ...(await veMock.loadVisualEvidenceForPhoto()),
      hazards: [{ code: "smoke", confidence: 0.95 }],
    } as never);
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    expect(releasedContentOf(await res.text())).not.toContain("**What it means**");
  });

  it("control: no photo, no fast path", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue(null);
    await POST(req({ message: "what does this alarm mean", mode: "general" }), params);
    expect(screenMock.loadScreenTextLines).not.toHaveBeenCalled();
  });
});
