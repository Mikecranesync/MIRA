/**
 * Notebook chat ↔ bound asset (plan slice I3, migration 081).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * Three things are under test, and the third is the one that would hurt:
 *
 *  1. a resolved binding reaches the model as an explicit identity claim, and
 *     an unconfirmed one is labelled SELECTED rather than presented as fact;
 *  2. every persisted turn — answered, abstained, safety-stopped — carries the
 *     snapshot of which machine it was about;
 *  3. binding an asset must NOT widen retrieval. `retrieveNodeChunks` keeps
 *     `unsPath: null` and exactly the validated doc ids. Passing the bound path
 *     would trigger manual-rag's ltree subtree expansion and silently overrule
 *     the validated doc set, which is the notebook's entire safety model.
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

describe("bound asset reaches the model", () => {
  it("states the canonical name and UNS path for a confirmed binding", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue(RESOLVED_CONFIRMED);
    await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params);

    const prompt = sentPrompt();
    expect(prompt).toContain("Discharge Conveyor");
    expect(prompt).toContain(UNS);
    expect(prompt).toContain("CONFIRMED");
  });

  it("marks an unconfirmed binding as SELECTED, not as fact", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue(RESOLVED_UNCONFIRMED);
    await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params);

    const prompt = sentPrompt();
    // A QR scan proves which sticker was scanned, not which machine wears it.
    expect(prompt).toContain("SELECTED but NOT yet confirmed");
    expect(prompt).not.toContain("Identity CONFIRMED");
  });

  it("says nothing about an asset when the notebook is unbound", async () => {
    await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params);
    const prompt = sentPrompt();
    expect(prompt).not.toContain("canonical path");
    expect(prompt).not.toContain("SELECTED");
  });
});

describe("binding must not widen retrieval", () => {
  it("keeps unsPath null and the exact validated doc set even when fully resolved", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue(RESOLVED_CONFIRMED);
    await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params);

    const call = ragMock.retrieveNodeChunks.mock.calls[0] as unknown as unknown[];
    const opts = call[3] as Record<string, unknown>;
    // Passing the bound path here would trigger manual-rag's ltree subtree
    // expansion and silently overrule the validated doc set.
    expect(opts.unsPath).toBeNull();
    expect(opts.docIds).toEqual([DOC_A]);
    expect(opts.validatedDocScope).toBe(true);
  });
});

describe("turn snapshot", () => {
  it("persists the asset on an answered turn", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue(RESOLVED_CONFIRMED);
    // The answered-path recordTurn runs inside the stream's start(), so the
    // body must be drained before asserting or the spy has not been called yet.
    await (await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params)).text();

    expect(domainMock.recordTurn).toHaveBeenCalledWith(
      expect.any(String),
      NB,
      expect.objectContaining({ equipmentEntityId: ENTITY, assetUnsPath: UNS }),
    );
  });

  it("persists the asset on an ABSTAIN too — a refusal about a machine is still about that machine", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue(RESOLVED_CONFIRMED);
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    await POST(chatReq({ message: "unanswerable", sourceDocIds: [DOC_A] }), params);

    expect(domainMock.recordTurn).toHaveBeenCalledWith(
      expect.any(String),
      NB,
      expect.objectContaining({
        answerStatus: "insufficient_evidence",
        equipmentEntityId: ENTITY,
        assetUnsPath: UNS,
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists the asset on a safety stop", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue(RESOLVED_CONFIRMED);
    await POST(chatReq({ message: "there is smoke coming from the panel", sourceDocIds: [DOC_A] }), params);

    expect(domainMock.recordTurn).toHaveBeenCalledWith(
      expect.any(String),
      NB,
      expect.objectContaining({ equipmentEntityId: ENTITY, assetUnsPath: UNS }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("writes nulls, not undefined, when unbound", async () => {
    await (await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params)).text();
    expect(domainMock.recordTurn).toHaveBeenCalledWith(
      expect.any(String),
      NB,
      expect.objectContaining({ equipmentEntityId: null, assetUnsPath: null }),
    );
  });
});

describe("unresolvable binding fails closed", () => {
  it("422s before retrieval, before the provider, and without persisting a turn", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue({ state: "unresolvable", entityId: ENTITY } as never);
    const res = await POST(chatReq({ message: "what is the baud rate", sourceDocIds: [DOC_A] }), params);

    expect(res.status).toBe(422);
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(domainMock.recordTurn).not.toHaveBeenCalled();
    expect(res.headers.get("Content-Type")).not.toContain("event-stream");
  });

  it("returns a sentence a technician can read, with the token kept in `code`", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue({ state: "unresolvable", entityId: ENTITY } as never);
    const body = await (await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params)).json();

    // mira-mobile renders `data.error` verbatim, so a bare token would reach the
    // phone as the literal string "uns_required".
    expect(body.error).not.toMatch(/_/);
    expect(body.error.length).toBeGreaterThan(20);
    expect(body.code).toBe("uns_required");
    expect(body.entityId).toBe(ENTITY);
  });

  it("never asks the technician to confirm — a direct binding is rejected, not downgraded", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue({ state: "unresolvable", entityId: ENTITY } as never);
    const body = await (await POST(chatReq({ message: "q", sourceDocIds: [DOC_A] }), params)).json();
    expect(String(body.error).toLowerCase()).not.toContain("is that right");
    expect(String(body.error).toLowerCase()).not.toContain("did you mean");
  });
});
