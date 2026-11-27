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
  retrieveCitedPageChunks: vi.fn(async () => [] as unknown[]),
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
/** A refusal whose only valid marker sits inside its limitation sentence: cited, still a refusal. */
const REFUSAL_REDRAFT = "The provided excerpts do not contain information about this [1]. I don't have enough information to answer.";
/** A lockout conflict (a powered check inside a locked-out step): a hazard warning, not a bypass. */
const CONFLICT_REDRAFT = "With the press stopped and locked out, check the display contrast setting first [1].";
/** The served redraft's text with no marker, and with a marker that resolves to no excerpt. */
const NOCITE_REDRAFT = "With the press stopped and locked out, check the hydraulic hose for wear.";
const BADCITE_REDRAFT = "With the press stopped and locked out, check the hydraulic hose for wear [9].";
/** A guard defeat under lockout wording: the validator sees only the isolation advisory. */
const JUMPER_REDRAFT = "With the press stopped and locked out, install a jumper across the light curtain so the press keeps cycling [1].";
/** Reports a defeated safeguard: answered with the bypass card, no question trigger. */
const Q_GUARD_OFF = "Someone took the guard off the press, how do I get it running again?";
/** A redraft the deterministic floor warns on (hazard_warning). */
const HAZARD_REDRAFT = "Bypass the light curtain with a jumper so the press keeps cycling [1].";

/** The cited page supports the served redrafts below (#6020): hose wear, the ribbon cable connector. */
const SOURCE_TEXT =
  "SECTION 7.2 Relieve accumulator pre-charge through valve V-12 before servicing the starter. " +
  "Inspect the hydraulic hose for wear and the ribbon cable connector for looseness.";
/** The same page number, holding nothing the redraft says (#6020). */
const UNRELATED_TEXT = "SECTION 2.1 Paint colour codes for the panels and the decals are listed in Appendix C.";
const chunks = [{ docId: DOC_A, filename: "HP200.pdf", page: 41, content: SOURCE_TEXT }];

const chatReq = (body: unknown, signal?: AbortSignal) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...(signal ? { signal } : {}),
  });
const params = { params: Promise.resolve({ id: NB }) };

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;
const STOP = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;
const usageChunk = (out: number) => `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: out } })}\n\n`;

function answerStream(text: string, out = 7): Response {
  const parts = [...text.split(" ").map((w, i, all) => delta(i < all.length - 1 ? w + " " : w)), STOP, usageChunk(out), "data: [DONE]\n\n"];
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
type StubOpts = {
  /** The redraft choice's finish_reason (default "stop"; null = none sent). */
  finish?: string | null;
  /** Draft 1's reported completion tokens (default 7). */
  draft1Output?: number;
  /** Redraft requests to a URL containing this fail with 500 (the next provider serves). */
  failRedraftAt?: string;
  /** Runs when the second judge call arrives, before it answers. */
  onSecondJudge?: () => void;
};

function stubFetch(redraft: Redraft, judgeVerdicts: string[], o: StubOpts = {}) {
  const judgeBodies: string[] = [];
  const redraftBodies: string[] = [];
  const redraftUrls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes('"stream":true')) return answerStream(DRAFT1, o.draft1Output);
    if (body.includes("candidate_answer")) {
      const content = judgeVerdicts[judgeBodies.length] ?? "not a verdict";
      judgeBodies.push(body);
      if (judgeBodies.length === 2) o.onSecondJudge?.();
      return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
    }
    redraftBodies.push(body);
    redraftUrls.push(String(url));
    if (redraft === "http500" || (o.failRedraftAt && String(url).includes(o.failRedraftAt))) return new Response("down", { status: 500 });
    const finish = o.finish === undefined ? "stop" : o.finish;
    return Response.json({
      choices: [{ message: { content: redraft }, finish_reason: finish }],
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { judgeBodies, redraftBodies, redraftUrls };
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
async function run(message: string, signal?: AbortSignal) {
  const res = await POST(chatReq({ message, sourceDocIds: [DOC_A] }, signal), params);
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
  const [meta, usage] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
  return { frames, streamed, turn, outcome, meta, usage };
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

describe("preconditions for source support (#6020)", () => {
  it("the redraft's words are on SOURCE_TEXT and on none of UNRELATED_TEXT", () => {
    for (const w of ["hydraulic", "hose", "wear"]) {
      expect(SOURCE_TEXT.toLowerCase()).toContain(w);
      expect(UNRELATED_TEXT.toLowerCase()).not.toContain(w);
    }
  });
});

describe("#6020 — a redraft that replaces a stop needs source support, not just a valid marker", () => {
  it("a valid marker on an unrelated page and a safe verdict: the stop stands, zero citations, the judge never asked", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], content: UNRELATED_TEXT }] as never);
    const { judgeBodies, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(1);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_unsupported");
  });

  it("the notebook's machine name on the page is not support for an invented step", async () => {
    // getNotebook's displayName is "Press 4 hydraulics"; the question never says "press".
    expect(Q_PLAIN.toLowerCase()).not.toContain("press");
    ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], content: "Acme HP-200 press. Inspect the hydraulic hose for wear." }] as never);
    stubFetch("With the press stopped and locked out, replace the ram seal kit [1].", [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(r.outcome.semantic_redraft).toBe("stopped_unsupported");
  });

  it("control: the same redraft against the page that supports it is served", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.streamed).toBe(REDRAFT);
    expect(r.outcome.semantic_redraft).toBe("served");
  });
});

// #6049 (Codex round 3 on #6001, F8): the source check exempted every zero value, so a redraft
// could tell the technician to set a delay to 0 ms while citing a page that says 800 ms.
describe("#6049 — a cited zero setpoint is checked against its page", () => {
  const ZERO_DELAY = "With the press stopped and locked out, set the pre-charge delay to 0 ms [1].";
  const PAGE_800 = "SECTION 7.4 Pre-charge sequence. Set the pre-charge delay to 800 ms before enabling the main contactor.";
  const PAGE_0 = "SECTION 7.4 Pre-charge sequence. Set the pre-charge delay to 0 ms when the bypass kit is fitted.";

  it("a redraft that sets the delay to 0 ms while its page says 800 ms: the stop stands, zero citations, the judge never asked", async () => {
    expect(PAGE_800).not.toContain("0 ms when");
    ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], content: PAGE_800 }] as never);
    const { judgeBodies, redraftBodies } = stubFetch(ZERO_DELAY, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(1);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_unsupported");
  });

  it("control: the same redraft against a page that says 0 ms is served", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], content: PAGE_0 }] as never);
    stubFetch(ZERO_DELAY, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.streamed).toBe(ZERO_DELAY);
    expect(r.outcome.semantic_redraft).toBe("served");
  });

  it("REVERSAL of #6001: a redraft stating a zero pressure reading in DIGITS that its page does not print is now stopped", async () => {
    const READING = "With the press stopped and locked out, relieve the pressure until the hose gauge reads 0 psi [1]. Then check the hydraulic hose for wear [1].";
    expect(SOURCE_TEXT).not.toContain("0 psi");
    const { judgeBodies } = stubFetch(READING, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_unsupported");
  });

  it("control: the same reading in words, as the redraft instruction asks for it, is still served", async () => {
    const READING = "With the press stopped and locked out, relieve the pressure and verify the hose gauge reads zero [1]. Then check the hydraulic hose for wear [1].";
    stubFetch(READING, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.streamed).toBe(READING);
    expect(r.outcome.semantic_redraft).toBe("served");
  });
});

describe("#6019 — a Stop after the redraft's judge and before the commit point keeps the stop", () => {
  /** Holds the cited-page read open until released; `entered` resolves when the route reaches it. */
  function holdCitedPageRead() {
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((res) => (entered = res));
    const gate = new Promise<void>((res) => (release = res));
    // A page number the cited-page read can address (the shared fixture carries none).
    ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], sourceUrl: "nb://HP200.pdf", sourcePage: 41 }] as never);
    ragMock.retrieveCitedPageChunks.mockImplementation(async () => {
      entered();
      await gate;
      return [{ ...chunks[0], chunkId: "c9", content: "WARNING relieve pressure before servicing the hose." }] as never;
    });
    return { reached, release };
  }

  it("a Stop during the cited-page read: no redraft text or citations stored, the stop recorded as the stop path records it", async () => {
    const ac = new AbortController();
    const { judgeBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const hold = holdCitedPageRead();
    const pending = run(Q_PLAIN, ac.signal);
    await hold.reached;
    // The read was entered only after the second judge passed the redraft.
    expect(judgeBodies).toHaveLength(2);
    ac.abort();
    hold.release();
    const r = await pending;
    expectStopped(r);
    expect(r.outcome).toMatchObject({ semantic_verdict: "unsafe", semantic_redraft: "stopped_aborted" });
    expect(r.meta.outcome).toBe("safety_stop");
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("stopped and locked out");
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("WARNING relieve pressure");
    // Spend still counts both generations, under draft 1's model.
    expect(String(r.turn.model)).toMatch(/^OpenAI:/);
    expect(r.usage).toMatchObject({ provider: "OpenAI", inputTokens: 12 + 50, outputTokens: 7 + 20 });
  });

  it("a Stop during the cited-page read on a redraft served by another provider restores draft 1's model", async () => {
    process.env.GROQ_API_KEY = "g0";
    const ac = new AbortController();
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { failRedraftAt: "api.openai.com" });
    const hold = holdCitedPageRead();
    const pending = run(Q_PLAIN, ac.signal);
    await hold.reached;
    ac.abort();
    hold.release();
    const r = await pending;
    expectStopped(r);
    expect(String(r.turn.model)).toMatch(/^OpenAI:/);
    expect(r.usage).toMatchObject({ provider: "OpenAI" });
  });

  it("control: the same held read with no Stop serves the redraft with its citation", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const hold = holdCitedPageRead();
    const pending = run(Q_PLAIN);
    await hold.reached;
    hold.release();
    const r = await pending;
    expect(r.streamed).toBe(REDRAFT);
    expect(r.frames.find((f) => f.kind === "sources")?.citations ?? []).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.meta.outcome).toBe("answered");
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

  it("a redraft cut at the output cap (finish_reason length, or none sent) stops before the judge; a finished one is the control", async () => {
    for (const finish of ["length", null]) {
      vi.clearAllMocks();
      const { judgeBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { finish });
      const r = await run(Q_PLAIN);
      expectStopped(r);
      expect(judgeBodies).toHaveLength(1);
      expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("stopped and locked out");
      expect(r.outcome.semantic_redraft).toBe("stopped_incomplete");
    }
    vi.clearAllMocks();
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { finish: "stop" });
    expect((await run(Q_PLAIN)).outcome.semantic_redraft).toBe("served");
  });

  it("a Stop during the second judge: the redraft is never adopted, streamed or stored, and the turn is not answered", async () => {
    const ac = new AbortController();
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { onSecondJudge: () => ac.abort() });
    const r = await run(Q_PLAIN, ac.signal);
    expect(r.streamed).not.toContain("stopped and locked out");
    expect(r.frames.find((f) => f.kind === "sources")?.citations ?? []).toHaveLength(0);
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("stopped and locked out");
    expect(r.meta.outcome).not.toBe("answered");
    expect(r.outcome.semantic_redraft).toBe("stopped_aborted");
  });

  it("a redraft with no citation, or only a marker that resolves to no excerpt, stops before the judge", async () => {
    for (const text of [NOCITE_REDRAFT, BADCITE_REDRAFT]) {
      vi.clearAllMocks();
      const { judgeBodies } = stubFetch(text, [verdict("unsafe"), verdict("safe", "none")]);
      const r = await run(Q_PLAIN);
      expectStopped(r);
      expect(judgeBodies).toHaveLength(1);
      expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("hydraulic hose");
      expect(r.outcome.semantic_redraft).toBe("stopped_check");
    }
  });

  it("the redraft gets only what is left of the per-turn output ceiling, and none when too little is left", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "500";
    const first = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: 7 });
    const r1 = await run(Q_PLAIN);
    expect(r1.outcome.semantic_redraft).toBe("served");
    const body = JSON.parse(first.redraftBodies[0]) as { max_tokens?: number; max_completion_tokens?: number };
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(493);
    vi.clearAllMocks();
    const second = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: 450 });
    const r2 = await run(Q_PLAIN);
    expect(second.redraftBodies).toHaveLength(0);
    expectStopped(r2);
    expect(r2.outcome.semantic_redraft).toBe("stopped_turn_cap");
  });

  it("a redraft served by another provider is attributed to it, and spend counts both generations", async () => {
    process.env.GROQ_API_KEY = "g0";
    const { redraftUrls } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { failRedraftAt: "api.openai.com" });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(redraftUrls.at(-1)).toContain("groq");
    expect(String(r.turn.model)).toMatch(/^Groq:/);
    expect(r.usage).toMatchObject({ provider: "Groq", inputTokens: 12 + 50, outputTokens: 7 + 20 });
  });

  it("a billed redraft that is withheld still counts in spend, under draft 1's model", async () => {
    stubFetch(HAZARD_REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    expect(String(r.turn.model)).toMatch(/^OpenAI:/);
    expect(r.usage).toMatchObject({ provider: "OpenAI", inputTokens: 12 + 50, outputTokens: 7 + 20 });
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
