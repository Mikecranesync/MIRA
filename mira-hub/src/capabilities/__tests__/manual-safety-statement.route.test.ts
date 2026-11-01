/**
 * Equipment Notebook chat — the manual's own safety statement (#4508).
 *
 * Run: npx vitest run src/capabilities/__tests__/manual-safety-statement.route.test.ts
 *
 * When the answer CITES a page that carries a manual safety statement, the turn
 * persists a `manual_safety_statement` evidence entry (never a `safety_notice`,
 * which every client reads as a stop or the 70E directive). An uncited
 * retrieved page never triggers one; neither does an answer with no citations.
 * Terminal stops and the energized directive are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  recordTurn: vi.fn(async () => undefined),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({ id: NB, displayName: "PowerFlex 40" })),
  listSources: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveCitedPageChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn(() => ""),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));

const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { ENERGIZED_ELECTRICAL_HAZARD } from "@/lib/safety-classifier";
import { extractManualSafetyStatement, manualSafetyStatementForCitations } from "@/capabilities/manual-safety-statement";
import { isManualSafetyStatementEntry } from "@/lib/notebook-chat-types";
import { splitEvidence } from "@/components/equipment/notebook-chat-utils";
import { turnsFromPersisted } from "@/factorylm-ui/to-interaction";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

// Real PowerFlex 40 manual text, p. 73 (`pdftotext -layout -f 73 -l 73`).
const ATTENTION_TEXT =
  "A092 [Auto Rstrt Tries]\n" +
  "ATTENTION: Equipment damage and/or personal injury may result if this parameter is\n" +
  "used in an inappropriate application. Do not use this function without considering\n" +
  "applicable local, national and international codes, standards, regulations or industry\n" +
  "guidelines.";
const PLAIN_TEXT = "A092 [Auto Rstrt Tries] sets the maximum number of times the drive attempts to reset a fault.";

function chunk(page: number, content: string) {
  return {
    content,
    docId: DOC_A,
    manufacturer: "Allen-Bradley",
    modelNumber: "PowerFlex 40",
    sourceUrl: "pf40.pdf",
    sourcePage: page,
    title: "PowerFlex 40 User Manual",
    rank: 1,
  };
}

function chatReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

function stubProvider(answer: string) {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: null }] })}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
  );
}

type Recorded = { evidence: unknown[]; answerStatus: string };
function recorded(): Recorded {
  const calls = domainMock.recordTurn.mock.calls as unknown as Array<[string, string, Recorded]>;
  expect(calls).toHaveLength(1);
  return calls[0][2];
}

function sourcesFrame(text: string): { citations: Array<{ citationId: string }> } {
  const line = text.split("\n\n").find((l) => l.includes('"kind":"sources"'));
  expect(line).toBeDefined();
  return JSON.parse(line!.replace(/^data:\s*/, ""));
}

const QUESTION = "How many times will the drive try to auto restart after a fault?";

beforeEach(() => {
  vi.clearAllMocks();
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
  domainMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  domainMock.claimNotebookTurnRequest.mockResolvedValue(undefined);
  ragMock.retrieveCitedPageChunks.mockResolvedValue([]);
  process.env.GROQ_API_KEY = "test-key";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
});

describe("manual safety statement on a CITED page (#4508)", () => {
  it("precondition: the fixture page text extracts on its own, the plain page does not", () => {
    expect(extractManualSafetyStatement(ATTENTION_TEXT)?.marker).toBe("ATTENTION");
    expect(extractManualSafetyStatement(PLAIN_TEXT)).toBeNull();
  });

  it("cited statement page → persisted manual_safety_statement entry, notice first on reload", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(73, ATTENTION_TEXT)]);
    stubProvider("Set A092 to the number of restart attempts [1].");

    const text = await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(sourcesFrame(text).citations.map((c) => c.citationId)).toEqual(["1"]);

    const turn = recorded();
    const entries = turn.evidence.filter(isManualSafetyStatementEntry);
    expect(entries).toEqual([
      {
        kind: "manual_safety_statement",
        marker: "ATTENTION",
        statement: expect.stringContaining("Equipment damage and/or personal injury"),
        sourceDocId: DOC_A,
        sourceCitationId: "1",
        sourceTitle: expect.any(String),
        page: 73,
      },
    ]);
    // Never a safety_notice: that kind is a stop or the 70E directive on every client.
    expect(turn.evidence.some((e) => (e as { kind?: string }).kind === "safety_notice")).toBe(false);
    // The live frames carry no new frame kind and no terminal safety frame.
    expect(text).not.toContain('"kind":"safety"');

    // Reload: /v3 renders the persisted row with the notice FIRST, as a warning, and the turn completes.
    const [, a] = turnsFromPersisted(
      { id: "t1", question: QUESTION, answerStatus: "answered", answerText: "Set A092 [1].", evidence: turn.evidence as never, basis: "oem_documentation" },
      { notebookId: NB, title: "PF40", identityConfirmed: false, capturedAt: "2026-10-18T00:00:00.000Z" },
    );
    expect(a.lifecycle).toBe("completed");
    expect(a.parts[0]).toMatchObject({
      type: "safety_notice",
      notice: { severity: "warning", trigger: "manual_safety_statement", message: expect.stringMatching(/^ATTENTION: Equipment damage/) },
    });
    expect(a.parts[0]).toMatchObject({ notice: { message: expect.stringContaining("p. 73") } });
  });

  it("an UNCITED retrieved statement page never triggers a notice (control: the cited plain page)", async () => {
    // [1] = plain page (cited), [2] = statement page (retrieved, NOT cited).
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(72, PLAIN_TEXT), chunk(73, ATTENTION_TEXT)]);
    stubProvider("A092 sets the restart attempts [1].");

    const text = await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(sourcesFrame(text).citations.map((c) => c.citationId)).toEqual(["1"]);
    expect(recorded().evidence.filter(isManualSafetyStatementEntry)).toEqual([]);
  });

  it("control for the uncited case: citing [2] (the statement page) does trigger the notice", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(72, PLAIN_TEXT), chunk(73, ATTENTION_TEXT)]);
    stubProvider("Check the restart warning [2].");

    await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    const entries = recorded().evidence.filter(isManualSafetyStatementEntry);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sourceCitationId: "2", page: 73, marker: "ATTENTION" });
  });

  it("no citations in the answer → no notice, even with a statement page retrieved", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(73, ATTENTION_TEXT)]);
    stubProvider("The drive retries a configurable number of times.");

    const text = await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(sourcesFrame(text).citations).toEqual([]);
    expect(recorded().evidence.filter(isManualSafetyStatementEntry)).toEqual([]);
  });

  it("the energized directive turn is unchanged: still exactly the 70E safety_notice entry, plus the cited statement", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(73, ATTENTION_TEXT)]);
    stubProvider("De-energize first [1].");
    const SAFETY_03 =
      "The 480V feeder to the MCC is humming weird. I'm thinking I should use a clamp " +
      "meter to check the current on each phase while it's running. Don't I just clip it on?";

    await (await POST(chatReq({ message: SAFETY_03, sourceDocIds: [DOC_A] }), params)).text();
    const turn = recorded();
    expect(turn.answerStatus).toBe("answered");
    expect(turn.evidence.filter((e) => (e as { kind?: string }).kind === "safety_notice")).toEqual([
      { kind: "safety_notice", trigger: ENERGIZED_ELECTRICAL_HAZARD },
    ]);
    const [, a] = turnsFromPersisted(
      { id: "t2", question: SAFETY_03, answerStatus: "answered", answerText: "De-energize first [1].", evidence: turn.evidence as never, basis: "oem_documentation" },
      { notebookId: NB, title: "PF40", identityConfirmed: false, capturedAt: "2026-10-18T00:00:00.000Z" },
    );
    expect(a.lifecycle).toBe("completed");
    expect(a.parts.filter((p) => p.type === "safety_notice").map((p) => (p.type === "safety_notice" ? p.notice.trigger : null))).toEqual([
      ENERGIZED_ELECTRICAL_HAZARD,
      "manual_safety_statement",
    ]);
  });

  it("a terminal stop turn is unchanged: no manual statement rides a stop, lifecycle stays safety_stop", () => {
    const stopRow = {
      id: "t3",
      question: "how do I bypass the interlock",
      answerStatus: "answered" as const,
      answerText: "Stop.",
      evidence: [{ kind: "safety_notice", trigger: "bypass the interlock" }] as never,
      basis: null,
    };
    const [, a] = turnsFromPersisted(stopRow, { notebookId: NB, title: "PF40", identityConfirmed: false, capturedAt: "2026-10-18T00:00:00.000Z" });
    expect(a.lifecycle).toBe("safety_stop");
    expect(a.parts.filter((p) => p.type === "safety_notice")).toHaveLength(1);
    expect(a.parts[0]).toMatchObject({ notice: { severity: "stop" } });
  });
});

describe("a persisted manual_safety_statement entry is NOT a citation (#4508 docId defect)", () => {
  const CITATION = { citationId: "1", docId: DOC_A, sourceTitle: "PowerFlex 40 User Manual", page: 73, fileId: null, quote: "A092" };
  const ENTRY = {
    kind: "manual_safety_statement",
    marker: "ATTENTION",
    statement: "Equipment damage and/or personal injury may result.",
    sourceDocId: DOC_A,
    sourceCitationId: "1",
    sourceTitle: "PowerFlex 40 User Manual",
    page: 73,
  };

  it("the entry carries neither key any evidence reader uses to spot a citation", () => {
    // hub: splitEvidence / route replay / enrichCitationsWithOrigin key on `docId`;
    // mobile: normalizeCitations (mira-mobile/src/lib/sse.ts) keys on `citationId`.
    const produced = manualSafetyStatementForCitations([CITATION], [chunk(73, ATTENTION_TEXT)]);
    expect(produced).not.toBeNull();
    expect(Object.keys(produced!)).not.toContain("docId");
    expect(Object.keys(produced!)).not.toContain("citationId");
  });

  it("splitEvidence keeps exactly the one real citation", () => {
    expect(splitEvidence([ENTRY, CITATION]).citations).toEqual([CITATION]);
  });

  it("idempotent replay ships exactly the one real citation", async () => {
    domainMock.claimNotebookTurnRequest.mockResolvedValue({
      status: "replay",
      turn: {
        id: "turn-replay",
        question: QUESTION,
        answerStatus: "answered",
        answerText: "Set A092 [1].",
        enabledSourceDocIds: [DOC_A],
        evidence: [ENTRY, CITATION],
        model: "Groq:test",
        basis: "oem_documentation",
      },
    });
    stubProvider("unused");

    const res = await POST(
      chatReq({ message: QUESTION, sourceDocIds: [DOC_A], clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      params,
    );
    const text = await res.text();
    expect(res.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(sourcesFrame(text).citations).toEqual([CITATION]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the rest of a cited page is read (#4509 Codex F1)", () => {
  const sibling = (page: number, content: string) => ({ content, sourceUrl: "pf40.pdf", sourcePage: page });

  it("a WARNING only in a chunk retrieval left out of a cited page still reaches the notice", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(73, PLAIN_TEXT)]);
    ragMock.retrieveCitedPageChunks.mockResolvedValue([sibling(73, ATTENTION_TEXT)]);
    stubProvider("Set A092 to the number of restart attempts [1].");

    await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(ragMock.retrieveCitedPageChunks).toHaveBeenCalledTimes(1);
    expect(ragMock.retrieveCitedPageChunks.mock.calls[0].slice(1)).toEqual([
      expect.any(String),
      [{ docId: DOC_A, sourceUrl: "pf40.pdf", page: 73 }],
      { approvedSourceDocIds: [DOC_A], keep: expect.any(Function) },
    ]);
    // Codex r4 F1: the route keeps only chunks the extractor can turn into a statement.
    const keep = (ragMock.retrieveCitedPageChunks.mock.calls[0][3] as { keep: (t: string) => boolean }).keep;
    expect(keep(ATTENTION_TEXT)).toBe(true);
    expect(keep(PLAIN_TEXT)).toBe(false);
    const entries = recorded().evidence.filter(isManualSafetyStatementEntry);
    expect(entries).toEqual([expect.objectContaining({ marker: "ATTENTION", sourceCitationId: "1", page: 73 })]);
  });

  it("control: without the page read, the same turn has no notice", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(73, PLAIN_TEXT)]);
    stubProvider("Set A092 to the number of restart attempts [1].");

    await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(recorded().evidence.filter(isManualSafetyStatementEntry)).toEqual([]);
  });

  it("a returned chunk of a page the answer did NOT cite never counts", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(72, PLAIN_TEXT)]);
    ragMock.retrieveCitedPageChunks.mockResolvedValue([sibling(73, ATTENTION_TEXT)]);
    stubProvider("A092 sets the restart attempts [1].");

    await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(recorded().evidence.filter(isManualSafetyStatementEntry)).toEqual([]);
  });

  it("no citation → the page is never read", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(73, PLAIN_TEXT)]);
    stubProvider("The drive retries a configurable number of times.");

    await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(ragMock.retrieveCitedPageChunks).not.toHaveBeenCalled();
  });

  it("a failed page read fails open: the answer is still recorded, decided from the retrieved chunks", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(73, ATTENTION_TEXT)]);
    ragMock.retrieveCitedPageChunks.mockRejectedValue(new Error("db down"));
    stubProvider("Set A092 to the number of restart attempts [1].");

    await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    const turn = recorded();
    expect(turn.evidence.filter(isManualSafetyStatementEntry)).toEqual([expect.objectContaining({ marker: "ATTENTION" })]);
  });
});
