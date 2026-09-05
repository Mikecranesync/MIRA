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
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async (): Promise<Record<string, unknown>> => ({ state: "unbound" })),
  recordTurn: vi.fn(async (..._args: unknown[]) => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

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
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  authedAs(USER_A);
  notebookOwnedByTenant();
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal("fetch", providerFetch());
});

describe("authorization happens before any provider call or persistence", () => {
  it("unauthenticated → 401; no provider call, nothing persisted", async () => {
    sessionMock.sessionOr401.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await POST(req({ message: "What is a VFD?", sourceDocIds: [], mode: "general" }), params);
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("nonexistent notebook (general mode) → 404 before the provider", async () => {
    nbMock.getNotebook.mockResolvedValue(null);
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const res = await POST(req({ message: "What is a VFD?", sourceDocIds: [], mode: "general" }), params);
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("a second tenant cannot reach the notebook: 404, no provider, nothing persisted", async () => {
    authedAs("user-b", OTHER_TENANT);
    const res = await POST(req({ message: "What is a VFD?", sourceDocIds: [], mode: "general" }), params);
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("a second tenant's GROUNDED question is refused before retrieval or provider", async () => {
    authedAs("user-b", OTHER_TENANT);
    const res = await POST(req({ message: "Which coil?", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(404);
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("a zero-source SAFETY STOP on a foreign/nonexistent notebook is NOT persisted", async () => {
    // The stop itself has no provider call — the hole is persistence: a stop
    // record must never land in a notebook the caller does not own.
    authedAs("user-b", OTHER_TENANT);
    const res = await POST(req({ message: "there is smoke coming from the drive panel", sourceDocIds: [] }), params);
    expect(res.status).toBe(404);
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("every persisted turn is owned by the authenticated technician", () => {
  it("general turn: owner is the session userId, not anything the client sent", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const res = await POST(
      req({ message: "What is a VFD?", sourceDocIds: [], mode: "general", ownerUserId: "attacker", owner_user_id: "attacker" }),
      params,
    );
    expect(res.status).toBe(200);
    await frames(res);
    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
    const [tenantId, notebookId, turn] = nbMock.recordTurn.mock.calls[0] as [string, string, { ownerUserId?: string }];
    expect(tenantId).toBe(TENANT);
    expect(notebookId).toBe(NB);
    expect(turn.ownerUserId).toBe(USER_A);
  });

  it("safety-stop turn (no sources) is owned by the session user", async () => {
    const res = await POST(req({ message: "there is smoke coming from the drive panel", sourceDocIds: [] }), params);
    expect(res.status).toBe(200);
    await frames(res);
    expect(fetch).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
    const turn = (nbMock.recordTurn.mock.calls[0] as unknown[])[2] as { ownerUserId?: string };
    expect(turn.ownerUserId).toBe(USER_A);
  });

  it("grounded abstain (Gate G) is owned by the session user", async () => {
    const res = await POST(req({ message: "Which coil?", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    await frames(res);
    expect(fetch).not.toHaveBeenCalled();
    const turn = (nbMock.recordTurn.mock.calls[0] as unknown[])[2] as { ownerUserId?: string };
    expect(turn.ownerUserId).toBe(USER_A);
  });

  it("grounded answered turn is owned by the session user", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([
      { docId: DOC_A, title: "manual.pdf", sourcePage: 4, sourceUrl: null, content: "Coil K1 resets the drive.", score: 0.9 },
    ]);
    const res = await POST(req({ message: "Which coil?", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    await frames(res);
    expect(fetch).toHaveBeenCalled();
    const turn = (nbMock.recordTurn.mock.calls.at(-1) as unknown[])[2] as { ownerUserId?: string };
    expect(turn.ownerUserId).toBe(USER_A);
  });
});

describe("machine-specific claims need a confirmed, matching asset binding", () => {
  const machineTurn = { message: "what happened around the fault?", sourceDocIds: [], mode: "general", machineEvidence: { assetId: ASSET, anchorAt: FAULT_AT } };

  function historyServed() {
    historyMock.fetchMachineHistory.mockResolvedValue({
      ok: true,
      history: {
        uns_path: UNS,
        anchor: { at: FAULT_AT },
        from: FAULT_AT,
        to: FAULT_AT,
        reason: null,
        summary: {},
        rows: [{ observed_at: FAULT_AT, tag: "run", value: 0 }],
        freshness: { overall: "stale" },
        coverage: { rows: 1 },
      },
    });
  }

  it("unbound notebook: client asset id is ignored — no history fetch, no machine evidence", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
    historyServed();
    const res = await POST(req(machineTurn), params);
    expect(res.status).toBe(200);
    const fr = await frames(res);
    expect(historyMock.fetchMachineHistory).not.toHaveBeenCalled();
    const evidence = fr.find((f) => f.kind === "evidence") as { machineEvidence?: unknown } | undefined;
    expect(evidence?.machineEvidence).toBeUndefined();
  });

  it("bound but NOT technician-confirmed: no history fetch, no machine evidence", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    nbMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved", entityId: ASSET, name: "Conveyor 1", unsPath: UNS, selectedVia: "qr_scan", confirmedAt: null,
    });
    historyServed();
    const res = await POST(req(machineTurn), params);
    expect(res.status).toBe(200);
    const fr = await frames(res);
    expect(historyMock.fetchMachineHistory).not.toHaveBeenCalled();
    const evidence = fr.find((f) => f.kind === "evidence") as { machineEvidence?: unknown } | undefined;
    expect(evidence?.machineEvidence).toBeUndefined();
  });

  it("confirmed binding but the client asked about a DIFFERENT asset: refused, not silently swapped", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    nbMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved", entityId: ASSET, name: "Conveyor 1", unsPath: UNS, selectedVia: "qr_scan", confirmedAt: FAULT_AT,
    });
    historyServed();
    const res = await POST(req({ ...machineTurn, machineEvidence: { assetId: OTHER_ASSET, anchorAt: FAULT_AT } }), params);
    expect(res.status).toBe(200);
    await frames(res);
    expect(historyMock.fetchMachineHistory).not.toHaveBeenCalled();
  });

  it("mismatch disputes the identity for THIS turn: no CONFIRMED identity in the prompt, no asset snapshot persisted", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    nbMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved", entityId: ASSET, name: "Conveyor 1", unsPath: UNS, selectedVia: "qr_scan", confirmedAt: FAULT_AT,
    });
    historyServed();
    const res = await POST(req({ ...machineTurn, machineEvidence: { assetId: OTHER_ASSET, anchorAt: FAULT_AT } }), params);
    expect(res.status).toBe(200);
    await frames(res);
    // The provider saw the dispute, not a confirmed identity.
    expect(seamMock.buildRequestBody).toHaveBeenCalled();
    const messages = (seamMock.buildRequestBody.mock.calls[0] as unknown[])[1] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("DISPUTED");
    expect(system).not.toContain("Identity CONFIRMED");
    // And the turn is not persisted as a record about the bound machine …
    const turn = (nbMock.recordTurn.mock.calls.at(-1) as unknown[])[2] as {
      equipmentEntityId?: string | null;
      evidence: Record<string, unknown>[];
    };
    expect(turn.equipmentEntityId ?? null).toBeNull();
    // … but the dispute itself is durable: reload can say WHY attribution is
    // absent, and a client cannot erase attribution without leaving a trace.
    const dispute = turn.evidence.find((e) => e.kind === "identity_dispute");
    expect(dispute).toMatchObject({ kind: "identity_dispute", requestedAssetId: OTHER_ASSET, boundAssetId: ASSET });
  });

  it("mismatch propagates through the whole answer contract: frame marker, no machine follow-ups, neutral machine context", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Conveyor 1", manufacturer: "Rockwell", model: "PowerFlex 525" });
    nbMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved", entityId: ASSET, name: "Conveyor 1", unsPath: UNS, selectedVia: "qr_scan", confirmedAt: FAULT_AT,
    });
    historyServed();
    const res = await POST(req({ ...machineTurn, machineEvidence: { assetId: OTHER_ASSET, anchorAt: FAULT_AT } }), params);
    expect(res.status).toBe(200);
    const fr = await frames(res);
    const evidence = fr.find((f) => f.kind === "evidence") as { identityDisputed?: boolean } | undefined;
    expect(evidence?.identityDisputed).toBe(true);
    expect(fr.find((f) => f.kind === "followups")).toBeUndefined();
    const messages = (seamMock.buildRequestBody.mock.calls[0] as unknown[])[1] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    // The machine-context header must not present the bound machine as a fact
    // for this question.
    expect(system).not.toMatch(/Equipment: Rockwell PowerFlex 525/);
    expect(system).toContain("DISPUTED");
  });

  it("confirmed AND matching: history is fetched for the BOUND asset", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    nbMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved", entityId: ASSET, name: "Conveyor 1", unsPath: UNS, selectedVia: "qr_scan", confirmedAt: FAULT_AT,
    });
    historyServed();
    const res = await POST(req(machineTurn), params);
    expect(res.status).toBe(200);
    await frames(res);
    expect(historyMock.fetchMachineHistory).toHaveBeenCalledTimes(1);
    const askedAsset = historyMock.fetchMachineHistory.mock.calls[0][2];
    expect(askedAsset).toBe(ASSET);
  });
});
