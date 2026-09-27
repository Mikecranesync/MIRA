/**
 * Plant memory (migration 095): a fix a technician recorded on this notebook
 * reaches the model as technician-confirmed MACHINE CONTEXT, and its absence
 * or a read failure leaves the turn exactly as before (fail-open).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  recordTurn: vi.fn(async () => undefined),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({ manufacturer: "Automation Direct", model: "GS10", displayName: "Bench rig" })),
  listSources: vi.fn(async () => [{ filename: "Conv_Simple_Anomaly_Catalog.pdf" }]),
  // 085: chat citations resolve canonical origin server-side
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn(() => "excerpts"),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

const fixMock = vi.hoisted(() => ({ listFixRecords: vi.fn(async () => [] as unknown[]) }));
vi.mock("@/capabilities/fix-records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/fix-records")>()),
  listFixRecords: fixMock.listFixRecords,
}));

import { POST } from "../[id]/chat/route";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const ENTITY = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const UNS = "enterprise.home_garage.conveyor_lab.conveyor_1";

const RESOLVED_CONFIRMED = {
  state: "resolved" as const,
  entityId: ENTITY,
  name: "Discharge Conveyor",
  unsPath: UNS,
  selectedVia: "qr" as const,
  confirmedAt: "2026-08-23T10:00:00Z",
};
const RESOLVED_UNCONFIRMED = { ...RESOLVED_CONFIRMED, confirmedAt: null };

function chatReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

/** One retrieved chunk, so the turn reaches the provider path. */
const CHUNK = { docId: DOC_A, filename: "cat.pdf", page: 2, content: "di05_photoeye returns ILLEGAL DATA ADDRESS." };

function stubProvider() {
  const body = [
    'data: {"choices":[{"delta":{"content":"Answer [1]."},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
  );
}

/** The prompt text actually handed to the provider. */
function sentPrompt(): string {
  const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
  return JSON.stringify(JSON.parse(String((call[1] as { body: string }).body)).messages);
}

beforeEach(() => {
  vi.clearAllMocks();
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
  domainMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
  process.env.GROQ_API_KEY = "test-key";
  stubProvider();
});

const FIX = {
  id: "44444444-4444-4444-8444-444444444444",
  notebookId: NB,
  equipmentEntityId: null,
  symptom: "E.oC trips on accel",
  faultCode: "oC",
  fix: "Raised P1.01 accel time to 8 s; trips stopped",
  recordedBy: "u1",
  createdAt: "2026-09-20T14:00:00Z",
};

describe("recorded fixes reach the model", () => {
  it("adds technician-recorded fixes to MACHINE CONTEXT", async () => {
    fixMock.listFixRecords.mockResolvedValueOnce([FIX]);
    const res = await POST(chatReq({ message: "it trips oC on accel", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    await res.text();
    const prompt = sentPrompt();
    expect(prompt).toContain("RECORDED FIXES ON THIS MACHINE");
    expect(prompt).toContain("Raised P1.01 accel time to 8 s");
    expect(prompt).toContain("2026-09-20");
    expect(fixMock.listFixRecords).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", NB, 3);
  });

  it("leaves the prompt without a fixes block when none are recorded", async () => {
    const res = await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params);
    await res.text();
    expect(sentPrompt()).not.toContain("RECORDED FIXES");
  });

  it("fails open when the fix store cannot be read", async () => {
    fixMock.listFixRecords.mockRejectedValueOnce(new Error('relation "asset_fix_records" does not exist'));
    const res = await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(sentPrompt()).not.toContain("RECORDED FIXES");
  });
});
