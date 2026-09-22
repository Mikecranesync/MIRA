/**
 * #3788 — a phone-photo question that retrieves nothing must not lose the photo.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * Device evidence (Pixel 9a, 2026-09-19, PR #3829 acceptance, HOME row): the
 * request carried a verified `visualEvidence.fileId`, retrieval returned zero
 * chunks, and the route abstained BEFORE it ever verified the photo — so the
 * technician got "I couldn't find that in the selected sources" with no
 * evidence frame, no photo card, no persisted visual entry, and no log line
 * saying the photo was dropped. The photo simply vanished.
 *
 * Gate G keeps its teeth here: with no document chunks and no machine window
 * the route still refuses without a provider call. What changes is ORDER —
 * the photo is verified first — and the abstain carries what was verified:
 *   - the persisted abstain turn's `evidence[]` includes the visual entry;
 *   - the SSE stream emits an `evidence` marker frame with `visualEvidence`
 *     (basis-less, the same grammar as the identity-dispute marker);
 *   - the status message says the photo was seen.
 * An unverifiable claim is still dropped, still logged, and the abstain is
 * byte-identical to before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const PHOTO = "44444444-4444-4444-8444-444444444444";
const CAPTURED_AT = "2026-09-19T11:09:23.000Z";

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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "CV-101", manufacturer: null, model: null });
  ragMock.retrieveNodeChunks.mockResolvedValue([]); // nothing retrieved — the Gate G case
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("#3788 — verified photo + zero chunks: the abstain carries the photo", () => {
  it("verifies the photo BEFORE abstaining, persists it on the abstain turn, and emits the visual evidence frame", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });

    const res = await POST(
      req({ mode: "source_only",
        message: "what am I looking at here",
        sourceDocIds: [DOC_A],
        visualEvidence: { fileId: PHOTO, capturedAt: "client-supplied-and-ignored" },
      }),
      params,
    );
    expect(res.status).toBe(200);
    const out = await frames(res);

    // Still Gate G: no provider call, structured abstain.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toMatch(/photo/i);

    // The photo was verified against THIS notebook in THIS tenant before the gate ran.
    expect(filesMock.photoLinkedToTarget).toHaveBeenCalledWith(TENANT, PHOTO, "equipment_notebook", NB);

    // …and it rides the stream: a basis-less evidence marker (dispute-marker grammar).
    const visual = out.find((f) => f.kind === "evidence" && "visualEvidence" in f) as
      | { visualEvidence: Record<string, unknown>; basis?: unknown }
      | undefined;
    expect(visual).toBeDefined();
    expect(visual?.visualEvidence).toEqual({
      kind: "visual_observation",
      fileId: PHOTO,
      capturedAt: CAPTURED_AT,
      provenance: "phone_photo",
    });
    expect(visual?.basis).toBeUndefined();

    // …and the persisted abstain remembers the photo (history renders the card).
    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown[])[2] as {
      answerStatus: string;
      answerText: string | null;
      evidence: Record<string, unknown>[];
    };
    expect(persisted.answerStatus).toBe("insufficient_evidence");
    expect(persisted.answerText).toBe("I saw your photo, but I couldn't find anything about it in the selected sources.");
    expect(persisted.evidence).toContainEqual({
      kind: "visual_observation",
      fileId: PHOTO,
      capturedAt: CAPTURED_AT,
      provenance: "phone_photo",
    });
  });

  it("an unverifiable claim is dropped, logged, and the abstain is unchanged (no evidence frame, plain message)", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue(null);

    const res = await POST(
      req({ mode: "source_only", message: "what am I looking at here", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }),
      params,
    );
    expect(res.status).toBe(200);
    const out = await frames(res);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(filesMock.photoLinkedToTarget).toHaveBeenCalledTimes(1);
    expect(out.some((f) => f.kind === "evidence")).toBe(false);
    const status = out.find((f) => f.kind === "status") as { status: string; message: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toBe("I couldn't find that in the selected sources.");
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/visualEvidence ignored/));

    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown[])[2] as { evidence: unknown[] };
    expect(persisted.evidence).toEqual([]);
  });

  it("a safety stop verifies and retains the attached photo without weakening the stop", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });

    const res = await POST(
      req({
        message: "there is smoke coming from the drive panel",
        sourceDocIds: [DOC_A],
        visualEvidence: { fileId: PHOTO },
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBe("smoke coming");
    expect(filesMock.photoLinkedToTarget).toHaveBeenCalledWith(TENANT, PHOTO, "equipment_notebook", NB);
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    const out = await frames(res);
    expect(out.some((f) => f.kind === "safety")).toBe(true);
    expect(out).toContainEqual({
      kind: "evidence",
      visualEvidence: {
        kind: "visual_observation",
        fileId: PHOTO,
        capturedAt: CAPTURED_AT,
        provenance: "phone_photo",
      },
    });

    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown[])[2] as {
      answerStatus: string;
      evidence: Record<string, unknown>[];
    };
    expect(persisted.answerStatus).toBe("answered");
    expect(persisted.evidence).toContainEqual(expect.objectContaining({ kind: "safety_notice" }));
    expect(persisted.evidence).toContainEqual({
      kind: "visual_observation",
      fileId: PHOTO,
      capturedAt: CAPTURED_AT,
      provenance: "phone_photo",
    });
  });

  it("no claim at all: the document abstain is byte-identical to before (no photo lookup, no frame)", async () => {
    const res = await POST(req({ mode: "source_only", message: "what am I looking at here", sourceDocIds: [DOC_A] }), params);
    const out = await frames(res);
    expect(filesMock.photoLinkedToTarget).not.toHaveBeenCalled();
    expect(out.map((f) => f.kind)).toEqual(["sources", "status"]);
    const status = out[1] as { message: string };
    expect(status.message).toBe("I couldn't find that in the selected sources.");
  });
});
