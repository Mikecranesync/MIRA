/**
 * Equipment Notebook chat — server-owned admission (Workstream A, PRD §6.4/§7.2).
 *
 * Run: cd mira-hub && npx vitest run src/app/api/equipment-notebooks/__tests__/chat-approved-source-scope
 *
 * The route must hand retrieval the approved set that validateChatSources
 * DERIVED (tenant-owned, notebook-linked, enabled, user_confirmed/verified,
 * not superseded) — never the ids the client asked for. A remap (#3477 shape:
 * requested DOC_A, derived DOC_B) makes the two sets differ, so the test can
 * tell authority from echo.
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
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));

const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

import { POST } from "../[id]/chat/route";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const DOC_B = "44444444-4444-4444-8444-444444444444";

function chatReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("chat route — approvedSourceDocIds is the server-derived set", () => {
  it("passes validateChatSources' derived docIds as approvedSourceDocIds (not the client's request)", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_B], nodeId: "n1" });
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    expect(domainMock.validateChatSources).toHaveBeenCalledWith(expect.any(String), NB, [DOC_A]);
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "q",
      expect.objectContaining({
        docIds: [DOC_B],
        approvedSourceDocIds: [DOC_B],
        validatedDocScope: true,
      }),
    );
    const opts = (ragMock.retrieveNodeChunks.mock.calls[0] as unknown[])[3] as {
      approvedSourceDocIds: string[];
    };
    expect(opts.approvedSourceDocIds).not.toContain(DOC_A);
  });

  it("never reaches retrieval (and so never derives an approved set) when validation refuses", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: false, error: "source_not_in_notebook" });
    const res = await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(403);
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });
});
