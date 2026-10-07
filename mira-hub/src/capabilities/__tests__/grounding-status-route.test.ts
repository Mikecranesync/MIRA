/**
 * F004 contract v2, milestone M1 (PR #4303): the notebook chat route records a
 * turn's retrieval status and citation status separately, shows them only to a
 * client that declares `grounding_status_v1` while the flag is on, keeps live =
 * saved = replay, and validates the explicit general-guidance link.
 *
 * Lives under capabilities/ (not next to the route) because test files under
 * mira-hub/src/app/** are guarded legacy paths (tools/ui_surface_lifecycle_guard.py).
 *
 * Run: cd mira-hub && ./node_modules/.bin/vitest run src/capabilities/__tests__/grounding-status-route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const FAILED_TURN = "55555555-5555-4555-8555-555555555555";
const REQ_ID = "66666666-6666-4666-8666-666666666666";
const CAPS = ["grounding_status_v1"];

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  recordTurn: vi.fn(async () => "row-1"),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Line 1 drive",
    manufacturer: "Allen-Bradley",
    model: "525",
  })),
  listSources: vi.fn(async () => [{ filename: "520-UM001.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
  getFallbackSourceTurn: vi.fn(),
  claimNotebookTurnRequest: vi.fn(),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  listTurns: vi.fn(async () => [] as unknown[]),
  listThreads: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null),
  deleteNotebook: vi.fn(),
  updateNotebook: vi.fn(),
  NotebookNotFoundError: class NotebookNotFoundError extends Error {},
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
  listFilesForTarget: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/workspace-files", () => filesMock);

vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>()),
  currentManualSearchStatus: vi.fn(async () => null),
}));

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

const persistMock = vi.hoisted(() => ({
  persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "trace-1" })),
}));
vi.mock("@/lib/inference/persist-usage", () => persistMock);

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { GET } from "@/app/api/equipment-notebooks/[id]/route";
import { chatBodyFor, detailQueryFor, generalGuidanceRequest } from "@/factorylm-ui/hub-host-logic";
import { threadFromPersisted } from "@/factorylm-ui/to-interaction";
import { groundingStatusLine } from "../../../../packages/factorylm-ui/src/grounding-status";

const chatReq = (body: unknown, init: { signal?: AbortSignal } = {}) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...(init.signal ? { signal: init.signal } : {}),
  });
const params = { params: Promise.resolve({ id: NB }) };
const getReq = (query: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(query) } }) as unknown as NextRequest;

type Frame = Record<string, unknown>;
function parseFrames(text: string): Frame[] {
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => JSON.parse(l) as Frame);
}
const groundingFrame = (frames: Frame[]) => frames.find((f) => f.kind === "grounding_status");
/** Frames with per-request random ids removed, for byte-identity comparisons. */
const comparable = (frames: Frame[]) => frames.filter((f) => f.kind !== "trace");

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;
function completingProvider(text: string): Response {
  const chunks = [
    ...text.split(" ").map((w) => delta(w + " ")),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200 },
  );
}
function hangingProvider(head: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const w of head) c.enqueue(enc.encode(delta(w)));
    },
  });
  return new Response(body, { status: 200 });
}

const Q = "What does fault F004 mean on this drive";
const F004_CHUNK = {
  docId: DOC_A, manufacturer: "Allen-Bradley", modelNumber: "525", sourceUrl: "node:525-manual", sourcePage: 167,
  content: "F004 UnderVoltage. DC bus voltage fell below the minimum value.",
};
const F012_CHUNK = {
  docId: DOC_A, manufacturer: "Allen-Bradley", modelNumber: "525", sourceUrl: "node:525-manual", sourcePage: 171,
  content: "F012 HW OverCurrent. The drive output current exceeded the hardware limit.",
};

function recorded(): Record<string, unknown> {
  const calls = domainMock.recordTurn.mock.calls as unknown as unknown[][];
  return calls[calls.length - 1]?.[2] as Record<string, unknown>;
}
const savedGrounding = () => (recorded().evidence as Frame[]).find((e) => e.kind === "grounding_status");

async function ask(body: Record<string, unknown>, answer: string | null) {
  const fetchMock = vi.fn(async () => completingProvider(answer ?? "unused"));
  vi.stubGlobal("fetch", fetchMock);
  const frames = parseFrames(await (await POST(chatReq({ message: Q, sourceDocIds: [DOC_A], ...body }), params)).text());
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
  return { frames, fetchMock };
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "k1";
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  delete process.env.MIRA_CANONICAL_SEAM;
  delete process.env.NOTEBOOK_ANSWER_GATE;
  // Pinned, never inherited (prove-the-test-fails rule 6).
  delete process.env.MIRA_TENANT_ID;
  process.env.NOTEBOOK_GROUNDING_STATUS_ENABLED = "1";
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  domainMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" } as never);
  domainMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: "tok" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue([F004_CHUNK] as never);
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe("F004 v2 M1 — outcomes on the main path (flag on, capability declared)", () => {
  it("T1 cited relevant passage → citation linked, manualCited, no fallback action", async () => {
    const { frames } = await ask({ clientCapabilities: CAPS }, "F004 is an UnderVoltage fault: the DC bus fell below its minimum [1].");
    const g = groundingFrame(frames);
    expect(g).toMatchObject({
      kind: "grounding_status",
      v: 1,
      outcome: "answered_citation_linked",
      retrieval: { status: "passages_found", passageCount: 1, returnedDocIds: [DOC_A], scopeDocIds: [DOC_A] },
      citation: { status: "linked", linkedDocIds: [DOC_A], unresolvedMarkerCount: 0 },
      manualCited: true,
      fallback: { offered: false },
    });
    // emitted just before status
    const kinds = frames.map((f) => f.kind);
    expect(kinds.indexOf("grounding_status")).toBe(kinds.indexOf("status") - 1);
  });

  it("T2 passages retrieved, answer uncited → uncited + offered; basis unchanged; agrees with DOCUMENTS_IN_CONTEXT_UNCITED", async () => {
    const log = vi.spyOn(console, "log");
    const { frames } = await ask({ clientCapabilities: CAPS }, "F004 is an UnderVoltage fault; check the incoming line voltage.");
    expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toMatchObject({ basis: "general_reasoning" });
    expect(groundingFrame(frames)).toMatchObject({
      outcome: "answered_uncited_with_passages",
      retrieval: { status: "passages_found", passageCount: 1 },
      citation: { status: "uncited", linkedDocIds: [] },
      manualCited: false,
      fallback: { offered: true },
    });
    await vi.waitFor(() =>
      expect(log.mock.calls.some((c) => String(c[0]).includes("DOCUMENTS_IN_CONTEXT_UNCITED"))).toBe(true),
    );
  });

  it("T3 irrelevant passage (F012 for an F004 question), answer uncited → still uncited, not cited", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([F012_CHUNK] as never);
    const { frames } = await ask({ clientCapabilities: CAPS }, "F004 usually means undervoltage on many drives.");
    expect(groundingFrame(frames)).toMatchObject({ outcome: "answered_uncited_with_passages", manualCited: false });
  });

  it("T3b LIMIT PIN: an irrelevant passage cited with [1] reads as 'linked' — linked never means 'supports'", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([F012_CHUNK] as never);
    const { frames } = await ask({ clientCapabilities: CAPS }, "F004 means overcurrent [1].");
    expect(groundingFrame(frames)).toMatchObject({ outcome: "answered_citation_linked", citation: { status: "linked" } });
  });

  it("T3c a marker that resolves to no retrieved passage is counted, not shipped", async () => {
    const { frames } = await ask({ clientCapabilities: CAPS }, "F004 is an UnderVoltage fault [7].");
    expect(groundingFrame(frames)).toMatchObject({
      outcome: "answered_uncited_with_passages",
      citation: { status: "uncited", unresolvedMarkerCount: 1 },
    });
    expect((frames.find((f) => f.kind === "sources") as { citations: unknown[] }).citations).toHaveLength(0);
  });

  it("T4 refusal with passages → refused + offered; the status line never says 'Not found'", async () => {
    const { frames } = await ask({ clientCapabilities: CAPS }, "The provided excerpts do not contain information about fault F004 on this drive.");
    expect(groundingFrame(frames)).toMatchObject({
      outcome: "refused_with_passages",
      retrieval: { status: "passages_found" },
      citation: { status: "refused" },
      manualCited: false,
      fallback: { offered: true },
    });
    const status = frames.find((f) => f.kind === "status") as { status: string; message: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toBe("I couldn't answer that from the selected sources.");
    expect(status.message).not.toMatch(/not found/i);
  });

  it("T4 control: an undeclared client still gets today's refusal message", async () => {
    const { frames } = await ask({}, "The provided excerpts do not contain information about fault F004 on this drive.");
    expect((frames.find((f) => f.kind === "status") as { message: string }).message).toBe("Not found in the selected sources.");
  });

  it("T4b no passages in scope → abstained_no_passages, no provider call, saved through the abstain path, sent before status", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    const { frames, fetchMock } = await ask({ clientCapabilities: CAPS }, null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recorded()).toMatchObject({ answerStatus: "insufficient_evidence", model: null });
    expect(savedGrounding()).toMatchObject({
      outcome: "abstained_no_passages",
      retrieval: { status: "no_passages", passageCount: 0 },
      citation: { status: "not_applicable" },
      fallback: { offered: true },
    });
    const kinds = frames.map((f) => f.kind);
    expect(kinds.indexOf("grounding_status")).toBe(kinds.indexOf("status") - 1);
  });

  it("T4b bound notebook: the abstention is kept — no general-guidance action is offered", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue({ state: "resolved", entityId: "e1", unsPath: "enterprise.a.b" } as never);
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    await ask({ clientCapabilities: CAPS }, null);
    expect(savedGrounding()).toMatchObject({ fallback: { offered: false } });
  });

  it("T13 provenance: scope ids come from the server-validated list, never the request body", async () => {
    // Request asks for a second, valid-looking UUID (another tenant's or another
    // notebook's document) plus junk; the server authorizes only DOC_A.
    const DOC_FOREIGN = "99999999-9999-4999-8999-999999999999";
    const requested = [DOC_A, DOC_FOREIGN, "not-a-uuid"];
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
    const { frames } = await ask(
      { clientCapabilities: CAPS, sourceDocIds: requested },
      "F004 is an UnderVoltage fault: the DC bus fell below its minimum [1].",
    );
    // Precondition: the request list really differed and reached the validator.
    expect(domainMock.validateChatSources).toHaveBeenCalledWith(TENANT_A, NB, requested);
    // Retrieval was scoped to the authorized list only.
    const retrievalOpts = (ragMock.retrieveNodeChunks.mock.calls[0] as unknown[])[3] as Record<string, unknown>;
    expect(retrievalOpts.approvedSourceDocIds).toEqual([DOC_A]);
    // Live and saved status record only the authorized list.
    for (const g of [groundingFrame(frames), savedGrounding()]) {
      expect(g).toMatchObject({
        outcome: "answered_citation_linked",
        retrieval: { scopeDocIds: [DOC_A], returnedDocIds: [DOC_A] },
        citation: { linkedDocIds: [DOC_A] },
        droppedRefCount: 0,
      });
      expect(JSON.stringify(g)).not.toContain(DOC_FOREIGN);
      expect(JSON.stringify(g)).not.toContain("not-a-uuid");
    }
  });

  it("T5 notebook retrieval throws → no saved turn, no provider call (the recovery gap stays visible)", async () => {
    ragMock.retrieveNodeChunks.mockRejectedValue(new Error("db down") as never);
    const fetchMock = vi.fn(async () => completingProvider("x"));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await POST(chatReq({ message: Q, sourceDocIds: [DOC_A], clientCapabilities: CAPS }), params).then(
      (r) => r.status,
      () => "threw",
    );
    expect(outcome === "threw" || (typeof outcome === "number" && outcome >= 500)).toBe(true);
    expect(domainMock.recordTurn).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T6 client stop → stopped, saved, never offered", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    vi.stubGlobal("fetch", vi.fn(async () => hangingProvider(["Check ", "the "])));
    const ac = new AbortController();
    const res = await POST(chatReq({ message: Q, sourceDocIds: [DOC_A], clientCapabilities: CAPS }, { signal: ac.signal }), params);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let received = "";
    while (!received.includes("the ")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += dec.decode(value, { stream: true });
    }
    ac.abort();
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    expect(recorded()).toMatchObject({ answerStatus: "error" });
    expect(savedGrounding()).toMatchObject({
      outcome: "stopped",
      citation: { status: "not_applicable" },
      manualCited: false,
      fallback: { offered: false },
    });
  });
});

describe("F004 v2 M1 — explicit general guidance, ownership-checked (§5)", () => {
  const offeredRow = {
    id: FAILED_TURN,
    evidence: [{ kind: "grounding_status", v: 1, outcome: "refused_with_passages", fallback: { offered: true } }],
  };

  it("T8 a valid link → general answer, retrieval not attempted, saved with fallback.of; the failed turn is not written", async () => {
    // An unidentified notebook: no manufacturer, so general mode searches nothing.
    domainMock.getNotebook.mockResolvedValueOnce({ id: NB, displayName: "Scratch" } as never);
    domainMock.getFallbackSourceTurn.mockResolvedValue(offeredRow as never);
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
    const { frames } = await ask(
      { sourceDocIds: [], mode: "general", fallbackOf: FAILED_TURN, clientCapabilities: CAPS },
      "Check the incoming supply voltage and the wiring to the drive.",
    );
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(groundingFrame(frames)).toMatchObject({
      outcome: "answered_without_manual",
      retrieval: { status: "not_attempted", notAttemptedReason: "general_mode" },
      manualCited: false,
      fallback: { offered: false, of: FAILED_TURN },
    });
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
  });

  it("T8c a link sent as the failed turn's REQUEST id is saved as the canonical row id the lookup returned", async () => {
    domainMock.getNotebook.mockResolvedValueOnce({ id: NB, displayName: "Scratch" } as never);
    domainMock.getFallbackSourceTurn.mockResolvedValue(offeredRow as never);
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
    const { frames } = await ask(
      { sourceDocIds: [], mode: "general", fallbackOf: REQ_ID, clientCapabilities: CAPS },
      "Check the incoming supply voltage and the wiring to the drive.",
    );
    // Precondition: the lookup received the request id the client sent.
    expect(domainMock.getFallbackSourceTurn).toHaveBeenCalledWith(TENANT_A, NB, expect.objectContaining({ turnId: REQ_ID }));
    for (const g of [groundingFrame(frames), savedGrounding()]) {
      expect(g).toMatchObject({ fallback: { of: FAILED_TURN } });
      expect(JSON.stringify(g)).not.toContain(REQ_ID);
    }
  });

  it("T8b a general answer that asserts a code's meaning is withheld by the existing gate → refused_without_passages, never manualCited", async () => {
    domainMock.getNotebook.mockResolvedValueOnce({ id: NB, displayName: "Scratch" } as never);
    domainMock.getFallbackSourceTurn.mockResolvedValue(offeredRow as never);
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
    const { frames } = await ask(
      { sourceDocIds: [], mode: "general", fallbackOf: FAILED_TURN, clientCapabilities: CAPS },
      "F004 usually indicates an undervoltage condition.",
    );
    expect(groundingFrame(frames)).toMatchObject({
      outcome: "refused_without_passages",
      retrieval: { status: "not_attempted", notAttemptedReason: "general_mode" },
      manualCited: false,
      fallback: { offered: false, of: FAILED_TURN },
    });
  });

  it("T7 the lookup is scoped by the SESSION tenant, notebook, owner and thread — never body values", async () => {
    domainMock.getFallbackSourceTurn.mockResolvedValue(offeredRow as never);
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
    await ask(
      { sourceDocIds: [], mode: "general", fallbackOf: FAILED_TURN, threadId: "thrd-1", clientCapabilities: CAPS, tenantId: "99999999-9999-4999-8999-999999999999", ownerUserId: "someone-else" },
      "General answer.",
    );
    expect(domainMock.getFallbackSourceTurn).toHaveBeenCalledWith(TENANT_A, NB, {
      ownerUserId: "u1",
      threadId: "thrd-1",
      turnId: FAILED_TURN,
    });
  });

  const rejected: [string, () => void, Record<string, unknown>][] = [
    ["another tenant/notebook/owner/thread or a legacy row (lookup finds nothing)", () => domainMock.getFallbackSourceTurn.mockResolvedValue(null as never), {}],
    ["a turn that never offered the action", () => domainMock.getFallbackSourceTurn.mockResolvedValue({ id: FAILED_TURN, evidence: [{ kind: "grounding_status", fallback: { offered: false } }] } as never), {}],
    ["a legacy turn with no status entry", () => domainMock.getFallbackSourceTurn.mockResolvedValue({ id: FAILED_TURN, evidence: [] } as never), {}],
    ["a request that is not general mode", () => domainMock.getFallbackSourceTurn.mockResolvedValue(offeredRow as never), { mode: undefined }],
    ["a malformed id", () => domainMock.getFallbackSourceTurn.mockResolvedValue(offeredRow as never), { fallbackOf: "not-a-uuid" }],
  ];
  for (const [name, arrange, override] of rejected) {
    it(`T7 rejects ${name}: 400 fallback_of_invalid, no claim, retrieval or provider call`, async () => {
      arrange();
      const fetchMock = vi.fn(async () => completingProvider("x"));
      vi.stubGlobal("fetch", fetchMock);
      const res = await POST(
        chatReq({ message: Q, sourceDocIds: [], mode: "general", fallbackOf: FAILED_TURN, clientRequestId: REQ_ID, clientCapabilities: CAPS, ...override }),
        params,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "fallback_of_invalid" });
      expect(domainMock.claimNotebookTurnRequest).not.toHaveBeenCalled();
      expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(domainMock.recordTurn).not.toHaveBeenCalled();
    });
  }

  it("T7 a failed ownership lookup fails closed with 503, not a general answer", async () => {
    domainMock.getFallbackSourceTurn.mockRejectedValue(new Error("db down") as never);
    const fetchMock = vi.fn(async () => completingProvider("x"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(chatReq({ message: Q, sourceDocIds: [], mode: "general", fallbackOf: FAILED_TURN, clientCapabilities: CAPS }), params);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T7/T11 control: with the flag OFF, fallbackOf is ignored exactly as today (no lookup, no 400)", async () => {
    process.env.NOTEBOOK_GROUNDING_STATUS_ENABLED = "0";
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
    const { frames } = await ask({ sourceDocIds: [], mode: "general", fallbackOf: "not-a-uuid", clientCapabilities: CAPS }, "General answer.");
    expect(domainMock.getFallbackSourceTurn).not.toHaveBeenCalled();
    expect(frames.find((f) => f.kind === "status")).toMatchObject({ status: "answered" });
  });
});

describe("F004 v2 M1 — live = saved = replay, old clients, flag off, legacy turns", () => {
  const scenarios: [string, string | null, unknown[]][] = [
    ["cited", "F004 is an UnderVoltage fault [1].", [F004_CHUNK]],
    ["uncited", "F004 is an UnderVoltage fault.", [F004_CHUNK]],
    ["refused", "The provided excerpts do not contain information about fault F004 on this drive.", [F004_CHUNK]],
    ["abstained", null, []],
  ];
  for (const [name, answer, chunks] of scenarios) {
    it(`T9 ${name}: the live frame, the saved entry and the replayed frame are the same object`, async () => {
      ragMock.retrieveNodeChunks.mockResolvedValue(chunks as never);
      const { frames } = await ask({ clientRequestId: REQ_ID, clientCapabilities: CAPS }, answer);
      const live = groundingFrame(frames);
      const saved = savedGrounding();
      expect(live).toBeDefined();
      expect(live).toEqual(saved);

      const turn = recorded();
      domainMock.claimNotebookTurnRequest.mockResolvedValue({
        status: "replay",
        turn: {
          id: "row-1",
          question: Q,
          answerStatus: turn.answerStatus,
          answerText: turn.answerText,
          enabledSourceDocIds: turn.enabledSourceDocIds,
          evidence: turn.evidence,
          basis: turn.basis ?? null,
        },
      } as never);
      // Retry with the same body — replay must NOT rebuild the entry.
      ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
      const replayed = parseFrames(
        await (await POST(chatReq({ message: Q, sourceDocIds: [DOC_A], clientRequestId: REQ_ID, clientCapabilities: CAPS }), params)).text(),
      );
      expect(groundingFrame(replayed)).toEqual(saved);
    });
  }

  it("T10 old client (flag on, no capability): live output identical to flag-off; entry still saved; history strips it", async () => {
    const answer = "F004 is an UnderVoltage fault.";
    const undeclared = await ask({}, answer);
    const savedEvidence = recorded().evidence as Frame[];
    expect(groundingFrame(undeclared.frames)).toBeUndefined();
    expect(savedEvidence.some((e) => e.kind === "grounding_status")).toBe(true);

    vi.clearAllMocks();
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
    ragMock.retrieveNodeChunks.mockResolvedValue([F004_CHUNK] as never);
    process.env.NOTEBOOK_GROUNDING_STATUS_ENABLED = "0";
    const off = await ask({}, answer);
    expect(comparable(undeclared.frames)).toEqual(comparable(off.frames));

    process.env.NOTEBOOK_GROUNDING_STATUS_ENABLED = "1";
    domainMock.listTurns.mockResolvedValue([{ id: "row-1", evidence: savedEvidence }] as never);
    const plain = (await (await GET(getReq(""), params)).json()) as { turns: { evidence: Frame[] }[] };
    expect(plain.turns[0].evidence.some((e) => e.kind === "grounding_status")).toBe(false);
    const declared = (await (await GET(getReq("caps=grounding_status_v1"), params)).json()) as { turns: { evidence: Frame[] }[] };
    expect(declared.turns[0].evidence.some((e) => e.kind === "grounding_status")).toBe(true);
  });

  it("T10 old client replay: a stored entry is never re-emitted to a request without the capability", async () => {
    domainMock.claimNotebookTurnRequest.mockResolvedValue({
      status: "replay",
      turn: { id: "row-1", question: Q, answerStatus: "answered", answerText: "x", enabledSourceDocIds: [DOC_A], evidence: [{ kind: "grounding_status", v: 1, outcome: "answered_uncited_with_passages" }], basis: "general_reasoning" },
    } as never);
    const frames = parseFrames(await (await POST(chatReq({ message: Q, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }), params)).text());
    expect(groundingFrame(frames)).toBeUndefined();
  });

  it("T11 flag off: nothing saved, nothing sent, nothing shown — even to a declaring client", async () => {
    process.env.NOTEBOOK_GROUNDING_STATUS_ENABLED = "0";
    const { frames } = await ask({ clientCapabilities: CAPS }, "The provided excerpts do not contain information about fault F004 on this drive.");
    expect(groundingFrame(frames)).toBeUndefined();
    expect((recorded().evidence as Frame[]).some((e) => e.kind === "grounding_status")).toBe(false);
    expect((frames.find((f) => f.kind === "status") as { message: string }).message).toBe("Not found in the selected sources.");
    domainMock.listTurns.mockResolvedValue([{ id: "row-1", evidence: [{ kind: "grounding_status", v: 1 }] }] as never);
    const body = (await (await GET(getReq("caps=grounding_status_v1"), params)).json()) as { turns: { evidence: Frame[] }[] };
    expect(body.turns[0].evidence).toEqual([]);
  });

  it("T11 the real default — flag UNSET — saves, sends and shows nothing", async () => {
    delete process.env.NOTEBOOK_GROUNDING_STATUS_ENABLED;
    expect(process.env.NOTEBOOK_GROUNDING_STATUS_ENABLED).toBeUndefined();
    const { frames } = await ask({ clientCapabilities: CAPS }, "F004 is an UnderVoltage fault.");
    expect(groundingFrame(frames)).toBeUndefined();
    expect((recorded().evidence as Frame[]).some((e) => e.kind === "grounding_status")).toBe(false);
  });

  it("T12 legacy turn (no entry): history and replay are unchanged and never claim a citation", async () => {
    const legacy = [{ citationId: "1", docId: DOC_A, page: 3 }];
    domainMock.listTurns.mockResolvedValue([{ id: "row-0", evidence: legacy }] as never);
    const body = (await (await GET(getReq("caps=grounding_status_v1"), params)).json()) as { turns: { evidence: unknown[] }[] };
    expect(body.turns[0].evidence).toEqual(legacy);
    domainMock.claimNotebookTurnRequest.mockResolvedValue({
      status: "replay",
      turn: { id: "row-0", question: Q, answerStatus: "answered", answerText: "x [1]", enabledSourceDocIds: [DOC_A], evidence: legacy, basis: "oem_documentation" },
    } as never);
    const frames = parseFrames(
      await (await POST(chatReq({ message: Q, sourceDocIds: [DOC_A], clientRequestId: REQ_ID, clientCapabilities: CAPS }), params)).text(),
    );
    expect(groundingFrame(frames)).toBeUndefined();
  });
});

// End-to-end through the REAL server route and the REAL Hub client code (only
// the database and the model are faked): the body the Hub builds → the route →
// the saved row → the history GET → the shell parts → the explicit tap → the
// linked general turn → reload. Proves the two halves speak one contract.
describe("F004 M2 round trip — Hub client ↔ server (#4303)", () => {
  const ROW = "77777777-7777-4777-8777-777777777777";
  const SEL = { notebookId: NB, threadId: "legacy" };
  const META = { notebookId: NB, title: "Line 1 drive", identityConfirmed: false, capturedAt: "2026-10-07T00:00:00.000Z" };
  const REFUSAL = "The provided excerpts do not contain information about fault F004 on this drive.";
  const GENERAL = "Check the incoming supply voltage and the wiring to the drive.";
  type Row = { id: string; question: string; answerStatus: string; answerText: string | null; evidence: unknown[]; basis: string | null };
  const savedRow = (id: string): Row => {
    const r = recorded();
    return {
      id,
      question: String(r.question),
      answerStatus: String(r.answerStatus),
      answerText: (r.answerText as string | null) ?? null,
      evidence: r.evidence as unknown[],
      basis: (r.basis as string | null) ?? null,
    };
  };
  async function post(body: unknown, answer: string) {
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider(answer)));
    const res = await POST(chatReq(body), params);
    expect(res.status).toBe(200);
    const frames = parseFrames(await res.text());
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    return frames;
  }
  async function history(rows: Row[]) {
    domainMock.listTurns.mockResolvedValue(rows as never);
    const json = (await (await GET(getReq(detailQueryFor(SEL).replace(/^\?/, "")), params)).json()) as { turns: Row[] };
    return json.turns;
  }
  const statusOf = (t: { parts: readonly { type: string }[] }) => t.parts.find((p) => p.type === "grounding_status") as Record<string, unknown> | undefined;

  it("refusal → honest status + offer on reload → tap → ONE linked general turn → reload shows it used", async () => {
    // 1. The Hub's own body, a manual selected.
    const first = await post(chatBodyFor(Q, [DOC_A], [], SEL), REFUSAL);
    expect(first.find((f) => f.kind === "status")).toMatchObject({ status: "insufficient_evidence" });
    const failed = savedRow(ROW);

    // 2. Reload: the GET the Hub makes, then the Hub's own mapping.
    let turns = await history([failed]);
    let answers = threadFromPersisted(turns as never, META).turns.filter((t) => t.role === "assistant");
    const status = statusOf(answers[0]!)!;
    expect(status).toMatchObject({ outcome: "refused_with_passages", fallbackOffered: true, manualSearched: true });
    expect(answers[0]!.parts.some((p) => p.type === "evidence_basis")).toBe(false);
    expect(groundingStatusLine(status as never)).toContain("read passages from the selected manual");

    // 3. The tap: the Hub resolves the shell turn to the linked general request.
    const req = generalGuidanceRequest(answers[0]!.id, turns as never, SEL)!;
    domainMock.recordTurn.mockClear();
    domainMock.getFallbackSourceTurn.mockResolvedValue({ id: ROW, evidence: failed.evidence } as never);
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
    domainMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Scratch" } as never);
    ragMock.retrieveNodeChunks.mockClear();
    const second = await post(req.body, GENERAL);
    expect(domainMock.getFallbackSourceTurn).toHaveBeenCalledWith(TENANT_A, NB, expect.objectContaining({ turnId: ROW }));
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(groundingFrame(second)).toMatchObject({ outcome: "answered_without_manual", fallback: { of: ROW } });
    const general = savedRow("88888888-8888-4888-8888-888888888888");
    expect(general.question).toBe(Q);

    // 4. Reload again: the offer is used, the new answer is labelled general.
    turns = await history([failed, general]);
    answers = threadFromPersisted(turns as never, META).turns.filter((t) => t.role === "assistant");
    expect(statusOf(answers[0]!)).toMatchObject({ fallbackUsed: true });
    expect(groundingStatusLine(statusOf(answers[1]!) as never)).toBe("General guidance — not from your manual.");
  });

  it("control — server flag off: the same Hub body and history render exactly as before (no entry, no offer)", async () => {
    process.env.NOTEBOOK_GROUNDING_STATUS_ENABLED = "0";
    await post(chatBodyFor(Q, [DOC_A], [], SEL), REFUSAL);
    const turns = await history([savedRow(ROW)]);
    const answers = threadFromPersisted(turns as never, META).turns.filter((t) => t.role === "assistant");
    expect(statusOf(answers[0]!)).toBeUndefined();
  });
});
