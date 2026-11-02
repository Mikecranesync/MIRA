/**
 * Mission 001 chat consumer: the bound machine's observed state reaches the
 * provider prompt and the evidence frame, is gated by the flag and the bound
 * asset, and never blocks an answer. Provider stubbed; harness copied from
 * src/capabilities/field-observation.route.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const PUMP07 = "cmms-pump07";
const PUMP_B = "cmms-pumpb";
const OBS_ID = "44444444-4444-4444-8444-444444444444";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(),
  recordTurn: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
  claimNotebookTurnRequest: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ status: "claimed", claimToken: "tok" })),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn<(...args: unknown[]) => object>(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

const obsStore = vi.hoisted(() => ({ listProjectionRows: vi.fn() }));
vi.mock("@/capabilities/observations/store", () => obsStore);

import { POST } from "../../../app/api/equipment-notebooks/[id]/chat/route";
import { deriveObservedState, type ObservationRow } from "../project";

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
const QUESTION = "Pump 07 seal is weeping again. What should I check?";

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

function boundTo(entityId: string) {
  return { state: "resolved", entityId, name: "Pump", unsPath: `enterprise.lw.line1.${entityId}`, selectedVia: "manual", confirmedAt: "2026-06-15T09:00:00.000Z" };
}

const ROW: ObservationRow = {
  id: OBS_ID,
  factKey: "seal_leak",
  factValue: "present",
  observedAt: "2026-06-15T13:10:00.000Z",
  recordedAt: "2026-06-15T13:12:00.000Z",
  recordedBy: "tech-alice",
  verificationMethod: "self_reported",
  uncertainty: "unverified",
  supersedesId: null,
};

/** Only the store (DB edge) is replaced; the observation rows are per asset. */
function storeFor(rowsByAsset: Record<string, ObservationRow[]>) {
  obsStore.listProjectionRows.mockImplementation(async (_t: string, entity: string) => ({ rows: rowsByAsset[entity] ?? [], contests: {} }));
}

function systemPrompt(): string {
  const messages = seamMock.buildRequestBody.mock.calls.at(-1)?.[1] as unknown as { role: string; content: string }[];
  return messages.find((m) => m.role === "system")!.content;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.MIRA_OBSERVATION_STATE = "1";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Pump 07" });
  nbMock.resolveBoundAsset.mockResolvedValue(boundTo(PUMP07));
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" });
  ragMock.retrieveNodeChunks.mockResolvedValue([
    { docId: "d1", filename: "pump.pdf", page: 1, content: "Check the mechanical seal faces and flush line." },
  ]);
  storeFor({ [PUMP07]: [ROW] });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("Check the seal faces first."), { status: 200 })));
});

describe("observed state in the chat prompt", () => {
  it("bound to Pump 07 with one stored observation: the section, author, times and verification reach the provider", async () => {
    const res = await POST(req({ message: QUESTION }), params);
    expect(res.status).toBe(200);
    await frames(res);
    const system = systemPrompt();
    expect(system).toContain("Technician-reported observations (unverified; not machine measurements):");
    expect(system).toContain("seal_leak=present");
    expect(system).toContain("by tech-alice");
    expect(system).toContain("observed 2026-06-15T13:10:00.000Z");
    expect(system).toContain("recorded 2026-06-15T13:12:00.000Z");
    expect(system).toContain("verification self_reported");
    expect(system).toContain("Root cause, health and safe-to-operate are NOT established");
    expect(obsStore.listProjectionRows).toHaveBeenCalledWith(TENANT, PUMP07);
  });

  it("an evidence frame carries the observation id and the state_version", async () => {
    const res = await POST(req({ message: QUESTION }), params);
    const evidence = (await frames(res)).find((f) => f.kind === "evidence") as Record<string, unknown> | undefined;
    expect(evidence).toBeDefined();
    const observed = evidence!.observedState as { stateVersion: string; observationIds: string[]; contributorCount: number };
    expect(observed.observationIds).toEqual([OBS_ID]);
    expect(observed.contributorCount).toBe(1);
    expect(observed.stateVersion).toBe(deriveObservedState([ROW], { now: new Date() }).stateVersion);
  });

  // #5097 (Codex #5091 r3 F1): an idempotent replay must carry the SAME provenance as the
  // live answer, from the persisted turn, even if machine state changed before the retry.
  it("idempotent replay returns the persisted observedState, not a recomputed one", async () => {
    const clientRequestId = "8b0d7a5e-3c1f-4a2b-9c4d-5e6f7a8b9c0d";
    const live = await POST(req({ message: QUESTION, clientRequestId }), params);
    expect(live.status).toBe(200);
    const liveObserved = ((await frames(live)).find((f) => f.kind === "evidence") as Record<string, unknown>).observedState;
    expect(liveObserved).toBeDefined();

    const turn = nbMock.recordTurn.mock.calls.at(-1)![2] as {
      answerText: string | null; enabledSourceDocIds: string[]; evidence: unknown[]; model: string | null; basis: string | null;
    };
    expect(turn.evidence).toContainEqual({ kind: "observed_state", ...(liveObserved as object) });

    storeFor({ [PUMP07]: [] }); // state moved on before the retry
    nbMock.claimNotebookTurnRequest.mockResolvedValueOnce({
      status: "replay",
      turn: { id: "turn-1", question: QUESTION, answerStatus: "answered", answerText: turn.answerText,
        enabledSourceDocIds: turn.enabledSourceDocIds, evidence: turn.evidence, model: turn.model, basis: turn.basis },
    });
    const replay = await POST(req({ message: QUESTION, clientRequestId }), params);
    expect(replay.headers.get("X-Idempotent-Replay")).toBe("true");
    const replayed = ((await frames(replay)).find((f) => f.kind === "evidence") as Record<string, unknown>).observedState;
    expect(replayed).toEqual(liveObserved);
  });

  it("a notebook bound to a different asset gets no observed section", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue(boundTo(PUMP_B));
    const res = await POST(req({ message: QUESTION }), params);
    expect(res.status).toBe(200);
    await frames(res);
    expect(systemPrompt()).not.toContain("Technician-reported observations");
    expect(obsStore.listProjectionRows).toHaveBeenCalledWith(TENANT, PUMP_B);
  });

  it("flag off: nothing is loaded and the prompt is byte-identical to the flag-on, zero-observation prompt", async () => {
    storeFor({ [PUMP07]: [ROW] });
    delete process.env.MIRA_OBSERVATION_STATE;
    await frames(await POST(req({ message: QUESTION }), params));
    const flagOff = systemPrompt();
    expect(obsStore.listProjectionRows).not.toHaveBeenCalled();
    expect(flagOff).not.toContain("Technician-reported observations");

    vi.clearAllMocks();
    process.env.MIRA_OBSERVATION_STATE = "1";
    storeFor({});
    nbMock.resolveBoundAsset.mockResolvedValue(boundTo(PUMP07));
    ragMock.retrieveNodeChunks.mockResolvedValue([
      { docId: "d1", filename: "pump.pdf", page: 1, content: "Check the mechanical seal faces and flush line." },
    ]);
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" });
    nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Pump 07" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("Check the seal faces first."), { status: 200 })));
    await frames(await POST(req({ message: QUESTION }), params));
    expect(systemPrompt()).toBe(flagOff);
  });

  it("table missing (42P01): the turn still answers, without the section", async () => {
    obsStore.listProjectionRows.mockRejectedValue(Object.assign(new Error("relation missing"), { code: "42P01" }));
    const res = await POST(req({ message: QUESTION }), params);
    expect(res.status).toBe(200);
    const events = await frames(res);
    expect(events.length).toBeGreaterThan(0);
    expect(systemPrompt()).not.toContain("Technician-reported observations");
  });
});
