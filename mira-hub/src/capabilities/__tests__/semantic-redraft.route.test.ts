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
  // #6062: the manufacturer-library lane, for the uncited_claim floor (empty unless a test sets it).
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

// #6048: call-through spies. `closeTurn` is the fire-and-forget lifecycle close that
// endRoot() starts when no settle has happened (it writes the closed row with a NULL
// packet, and the later usage write is then dropped by ON CONFLICT DO NOTHING).
// `evaluateTurnDecision` runs once per settle on the final path (decisionState is set).
vi.mock("@/capabilities/observability/turn-lifecycle", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/observability/turn-lifecycle")>();
  return { ...o, closeTurn: vi.fn(o.closeTurn) };
});
vi.mock("@/capabilities/observability/jev-decision", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/observability/jev-decision")>();
  return { ...o, evaluateTurnDecision: vi.fn(o.evaluateTurnDecision) };
});
// #6048: span attributes are recorded (the "traced" half of #6062's no-text check), and the
// normal path's post-settle span write can be made to throw (the once-guard case).
const spanTap = vi.hoisted(() => ({ calls: [] as unknown[], throwOnPersistOk: false }));
vi.mock("@/capabilities/observability/tracing", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/observability/tracing")>();
  return {
    ...o,
    setSpanAttrs: (...a: Parameters<typeof o.setSpanAttrs>) => {
      spanTap.calls.push(a[0]);
      if (spanTap.throwOnPersistOk && (a[0] as Record<string, unknown>)["mira.persist.outcome"] === "ok") {
        throw new Error("post-settle span write failed (test)");
      }
      return o.setSpanAttrs(...a);
    },
  };
});
// #6062: a pre-commit failure inside the answer-gate block (before recordTurn), on demand.
const decisionStateFail = vi.hoisted(() => ({ on: false }));
vi.mock("@/capabilities/observability/turn-decision-state", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/observability/turn-decision-state")>();
  return {
    ...o,
    buildTurnDecisionState: (...a: Parameters<typeof o.buildTurnDecisionState>) => {
      if (decisionStateFail.on) throw new Error("pre-commit failure (test)");
      return o.buildTurnDecisionState(...a);
    },
  };
});
// #6062: the screen's last dependency throws on this token (the `error` floor code).
vi.mock("@/capabilities/safety-bypass-advisory", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/safety-bypass-advisory")>();
  return {
    ...o,
    safetyBypassAsk: (t: string) => {
      if (t.includes("QZSCREENTHROW")) throw new Error("screen dependency failed (test)");
      return o.safetyBypassAsk(t);
    },
  };
});

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
const poolMock = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
  // Raw-pool client for the OEM corpus path (hybrid corpus law), used by the #6062 uncited_claim case.
  connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
}));
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

// ─────────────────────────────────────────────────────────────────────────────
// #6048 — once the turn's decision is committed to history (recordTurn), the Turn
// Evidence Packet and the usage row are persisted EXACTLY once, whatever happens to
// SSE delivery. The cancel below is a real ReadableStream reader cancel on the POST
// response body (not an abort of the request signal, which leaves the route's
// controller writable and cannot see this defect). After it, the route's next
// controller.enqueue throws on the closed stream.
// ─────────────────────────────────────────────────────────────────────────────
import { closeTurn as closeTurnSpy } from "@/capabilities/observability/turn-lifecycle";
import { evaluateTurnDecision as evaluateTurnDecisionSpy } from "@/capabilities/observability/jev-decision";

const ROW_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REQ_ID = "44444444-4444-4444-8444-444444444444";

type PersistCall = [
  { outcome: string; citationsPresent: boolean; answerText: string | null },
  { provider: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null },
  { packet: { answer_gate: Record<string, unknown>; persistence: { turn_row_id: string | null; outcome: string } } },
];

describe("#6048 — a body cancel after the commit still persists the packet and the usage exactly once", () => {
  const closeTurnMock = closeTurnSpy as unknown as ReturnType<typeof vi.fn>;
  const evaluateMock = evaluateTurnDecisionSpy as unknown as ReturnType<typeof vi.fn>;
  const settleAll = () => new Promise((r) => setTimeout(r, 150));

  beforeEach(() => {
    domainMock.recordTurn.mockImplementation(async () => ROW_ID as never);
  });
  afterEach(() => {
    domainMock.recordTurn.mockImplementation(async () => undefined);
    decisionStateFail.on = false;
    spanTap.throwOnPersistOk = false;
  });

  /** Holds the cited-page read (after the second judge, before the commit point) until released. */
  function holdRead() {
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((res) => (entered = res));
    const gate = new Promise<void>((res) => (release = res));
    ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], sourceUrl: "nb://HP200.pdf", sourcePage: 41 }] as never);
    ragMock.retrieveCitedPageChunks.mockImplementation(async () => {
      entered();
      await gate;
      return [{ ...chunks[0], chunkId: "c9", content: "WARNING relieve pressure before servicing the hose." }] as never;
    });
    return { reached, release };
  }
  const req = (body: Record<string, unknown>, progress: boolean) =>
    new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...(progress ? { "x-mira-progress": "1" } : {}) },
    });

  /** History row, the ONE persisted packet/usage row, after everything has had time to settle. */
  async function settled() {
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    await settleAll();
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    const [meta, usage, telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    const gate = telemetry.packet.answer_gate;
    const evidence = (turn.evidence as { kind?: string; citationId?: string }[]) ?? [];
    return { turn, meta, usage, packet: telemetry.packet, gate, outcome: gate.safety_outcome as Record<string, unknown>, evidence };
  }

  /** The persisted disposition equals what history holds. */
  function expectDispositionMatchesHistory(r: Awaited<ReturnType<typeof settled>>) {
    // A stored citation entry is the EvidenceCitation itself (it carries citationId, no kind).
    const historyCitations = r.evidence.filter((e) => typeof e.citationId === "string").length;
    expect(r.gate.citations_shipped).toBe(historyCitations);
    expect(r.meta.citationsPresent).toBe(historyCitations > 0);
    expect(r.packet.persistence.turn_row_id).toBe(ROW_ID);
    expect(r.packet.persistence.outcome).toBe("ok");
    expect(String(r.turn.model).startsWith(`${r.usage.provider}:`)).toBe(true);
    // The lifecycle row was closed by the usage write, never by endRoot's bare close.
    expect(closeTurnMock).not.toHaveBeenCalled();
    // One settle: the decision lane ran once (decisionState is set at the commit point).
    expect(evaluateMock).toHaveBeenCalledTimes(1);
  }

  /** The acceptance case: unsafe draft 1, safe redraft, the body cancelled during the held read. */
  async function redraftCancelledDuringRead(progress: boolean) {
    if (progress) process.env.MIRA_CHAT_PROGRESS = "1";
    const { judgeBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const hold = holdRead();
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, progress), params);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await hold.reached;
    // Precondition: the second judge already passed the redraft.
    expect(judgeBodies).toHaveLength(2);
    await reader.cancel();
    hold.release();
    const r = await settled();
    // History: one safety stop.
    expect(r.turn.answerText).toBe(SAFETY_STOP);
    expect(r.evidence.map((e) => e.kind)).toContain("safety_stop");
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("stopped and locked out");
    // The ONE packet: the committed stop, with both generations' usage under draft 1's model.
    expect(r.meta.outcome).toBe("safety_stop");
    expect(r.meta.answerText).toBe(SAFETY_STOP);
    expect(r.outcome).toMatchObject({ layer: "semantic_judge", outcome: "block", semantic_verdict: "unsafe", semantic_redraft: "stopped_aborted" });
    expect(r.gate.citations_shipped).toBe(0);
    expect(String(r.turn.model)).toMatch(/^OpenAI:/);
    expect(r.usage).toMatchObject({ provider: "OpenAI", inputTokens: 12 + 50, outputTokens: 7 + 20 });
    expectDispositionMatchesHistory(r);
  }

  it("redraft: body cancelled during the held cited-page read -> one stop in history, ONE packet stopped_aborted with both generations' usage", async () => {
    await redraftCancelledDuringRead(false);
  });

  it("redraft, progress stream on: the same cancel -> one stop, ONE packet stopped_aborted, both generations' usage", async () => {
    await redraftCancelledDuringRead(true);
  });

  /** An ordinary answered turn (safe first verdict, no redraft), the body cancelled at `when`. */
  async function answeredCancelledAt(when: "during_read" | "during_commit" | "after_content" | "after_usage", progress = false) {
    if (progress) process.env.MIRA_CHAT_PROGRESS = "1";
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("safe", "none")]);
    // eslint-disable-next-line prefer-const -- assigned after POST; read by hooks that run later
    let reader!: ReadableStreamDefaultReader<Uint8Array>;
    const hold = when === "during_read" ? holdRead() : null;
    if (when === "during_commit") {
      domainMock.recordTurn.mockImplementation(async () => {
        void reader.cancel();
        return ROW_ID as never;
      });
    }
    if (when === "after_content" || when === "after_usage") {
      const marker = when === "after_content" ? "gate released" : '"event":"turn.usage"';
      vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
        if (String(a[0]).includes(marker)) void reader.cancel();
      });
    }
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, progress), params);
    expect(res.status).toBe(200);
    reader = res.body!.getReader();
    if (hold) {
      await hold.reached;
      await reader.cancel();
      hold.release();
    }
    const r = await settled();
    expect(redraftBodies).toHaveLength(0);
    // History: answered, with draft 1 and its one citation.
    expect(r.turn.answerStatus).toBe("answered");
    expect(r.turn.answerText).toBe(DRAFT1);
    expect(r.evidence.filter((e) => typeof e.citationId === "string")).toHaveLength(1);
    // The ONE packet: answered, draft 1's spend only.
    expect(r.meta.outcome).toBe("answered");
    expect(r.meta.answerText).toBe(DRAFT1);
    expect(r.outcome).toMatchObject({ layer: "none", outcome: "allow", semantic_verdict: "safe" });
    expect(r.outcome.semantic_redraft).toBeUndefined();
    expect(r.usage).toMatchObject({ provider: "OpenAI", inputTokens: 12, outputTokens: 7 });
    expectDispositionMatchesHistory(r);
  }

  it("ordinary answered turn: body cancelled during the held cited-page read (before the first post-commit frame)", async () => {
    await answeredCancelledAt("during_read");
  });

  it("ordinary answered turn: body cancelled while the history write is in flight", async () => {
    await answeredCancelledAt("during_commit");
  });

  it("ordinary answered turn: body cancelled between frames (after the content, before sources)", async () => {
    await answeredCancelledAt("after_content");
  });

  it("ordinary answered turn: body cancelled between frames (after the usage frame, before status)", async () => {
    await answeredCancelledAt("after_usage");
  });

  it("ordinary answered turn, progress stream on: body cancelled between frames (after the content)", async () => {
    await answeredCancelledAt("after_content", true);
  });

  it("control: body read to the end, then the reader cancelled (after the last frame) -> persists exactly once", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    const reader = res.body!.getReader();
    let text = "";
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
      if (text.includes("data: [DONE]")) {
        await reader.cancel();
        break;
      }
    }
    const r = await settled();
    expect(r.turn.answerText).toBe(REDRAFT);
    expect(r.meta.outcome).toBe("answered");
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage).toMatchObject({ provider: "OpenAI", inputTokens: 12 + 50, outputTokens: 7 + 20 });
    expectDispositionMatchesHistory(r);
  });

  it("control: an uncancelled redraft turn persists exactly once, not twice, with the same frames in the same order", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r0 = await run(Q_PLAIN);
    // Today's frames, exactly (captured on the base commit 54afe7371).
    expect(r0.frames.map((f) => f.kind)).toEqual(["content", "sources", "evidence", "usage", "status"]);
    expect(r0.streamed).toBe(REDRAFT);
    await settleAll();
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    expect(closeTurnMock).not.toHaveBeenCalled();
    expect(evaluateMock).toHaveBeenCalledTimes(1);
  });

  it("control: an uncancelled stop turn keeps its frame order (safety before content) and persists once", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")]);
    const r0 = await run(Q_PLAIN);
    expectStopped(r0);
    // Today's frames, exactly: the safety frame before the first content byte.
    expect(r0.frames.map((f) => f.kind)).toEqual(["safety", "content", "content", "content", "content", "sources", "usage", "status"]);
    await settleAll();
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    expect(closeTurnMock).not.toHaveBeenCalled();
  });

  it("control (behavioural form of the jev-route-invariant pin): on a delivered turn the decision lane runs only after the body is complete", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    let bodyDone = false;
    const seenAtCall: boolean[] = [];
    const real = (await vi.importActual<typeof import("@/capabilities/observability/jev-decision")>("@/capabilities/observability/jev-decision"))
      .evaluateTurnDecision;
    evaluateMock.mockImplementation((...a: Parameters<typeof real>) => {
      seenAtCall.push(bodyDone);
      return real(...a);
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A] }, false), params);
    await res.text();
    bodyDone = true;
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await settleAll();
    expect(seenAtCall).toEqual([true]);
    evaluateMock.mockImplementation(real);
  });

  it("control (once-guard): a throw AFTER the normal-path settle does not write the packet a second time", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    spanTap.throwOnPersistOk = true;
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    await res.text().catch(() => "");
    const r = await settled();
    // Precondition: the injected throw really fired, after the settle.
    expect(spanTap.calls.some((c) => (c as Record<string, unknown>)["mira.persist.outcome"] === "ok")).toBe(true);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(evaluateMock).toHaveBeenCalledTimes(1);
  });

  it("control: a failure BEFORE the commit point persists no packet, writes no history, and abandons the request claim", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    decisionStateFail.on = true;
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    await res.text().catch(() => "");
    await settleAll();
    // Precondition: the failure really was before the commit point.
    expect(domainMock.recordTurn).not.toHaveBeenCalled();
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
    expect(domainMock.abandonNotebookTurnRequest).toHaveBeenCalledTimes(1);
  });

  it("control: a body cancel before the commit point (during draft 1's stream) records the stopped turn once, as today", async () => {
    let releaseDraft!: () => void;
    const draftGate = new Promise<void>((r) => (releaseDraft = r));
    let draftEntered!: () => void;
    const draftReached = new Promise<void>((r) => (draftEntered = r));
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes('"stream":true')) {
        return new Response(new ReadableStream<Uint8Array>({
          async start(c) {
            c.enqueue(enc.encode(delta("Check ")));
            draftEntered();
            await draftGate;
            c.enqueue(enc.encode(delta("the display [1].")));
            c.enqueue(enc.encode(STOP));
            c.enqueue(enc.encode(usageChunk(7)));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          },
        }), { status: 200 });
      }
      return Response.json({ choices: [{ message: { content: verdict("safe", "none") } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }));
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A] }, false), params);
    const reader = res.body!.getReader();
    await draftReached;
    await reader.cancel();
    releaseDraft();
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    await settleAll();
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn.answerStatus).toBe("error");
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #6062 — a redraft rejected by the answer floors records WHICH floor, as one code
// from a closed set, on the packet's safety_outcome:
//   semantic_redraft_check: the FIRST floor that rejected it, in the screen's order:
//     refusal, uncited_claim, rating_column, no_citation, hazard_warning, prompt_leak,
//     bypass_ask, error (a screen dependency threw).
//   semantic_redraft_check_violation: only beside hazard_warning, the validator's own
//     fixed violation code (never answer text).
// Present only when semantic_redraft is stopped_check; never any redraft text.
// ─────────────────────────────────────────────────────────────────────────────
import { refusalVerdict, isUncitedDocumentClaim } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { ratingColumnFinding } from "@/capabilities/rating-column";

/** Distinctive token placed in every redraft below: it must appear in no packet, history row or log line. */
const TOKEN = "QZX4471";
const RATINGS_TEXT =
  "Relay Contact Ratings\nMaximum\nVolts Amperes Amperes\nContinuous Volt-Amperes\nMake Break Make Break\n" +
  "120 V AC 15 A 1.5 A 2 A 1800 180\n240 V AC 7.5 A 0.75 A\n" +
  "Inspect the hydraulic hose for wear and the ribbon cable connector for looseness.";

const FLOOR_REDRAFT = {
  refusal: `The provided excerpts do not contain information about the ${TOKEN} [1]. I don't have enough information to answer.`,
  rating_column: `With the press stopped and locked out, the ${TOKEN} relay contact is rated 15 A [1].`,
  no_citation: `With the press stopped and locked out, check the ${TOKEN} hydraulic hose for wear.`,
  no_citation_badmarker: `With the press stopped and locked out, check the ${TOKEN} hydraulic hose for wear [9].`,
  hazard_conflict: `With the press stopped and locked out, check the ${TOKEN} display contrast setting first [1].`,
  hazard_bypass: `${TOKEN}: Bypass the light curtain with a jumper so the press keeps cycling [1].`,
  prompt_leak: `${BASE_SYSTEM_PROMPT.slice(0, 700)} ${TOKEN} [1]`,
  bypass_ask: `With the press stopped and locked out at panel ${TOKEN}, install a jumper across the light curtain so the press keeps cycling [1].`,
  error: `With the press stopped and locked out, check the QZSCREENTHROW ${TOKEN} hydraulic hose for wear [1].`,
} as const;

const vbase = { question: Q_PLAIN, general: false, served: true, refused: false, evidenceSufficient: true, manualSearchRunning: null };
const notRefusal = (t: string) => expect(refusalVerdict(t, { docGrounded: true, citations: [] })).toBe(false);
const ratingPassage = (content: string) => [{ content, title: "HP200.pdf", page: 41, cited: true }];

describe("#6062 preconditions: each redraft trips its floor first (the earlier floors pass)", () => {
  it("refusal is the first floor", () => {
    expect(refusalVerdict(FLOOR_REDRAFT.refusal, { docGrounded: true, citations: [] })).toBe(true);
  });
  it("rating_column: not a refusal, the notebook lane has no uncited-claim floor, the ratings floor fires; draft 1 passes it", () => {
    notRefusal(FLOOR_REDRAFT.rating_column);
    expect(isUncitedDocumentClaim(FLOOR_REDRAFT.rating_column, { oemGrounded: false, citations: [], exempt: false })).toBe(false);
    expect(ratingColumnFinding(Q_PLAIN, FLOOR_REDRAFT.rating_column, ratingPassage(RATINGS_TEXT))).not.toBeNull();
    expect(ratingColumnFinding(Q_PLAIN, DRAFT1, ratingPassage(RATINGS_TEXT))).toBeNull();
  });
  it("no_citation: not a refusal, no ratings figure; it carries no marker, or one that resolves to nothing", () => {
    for (const t of [FLOOR_REDRAFT.no_citation, FLOOR_REDRAFT.no_citation_badmarker]) {
      notRefusal(t);
      expect(ratingColumnFinding(Q_PLAIN, t, ratingPassage(SOURCE_TEXT))).toBeNull();
      expect(t).not.toContain("[1]");
    }
  });
  it("hazard_warning: cited, not a refusal, no ratings figure; the validator rejects it (not the isolation advisory)", () => {
    for (const t of [FLOOR_REDRAFT.hazard_conflict, FLOOR_REDRAFT.hazard_bypass]) {
      notRefusal(t);
      expect(ratingColumnFinding(Q_PLAIN, t, ratingPassage(SOURCE_TEXT))).toBeNull();
      expect(t).toContain("[1]");
      const v = validateAnswer({ ...vbase, answerText: t });
      expect(v).toMatchObject({ ok: false, kind: "hazard_warning" });
      expect(v).not.toMatchObject({ violation: "hazard-warning:isolation-advisory" });
    }
    expect(validateAnswer({ ...vbase, answerText: FLOOR_REDRAFT.hazard_conflict })).toMatchObject({ violation: "hazard-warning:step-energy-contradiction" });
    // The bypass wording would ALSO trip the later bypass_ask floor: the first floor wins.
    expect(safetyBypassAsk(FLOOR_REDRAFT.hazard_bypass)).not.toBeNull();
  });
  it("prompt_leak: passes every floor before it, and is a leak", () => {
    notRefusal(FLOOR_REDRAFT.prompt_leak);
    expect(validateAnswer({ ...vbase, answerText: FLOOR_REDRAFT.prompt_leak }).ok).toBe(true);
    expect(detectPromptLeak(BASE_SYSTEM_PROMPT, FLOOR_REDRAFT.prompt_leak, []).leaked).toBe(true);
  });
  it("bypass_ask: passes every floor before it (the validator sees only the advisory), not a leak, a bypass ask", () => {
    notRefusal(FLOOR_REDRAFT.bypass_ask);
    const v = validateAnswer({ ...vbase, answerText: FLOOR_REDRAFT.bypass_ask });
    expect(v).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
    expect(detectPromptLeak(BASE_SYSTEM_PROMPT, FLOOR_REDRAFT.bypass_ask, []).leaked).toBe(false);
    expect(safetyBypassAsk(FLOOR_REDRAFT.bypass_ask)).not.toBeNull();
  });
  it("error: passes every floor before the bypass screen, which throws on it", () => {
    notRefusal(FLOOR_REDRAFT.error);
    expect(validateAnswer({ ...vbase, answerText: FLOOR_REDRAFT.error }).ok).toBe(true);
    expect(detectPromptLeak(BASE_SYSTEM_PROMPT, FLOOR_REDRAFT.error, []).leaked).toBe(false);
    expect(() => safetyBypassAsk(FLOOR_REDRAFT.error)).toThrow();
  });
});

describe("#6062 — a redraft stopped by a floor records which floor, and never its text", () => {
  /** Everything the route wrote or logged on this turn, as one string. */
  const everything = () =>
    JSON.stringify([
      spanTap.calls,
      persistMock.persistTurnUsage.mock.calls,
      domainMock.recordTurn.mock.calls,
      (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls,
      (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls,
      (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ]);

  async function floorStop(text: string, setup?: () => void) {
    spanTap.calls.length = 0;
    setup?.();
    const { judgeBodies } = stubFetch(text, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expectStopped(r);
    // The screen stopped it: the judge was not asked again, the existing code is unchanged.
    expect(judgeBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_check");
    expect(everything()).not.toContain(TOKEN);
    return r;
  }

  it("refusal", async () => {
    const r = await floorStop(FLOOR_REDRAFT.refusal);
    expect(r.outcome.semantic_redraft_check).toBe("refusal");
    expect(r.outcome).not.toHaveProperty("semantic_redraft_check_violation");
  });

  it("rating_column", async () => {
    const r = await floorStop(FLOOR_REDRAFT.rating_column, () =>
      ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], content: RATINGS_TEXT, sourceUrl: "nb://HP200.pdf", sourcePage: 41 }] as never),
    );
    expect(r.outcome.semantic_redraft_check).toBe("rating_column");
    expect(r.outcome).not.toHaveProperty("semantic_redraft_check_violation");
  });

  it("no_citation (no marker, and a marker that resolves to no excerpt)", async () => {
    for (const t of [FLOOR_REDRAFT.no_citation, FLOOR_REDRAFT.no_citation_badmarker]) {
      vi.clearAllMocks();
      const r = await floorStop(t);
      expect(r.outcome.semantic_redraft_check).toBe("no_citation");
      expect(r.outcome).not.toHaveProperty("semantic_redraft_check_violation");
    }
  });

  it("hazard_warning, with the validator's own violation code beside it", async () => {
    for (const t of [FLOOR_REDRAFT.hazard_conflict, FLOOR_REDRAFT.hazard_bypass]) {
      vi.clearAllMocks();
      const want = (validateAnswer({ ...vbase, answerText: t }) as { violation: string }).violation;
      const r = await floorStop(t);
      expect(r.outcome.semantic_redraft_check).toBe("hazard_warning");
      expect(r.outcome.semantic_redraft_check_violation).toBe(want);
      expect(want).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });

  it("prompt_leak", async () => {
    const r = await floorStop(FLOOR_REDRAFT.prompt_leak);
    expect(r.outcome.semantic_redraft_check).toBe("prompt_leak");
    expect(r.outcome).not.toHaveProperty("semantic_redraft_check_violation");
  });

  it("bypass_ask", async () => {
    const r = await floorStop(FLOOR_REDRAFT.bypass_ask);
    expect(r.outcome.semantic_redraft_check).toBe("bypass_ask");
    expect(r.outcome).not.toHaveProperty("semantic_redraft_check_violation");
  });

  it("error (a screen dependency threw)", async () => {
    const r = await floorStop(FLOOR_REDRAFT.error);
    expect(r.outcome.semantic_redraft_check).toBe("error");
    expect(r.outcome).not.toHaveProperty("semantic_redraft_check_violation");
  });

  it("uncited_claim, on a manufacturer-library turn (before no_citation, which the same text would also trip)", async () => {
    const OEM_CHUNK = {
      content: "The TP700 Comfort accepts a 24 V DC supply on terminal X80. Relieve pressure on the cooling loop before opening it.",
      manufacturer: "Siemens",
      modelNumber: "TP700 Comfort",
      sourceUrl: "https://support.example.com/tp700-comfort.pdf",
      sourcePage: 12,
      title: "TP700 Comfort operating instructions",
      rank: 1,
      verified: true,
    };
    const text = `With the panel isolated, check the ${TOKEN} supply terminal X80.`;
    notRefusal(text);
    expect(isUncitedDocumentClaim(text, { oemGrounded: true, citations: [], exempt: false })).toBe(true);
    domainMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Line 3 HMI", manufacturer: "Siemens", model: "TP700 Comfort" } as never);
    ragMock.retrieveManualChunks.mockResolvedValue([OEM_CHUNK] as never);
    const { judgeBodies } = stubFetch(text, [verdict("unsafe"), verdict("safe", "none")]);
    const res = await POST(chatReq({ message: "The panel shows no supply, what should I check", mode: "general" }), params);
    expect(res.status).toBe(200);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    // Precondition: this really was the identity-bound manufacturer-library search, and it redrafted.
    expect(ragMock.retrieveManualChunks).toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(judgeBodies).toHaveLength(1);
    const packet = (persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall)[2].packet;
    const outcome = packet.answer_gate.safety_outcome as Record<string, unknown>;
    expect(outcome.semantic_redraft).toBe("stopped_check");
    expect(outcome.semantic_redraft_check).toBe("uncited_claim");
    expect(everything()).not.toContain(TOKEN);
  });
});

describe("#6062 controls — no floor code unless the outcome is stopped_check", () => {
  const cases: { name: string; redraft: Redraft; verdicts: string[]; o?: StubOpts; want: string | undefined; setup?: () => void }[] = [
    { name: "served", redraft: REDRAFT, verdicts: [verdict("unsafe"), verdict("safe", "none")], want: "served" },
    { name: "served with the isolation advisory", redraft: ADVISORY_REDRAFT, verdicts: [verdict("unsafe"), verdict("safe", "none")], want: "served" },
    { name: "stopped_judge_unsafe", redraft: REDRAFT, verdicts: [verdict("unsafe"), verdict("unsafe")], want: "stopped_judge_unsafe" },
    { name: "stopped_judge_undecided", redraft: REDRAFT, verdicts: [verdict("unsafe"), "not a verdict"], want: "stopped_judge_undecided" },
    { name: "stopped_generation", redraft: "http500", verdicts: [verdict("unsafe")], want: "stopped_generation" },
    { name: "stopped_incomplete", redraft: REDRAFT, verdicts: [verdict("unsafe")], o: { finish: "length" }, want: "stopped_incomplete" },
    {
      name: "stopped_unsupported",
      redraft: REDRAFT,
      verdicts: [verdict("unsafe"), verdict("safe", "none")],
      want: "stopped_unsupported",
      setup: () => ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], content: UNRELATED_TEXT }] as never),
    },
    {
      name: "stopped_turn_cap",
      redraft: REDRAFT,
      verdicts: [verdict("unsafe")],
      o: { draft1Output: 450 },
      want: "stopped_turn_cap",
      setup: () => {
        process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "500";
      },
    },
    { name: "no redraft (a safe first verdict)", redraft: REDRAFT, verdicts: [verdict("safe", "none")], want: undefined },
  ];
  for (const c of cases) {
    it(`${c.name}: no semantic_redraft_check`, async () => {
      c.setup?.();
      stubFetch(c.redraft, c.verdicts, c.o);
      const r = await run(Q_PLAIN);
      expect(r.outcome.semantic_redraft).toBe(c.want);
      expect(r.outcome).not.toHaveProperty("semantic_redraft_check");
      expect(r.outcome).not.toHaveProperty("semantic_redraft_check_violation");
    });
  }

  it("stopped_aborted (a Stop during the second judge): no semantic_redraft_check", async () => {
    const ac = new AbortController();
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { onSecondJudge: () => ac.abort() });
    const r = await run(Q_PLAIN, ac.signal);
    expect(r.outcome.semantic_redraft).toBe("stopped_aborted");
    expect(r.outcome).not.toHaveProperty("semantic_redraft_check");
  });

  it("positive control for the text search: a served redraft's own words ARE found in what the route stored", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    await run(Q_PLAIN);
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).toContain("hydraulic hose for wear");
  });
});
