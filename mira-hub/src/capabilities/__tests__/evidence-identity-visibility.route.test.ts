/**
 * #6030 F3/F4/F5 — one evidence set, one identity, one visible text, through the notebook POST.
 *
 * Real: the notebook chat route, manual-rag's prompt/citation builders, context-selection, the
 * citation/support/claim validators, the safety-statement reader. Controlled: auth/session, the
 * notebook domain functions, retrieval (returns the chunks below), the provider (stubbed HTTP: draft,
 * judge and redraft bodies; no model is called). Synthetic text, not OEM facts.
 *
 * Run: npx vitest run src/capabilities/__tests__/evidence-identity-visibility.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetOpenAiRunBudgetForTests } from "@/capabilities/openai-run-budget";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const DOC_B = "44444444-4444-4444-8444-444444444444";
const URL = "shared-name.pdf";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));
const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(async () => ({ status: "claimed" as const, claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  listTurns: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null),
  recordTurn: vi.fn(async () => undefined),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", displayName: "Drive", manufacturer: "Acme", model: "D1" })),
  listSources: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);
const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveCitedPageChunks: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/manual-rag", async (importActual) => ({ ...(await importActual<typeof import("@/lib/manual-rag")>()), ...ragMock }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
const persistMock = vi.hoisted(() => ({ persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "t" })) }));
vi.mock("@/lib/inference/persist-usage", () => persistMock);
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: vi.fn(async () => null) }));
vi.mock("@/lib/visual-evidence-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visual-evidence-context")>()),
  loadVisualEvidenceForPhoto: vi.fn(async () => null),
  loadRecentLookObservations: vi.fn(async () => []),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const chunk = (docId: string, page: number, content: string, extra: Record<string, unknown> = {}) => ({
  content, docId, sourceUrl: URL, sourcePage: page, pageLabel: String(page), title: `Doc ${docId.slice(0, 2)}`,
  manufacturer: "", modelNumber: "", rank: 1, verified: false, chunkIndex: null, ...extra,
});
const req = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = { params: Promise.resolve({ id: NB }) };
const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;
const STOP_FRAME = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;
function stream(text: string): Response {
  const parts = [delta(text), STOP_FRAME, `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`, "data: [DONE]\n\n"];
  return new Response(new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), { status: 200 });
}
const verdict = (v: string) => JSON.stringify({ verdict: v, hazard_class: v === "safe" ? "none" : "pressure", reason: "r" });

/** draft -> (judge answers in order) -> optional non-streaming redraft. */
function stubProvider(draft: string, judge: string[] = [], redraft?: string) {
  const streamBodies: string[] = [];
  let judged = 0;
  const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes('"stream":true')) {
      streamBodies.push(body);
      return stream(draft);
    }
    if (body.includes("candidate_answer")) return Response.json({ choices: [{ message: { content: judge[judged++] ?? verdict("safe") } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
    return Response.json({ choices: [{ message: { content: redraft ?? draft }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20 } });
  });
  vi.stubGlobal("fetch", f);
  return { streamBodies };
}
const lastUser = (body: string): string => {
  const msgs = JSON.parse(body).messages as Array<{ role: string; content: string }>;
  return msgs[msgs.length - 1].content;
};
const turn = () => (domainMock.recordTurn.mock.calls as unknown as Array<[string, string, Record<string, unknown>]>)[0][2];

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "1";
  delete process.env.NOTEBOOK_SEMANTIC_CHECK;
  process.env.NOTEBOOK_SEMANTIC_TIMEOUT_MS = "60";
  process.env.OPENAI_API_KEY = "k0";
  for (const k of ["OPENROUTER_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "TOGETHERAI_API_KEY", "OPENAI_RUN_BUDGET_USD", "MIRA_JEV_SHADOW"]) delete process.env[k];
  resetOpenAiRunBudgetForTests();
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A, DOC_B], nodeId: "n1" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 20));
  process.env = { ...ENV };
  resetOpenAiRunBudgetForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ask(message: string, docs = [DOC_A, DOC_B]) {
  const res = await POST(req({ message, sourceDocIds: docs }), params);
  await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
  return turn() as { answerStatus: string; answerText: string; evidence: Array<{ citationId: string; docId: string; page: number | null; quote: string }> };
}

describe("two admitted documents that share a file name and a physical page", () => {
  const A = chunk(DOC_A, 45, "Document A page 45: the supply is 12 V.");
  const B = chunk(DOC_B, 45, "Document B page 45: the supply is 24 V.");
  const Q = "What supply voltage applies?";

  it("provider blocks are [1] and [2]; an answer citing only B's [2] is answered with B's document and page", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([A, B] as never);
    const p = stubProvider("The supply is 24 V [2].");
    const t = await ask(Q);
    const sent = lastUser(p.streamBodies[0]);
    expect(sent).toMatch(/\[1\] [^\n]*p\.45\nDocument A page 45/);
    expect(sent).toMatch(/\[2\] [^\n]*p\.45\nDocument B page 45/);
    expect(t.answerStatus).toBe("answered");
    expect(t.evidence).toEqual([expect.objectContaining({ citationId: "2", docId: DOC_B, page: 45 })]);
    expect(t.evidence[0].quote).toContain("24 V");
  });

  it("redraft control: B's own value cited to [2] is served; A's value cited to [2] is NOT supported by B's page and the stop stands", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([A, B] as never);
    stubProvider("Check the display contrast setting first [1].", [verdict("unsafe"), verdict("safe")], "With the drive stopped and locked out, the supply is 24 V [2].");
    const ok = await ask(Q);
    expect(ok.answerText).toContain("24 V [2]");
    expect(ok.evidence).toEqual([expect.objectContaining({ citationId: "2", docId: DOC_B, page: 45 })]);

    vi.clearAllMocks();
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A, DOC_B], nodeId: "n1" });
    domainMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } as never);
    resetOpenAiRunBudgetForTests();
    ragMock.retrieveNodeChunks.mockResolvedValue([A, B] as never);
    stubProvider("Check the display contrast setting first [1].", [verdict("unsafe"), verdict("safe")], "With the drive stopped and locked out, the supply is 12 V [2].");
    const bad = await ask(Q);
    expect(bad.answerText).toMatch(/SAFETY STOP/);
    expect(bad.answerText).not.toContain("12 V");
    expect(bad.evidence.some((e) => "citationId" in e)).toBe(false);
  });

  it("the cited-page read is asked for document B's page, and B's warning becomes the notice (not A's)", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([A, B] as never);
    ragMock.retrieveCitedPageChunks.mockImplementation((async (_c: unknown, _t: string, wanted: Array<{ docId: string; sourceUrl: string; page: number }>) => {
      const rows = [
        { docId: DOC_A, sourceUrl: URL, sourcePage: 45, content: "WARNING! Document A: only an electrician may open the cabinet." },
        { docId: DOC_B, sourceUrl: URL, sourcePage: 45, content: "WARNING! Document B: wait 5 minutes after removing power before touching the terminals." },
      ];
      return rows.filter((r) => wanted.some((w) => w.docId === r.docId && w.page === r.sourcePage));
    }) as never);
    stubProvider("Document B says the supply is 24 V [2].");
    await ask(Q);
    const asked = ragMock.retrieveCitedPageChunks.mock.calls[0] as unknown as [unknown, string, Array<{ docId: string }>];
    expect(asked[2].map((w) => w.docId)).toEqual([DOC_B]);
    const t = turn() as { evidence: Array<Record<string, unknown>> };
    const notice = t.evidence.find((e) => e.kind === "manual_safety_statement");
    expect(notice).toMatchObject({ sourceDocId: DOC_B, sourceCitationId: "2" });
    expect(JSON.stringify(notice)).toContain("Document B");
    expect(JSON.stringify(notice)).not.toContain("Document A");
  });
});

describe("a late complete row that the model was actually shown", () => {
  const filler = Array.from({ length: 120 }, (_, i) => `| A${i} | Synthetic filler ${i} |`).join("\n");
  const ROW = "| F205 | Rated current is 19.7 A |";
  const LATE = chunk(DOC_A, 45, `# Model B only\n| Code | Meaning |\n|---|---|\n${filler}\n${ROW}`);
  const Q = "What is the F205 rated current?";
  const DRAFT = "Check the display contrast setting first [1].";
  const REDRAFT_OK = "With the drive stopped and locked out, the F205 rated current is 19.7 A [1].";
  const REDRAFT_WRONG = "With the drive stopped and locked out, the F205 rated current is 21.4 A [1].";
  const beforeEachRetrieve = () => ragMock.retrieveNodeChunks.mockResolvedValue([LATE] as never);

  it("precondition: the row is beyond the old 1200-char prefix and reaches the provider", async () => {
    beforeEachRetrieve();
    expect(LATE.content.indexOf(ROW)).toBeGreaterThan(1200);
    const p = stubProvider("The F205 rated current is 19.7 A [1].");
    const t = await ask(Q, [DOC_A]);
    expect(lastUser(p.streamBodies[0])).toContain(ROW);
    expect(t.answerStatus).toBe("answered");
    expect(t.evidence[0].quote).toContain("19.7 A");
  });

  it("semantic redraft: the late valid row passes the existing value/source floor and the redraft is served", async () => {
    beforeEachRetrieve();
    const p = stubProvider(DRAFT, [verdict("unsafe"), verdict("safe")], REDRAFT_OK);
    const t = await ask(Q, [DOC_A]);
    expect(lastUser(p.streamBodies[0])).toContain(ROW); // the quoted row reached the provider
    expect(t.answerText).toBe(REDRAFT_OK);
    expect(t.evidence[0].quote).toContain("19.7 A");
  });

  it("control: a redraft with a WRONG value is not supported by that row and the stop stands", async () => {
    beforeEachRetrieve();
    stubProvider(DRAFT, [verdict("unsafe"), verdict("safe")], REDRAFT_WRONG);
    const t = await ask(Q, [DOC_A]);
    expect(t.answerText).toMatch(/SAFETY STOP/);
    expect(t.answerText).not.toContain("21.4 A");
    expect(t.evidence.some((e) => "citationId" in e)).toBe(false);
  });

  it("a follow-up whose fault code comes from the thread: the validators use the SAME context question the excerpts were selected for", async () => {
    // "its rated current" names no fault code; the topic hint carries F205 from the thread, so the
    // late row is selected for (message + hint). Judged on the bare message it would be unsupported.
    beforeEachRetrieve();
    const p = stubProvider(DRAFT, [verdict("unsafe"), verdict("safe")], REDRAFT_OK);
    const res = await POST(
      req({
        message: "What is its rated current?",
        sourceDocIds: [DOC_A],
        history: [
          { role: "user", content: "What does fault F205 mean on this drive?" },
          { role: "assistant", content: "F205 is an overcurrent fault on the drive [1]." },
        ],
      }),
      params,
    );
    await res.text();
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    expect(lastUser(p.streamBodies[0])).toContain(ROW); // selected through the hint, and shown to the provider
    const t = turn() as { answerText: string; evidence: Array<{ quote: string }> };
    expect(t.answerText).toBe(REDRAFT_OK);
    expect(t.evidence[0].quote).toContain("19.7 A");
  });
});

