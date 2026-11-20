/**
 * TASK-S2 — proves the chat route's sheet-receipt wiring is correctly gated:
 * flag off, or no jobId, or no message ⇒ `withSheetReceipt` is never called
 * and the response is byte-identical to the pre-S2 route. Mocks
 * `withSheetReceipt` itself (receipt.ts's own behavior is covered by
 * `capabilities/living-sheet/__tests__/receipt.test.ts`) so this test is
 * purely about the route's gating logic inside POST.
 *
 * Reuses the mocking harness from `turn-lifecycle.test.ts` (session / nb /
 * manual-rag / db) since POST needs all of them to reach its return
 * statements at all.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const sessionMock = vi.hoisted(() => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/session", () => sessionMock);
const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
  claimNotebookTurnRequest: vi.fn(),
  normalizeNotebookThreadId: (value: unknown) => typeof value === "string" ? value : null,
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);
vi.mock("@/lib/manual-rag", () => ({
  retrieveNodeChunks: vi.fn(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
}));
const client = vi.hoisted(() => ({
  query: vi.fn(async (text: string) => {
    if (/UPDATE decision_traces/.test(text)) return { rows: [{ trace_id: "t1" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(client)),
}));
vi.mock("@/lib/db", () => ({ default: client }));
const retryMock = vi.hoisted(() => ({ readTurnRetry: vi.fn() }));
vi.mock("@/capabilities/turn-recovery/store", () => retryMock);

const withSheetReceiptMock = vi.hoisted(() => vi.fn(async (res: Response, _ctx?: unknown) => res));
vi.mock("@/capabilities/living-sheet/receipt", () => ({ withSheetReceipt: withSheetReceiptMock }));

import { POST } from "../route";

const params = { params: Promise.resolve({ id: NB }) };
function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const ORIGINAL_FLAG = process.env.NOTEBOOK_LIVING_SHEET;
const ORIGINAL_PERSONA = process.env.MIRA_PERSONA_CONTRACT;
beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT, userId: "u1" });
  delete process.env.NOTEBOOK_LIVING_SHEET;
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.MIRA_PERSONA_CONTRACT = "1";
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
});
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.NOTEBOOK_LIVING_SHEET;
  else process.env.NOTEBOOK_LIVING_SHEET = ORIGINAL_FLAG;
  if (ORIGINAL_PERSONA === undefined) delete process.env.MIRA_PERSONA_CONTRACT;
  else process.env.MIRA_PERSONA_CONTRACT = ORIGINAL_PERSONA;
});

describe("sheet-receipt gating in POST", () => {
  it("native round2 F3 checks current membership before the original-job recovery pre-read", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    const id = "44444444-4444-4444-8444-444444444444";
    sessionMock.sessionOr401.mockImplementation(async (options?: { requireCurrentUser?: boolean }) =>
      options?.requireCurrentUser ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : { tenantId: TENANT, userId: "u1" });
    retryMock.readTurnRetry.mockResolvedValue({ body: { message: "Original job question", livingSheetJobId: JOB_ID,
      clientRequestId: id, threadId: "thread", sourceDocIds: [], mode: "general", expectedEquipmentEntityId: null },
      target: { kind: "known", equipmentEntityId: null }, component: null });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "replay", turn: { id, question: "Original job question",
      answerStatus: "answered", answerText: "Saved answer", enabledSourceDocIds: [], evidence: [], model: null, basis: null } });
    const res = await POST(req({ retryRequestId: id, threadId: "thread" }), params);
    expect(res.status).toBe(401);
    expect(retryMock.readTurnRetry).not.toHaveBeenCalled();
    expect(nbMock.claimNotebookTurnRequest).not.toHaveBeenCalled();
    expect(withSheetReceiptMock).not.toHaveBeenCalled();
  });
  it("uses the original request job, text and turn id for a recovery envelope", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    const id = "44444444-4444-4444-8444-444444444444";
    retryMock.readTurnRetry.mockResolvedValue({ body: { message: "Original job question", livingSheetJobId: JOB_ID,
      clientRequestId: id, threadId: "thread", sourceDocIds: [], mode: "general", expectedEquipmentEntityId: null },
      target: { kind: "known", equipmentEntityId: null }, component: null });
    nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "replay", turn: { id, question: "Original job question",
      answerStatus: "answered", answerText: "Saved answer", enabledSourceDocIds: [], evidence: [], model: null, basis: null } });
    const res = await POST(req({ retryRequestId: id, threadId: "thread" }), params);
    await res.text();
    expect(withSheetReceiptMock).toHaveBeenCalledExactlyOnceWith(expect.any(Response), expect.objectContaining({
      tenantId: TENANT, notebookId: NB, jobId: JOB_ID, techText: "Original job question", turnId: id,
    }));
  });
  it("flag off (default) -> withSheetReceipt is never called, response unaffected", async () => {
    const res = await POST(req({ message: "why would a contactor chatter", livingSheetJobId: JOB_ID }), params);
    await res.text();
    expect(withSheetReceiptMock).not.toHaveBeenCalled();
  });

  it("flag on, but no livingSheetJobId -> withSheetReceipt is never called", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    const res = await POST(req({ message: "why would a contactor chatter" }), params);
    await res.text();
    expect(withSheetReceiptMock).not.toHaveBeenCalled();
  });

  it("flag on, jobId present but not a UUID -> withSheetReceipt is never called", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    const res = await POST(req({ message: "why would a contactor chatter", livingSheetJobId: "not-a-uuid" }), params);
    await res.text();
    expect(withSheetReceiptMock).not.toHaveBeenCalled();
  });

  it("flag on, valid jobId, but empty message -> withSheetReceipt is never called", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    const res = await POST(req({ message: "   ", livingSheetJobId: JOB_ID }), params);
    await res.text();
    expect(withSheetReceiptMock).not.toHaveBeenCalled();
  });

  it("flag on, valid jobId, non-empty message -> withSheetReceipt IS called with the tenant from sessionOr401 (never the body)", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    const res = await POST(
      req({ message: "why would a contactor chatter", livingSheetJobId: JOB_ID, tenantId: "attacker-supplied" }),
      params,
    );
    await res.text();
    expect(withSheetReceiptMock).toHaveBeenCalledTimes(1);
    const ctx = withSheetReceiptMock.mock.calls[0]![1];
    expect(ctx).toMatchObject({ tenantId: TENANT, notebookId: NB, jobId: JOB_ID, techText: "why would a contactor chatter" });
  });

  it("a malformed JSON body never breaks the turn -> withSheetReceipt is never called, route still answers", async () => {
    const malformed = new NextRequest("http://test/api/equipment-notebooks/x/chat", {
      method: "POST",
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    });
    // The route's own body parsing (handleChatTurn) governs the actual outcome;
    // this only proves our defensive req.clone().json() never throws out of POST.
    await expect(POST(malformed, params)).resolves.toBeInstanceOf(Response);
    expect(withSheetReceiptMock).not.toHaveBeenCalled();
  });
});
