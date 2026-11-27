/**
 * #6030 F7/F8 — one output-hygiene check for every candidate admitted to buffered release, through the notebook POST.
 *
 * Real: the notebook chat route, manual-rag's prompt/citation builders, context-selection, the
 * citation/support/claim validators, the safety-statement reader. Controlled: auth/session, the
 * notebook domain functions, retrieval (returns the chunks below), the provider (stubbed HTTP: draft,
 * judge and redraft bodies; no model is called). Synthetic text, not OEM facts.
 *
 * Run: npx vitest run src/capabilities/__tests__/output-hygiene-release.route.test.ts
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

import { POST, replayedErrorStatus } from "@/app/api/equipment-notebooks/[id]/chat/route";

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


const SOURCE = "F081 is DSI Comm Loss. Type 2 requires manual reset (synthetic regression source). Inspect the hydraulic hose for wear.";
const one = chunk(DOC_A, 162, SOURCE);
const contentOf = (raw: string): string =>
  raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return {}; } }).filter((f) => f.kind === "content").map((f) => f.content ?? "").join("");
type Turn = { answerStatus: string; answerText: string; basis: string | null; evidence: Array<Record<string, unknown>> };
async function run(message: string, history?: unknown[]) {
  const res = await POST(req({ message, sourceDocIds: [DOC_A], ...(history ? { history } : {}) }), params);
  const raw = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
  return { raw, live: contentOf(raw), turn: turn() as unknown as Turn };
}
const providerCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.length;

describe("matching-language answers are preserved, with one ordinary provider request", () => {
  // The semantic judge is off here so "one request" measures hygiene itself: it adds no translation,
  // detector, generation or judge call of its own.
  beforeEach(() => { process.env.NOTEBOOK_SEMANTIC_CHECK = "0"; });
  it.each([
    ["Japanese", "F081 の意味は何ですか？", "F081 は通信障害です。タイプ2では手動リセットが必要です [1]。"],
    ["Arabic", "ما معنى العطل F081؟", "العطل F081 يعني فقد الاتصال. يتطلب النوع الثاني إعادة ضبط يدوية [1]."],
    ["Hindi", "F081 का अर्थ क्या है?", "F081 का अर्थ संचार हानि है। टाइप 2 के लिए मैनुअल रीसेट आवश्यक है [1]।"],
    ["Russian", "Что означает F081?", "F081 означает потерю связи. Для типа 2 требуется ручной сброс [1]."],
  ])("%s", async (_n, q, a) => {
    ragMock.retrieveNodeChunks.mockResolvedValue([one] as never);
    const p = stubProvider(a);
    const r = await run(q);
    expect(r.live).toBe(a);
    expect(r.turn.answerText).toBe(a);
    expect(r.turn.answerStatus).toBe("answered");
    expect(r.turn.evidence).toEqual([expect.objectContaining({ docId: DOC_A, page: 162, citationId: "1" })]);
    expect(p.streamBodies).toHaveLength(1);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1); // no translation/judge/extra generation
  });
});

describe("a failing draft is never released, and the failure is reported honestly", () => {
  const BAD = "PF525-TEST reports ошибка in its drive status. F081 is DSI Comm Loss [1].";
  it("a product code elsewhere does not exempt unexpected Cyrillic prose: neither streamed nor saved, no manual claim", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([one] as never);
    stubProvider(BAD);
    const r = await run("What does F081 mean?");
    expect(r.live).not.toContain("ошибка");
    expect(r.turn.answerText).not.toContain("ошибка");
    expect(r.live).toBe(r.turn.answerText);
    expect(r.turn.answerText).toMatch(/could not produce a clean reply/);
    // An ERROR of the reply, never "insufficient_evidence": nothing is claimed about the manuals.
    expect(r.turn.answerStatus).toBe("error");
    expect(r.turn.basis).toBeNull();
    expect(r.turn.evidence.some((e) => "citationId" in e)).toBe(false);
    expect(r.turn.evidence).toContainEqual({ kind: "output_hygiene_failure", code: "unexpected_script" });
    const status = r.raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return {}; } }).find((f) => f.kind === "status");
    expect(status).toEqual({ kind: "status", status: "error", message: "I could not produce a clean reply this time. Please ask again." }); // no provider `reason`
  });
  it("the stored failure replays with the same status (no provider-exhaustion copy)", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([one] as never);
    stubProvider(BAD);
    const r = await run("What does F081 mean?");
    const t = turn() as unknown as { evidence: unknown[] };
    expect(replayedErrorStatus(t.evidence)).toEqual({ kind: "status", status: "error", message: "I could not produce a clean reply this time. Please ask again." });
    expect(replayedErrorStatus([])).toMatchObject({ message: "No answer provider available." }); // control: other errors unchanged
    void r;
  });
  it("text cut from the prompt cannot legitimise a foreign word in the answer", async () => {
    const text = "F081 is DSI Comm Loss. Type 2 requires manual reset (synthetic).\n" + "Ordinary synthetic maintenance background. ".repeat(100) + "\nошибка";
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(DOC_A, 162, text)] as never);
    const p = stubProvider("F081 ошибка means DSI Comm Loss [1].");
    const r = await run("What does F081 mean?");
    expect(lastUser(p.streamBodies[0])).not.toContain("ошибка");
    expect(r.live).not.toContain("ошибка");
    expect(r.turn.answerText).not.toContain("ошибка");
  });
  it("a clean quoted recovery is released with its real citation; a still-rejected one is not", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([one] as never);
    const clean = "F081 means DSI Comm Loss and Type 2 requires manual reset [1].";
    stubProvider('rewrite: "' + clean + '"');
    const ok = await run("What does F081 mean?");
    expect(ok.live).toBe(clean);
    expect(ok.turn.answerText).toBe(clean);
    expect(ok.turn.evidence).toEqual([expect.objectContaining({ docId: DOC_A, page: 162 })]);
    vi.clearAllMocks();
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A, DOC_B], nodeId: "n1" });
    domainMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } as never);
    ragMock.retrieveNodeChunks.mockResolvedValue([one] as never);
    stubProvider('rewrite: "F081 needs manual reset. rewrite: DSI Comm Loss [1]."');
    const bad = await run("What does F081 mean?");
    expect(bad.live).not.toContain("rewrite:");
    expect(bad.turn.answerText).not.toContain("rewrite:");
  });
  it("gate OFF: what was streamed is exactly what is saved (no post-hoc replacement), detection is not enforced", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    ragMock.retrieveNodeChunks.mockResolvedValue([one] as never);
    const draft = "F081 means DSI Comm Loss. rewrite: F081 requires manual reset [1].";
    stubProvider(draft);
    const r = await run("What does F081 mean?");
    expect(r.turn.answerText).toBe(r.live);
    expect(r.live).toBe(draft);
  });
});

describe("the semantic redraft faces the same check", () => {
  const Q = "The display is dim, what should I look at?";
  const SRC = chunk(DOC_A, 41, "SECTION 7.2 Relieve accumulator pre-charge through valve V-12 before servicing the starter. Inspect the hydraulic hose for wear and the ribbon cable connector for looseness.");
  const OK = "With the press stopped and locked out, inspect the hydraulic hose for wear [1].";
  const MALFORMED = `${OK} rewrite: Inspect the hydraulic hose for wear [1].`;
  const JP_OK = "プレスを停止しロックアウトした状態で、hydraulic hose for wear を点検してください [1]。";
  it("a malformed redraft is not adopted even though its judge and source support would pass; the stop stands", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([SRC] as never);
    const redrafts: string[] = [];
    let judged = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      const b = String(init?.body ?? "");
      if (b.includes('"stream":true')) return stream("Check the display contrast setting first [1].");
      if (b.includes("candidate_answer")) return Response.json({ choices: [{ message: { content: verdict(judged++ === 0 ? "unsafe" : "safe") } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
      redrafts.push(b);
      return Response.json({ choices: [{ message: { content: MALFORMED }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 20 } });
    }));
    const r = await run(Q);
    expect(redrafts).toHaveLength(1);
    expect(r.live).not.toContain("rewrite:");
    expect(r.turn.answerText).toMatch(/SAFETY STOP/);
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("rewrite:");
  });
  it("control: the clean redraft is adopted and released", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([SRC] as never);
    let judged = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      const b = String(init?.body ?? "");
      if (b.includes('"stream":true')) return stream("Check the display contrast setting first [1].");
      if (b.includes("candidate_answer")) return Response.json({ choices: [{ message: { content: verdict(judged++ === 0 ? "unsafe" : "safe") } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
      return Response.json({ choices: [{ message: { content: OK }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 20 } });
    }));
    const r = await run(Q);
    expect(r.live).toBe(OK);
    expect(r.turn.answerText).toBe(OK);
  });
  it("a redraft in an unexpected script is not adopted in an English turn (an expected-script redraft would be)", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([SRC] as never);
    let judged = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      const b = String(init?.body ?? "");
      if (b.includes('"stream":true')) return stream("Check the display contrast setting first [1].");
      if (b.includes("candidate_answer")) return Response.json({ choices: [{ message: { content: verdict(judged++ === 0 ? "unsafe" : "safe") } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
      return Response.json({ choices: [{ message: { content: JP_OK }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 20 } });
    }));
    const r = await run(Q);
    expect(r.live).not.toContain("プレス");
    expect(r.turn.answerText).toMatch(/SAFETY STOP/);
  });
});
