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
import { NextRequest, NextResponse } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const ASSET = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const OTHER_ASSET = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const UNS = "enterprise.plant.line.conveyor_1";
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
  recordTurn: vi.fn(async (..._args: unknown[]) => undefined),
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
import * as queryFunctions from "@/lib/notebook-query";

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
const later = { ...prior, id: "later", question: "The new topic is LATER-PART", answerText: "Later context", createdAt: "2026-11-20T10:00:00.000Z" };
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

describe("native round2 recovery regressions on the real POST handler", () => {
  it.each([
    ["unresolvable", "there is smoke coming from the drive panel"],
    ["rebound", "there is smoke coming from the drive panel"],
    ["unresolvable", "can I swap the fan while it is powered"],
    ["rebound", "can I swap the fan while it is powered"],
  ])("F1 preserves equipment-independent warning for a %s target: %s", async (state, message) => {
    nbMock.getNotebook.mockResolvedValue({ ...NOTEBOOK_A, asset: { entityId: ASSET } });
    nbMock.resolveBoundAsset.mockResolvedValue(state === "unresolvable" ? { state: "unresolvable", entityId: ASSET }
      : { state: "resolved", entityId: OTHER_ASSET, name: "Replacement", unsPath: "enterprise.replacement", confirmedAt: FAULT_AT, selectedVia: "picker" });
    const res = await POST(req({ ...originalBody(), message, expectedEquipmentEntityId: ASSET }), params);
    expect(res.status).toBe(200);
    const data = await frames(res);
    expect(JSON.stringify(data)).toContain(message.includes("powered") ? "SAFETY STOP" : "⚠️");
    expect(fetch).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    const persisted = nbMock.recordTurn.mock.calls.at(-1)?.[2] as Record<string, unknown> | undefined;
    expect(persisted?.equipmentEntityId ?? null).toBeNull();
    expect(JSON.stringify(data)).not.toContain(OTHER_ASSET);
  });

  it.each(["unresolvable", "rebound"])("F1 preserves a verified photo-only hazard when the target is %s", async state => {
    nbMock.getNotebook.mockResolvedValue({ ...NOTEBOOK_A, asset: { entityId: ASSET } });
    nbMock.resolveBoundAsset.mockResolvedValue(state === "unresolvable" ? { state: "unresolvable", entityId: ASSET }
      : { state: "resolved", entityId: OTHER_ASSET, name: "Replacement", unsPath: "enterprise.replacement", confirmedAt: FAULT_AT, selectedVia: "picker" });
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: DOC_A, capturedAt: FAULT_AT });
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue({ observationId: "obs", sessionId: "look", text: "Arcing at the panel", obsKind: "scene", trust: "candidate", confidence: 0.99,
      fileId: DOC_A, photoHash: "hash", observedAt: FAULT_AT, hazards: [{ code: "arcing", confidence: 0.99 }] });
    const res = await POST(req({ ...originalBody(), message: "What is visible here?", expectedEquipmentEntityId: ASSET, visualEvidence: { fileId: DOC_A } }), params);
    expect(res.status).toBe(200);
    const data = await frames(res);
    expect(JSON.stringify(data)).toContain("⚠️");
    expect(fetch).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect((nbMock.recordTurn.mock.calls.at(-1)?.[2] as Record<string, unknown>)?.equipmentEntityId ?? null).toBeNull();
  });

  it("F1 does not turn an unverified photo into diagnostic permission for a changed target", async () => {
    nbMock.getNotebook.mockResolvedValue({ ...NOTEBOOK_A, asset: { entityId: OTHER_ASSET } });
    const res = await POST(req({ ...originalBody(), expectedEquipmentEntityId: ASSET, visualEvidence: { fileId: DOC_A } }), params);
    expect(res.status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });

  it("F2 keeps the same confirmed null-asset identity retryable even after JSONB reorders its keys", async () => {
    const reordered = JSON.parse(JSON.stringify(acceptedContext), (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value);
    recoveryMock.readTurnRetry.mockResolvedValue({ body: originalBody(), target: { kind: "known", equipmentEntityId: null }, component: null, acceptedContext: reordered });
    const res = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(res.status).toBe(200);
    await frames(res);
    expect(nbMock.claimNotebookTurnRequest).toHaveBeenCalledTimes(1);
    expect(nbMock.acceptNotebookTurnContext).not.toHaveBeenCalled();
  });

  it("F2 refuses a confirmed null-asset notebook changed from the original model before provider work", async () => {
    nbMock.getNotebook.mockResolvedValue({ ...NOTEBOOK_A, model: "MLC", catalogNumber: "MLC-SAFETY" });
    const res = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "notebook_identity_changed" });
    expect(fetch).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });

  it.each(["deleted", "moved"])("F3 denies recovery for a %s current account before original-request lookup", async () => {
    const oldActor = { tenantId: TENANT, userId: USER_A, email: "old@example.invalid", status: "trial", role: "technician" };
    sessionMock.sessionOr401.mockImplementation(async (options?: { requireCurrentUser?: boolean }) =>
      options?.requireCurrentUser ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : oldActor);
    const res = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(res.status).toBe(401);
    expect(recoveryMock.readTurnRetry).not.toHaveBeenCalled();
    expect(nbMock.claimNotebookTurnRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F5 refuses an original component revision before advancing its selection or rewriting attribution", async () => {
    const selected = { componentId: COMPONENT, revision: 1, version: 1, selectedAt: FAULT_AT, selectedVia: "picker" };
    benchMock.getSelection.mockResolvedValue(selected);
    benchMock.getSelectionState.mockResolvedValue({ selection: selected, version: 1 });
    benchMock.listComponents.mockResolvedValue([{ id: COMPONENT, kind: "drive", retiredAt: null, current: {
      componentId: COMPONENT, revision: 2, rawLabel: "Corrected drive", manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-10P2", identityStatus: "user_confirmed", localTag: "VFD1",
    } }]);
    benchMock.advanceSelectionRevision.mockResolvedValue({ ...selected, revision: 2, version: 2 });
    recoveryMock.readTurnRetry.mockResolvedValue({ body: { ...originalBody(), mode: "grounded", sourceDocIds: [DOC_A], componentSelection: { threadId: null, componentId: COMPONENT, selectionVersion: 1 } },
      target: { kind: "known", equipmentEntityId: null }, component: { componentId: COMPONENT, revision: 1 },
      acceptedContext: { ...acceptedContext, component: { componentId: COMPONENT, revision: 1, selection: selected } } });
    const res = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
    expect(res.status).toBe(409);
    expect(benchMock.advanceSelectionRevision).not.toHaveBeenCalled();
    expect(benchMock.stampTurnComponent).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F6 retains original referential context and excludes a completed topic appended after the question", async () => {
    benchMock.listSelectionTurns.mockResolvedValue([prior, later]);
    nbMock.listTurns.mockResolvedValue([prior, later] as never[]);
    recoveryMock.readTurnRetry.mockResolvedValue({ body: { ...originalBody(), message: "what about the other one", mode: "grounded", sourceDocIds: [DOC_A], history: acceptedContext.history },
      target: { kind: "known", equipmentEntityId: null }, component: null, acceptedContext });
    const query = vi.spyOn(queryFunctions, "buildRetrievalQuery");
    try {
      const res = await POST(req({ retryRequestId: REQUEST, threadId: null }), params);
      await frames(res);
      const uses = query.mock.calls.filter(([message]) => message === "what about the other one");
      expect(uses.length).toBeGreaterThan(0);
      const histories = JSON.stringify(uses.map(([, history]) => history));
      expect(histories).toContain("ORIGINAL-PART");
      expect(histories).not.toContain("LATER-PART");
      expect(benchMock.listSelectionTurns).not.toHaveBeenCalled();
    } finally { query.mockRestore(); }
  });
});
