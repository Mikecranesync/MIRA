/**
 * Equipment Notebook chat — the cited manual's Safety chapter reaches the answer (#4508, #5056 Codex F1).
 *
 * Run: npx vitest run src/capabilities/__tests__/manual-safety-chapter.route.test.ts
 *
 * Two manuals are retrieved. Manual A's chapter starts on page 1 with four warning pages; the
 * ACS355's starts on page 17 with one. The ACS355 warning must still reach the prompt with its own
 * document identity, the directive must ride with it, and an answer citing it gets that page's
 * statement as the notice (#4509).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import pages from "../manual-safety-statement.real-pages.json";

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
  getNotebook: vi.fn(async () => ({ id: NB, displayName: "ACS355" })),
  listSources: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveCitedPageChunks: vi.fn(async () => [] as unknown[]),
  approvalGateEnabled: vi.fn(() => false),
  PAGE_LABEL_SQL: "NULL AS page_label",
  approvedSourceFilterSql: vi.fn(() => ""),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn(() => ""),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

const tenantClient = vi.hoisted(() => ({ query: vi.fn(async (..._a: unknown[]) => ({ rows: [] as unknown[] })) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(tenantClient)),
}));

const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { isManualSafetyStatementEntry } from "@/lib/notebook-chat-types";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const DOC_B = "44444444-4444-4444-8444-444444444444";
const URL_A = "other-drive.pdf";
const URL_B = "acs355.pdf";

const text = (id: string) => (pages as Array<{ id: string; text: string }>).find((p) => p.id === id)!.text;
const P372 = text("acs355-q3"); // fan replacement page: "chapter Safety on page\n17"
const P18 = text("acs355-q2"); // Safety chapter: wait 5 minutes, multimeter

const chunk = (docId: string, sourceUrl: string, title: string, page: number, content: string) => ({
  content, docId, sourceUrl, sourcePage: page, title, manufacturer: "ABB", modelNumber: "ACS355", rank: 1,
});

// What a page read returns: A's chapter pages 1-4 each carry a warning, the ACS355's only page 18.
const CORPUS = [
  ...[1, 2, 3, 4].map((p) => ({ sourceUrl: URL_A, sourcePage: p, content: `WARNING! Other drive, page ${p}: disconnect power before servicing.` })),
  { sourceUrl: URL_B, sourcePage: 18, content: P18 },
];

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
  const f = vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  vi.stubGlobal("fetch", f);
  return f;
}

const QUESTION = "How do I replace the cooling fan on the ACS355?";

beforeEach(() => {
  vi.clearAllMocks();
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A, DOC_B], nodeId: "n1" });
  domainMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  domainMock.claimNotebookTurnRequest.mockResolvedValue(undefined);
  ragMock.retrieveNodeChunks.mockResolvedValue([
    chunk(DOC_A, URL_A, "Other drive manual", 40, "WARNING! Read and follow the instructions in chapter Safety on page 1."),
    chunk(DOC_B, URL_B, "ACS355 User's Manual", 372, P372),
  ]);
  ragMock.retrieveCitedPageChunks.mockImplementation((async (
    _c: unknown,
    _t: string,
    wanted: Array<{ sourceUrl: string; page: number }>,
    opts: { keep?: (t: string) => boolean } = {},
  ) =>
    CORPUS.filter(
      (r) => wanted.some((w) => w.sourceUrl === r.sourceUrl && w.page === r.sourcePage) && (opts.keep ? opts.keep(r.content) : true),
    )) as never);
  process.env.GROQ_API_KEY = "test-key";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
});

describe("the cited manual's Safety chapter on a two-manual turn", () => {
  it("the ACS355 warning survives the cap, rides with its own document, and becomes the notice when cited", async () => {
    // Excerpts: [1] A p40, [2] ACS355 p372, then chapter pages one per manual: [3] A p1, [4] ACS355 p18, [5] A p2, [6] A p3.
    // Cites only the chapter page: #4509 shows one notice per turn, so citing [2] too would pick its own WARNING.
    const f = stubProvider("Stop the drive, wait 5 minutes and check with a multimeter that no voltage is present [4].");
    const res = await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A, DOC_B] }), params);
    await res.text();

    const sent = ragMock.buildManualUserContent.mock.calls[0] as unknown as [string, Array<{ docId: string; sourceUrl: string; sourcePage: number; title: string; content: string }>];
    const chapter = sent[1].slice(2);
    expect(chapter.map((c) => `${c.sourceUrl}:${c.sourcePage}`)).toEqual([`${URL_A}:1`, `${URL_B}:18`, `${URL_A}:2`, `${URL_A}:3`]);
    expect(chapter[1]).toMatchObject({ docId: DOC_B, title: "ACS355 User's Manual", content: P18 });

    const system = JSON.parse(String((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).messages[0].content as string;
    expect(system).toContain("SAFETY CHAPTER");

    const turn = (domainMock.recordTurn.mock.calls as unknown as Array<[string, string, { evidence: unknown[] }]>)[0][2];
    const notices = turn.evidence.filter(isManualSafetyStatementEntry);
    expect(notices).toEqual([expect.objectContaining({ sourceDocId: DOC_B, page: 18, sourceCitationId: "4" })]);
  });

  it("control: no retrieved page refers to a Safety chapter → no chapter chunks and no directive", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(DOC_B, URL_B, "ACS355 User's Manual", 355, text("acs355-q4"))]);
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_B], nodeId: "n1" });
    const f = stubProvider("Alarm 2010 means overcurrent [1].");
    await (await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_B] }), params)).text();

    // Precondition: the document-level lookup really ran (and found nothing), not a failure that fell open.
    const lookups = tenantClient.query.mock.calls.filter((c) => String(c[0]).includes("DISTINCT ON"));
    expect(lookups).toHaveLength(1);
    expect(lookups[0][1]).toHaveLength(3);
    const sent = ragMock.buildManualUserContent.mock.calls[0] as unknown as [string, unknown[]];
    expect(sent[1]).toHaveLength(1);
    const system = JSON.parse(String((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).messages[0].content as string;
    expect(system).not.toContain("SAFETY CHAPTER");
  });
});
