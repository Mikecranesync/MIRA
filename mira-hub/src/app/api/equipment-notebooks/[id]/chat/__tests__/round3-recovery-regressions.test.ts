/**
 * Private technician conversations on a SHARED Equipment Notebook.
 *
 * Run: cd mira-hub && npx vitest run src/app/api/equipment-notebooks/\[id\]/chat/__tests__/turn-ownership
 *
 * The Notebook (manuals, evidence, asset identity, machine history) is shared
 * by the tenant. Every NEW chat turn is owned by the authenticated technician
 * — derived from the server session, never from the request body — and the
 * server must prove tenant ownership of the Notebook BEFORE any provider call
 * and BEFORE any persistence, on every path: general, grounded, safety stop.
 *
 * Machine-specific claims need a server-resolved, tenant-authorized,
 * technician-CONFIRMED asset binding that matches what the client asked about;
 * a client-supplied asset id is a request, not truth.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PHOTO_CHANGED_RETRY_NOTE } from "@/capabilities/turn-recovery/contract";
import { bypassStopText } from "@/capabilities/safety-bypass-advisory";
import { errorMessageFor } from "@/factorylm-ui/hub-host-logic";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const ASSET = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const OTHER_ASSET = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const FAULT_AT = "2026-08-27T23:16:31.000Z";
const USER_A = "user-a-0000-4000-8000-000000000001";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(),
}));
vi.mock("@/lib/session", () => sessionMock);

const nbMock = vi.hoisted(() => ({
  LEGACY_THREAD_ID: "legacy",
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async (): Promise<Record<string, unknown>> => ({ state: "unbound" })),
  recordTurn: vi.fn(async () => undefined),
  claimNotebookTurnRequest: vi.fn(),
  acceptNotebookTurnContext: vi.fn(async () => true),
  stampClaimedTurnComponent: vi.fn(async () => true),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  listTurns: vi.fn(async () => []),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  normalizeNotebookThreadId: vi.fn((value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const filesMock = vi.hoisted(() => ({ photoLinkedToTarget: vi.fn(async () => null as { fileId: string; capturedAt: string } | null) }));
vi.mock("@/lib/workspace-files", async (original) => ({ ...await original<typeof import("@/lib/workspace-files")>(), ...filesMock }));
const lookMock = vi.hoisted(() => ({ loadVisualEvidenceForPhoto: vi.fn(async () => null as import("@/lib/visual-evidence-context").VisualEvidenceRow | null) }));
vi.mock("@/lib/visual-evidence-context", async (original) => ({ ...await original<typeof import("@/lib/visual-evidence-context")>(), ...lookMock }));

const historyMock = vi.hoisted(() => ({
  fetchMachineHistory: vi.fn(),
  clampSpan: vi.fn((v: unknown, d: number) => (typeof v === "number" ? v : d)),
  parseAnchor: vi.fn((v: unknown) => (typeof v === "string" ? v : null)),
}));
vi.mock("@/lib/machine-history", () => historyMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://provider.test/v1", key: "k", model: "m" }]),
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

const recoveryMock = vi.hoisted(() => ({ readTurnRetry: vi.fn() }));
vi.mock("@/capabilities/turn-recovery/store", () => recoveryMock);
const benchMock = vi.hoisted(() => ({
  getSelection: vi.fn(), getSelectionState: vi.fn(), listComponents: vi.fn(),
  advanceSelectionRevision: vi.fn(), listSelectionTurns: vi.fn(),
  stampTurnComponent: vi.fn(async () => true),
}));
vi.mock("@/capabilities/bench-components/store", () => benchMock);

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

/** The provider is the ONLY thing the route reaches with global fetch. */
function providerFetch() {
  return vi.fn(async () => new Response(providerStream("Check the DC bus first."), { status: 200 }));
}

function authedAs(userId: string, tenantId = TENANT) {
  sessionMock.sessionOr401.mockResolvedValue({ tenantId, userId, email: `${userId}@x`, status: "trial", trialExpiresAt: null, role: "technician" });
}

/** A notebook that exists ONLY for TENANT: any other tenant's lookup is null. */
function notebookOwnedByTenant() {
  nbMock.getNotebook.mockImplementation(async (tenantId: string, id: string) =>
    tenantId === TENANT && id === NB ? { id: NB, displayName: "Conveyor 1" } : null,
  );
  // Mirrors the REAL resolver: an empty selection returns early WITHOUT touching
  // the database, so `no_sources_selected` proves nothing about ownership.
  nbMock.validateChatSources.mockImplementation(async (tenantId: string, id: string, docIds: string[]) => {
    if (docIds.length === 0) return { ok: false, error: "no_sources_selected" };
    if (!(tenantId === TENANT && id === NB)) return { ok: false, error: "notebook_not_found" };
    return { ok: true, docIds, nodeId: "node-1" };
  });
}

beforeEach(() => {
  // This suite pins its own seam (not the semantic judge, which is owned by
  // chat-answer-gate.test.ts). Iteration-9 judges EVERY served answer, so
  // disable the layer here rather than stub a judge in every test.
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  authedAs(USER_A);
  notebookOwnedByTenant();
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  lookMock.loadVisualEvidenceForPhoto.mockResolvedValue(null);
  vi.stubGlobal("fetch", providerFetch());
});


const REQUEST = "44444444-4444-4444-8444-444444444444";
const TOKEN = "55555555-5555-4555-8555-555555555555";
const COMPONENT = "66666666-6666-4666-8666-666666666666";
const NOTEBOOK_A = { id: NB, displayName: "Machine", manufacturer: "AutomationDirect", model: "GS10",
  catalogNumber: "GS11N-10P2", serialNumber: null, equipmentType: "vfd", identityStatus: "user_confirmed", asset: null };
const identityA = { version: 1, manufacturer: "AutomationDirect", model: "GS10", catalogNumber: "GS11N-10P2",
  serialNumber: null, equipmentType: "vfd", identityStatus: "user_confirmed" };
const prior = { id: "old", question: "We are discussing ORIGINAL-PART", answerStatus: "answered", answerText: "Original context",
  evidence: [], componentId: null, componentRevision: null, createdAt: "2026-11-19T10:00:00.000Z", clientRequestId: null };
const acceptedContext = {
  version: 1,
  target: { equipmentEntityId: null, notebookIdentity: identityA,
    manualIdentity: { identity: { manufacturer: "AutomationDirect", model: "GS10" }, catalogNumber: "GS11N-10P2", identityStatus: "user_confirmed" } },
  component: null,
  history: [{ role: "user", content: prior.question }, { role: "assistant", content: prior.answerText }],
  selectionTurnIds: [prior.id], subjectQueries: [prior.question], subjectOutOfReach: false,
  priorLookRows: [], currentLookRow: null, priorLookFileIds: [],
  priorReportContext: { content: "", turnIds: [], truncated: false, coverage: "not_requested" }, previousTurn: null,
};
const originalBody = () => ({ clientRequestId: REQUEST, message: "What fuse should this drive use?", sourceDocIds: [], mode: "general", threadId: null,
  expectedEquipmentEntityId: null, expectedNotebookIdentity: identityA, history: [],
  componentSelection: { threadId: null, componentId: null, selectionVersion: null } });

beforeEach(() => {
  nbMock.getNotebook.mockResolvedValue(NOTEBOOK_A);
  nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: TOKEN, preserveFailedTurn: false });
  benchMock.getSelection.mockResolvedValue(null);
  benchMock.getSelectionState.mockResolvedValue({ selection: null, version: null });
  benchMock.listComponents.mockResolvedValue([]);
  benchMock.listSelectionTurns.mockResolvedValue([]);
  recoveryMock.readTurnRetry.mockResolvedValue({ body: originalBody(), target: { kind: "known", equipmentEntityId: null }, component: null, acceptedContext });
});

describe("native round3 safety and server-target regressions", () => {
  const originalSelection = { componentId: COMPONENT, revision: 1, version: 1, selectedAt: FAULT_AT, selectedVia: "picker" };
  function recovered(message: string, extra: Record<string, unknown> = {}, component = false) {
    const body = { ...originalBody(), message, ...extra,
      ...(component ? { mode: "grounded", sourceDocIds: [DOC_A], componentSelection: { threadId: null, componentId: COMPONENT, selectionVersion: 1 } } : {}) };
    recoveryMock.readTurnRetry.mockResolvedValue({ body, target: { kind: "known", equipmentEntityId: null }, component: component ? { componentId: COMPONENT, revision: 1 } : null,
      acceptedContext: { ...acceptedContext, ...(component ? { component: { componentId: COMPONENT, revision: 1, selection: originalSelection } } : {}) } });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: TOKEN, preserveFailedTurn: true });
  }
  it("F1 delivers the independently known smoke warning after the same component/revision is reselected", async () => {
    recovered("There is smoke coming from the drive panel", {}, true);
    benchMock.getSelection.mockResolvedValue({ ...originalSelection, version: 2, selectedAt: "2026-11-20T10:00:00Z" });
    benchMock.listComponents.mockResolvedValue([{ id: COMPONENT, retiredAt: null, current: { componentId: COMPONENT, revision: 1, rawLabel: "Drive", manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-10P2", identityStatus: "user_confirmed", localTag: "VFD1" } }]);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(await response.text()).toContain("⚠️");
    expect(fetch).not.toHaveBeenCalled(); expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled(); expect(benchMock.advanceSelectionRevision).not.toHaveBeenCalled();
  });
  it("F1 delivers the known text warning despite a detached original photo", async () => {
    recovered("There is smoke coming from the drive panel", { visualEvidence: { fileId: DOC_A } });
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(await response.text()).toContain("⚠️");
    expect(fetch).not.toHaveBeenCalled(); expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled(); expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });
  it("keeps the nonhazardous detached-photo refusal", async () => {
    recovered("What fuse should this drive use?", { visualEvidence: { fileId: DOC_A } });
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "retry_photo_unavailable" });
    expect(fetch).not.toHaveBeenCalled(); expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });
  it("F1 keeps the energized-work stop independent of an unavailable original photo", async () => {
    recovered("Can I replace the fan while it is powered without locking out?", { visualEvidence: { fileId: DOC_A } });
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(/lockout|lock out|de-energize/i);
    expect(fetch).not.toHaveBeenCalled(); expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });
  it("F1 keeps an independently known warning when an accepted prior photo changes", async () => {
    const body = { ...originalBody(), message: "There is smoke coming from the drive panel" };
    const original = { observationId: "original", sessionId: "session", fileId: DOC_A, text: "Original photo", hazards: [], photoHash: "original" };
    recoveryMock.readTurnRetry.mockResolvedValue({ body, target: { kind: "known", equipmentEntityId: null }, component: null,
      acceptedContext: { ...acceptedContext, priorLookRows: [original], priorLookFileIds: [DOC_A] } });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: TOKEN, preserveFailedTurn: true });
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: DOC_A, capturedAt: FAULT_AT });
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue({ ...original, text: "REPLACEMENT-PHOTO-TEXT" } as unknown as import("@/lib/visual-evidence-context").VisualEvidenceRow);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    const text = await response.text();
    expect(response.status).toBe(409); expect(text).toContain("⚠️"); expect(text).not.toContain("REPLACEMENT-PHOTO-TEXT");
    expect(fetch).not.toHaveBeenCalled(); expect(nbMock.recordTurn).not.toHaveBeenCalled(); expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });
  it.each([ASSET, null])("F2 refuses a legacy full-body reclaim when server-accepted asset %s changed", async originalAsset => {
    const body = originalBody(); delete (body as Partial<ReturnType<typeof originalBody>>).expectedEquipmentEntityId;
    delete (body as Partial<ReturnType<typeof originalBody>>).expectedNotebookIdentity;
    nbMock.getNotebook.mockResolvedValue({ ...NOTEBOOK_A, asset: { entityId: OTHER_ASSET } });
    nbMock.resolveBoundAsset.mockResolvedValue({ state: "resolved", entityId: OTHER_ASSET, name: "Same model different instance", unsPath: "enterprise.other", confirmedAt: FAULT_AT, selectedVia: "picker", manufacturer: "AutomationDirect", model: "GS10", catalogNumber: "GS11N-10P2" });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: TOKEN, preserveFailedTurn: true,
      acceptedContext: { ...acceptedContext, target: { ...acceptedContext.target, equipmentEntityId: originalAsset } } });
    const response = await POST(req(body), params);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "equipment_binding_changed" });
    expect(fetch).not.toHaveBeenCalled(); expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled(); expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });
  it("F3 serves the safety-only warning without overwriting an original failed row", async () => {
    const body = { ...originalBody(), message: "There is smoke coming from the drive panel", expectedEquipmentEntityId: ASSET };
    recoveryMock.readTurnRetry.mockResolvedValue({ body, target: { kind: "known", equipmentEntityId: ASSET }, component: null,
      acceptedContext: { ...acceptedContext, target: { ...acceptedContext.target, equipmentEntityId: ASSET } } });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: TOKEN, preserveFailedTurn: true });
    nbMock.getNotebook.mockResolvedValue({ ...NOTEBOOK_A, asset: { entityId: OTHER_ASSET } });
    nbMock.resolveBoundAsset.mockResolvedValue({ state: "resolved", entityId: OTHER_ASSET, name: "Replacement", unsPath: "enterprise.other", confirmedAt: FAULT_AT, selectedVia: "picker" });
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(await response.text()).toContain("⚠️");
    expect(nbMock.recordTurn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });
});

describe("native round4 F1: accepted photo warning survives a held source", () => {
  type Row = import("@/lib/visual-evidence-context").VisualEvidenceRow;
  const look = (hazards: unknown[]) => ({ observationId: "o1", sessionId: "s1", fileId: DOC_A, text: "Cabinet photo", hazards, photoHash: "h1" }) as unknown as Row;
  function acceptedPhotoRetry(row: Row) {
    const body = { ...originalBody(), message: "What fuse should this drive use?", mode: "grounded", sourceDocIds: [DOC_A], visualEvidence: { fileId: DOC_A } };
    recoveryMock.readTurnRetry.mockResolvedValue({ body, target: { kind: "known", equipmentEntityId: null }, component: null,
      acceptedContext: { ...acceptedContext, currentLookRow: row } });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: TOKEN, preserveFailedTurn: true });
    // The selected manual was disabled/detached after acceptance.
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "source_not_in_notebook" });
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: DOC_A, capturedAt: FAULT_AT });
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue(row);
  }
  const quiet = () => {
    expect(fetch).not.toHaveBeenCalled(); expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled(); expect(nbMock.acceptNotebookTurnContext).not.toHaveBeenCalled();
  };
  it("delivers the photo warning directly", async () => {
    acceptedPhotoRetry(look([{ code: "smoke", confidence: 0.99 }]));
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.safetyWarning).toContain("⚠️"); expect(body.code).toBe("source_not_in_notebook");
    quiet();
  });
  it("delivers the photo warning to a progress-stream client", async () => {
    process.env.MIRA_CHAT_PROGRESS = "1";
    try {
      acceptedPhotoRetry(look([{ code: "smoke", confidence: 0.99 }]));
      const r = new NextRequest("http://test/api/equipment-notebooks/x/chat", { method: "POST", body: JSON.stringify({ retryRequestId: REQUEST, threadId: null }),
        headers: { "Content-Type": "application/json", "x-mira-progress": "1" } });
      const text = await (await POST(r, params)).text();
      expect(text).toContain("⚠️"); expect(text).toContain("source_not_in_notebook");
      quiet();
    } finally { delete process.env.MIRA_CHAT_PROGRESS; }
  });
  it("keeps a plain source refusal when the photo is not hazardous", async () => {
    acceptedPhotoRetry(look([]));
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "source_not_in_notebook" });
    quiet();
  });
  it("does not disclose a hazard when the original photo is unavailable", async () => {
    acceptedPhotoRetry(look([{ code: "smoke", confidence: 0.99 }]));
    filesMock.photoLinkedToTarget.mockResolvedValue(null);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "retry_photo_unavailable" });
    quiet();
  });
  it("does not disclose a replacement photo's hazard", async () => {
    acceptedPhotoRetry(look([]));
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue(look([{ code: "smoke", confidence: 0.99 }]) as Row);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    const text = await response.text();
    expect(response.status).toBe(409); expect(text).not.toContain("⚠️"); expect(text).toContain("retry_photo_changed");
    quiet();
  });
  it("keeps the descriptor-load failure closed and never discloses or writes", async () => {
    acceptedPhotoRetry(look([{ code: "smoke", confidence: 0.99 }]));
    lookMock.loadVisualEvidenceForPhoto.mockRejectedValue(new Error("descriptor store down"));
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.safetyWarning).toBeUndefined(); expect(body.error).toBe("visual_descriptor_load_failed");
    quiet();
    expect(nbMock.stampClaimedTurnComponent).not.toHaveBeenCalled(); expect(benchMock.advanceSelectionRevision).not.toHaveBeenCalled();
  });
  it("PINNED BEHAVIOUR CHANGE (human decision): a descriptor that first appears after acceptance is 'changed' and its hazard is withheld too", async () => {
    acceptedPhotoRetry(look([]));
    recoveryMock.readTurnRetry.mockResolvedValue({ body: { ...originalBody(), message: "What fuse should this drive use?", mode: "grounded", sourceDocIds: [DOC_A], visualEvidence: { fileId: DOC_A } },
      target: { kind: "known", equipmentEntityId: null }, component: null, acceptedContext: { ...acceptedContext, currentLookRow: null } });
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue(look([{ code: "smoke", confidence: 0.99 }]) as Row);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    const text = await response.text();
    expect(response.status).toBe(409); expect(text).toContain("retry_photo_changed"); expect(text).not.toContain("⚠️");
    quiet();
  });
  it("control: with the source NOT held, a replaced photo's hazard still never drives the retry", async () => {
    acceptedPhotoRetry(look([]));
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue(look([{ code: "smoke", confidence: 0.99 }]) as Row);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    const text = await response.text();
    expect(response.status).toBe(409); expect(text).not.toContain("⚠️"); expect(text).toContain("retry_photo_changed");
    quiet();
  });
  const SMOKE = [{ code: "smoke", confidence: 0.99 }];
  const REPLACEMENT_TEXT = "REPLACEMENT-PHOTO-TEXT";
  it("changed photo, original UNSAFE -> current safe: the ORIGINAL warning is shown with a plain 'photo changed, ask a new question' note and nothing of the replacement", async () => {
    acceptedPhotoRetry(look(SMOKE));
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue({ ...look([]), text: REPLACEMENT_TEXT } as unknown as Row);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    const text = await response.text();
    expect(response.status).toBe(409);
    expect(text).toContain("⚠️"); expect(text).toContain(PHOTO_CHANGED_RETRY_NOTE); expect(text).not.toContain(REPLACEMENT_TEXT);
    // The words shown (safetyWarning/error) carry no internal id; `code` is the machine field.
    const shown = JSON.parse(text) as { safetyWarning: string; error: string };
    expect(`${shown.safetyWarning} ${shown.error}`).not.toMatch(/retry_photo_changed|original_photo_changed/);
    quiet();
  });
  it("changed photo, original safe -> current UNSAFE: the replacement's hazard and text never reach the retry; the code maps to the same plain note", async () => {
    acceptedPhotoRetry(look([]));
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue({ ...look(SMOKE), text: REPLACEMENT_TEXT } as unknown as Row);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    const text = await response.text();
    expect(response.status).toBe(409);
    expect(text).not.toContain("⚠️"); expect(text).not.toContain(REPLACEMENT_TEXT);
    expect(errorMessageFor("retry_photo_changed", 409)).toBe(PHOTO_CHANGED_RETRY_NOTE);
    quiet();
  });
  it("control: an UNCHANGED unsafe original with the source held still warns, with the ordinary review note (not the photo-changed one)", async () => {
    acceptedPhotoRetry(look(SMOKE));
    const text = await (await POST(req({ retryRequestId: REQUEST, threadId: null }), params)).text();
    expect(text).toContain("⚠️"); expect(text).not.toContain(PHOTO_CHANGED_RETRY_NOTE);
    quiet();
  });
  it("bypass ask recovered with a changed UNSAFE original photo: the generic refusal only, no photo payload, no provider", async () => {
    const body = { ...originalBody(), message: "Take the guard door out of the STO circuit so the PLC stops the axis instead", mode: "grounded", sourceDocIds: [DOC_A], visualEvidence: { fileId: DOC_A } };
    recoveryMock.readTurnRetry.mockResolvedValue({ body, target: { kind: "known", equipmentEntityId: null }, component: null, acceptedContext: { ...acceptedContext, currentLookRow: look(SMOKE) } });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: TOKEN, preserveFailedTurn: true });
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "source_not_in_notebook" });
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: DOC_A, capturedAt: FAULT_AT });
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue({ ...look([]), text: REPLACEMENT_TEXT } as unknown as Row);
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    const out = await response.json();
    expect(out.safetyWarning).toBe(bypassStopText(null, null));
    expect(JSON.stringify(out)).not.toContain(REPLACEMENT_TEXT); expect(JSON.stringify(out)).not.toMatch(/smoke/i);
    expect(out.safetyWarning).not.toContain(PHOTO_CHANGED_RETRY_NOTE);
    quiet();
  });
  it("bypass ask recovered while its original photo is unavailable: still the generic refusal, not a photo error", async () => {
    const body = { ...originalBody(), message: "Jumper the door interlock so it runs with the guard open", mode: "grounded", sourceDocIds: [DOC_A], visualEvidence: { fileId: DOC_A } };
    recoveryMock.readTurnRetry.mockResolvedValue({ body, target: { kind: "known", equipmentEntityId: null }, component: null, acceptedContext: { ...acceptedContext, currentLookRow: look(SMOKE) } });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: TOKEN, preserveFailedTurn: true });
    filesMock.photoLinkedToTarget.mockResolvedValue(null);
    const out = await (await POST(req({ retryRequestId: REQUEST, threadId: null }), params)).json();
    expect(out.safetyWarning).toBe(bypassStopText(null, null));
    expect(out.error).not.toBe("retry_photo_unavailable");
    quiet();
  });
  it("still warns about a question hazard when the source is held", async () => {
    acceptedPhotoRetry(look([]));
    const body = { ...originalBody(), message: "There is smoke coming from the drive panel", mode: "grounded", sourceDocIds: [DOC_A], visualEvidence: { fileId: DOC_A } };
    recoveryMock.readTurnRetry.mockResolvedValue({ body, target: { kind: "known", equipmentEntityId: null }, component: null, acceptedContext: { ...acceptedContext, currentLookRow: look([]) } });
    const response = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect((await response.json()).safetyWarning).toContain("⚠️");
    quiet();
  });
});
