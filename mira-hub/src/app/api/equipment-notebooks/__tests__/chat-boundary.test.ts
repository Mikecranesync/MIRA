/**
 * Equipment Notebook chat — retrieval-boundary contract (PRD §12, §29.2).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * The rules under test:
 *  - a doc id outside the notebook (sibling notebook, other tenant, rejected
 *    source, or garbage) is rejected BEFORE retrieval — 4xx, no SQL retrieval,
 *    no provider call;
 *  - "no sources selected" is an explicit 422, never a silent global-corpus
 *    fall-through;
 *  - zero retrieved evidence → structured insufficient_evidence frame, the
 *    provider is NEVER called, and the turn is persisted with that status;
 *  - a grounded turn passes the validated doc set to retrieveNodeChunks as
 *    `docIds` (SQL-level enforcement) and persists the source snapshot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const contextMock = vi.hoisted(() => ({
  requestContextOr401: vi.fn(async () => ({
    tenantId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    authKind: "session" as "session" | "service",
    sourceChannel: null as "telegram" | "slack" | "hub" | "mobile" | null,
  })),
}));
vi.mock("@/lib/service-request-context", () => contextMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  recordTurn: vi.fn(async () => undefined),
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

function chatReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: NB }) };

async function readFrames(res: Response): Promise<string[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter(Boolean);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn()); // any provider call in a boundary test = failure
});

describe("chat boundary", () => {
  it("accepts service auth through the same tenant-scoped source gate", async () => {
    contextMock.requestContextOr401.mockResolvedValueOnce({
      tenantId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      authKind: "service",
      sourceChannel: "telegram",
    });
    domainMock.validateChatSources.mockResolvedValue({
      ok: false,
      error: "notebook_not_found",
    });
    const res = await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(404);
    expect(domainMock.validateChatSources).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      NB,
      [DOC_A],
    );
  });

  it("rejects a doc id that is not in the notebook (sibling/foreign) with 403 and no retrieval", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: false, error: "source_not_in_notebook" });
    const res = await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(403);
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects empty source selection with 422 (no silent global fallback)", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const res = await POST(chatReq({ message: "q", sourceDocIds: [] }), params);
    expect(res.status).toBe(422);
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });

  it("404s an unknown notebook without leaking existence", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: false, error: "notebook_not_found" });
    const res = await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(404);
  });

  it("abstains with structured insufficient_evidence on zero chunks — provider never called, turn persisted", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const res = await POST(chatReq({ message: "unanswerable", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    const frames = await readFrames(res);
    expect(frames.some((f) => f.includes('"insufficient_evidence"'))).toBe(true);
    expect(frames.at(-1)).toBe("[DONE]");
    expect(fetch).not.toHaveBeenCalled();
    expect(domainMock.recordTurn).toHaveBeenCalledWith(
      expect.any(String),
      NB,
      expect.objectContaining({
        answerStatus: "insufficient_evidence",
        enabledSourceDocIds: [DOC_A],
        evidence: [],
      }),
    );
  });

  it("passes the VALIDATED doc set to retrieval as docIds (SQL-enforced allowed set)", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params);
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "q",
      expect.objectContaining({ docIds: [DOC_A] }),
    );
  });

  it("rejects a missing message", async () => {
    const res = await POST(chatReq({ sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(400);
  });
});
