/**
 * #4355 option 1 (owner decision, 2026-10-12): OpenAI writes a notebook-chat
 * answer only if that answer's safety judge ALSO fits under the per-run cap.
 *
 * Why: the route serves an answer whose judge returned "unknown" with no hazard
 * banner (fail-open, owner decision #4022). Without the paired hold, an answer
 * admitted on the last of the budget could leave no room for its judge, so a
 * flagged answer would go out unjudged at the cap edge — and with OpenAI the
 * only live provider (canary 2026-10-12), nothing else would judge it.
 *
 * Contract pinned here, end to end through POST:
 *  - the pair does not fit -> OpenAI is not called for the answer at all;
 *  - the pair fits -> the answer is written and judged on OpenAI;
 *  - a concurrent turn takes the rest of the cap mid-answer -> the judge STILL
 *    runs on OpenAI, on the room held for it;
 *  - with the judge off (gate off) no judge room is held;
 *  - no turn leaves any room held when it ends (no cap leak).
 *
 * Mock scaffold mirrors stream-usage-drain.route.test.ts.
 * Run: npx vitest run src/capabilities/__tests__/judge-hold.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(async () => ({
    status: "claimed" as const,
    claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  recordTurn: vi.fn(async () => undefined),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "PF525 — Line 1",
    manufacturer: "Allen-Bradley",
    model: "PowerFlex 525",
  })),
  listSources: vi.fn(async () => [{ filename: "PF525.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

const persistMock = vi.hoisted(() => ({
  persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "trace-1" })),
}));
vi.mock("@/lib/inference/persist-usage", () => persistMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);
vi.mock("@/lib/visual-evidence-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visual-evidence-context")>()),
  loadVisualEvidenceForPhoto: vi.fn(async () => null),
  loadRecentLookObservations: vi.fn(async () => []),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { OpenAiRunBudget, openAiRunBudget, resetOpenAiRunBudgetForTests } from "@/capabilities/openai-run-budget";
import { JUDGE_OUTPUT_TOKENS, judgeHoldInputBound } from "@/capabilities/answer-safety-check";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const FIRST = "Check the DC bus voltage first.";
const FALLBACK = "FALLBACK ANSWER FROM GROQ";

const chatReq = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: NB }) };

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;
const STOP = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;
const USAGE = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`;

function answerStream(): Response {
  const chunks = [...FIRST.split(" ").map((w) => delta(w + " ")), STOP, USAGE, "data: [DONE]\n\n"];
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

const groundedChunks = [
  { docId: DOC_A, filename: "PF525.pdf", page: 87, content: "Fault F004 indicates DC bus undervoltage." },
];

/** OpenAI streaming = the answer; any body carrying `candidate_answer` = the safety judge. */
function stubFetch(opts: { onAnswer?: () => void } = {}) {
  const calls = { openaiAnswer: 0, openaiJudge: 0, otherJudge: 0 };
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === "string" ? init.body : "";
    if (u.includes("api.openai.com") && body.includes('"stream":true')) {
      calls.openaiAnswer += 1;
      opts.onAnswer?.();
      return answerStream();
    }
    if (body.includes("candidate_answer")) {
      if (u.includes("api.openai.com")) calls.openaiJudge += 1;
      else calls.otherJudge += 1;
      return Response.json({
        choices: [{ message: { content: '{"verdict":"safe","hazard_class":"none","reason":"x"}' } }],
        usage: { prompt_tokens: 40, completion_tokens: 9 },
      });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const ENV = { ...process.env };
const QUESTION = "what is F004";
beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "1";
  delete process.env.NOTEBOOK_SEMANTIC_CHECK;
  process.env.OPENAI_API_KEY = "k0";
  delete process.env.GROQ_API_KEY;
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  delete process.env.OPENAI_RUN_BUDGET_USD;
  resetOpenAiRunBudgetForTests();
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(groundedChunks as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
  resetOpenAiRunBudgetForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run() {
  const res = await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params);
  expect(res.status).toBe(200);
  const text = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
  return { text, turn };
}

const usd = (i: number, o: number) => new OpenAiRunBudget({ now: () => 0 }).estimateUsd(i, o);

/** The answer's and the judge's hold shapes, read off a turn with room to spare. */
async function measureHolds(): Promise<{ answer: [number, number]; judge: [number, number] }> {
  const reserve = vi.spyOn(OpenAiRunBudget.prototype, "reserve");
  stubFetch();
  await run();
  const shapes = reserve.mock.calls as [number, number][];
  const judge = shapes.find(([, out]) => out === JUDGE_OUTPUT_TOKENS);
  const answer = shapes.find(([, out]) => out !== JUDGE_OUTPUT_TOKENS);
  if (!judge || !answer) throw new Error(`precondition: both holds taken (${JSON.stringify(shapes)})`);
  reserve.mockRestore();
  vi.clearAllMocks();
  resetOpenAiRunBudgetForTests();
  return { answer, judge };
}

function setCap(capUsd: number) {
  process.env.OPENAI_RUN_BUDGET_USD = String(capUsd);
  resetOpenAiRunBudgetForTests();
}

describe("#4355 option 1 — OpenAI answers only when its safety judge also fits", () => {
  it("with room to spare: the answer is written AND judged on OpenAI, and the judge hold is sized before the answer", async () => {
    const reserve = vi.spyOn(OpenAiRunBudget.prototype, "reserve");
    const calls = stubFetch();
    const { turn } = await run();
    expect(turn).toMatchObject({ answerStatus: "answered" });
    expect(calls.openaiAnswer).toBe(1);
    expect(calls.openaiJudge).toBe(1);
    expect(reserve.mock.calls).toContainEqual([judgeHoldInputBound(QUESTION, 800), JUDGE_OUTPUT_TOKENS, "gpt-5.4-mini"]); // priced as the model it sends (#4968)
    // Dollar arithmetic may retain sub-picodollar IEEE-754 subtraction dust.
    expect(openAiRunBudget().heldUsd).toBeCloseTo(0, 12);
  });

  it("the pair does NOT fit: OpenAI is never called for the answer, and nothing stays held", async () => {
    const { answer, judge } = await measureHolds();
    setCap(usd(...answer) + usd(...judge) * 0.5); // the answer alone would fit
    expect(usd(...answer)).toBeLessThan(openAiRunBudget().capUsd); // precondition
    const calls = stubFetch();
    await run();
    expect(calls.openaiAnswer).toBe(0);
    expect(calls.openaiJudge).toBe(0);
    const warned = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(warned).toContain('"scope":"notebook-chat+safety-judge"');
    // Dollar arithmetic may retain sub-picodollar IEEE-754 subtraction dust.
    expect(openAiRunBudget().heldUsd).toBeCloseTo(0, 12);
  });

  it("control: the pair just fits — the answer is written and judged on OpenAI", async () => {
    const { answer, judge } = await measureHolds();
    setCap((usd(...answer) + usd(...judge)) * 1.0001);
    const calls = stubFetch();
    await run();
    expect(calls.openaiAnswer).toBe(1);
    expect(calls.openaiJudge).toBe(1);
    // Dollar arithmetic may retain sub-picodollar IEEE-754 subtraction dust.
    expect(openAiRunBudget().heldUsd).toBeCloseTo(0, 12);
  });

  it("a concurrent turn takes the rest of the cap after the answer is booked: the judge STILL runs on OpenAI", async () => {
    // The squeeze lands at the worst moment: the answer has just settled (its
    // unused worst case is freed) and the judge has not reserved yet. Only the
    // room held for the judge since the answer was admitted can still pay it.
    let squeezed: { release(): void } | null = null;
    let roomLeftForAnyRequest: boolean | null = null;
    const origRecord = OpenAiRunBudget.prototype.record;
    vi.spyOn(OpenAiRunBudget.prototype, "record").mockImplementation(function (this: OpenAiRunBudget, i: number, o: number) {
      const cost = origRecord.call(this, i, o);
      if (!squeezed) {
        const room = this.capUsd - this.spentUsd - this.heldUsd;
        const v = this.reserve(Math.floor((room - 1e-7) / usd(1, 0)), 0);
        if (v.ok) squeezed = v.reservation;
        const probe = this.reserve(1, 1);
        roomLeftForAnyRequest = probe.ok;
        if (probe.ok) probe.reservation.release();
      }
      return cost;
    });
    const calls = stubFetch();
    await run();
    expect(squeezed).not.toBeNull(); // precondition: the concurrent hold landed
    expect(roomLeftForAnyRequest).toBe(false); // precondition: nothing else fit after it
    expect(calls.openaiAnswer).toBe(1);
    expect(calls.openaiJudge).toBe(1);
    (squeezed as unknown as { release(): void }).release();
    // Dollar arithmetic may retain sub-picodollar IEEE-754 subtraction dust.
    expect(openAiRunBudget().heldUsd).toBeCloseTo(0, 12);
  });

  it("with the judge off (gate off) no judge room is held: an answer that fits alone is written", async () => {
    const { answer } = await measureHolds();
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    setCap(usd(...answer) * 1.0001);
    const reserve = vi.spyOn(OpenAiRunBudget.prototype, "reserve");
    const calls = stubFetch();
    await run();
    expect(calls.openaiAnswer).toBe(1);
    expect(reserve.mock.calls.some(([, out]) => out === JUDGE_OUTPUT_TOKENS)).toBe(false);
  });

  it("an answer that is never served (provider error) leaves no judge room held", async () => {
    const fetchMock = vi.fn(async () => new Response("upstream down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params);
    await res.text();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0); // precondition: OpenAI was attempted
    // Dollar arithmetic may retain sub-picodollar IEEE-754 subtraction dust.
    expect(openAiRunBudget().heldUsd).toBeCloseTo(0, 12);
  });
});
