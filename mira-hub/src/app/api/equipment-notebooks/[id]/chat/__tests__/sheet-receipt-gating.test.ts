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
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));
const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
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
