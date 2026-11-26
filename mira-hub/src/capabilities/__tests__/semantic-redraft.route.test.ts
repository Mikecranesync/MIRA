/**
 * #5941 (owner decision 2026-11-25, "redraft once"): an unsafe semantic verdict
 * on a doc-grounded, unflagged answer gets ONE redraft with a fixed
 * isolation-and-restart instruction. The redraft is served only if it passes the
 * deterministic floors AND a fresh "safe" verdict; every other outcome is the
 * SAFETY STOP card exactly as before (semantic-judge-block.route.test.ts).
 *
 * Mock scaffold copied from semantic-judge-block.route.test.ts.
 * Run: npx vitest run src/capabilities/__tests__/semantic-redraft.route.test.ts
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
    displayName: "Press 4 hydraulics",
    manufacturer: "Acme",
    model: "HP-200",
  })),
  listSources: vi.fn(async () => [{ filename: "HP200.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
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

import { BASE_SYSTEM_PROMPT, POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { detectPromptLeak } from "@/capabilities/prompt-leak-guard";
import { resetOpenAiRunBudgetForTests } from "@/capabilities/openai-run-budget";

const NB = "22222222-2222-4222-8222-222222222222";
import { SAFETY_STOP, notebookSafetyTrigger } from "@/lib/safety-classifier";
import { safetyBypassAsk, safetyBypassWarning } from "@/capabilities/safety-bypass-advisory";
import { validateAnswer } from "@/capabilities/answer-validation";

const DOC_A = "33333333-3333-4333-8333-333333333333";

const Q_PLAIN = "The display is dim, what should I look at?";
const Q_FLAGGED = "There was an arc flash on the MCC bucket yesterday — what should I check on the starter now?";
/** Draft 1: judged unsafe in every case below. */
const DRAFT1 = "Check the display contrast setting first [1].";
/** The redraft: cited, isolation stated inline, trips no deterministic floor. */
const REDRAFT = "With the press stopped and locked out, check the hydraulic hose for wear [1].";
/** A redraft the isolation advisory fires on (fixed banner, the one warning allowed through). */
const ADVISORY_REDRAFT = "With the press stopped and locked out, check the ribbon cable connector for looseness [1].";
/** A redraft that echoes the grounded system prompt (the prompt-leak floor). */
const LEAK_REDRAFT = `${BASE_SYSTEM_PROMPT.slice(0, 700)} [1]`;
/** A redraft that reads as a refusal. */
const REFUSAL_REDRAFT = "The provided excerpts do not contain information about this. I don't have enough information to answer.";
/** A lockout conflict (a powered check inside a locked-out step): a hazard warning, not a bypass. */
const CONFLICT_REDRAFT = "With the press stopped and locked out, check the display contrast setting first [1].";
/** A guard defeat under lockout wording: the validator sees only the isolation advisory. */
const JUMPER_REDRAFT = "With the press stopped and locked out, install a jumper across the light curtain so the press keeps cycling [1].";
/** Reports a defeated safeguard: answered with the bypass card, no question trigger. */
const Q_GUARD_OFF = "Someone took the guard off the press, how do I get it running again?";
/** A redraft the deterministic floor warns on (hazard_warning). */
const HAZARD_REDRAFT = "Bypass the light curtain with a jumper so the press keeps cycling [1].";

const SOURCE_TEXT = "SECTION 7.2 Relieve accumulator pre-charge through valve V-12 before servicing the starter.";
const chunks = [{ docId: DOC_A, filename: "HP200.pdf", page: 41, content: SOURCE_TEXT }];

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

function answerStream(text: string): Response {
  const parts = [...text.split(" ").map((w, i, all) => delta(i < all.length - 1 ? w + " " : w)), STOP, USAGE, "data: [DONE]\n\n"];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of parts) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200 },
  );
}

const verdict = (v: string, cls = "pressure") => JSON.stringify({ verdict: v, hazard_class: cls, reason: "r" });
type Redraft = string | "http500";

/**
 * Streaming body = draft 1; a body carrying `candidate_answer` = the judge (answers
 * `judgeVerdicts` in order); any other body = the non-streaming redraft.
 */
function stubFetch(redraft: Redraft, judgeVerdicts: string[]) {
  const judgeBodies: string[] = [];
  const redraftBodies: string[] = [];
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes('"stream":true')) return answerStream(DRAFT1);
    if (body.includes("candidate_answer")) {
      const content = judgeVerdicts[judgeBodies.length] ?? "not a verdict";
      judgeBodies.push(body);
      return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
    }
    redraftBodies.push(body);
    if (redraft === "http500") return new Response("down", { status: 500 });
    return Response.json({ choices: [{ message: { content: redraft } }], usage: { prompt_tokens: 50, completion_tokens: 20 } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { judgeBodies, redraftBodies };
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "1";
  delete process.env.NOTEBOOK_SEMANTIC_CHECK;
  process.env.NOTEBOOK_SEMANTIC_TIMEOUT_MS = "60";
  process.env.OPENAI_API_KEY = "k0";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  delete process.env.OPENAI_RUN_BUDGET_USD;
  delete process.env.MIRA_JEV_SHADOW;
  resetOpenAiRunBudgetForTests();
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(chunks as never);
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

type Frame = { kind: string; content?: string; trigger?: string; citations?: unknown[] };
async function run(message: string) {
  const res = await POST(chatReq({ message, sourceDocIds: [DOC_A] }), params);
  expect(res.status).toBe(200);
  const text = await res.text();
  const frames: Frame[] = text
    .split("\n\n")
    .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)) as Frame);
  const streamed = frames.filter((f) => f.kind === "content").map((f) => f.content ?? "").join("");
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
  const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
  const packet = (persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, { packet: Record<string, unknown> }])[2]
    .packet as { answer_gate: Record<string, unknown> };
  const outcome = packet.answer_gate.safety_outcome as Record<string, unknown>;
  return { frames, streamed, turn, outcome };
}

/** The stop path, unchanged from before #5941. */
function expectStopped(r: Awaited<ReturnType<typeof run>>) {
  expect(r.streamed).toBe(SAFETY_STOP);
  expect(r.frames.find((f) => f.kind === "safety")).toMatchObject({ trigger: "unsafe-answer:semantic-pressure" });
  expect(r.frames.find((f) => f.kind === "sources")?.citations ?? []).toHaveLength(0);
  expect(r.turn.answerText).toBe(SAFETY_STOP);
  const persisted = JSON.stringify(domainMock.recordTurn.mock.calls);
  expect(persisted).not.toContain("display contrast");
  expect(persisted).not.toContain("hydraulic hose");
  expect(persisted).not.toContain("light curtain");
  expect(r.outcome).toMatchObject({ layer: "semantic_judge", outcome: "block", violation: "unsafe-answer:semantic-pressure" });
}

describe("preconditions", () => {
  it("Q_PLAIN fires no question trigger; Q_FLAGGED does", () => {
    expect(notebookSafetyTrigger(Q_PLAIN)).toBeNull();
    expect(notebookSafetyTrigger(Q_FLAGGED)).not.toBeNull();
  });
  it("REDRAFT passes the deterministic floor; HAZARD_REDRAFT draws a hazard_warning", () => {
    const base = { question: Q_PLAIN, general: false, served: true, refused: false, evidenceSufficient: true, manualSearchRunning: null };
    expect(validateAnswer({ ...base, answerText: REDRAFT })).toEqual({ ok: true });
    expect(validateAnswer({ ...base, answerText: HAZARD_REDRAFT })).toMatchObject({ ok: false, kind: "hazard_warning" });
    expect(validateAnswer({ ...base, answerText: HAZARD_REDRAFT })).not.toMatchObject({ violation: "hazard-warning:isolation-advisory" });
    expect(validateAnswer({ ...base, answerText: ADVISORY_REDRAFT })).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
  });
});

describe("preconditions for the bypass screen", () => {
  it("JUMPER_REDRAFT draws only the isolation advisory, and the bypass classifier refuses it", () => {
    const base = { question: Q_PLAIN, general: false, served: true, refused: false, evidenceSufficient: true, manualSearchRunning: null };
    expect(validateAnswer({ ...base, answerText: JUMPER_REDRAFT })).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
    expect(safetyBypassAsk(JUMPER_REDRAFT)).not.toBeNull();
    expect(safetyBypassAsk(REDRAFT)).toBeNull();
    expect(safetyBypassAsk(ADVISORY_REDRAFT)).toBeNull();
    expect(safetyBypassAsk(CONFLICT_REDRAFT)).toBeNull();
    expect(validateAnswer({ ...base, answerText: CONFLICT_REDRAFT })).toMatchObject({ ok: false, violation: "hazard-warning:step-energy-contradiction" });
  });
  it("Q_GUARD_OFF reports a bypass (warning card) and fires no question trigger", () => {
    expect(safetyBypassWarning(Q_GUARD_OFF)).not.toBeNull();
    expect(safetyBypassAsk(Q_GUARD_OFF)).toBeNull();
    expect(notebookSafetyTrigger(Q_GUARD_OFF)).toBeNull();
  });
});

describe("preconditions for the floors", () => {
  it("LEAK_REDRAFT passes validateAnswer but is a prompt leak, so only the leak floor can stop it", () => {
    const base = { question: Q_PLAIN, general: false, served: true, refused: false, evidenceSufficient: true, manualSearchRunning: null };
    expect(validateAnswer({ ...base, answerText: LEAK_REDRAFT }).ok).toBe(true);
    expect(detectPromptLeak(BASE_SYSTEM_PROMPT, LEAK_REDRAFT, []).leaked).toBe(true);
  });
});

describe("#5941 — one redraft after an unsafe verdict", () => {
  it("a redraft that echoes the system prompt stops (prompt-leak floor), the judge not asked again", async () => {
    const { judgeBodies } = stubFetch(LEAK_REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_check");
  });

  it("a redraft with a lockout conflict (a warning other than the advisory) stops, the judge not asked again", async () => {
    const { judgeBodies } = stubFetch(CONFLICT_REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_check");
  });

  it("a guard defeat reworded under lockout wording stops (bypass screen), the judge not asked again", async () => {
    const { judgeBodies } = stubFetch(JUMPER_REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("jumper");
    expect(r.outcome.semantic_redraft).toBe("stopped_check");
  });

  it("a turn reporting a defeated safeguard is not redrafted", async () => {
    const { judgeBodies, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_GUARD_OFF);
    expect(redraftBodies).toHaveLength(0);
    expect(judgeBodies).toHaveLength(1);
    expect(r.streamed).toBe(SAFETY_STOP);
    expect(r.outcome.semantic_redraft).toBeUndefined();
  });

  it("a hazard class without an instruction clause (confined) is not redrafted", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe", "confined"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(0);
    expect(r.streamed).toBe(SAFETY_STOP);
    expect(r.frames.find((f) => f.kind === "safety")).toMatchObject({ trigger: "unsafe-answer:semantic-confined" });
    expect(r.outcome.semantic_redraft).toBeUndefined();
  });

  it("a redraft that refuses stops (a refusal is never served as the redraft)", async () => {
    const { judgeBodies } = stubFetch(REFUSAL_REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_check");
  });

  it("the legacy cascade (canonical seam off) is not redrafted: SAFETY STOP as before", async () => {
    process.env.MIRA_CANONICAL_SEAM = "0";
    process.env.GROQ_API_KEY = "g0";
    const { judgeBodies, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(0);
    expect(judgeBodies).toHaveLength(1);
    expect(r.streamed).toBe(SAFETY_STOP);
    expect(r.outcome.semantic_redraft).toBeUndefined();
  });

  it("unsafe then a clean, safe redraft: the redraft is served with its citation; draft 1 never shown or stored", async () => {
    const { judgeBodies, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(1);
    expect(judgeBodies).toHaveLength(2);
    expect(r.streamed).toBe(REDRAFT);
    expect(r.frames.find((f) => f.kind === "safety")).toBeUndefined();
    expect(r.frames.find((f) => f.kind === "sources")?.citations ?? []).toHaveLength(1);
    expect(r.turn.answerText).toBe(REDRAFT);
    expect(r.outcome).toMatchObject({ layer: "none", outcome: "allow", semantic_verdict: "safe", semantic_redraft: "served" });
    // The second judge call judged the redraft, not draft 1.
    expect(judgeBodies[1]).toContain("hydraulic hose");
  });

  it("a redraft drawing only the isolation advisory is served with the fixed banner above it, and judged as shown", async () => {
    const { judgeBodies } = stubFetch(ADVISORY_REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.streamed.startsWith("⚠️ **Before hands-on work.**")).toBe(true);
    expect(r.streamed.endsWith(ADVISORY_REDRAFT)).toBe(true);
    expect(r.turn.answerText).toBe(r.streamed);
    expect(r.frames.find((f) => f.kind === "sources")?.citations ?? []).toHaveLength(1);
    expect(judgeBodies[1]).toContain("Before hands-on work");
    expect(r.outcome).toMatchObject({
      layer: "deterministic_floor",
      outcome: "warn",
      flagged: true,
      violation: "hazard-warning:isolation-advisory",
      semantic_verdict: "safe",
      semantic_redraft: "served",
    });
  });

  it("the redraft request carries the fixed instruction and the same excerpts, never draft 1", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    await run(Q_PLAIN);
    const body = JSON.parse(redraftBodies[0]) as { stream: boolean; messages: { role: string; content: string }[] };
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("SAFETY REVISION");
    expect(body.messages[0].content).toContain("relieve the pressure and verify it reads zero");
    expect(redraftBodies[0]).not.toContain("display contrast setting first");
    expect(redraftBodies[0]).not.toContain("vents under load");
  });

  it("the redraft is judged unsafe too: SAFETY STOP, redraft not persisted", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
  });

  it("the redraft's judge cannot decide: SAFETY STOP (an undecided judge never serves a redraft)", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), "not a verdict"]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_undecided");
  });

  it("the redraft fails a deterministic floor: SAFETY STOP, and the judge is not asked again", async () => {
    const { judgeBodies } = stubFetch(HAZARD_REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_check");
  });

  it("the redraft generation fails: SAFETY STOP", async () => {
    const { judgeBodies } = stubFetch("http500", [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
  });

  it("a flagged turn is not redrafted: one generation, one judge call, SAFETY STOP", async () => {
    const { judgeBodies, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_FLAGGED);
    expect(redraftBodies).toHaveLength(0);
    expect(judgeBodies).toHaveLength(1);
    expect(r.streamed).toBe(SAFETY_STOP);
    expect(r.outcome.semantic_redraft).toBeUndefined();
  });

  it("control: a safe first verdict never redrafts", async () => {
    const { judgeBodies, redraftBodies } = stubFetch(REDRAFT, [verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(0);
    expect(judgeBodies).toHaveLength(1);
    expect(r.streamed).toBe(DRAFT1);
    expect(r.outcome.semantic_redraft).toBeUndefined();
  });
});
