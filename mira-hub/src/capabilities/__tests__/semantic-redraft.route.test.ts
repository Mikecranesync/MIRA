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
import { resetProviderHealthForTests } from "@/capabilities/provider-health";

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

/** Round 2: draft 1's stream with its completion_tokens written as raw JSON text. */
function answerStreamRawCount(text: string, rawOut: string): Response {
  return answerStreamRawUsage(text, `{"prompt_tokens":12,"completion_tokens":${rawOut}}`);
}

/** Round 3: draft 1's stream with its whole usage block written as raw JSON text. */
function answerStreamRawUsage(text: string, rawUsage: string): Response {
  const usage = `data: {"choices":[],"usage":${rawUsage}}\n\n`;
  const parts = [...text.split(" ").map((w, i, all) => delta(i < all.length - 1 ? w + " " : w)), STOP, usage, "data: [DONE]\n\n"];
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
  /**
   * Round 2: draft 1's completion_tokens as raw JSON text (e.g. `"7"` or `1e400`), for
   * malformed counts JSON.stringify cannot write (NaN/Infinity become null). Overrides draft1Output.
   */
  draft1OutputRaw?: string;
  /** Round 3: draft 1's whole usage block as raw JSON text (cached / prompt counts). Overrides both. */
  draft1UsageRaw?: string;
  /** Redraft requests to a URL containing this fail with 500 (the next provider serves). */
  failRedraftAt?: string;
  /** Runs when the second judge call arrives, before it answers. */
  onSecondJudge?: () => void;
  /**
   * #6021/#6022/#6023: per-host redraft replies, keyed by a URL substring. A host
   * listed here answers with these fields instead of `redraft` / `finish` / the
   * default usage; unlisted hosts keep the default behaviour.
   */
  byHost?: Record<string, HostReply>;
};
type HostReply = {
  /** A non-200 status: rejected before generation, nothing billed. */
  status?: number;
  /** The completion text (default ""). */
  content?: string;
  /** finish_reason (default "stop"; null = none sent). */
  finish?: string | null;
  /** The usage block as sent (undefined = no usage block). */
  usage?: unknown;
  /** The fetch throws a TimeoutError (accepted, maybe billed, usage unknown). */
  throws?: boolean;
};

function stubFetch(redraft: Redraft, judgeVerdicts: string[], o: StubOpts = {}) {
  const judgeBodies: string[] = [];
  const redraftBodies: string[] = [];
  const redraftUrls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes('"stream":true')) {
      if (o.draft1UsageRaw !== undefined) return answerStreamRawUsage(DRAFT1, o.draft1UsageRaw);
      return o.draft1OutputRaw === undefined ? answerStream(DRAFT1, o.draft1Output) : answerStreamRawCount(DRAFT1, o.draft1OutputRaw);
    }
    if (body.includes("candidate_answer")) {
      const content = judgeVerdicts[judgeBodies.length] ?? "not a verdict";
      judgeBodies.push(body);
      if (judgeBodies.length === 2) o.onSecondJudge?.();
      return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
    }
    redraftBodies.push(body);
    redraftUrls.push(String(url));
    const hostKey = o.byHost ? Object.keys(o.byHost).find((h) => String(url).includes(h)) : undefined;
    if (o.byHost && hostKey !== undefined) {
      const h = o.byHost[hostKey];
      if (h.throws) throw new DOMException("timed out", "TimeoutError");
      if (h.status !== undefined && h.status !== 200) return new Response("down", { status: h.status });
      return Response.json({
        choices: [{ message: { content: h.content ?? "" }, finish_reason: h.finish === undefined ? "stop" : h.finish }],
        ...(h.usage === undefined ? {} : { usage: h.usage }),
      });
    }
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
  const gen = (packet as unknown as { generation: PacketGeneration }).generation;
  return { frames, streamed, turn, outcome, meta, usage, gen };
}

/** The persisted packet's generation section (#6023). */
type PacketAttempt = { provider: string | null; model: string | null; outcome: string; [k: string]: unknown };
type PacketGeneration = {
  attempts: PacketAttempt[];
  served_provider: string | null;
  served_model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
};
/**
 * #6023 proposed packet names (the implementer adopts them or changes them here):
 * a redraft attempt carries `REDRAFT_MARKER: true`; a redraft that generated text
 * but was not served (late Stop, failed check, unsafe verdict) has outcome
 * `NOT_SERVED`. Draft 1's attempts carry no marker.
 */
const REDRAFT_MARKER = "redraft";
const NOT_SERVED = "generated_not_served";
const redraftAttempts = (g: PacketGeneration) => g.attempts.filter((a) => a[REDRAFT_MARKER] === true).map((a) => [a.provider, a.outcome]);
const draft1Providers = (g: PacketGeneration) => g.attempts.filter((a) => a[REDRAFT_MARKER] !== true).map((a) => a.provider);
const capOf = (body: string) => {
  const b = JSON.parse(body) as { max_tokens?: number; max_completion_tokens?: number };
  return b.max_tokens ?? b.max_completion_tokens;
};
const hostOf = (url: string) => new URL(url).host;

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
    // #6023 F6-a: the persisted packet agrees with the row and the ledger.
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", "http_error"],
      ["Groq", "served"],
    ]);
    expect(draft1Providers(r.gen)).toEqual(["OpenAI"]);
    expect(r.gen.served_provider).toBe("Groq");
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

describe("#6021 F4-a — the redraft allowance is held across redraft attempts", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "500";
    process.env.GROQ_API_KEY = "g0";
  });
  const sent = (urls: string[], bodies: string[]) => urls.map((u, i) => [hostOf(u), capOf(bodies[i])]);

  it("500 ceiling, 200-token draft 1: a billable empty 300-token first redraft opens NO backup request", async () => {
    const { redraftUrls, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1Output: 200,
      byHost: {
        "api.openai.com": { content: "", finish: "length", usage: { prompt_tokens: 50, completion_tokens: 300 } },
        "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(sent(redraftUrls, redraftBodies)).toEqual([["api.openai.com", 300]]);
    expect(r.streamed).toBe(SAFETY_STOP);
  });

  it("a billable first redraft with unknown usage (timeout) debits the whole request cap: no backup request", async () => {
    const { redraftUrls, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1Output: 200,
      byHost: { "api.openai.com": { throws: true }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(sent(redraftUrls, redraftBodies)).toEqual([["api.openai.com", 300]]);
    expect(r.streamed).toBe(SAFETY_STOP);
  });

  it("a negative output count on a billable first redraft cannot raise the allowance: no backup request", async () => {
    const { redraftUrls, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1Output: 200,
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: -1000 } },
        "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(sent(redraftUrls, redraftBodies)).toEqual([["api.openai.com", 300]]);
    expect(r.streamed).toBe(SAFETY_STOP);
  });

  it("control: a pre-generation rejection (HTTP 500, nothing billed) leaves the allowance, and the backup is asked with 300", async () => {
    const { redraftUrls, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1Output: 200,
      byHost: { "api.openai.com": { status: 500 }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(sent(redraftUrls, redraftBodies)).toEqual([
      ["api.openai.com", 300],
      ["api.groq.com", 300],
    ]);
    expect(r.outcome.semantic_redraft).toBe("served");
  });
});

describe("#6021 F4-b — a malformed draft-1 count cannot grant the redraft an allowance", () => {
  it("500 ceiling, draft 1 reports completion_tokens -50: no redraft request, stopped_turn_cap", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "500";
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: -50 });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(0);
    expect(r.outcome.semantic_redraft).toBe("stopped_turn_cap");
  });
});

describe("#6022 F5 — every billed redraft attempt reaches the turn's usage", () => {
  beforeEach(() => {
    // Loose ceiling: the allowance never decides these cases (request cap 800).
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });

  it("F5-a: an empty 200 with known usage counts when the redraft cascade is exhausted", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 30 } } },
    });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50, 7 + 30]);
  });

  it("F5-a: an empty 200 with known usage counts when a fallback serves the redraft", async () => {
    process.env.GROQ_API_KEY = "g0";
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 30 } },
        "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(2);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage.provider).toBe("Groq");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50 + 50, 7 + 30 + 20]);
  });

  it("F5-a control: an HTTP 500 before generation adds nothing to the turn's usage", async () => {
    process.env.GROQ_API_KEY = "g0";
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { status: 500 }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(2);
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50, 7 + 20]);
  });

  it("F5-b: a redraft attempt that times out makes the turn's totals unknown (NULL, never 0)", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { throws: true } },
    });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
    expect([r.usage.inputTokens, r.usage.outputTokens, r.usage.costUsdEstimate]).toEqual([null, null, null]);
  });

  it("F5-b control: the same single-provider redraft rejected with HTTP 500 keeps draft 1's known totals", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { status: 500 } },
    });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12, 7]);
  });

  it("a fallback-served redraft's ledger row carries the redraft's own route reason and attempted list", async () => {
    process.env.GROQ_API_KEY = "g0";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { status: 500 }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(r.usage.provider).toBe("Groq");
    expect(r.usage.routeReason).toBe("fallback:OpenAI");
    expect(r.usage.attempted).toEqual(["OpenAI"]);
  });

  it("control: a redraft served by the first provider keeps routeReason primary and an empty attempted list", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage.routeReason).toBe("primary");
    expect(r.usage.attempted).toEqual([]);
  });
});

describe("#6023 F6-a — the packet's generation section describes the served redraft", () => {
  beforeEach(() => {
    // Pinned: an inherited low ceiling would end these in stopped_turn_cap.
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });
  const groqServes = () =>
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { status: 500 }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });

  it("a redraft served by Groq: the packet's served provider and model are the ones on the conversation row", async () => {
    process.env.GROQ_API_KEY = "g0";
    groqServes();
    const r = await run(Q_PLAIN);
    expect(String(r.turn.model)).toMatch(/^Groq:/);
    expect(r.gen.served_provider).toBe("Groq");
    expect(`${r.gen.served_provider}:${r.gen.served_model}`).toBe(String(r.turn.model));
  });

  it("the packet's token totals describe the whole turn and equal the ledger row", async () => {
    process.env.GROQ_API_KEY = "g0";
    groqServes();
    const r = await run(Q_PLAIN);
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50, 7 + 20]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12 + 50, 7 + 20]);
  });

  it("an unresolved redraft attempt (timeout) makes the packet's token totals unknown", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { byHost: { "api.openai.com": { throws: true } } });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([null, null]);
  });

  it("control: a turn without a redraft keeps today's packet values (draft 1 only, equal to the ledger)", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBeUndefined();
    expect(r.gen.served_provider).toBe("OpenAI");
    expect(r.gen.attempts.map((a) => [a.provider, a.outcome])).toEqual([["OpenAI", "served"]]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12, 7]);
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12, 7]);
  });
});

describe("#6023 F6-b — a redraft that generated but was not served is recorded as attempted, never as served", () => {
  beforeEach(() => {
    // Pinned: an inherited low ceiling would end these in stopped_turn_cap.
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });
  function holdCitedPageRead() {
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((res) => (entered = res));
    const gate = new Promise<void>((res) => (release = res));
    ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], sourceUrl: "nb://HP200.pdf", sourcePage: 41 }] as never);
    ragMock.retrieveCitedPageChunks.mockImplementation(async () => {
      entered();
      await gate;
      return [] as never;
    });
    return { reached, release };
  }
  async function lateStopOnGroqRedraft() {
    process.env.GROQ_API_KEY = "g0";
    const ac = new AbortController();
    const { judgeBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { status: 500 }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const hold = holdCitedPageRead();
    const pending = run(Q_PLAIN, ac.signal);
    await hold.reached;
    // Precondition: the redraft passed its judge before the Stop (the late-Stop window).
    expect(judgeBodies).toHaveLength(2);
    ac.abort();
    hold.release();
    const r = await pending;
    expect(r.outcome.semantic_redraft).toBe("stopped_aborted");
    return r;
  }

  it("late Stop on a Groq redraft: the Groq generation is recorded as attempted, not served", async () => {
    const r = await lateStopOnGroqRedraft();
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", "http_error"],
      ["Groq", NOT_SERVED],
    ]);
  });

  it("control: late Stop on a Groq redraft: the packet's served provider is draft 1's, not the redraft's", async () => {
    const r = await lateStopOnGroqRedraft();
    expect(String(r.turn.model)).toMatch(/^OpenAI:/);
    expect(r.gen.served_provider).toBe("OpenAI");
  });

  it("a Groq redraft judged unsafe: recorded as attempted, and the packet's served provider stays draft 1's", async () => {
    process.env.GROQ_API_KEY = "g0";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")], {
      byHost: { "api.openai.com": { status: 500 }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", "http_error"],
      ["Groq", NOT_SERVED],
    ]);
    expect(r.gen.served_provider).toBe("OpenAI");
  });

  it("a redraft that fails a deterministic floor: recorded as attempted, not served", async () => {
    stubFetch(HAZARD_REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_check");
    expect(redraftAttempts(r.gen)).toEqual([["OpenAI", NOT_SERVED]]);
  });
});

// ---------------------------------------------------------------------------
// Round 2 (review r1 of b9b14e739): R1-C1 .. R1-C6 and the round-1 open risks.
// ---------------------------------------------------------------------------

/**
 * Round-2 proposed packet outcome names (the implementer adopts them or changes them
 * here, in one place):
 *  - DRAFT1_REPLACED: draft 1's attempt on a turn where a redraft replaced it and was
 *    served. Draft 1 generated text the turn did not serve, so the existing
 *    "generated_not_served" value; exactly one attempt is then "served" (R1-C6).
 *  - BILLED_EMPTY: a redraft attempt that answered 200 with KNOWN usage and produced
 *    no text: billed, so never the unbilled rejection's "http_error" (R1-C6).
 *  - USAGE_UNKNOWN: a billed attempt whose usage is unknown (timeout, unreadable body,
 *    a 200 with no usage block, or a malformed count): "exception", as round 1 records a
 *    timeout today. tools/qa/retrieval_acceptance.py keys on this value to accept NULL
 *    packet token totals (R1-C5), so the two halves must agree.
 */
const DRAFT1_REPLACED = "generated_not_served";
const BILLED_EMPTY = "empty_completion";
const USAGE_UNKNOWN = "exception";
const UNBILLED_REJECTION = "http_error";
/** Every attempt, in order: [provider, outcome, is a redraft attempt]. */
const allAttempts = (g: PacketGeneration) => g.attempts.map((a) => [a.provider, a.outcome, a[REDRAFT_MARKER] === true]);
const servedRedraftRouteReason = (g: PacketGeneration) =>
  g.attempts.filter((a) => a[REDRAFT_MARKER] === true && a.outcome === "served").map((a) => a.route_reason);

/** Wraps the stubbed fetch: draft-1 (streaming) requests to a host containing `hostSub` get `status` instead of a stream. */
function failDraft1At(hostSub: string, status: number) {
  const inner = globalThis.fetch as unknown as (u: string | URL | Request, i?: RequestInit) => Promise<Response>;
  const draft1Hosts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes('"stream":true')) {
        draft1Hosts.push(hostOf(String(url)));
        if (String(url).includes(hostSub)) return new Response("no", { status });
      }
      return inner(url, init);
    }),
  );
  return { draft1Hosts };
}

describe("R1-C1 — a fallback-served redraft records the providers the redraft passed over, however they were passed over", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
    process.env.MIRA_PROVIDER_UNHEALTHY_S = "300";
    process.env.GROQ_API_KEY = "g0";
    resetProviderHealthForTests();
  });
  afterEach(() => resetProviderHealthForTests());
  const ledger = (r: Awaited<ReturnType<typeof run>>) => [r.usage.provider, r.usage.routeReason, r.usage.attempted];

  it("OpenAI quarantined by draft 1's 401: the Groq redraft is stored as fallback:OpenAI, attempted [OpenAI]", async () => {
    const { redraftUrls } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const { draft1Hosts } = failDraft1At("api.openai.com", 401);
    const r = await run(Q_PLAIN);
    // Preconditions: draft 1 fell over to Groq on the 401; the redraft never asked OpenAI.
    expect(draft1Hosts).toEqual(["api.openai.com", "api.groq.com"]);
    expect(redraftUrls.map(hostOf)).toEqual(["api.groq.com"]);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(ledger(r)).toEqual(["Groq", "fallback:OpenAI", ["OpenAI"]]);
  });

  it("OpenAI quarantined by draft 1's 401: the packet's served redraft attempt carries route_reason fallback:OpenAI", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    failDraft1At("api.openai.com", 401);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(servedRedraftRouteReason(r.gen)).toEqual(["fallback:OpenAI"]);
  });

  it("OpenAI refused by the run budget: the Groq redraft is stored as fallback:OpenAI, attempted [OpenAI]", async () => {
    process.env.OPENAI_RUN_BUDGET_USD = "0.0000001";
    resetOpenAiRunBudgetForTests();
    const fetched: string[] = [];
    const { redraftUrls } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const inner = globalThis.fetch as unknown as (u: string | URL | Request, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => (fetched.push(hostOf(String(url))), inner(url, init))));
    const r = await run(Q_PLAIN);
    // Precondition: the budget refused OpenAI before every fetch, so nothing reached it.
    expect(fetched).not.toContain("api.openai.com");
    expect(redraftUrls.map(hostOf)).toEqual(["api.groq.com"]);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(ledger(r)).toEqual(["Groq", "fallback:OpenAI", ["OpenAI"]]);
  });

  it("ordered: OpenAI quarantined, Groq rejects the redraft with 500, Cerebras serves: fallback:OpenAI,Groq, attempted [OpenAI, Groq]", async () => {
    process.env.CEREBRAS_API_KEY = "c0";
    const { redraftUrls } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { groq: { status: 500 }, cerebras: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    failDraft1At("api.openai.com", 401);
    const r = await run(Q_PLAIN);
    expect(redraftUrls.map(hostOf)).toEqual(["api.groq.com", "api.cerebras.ai"]);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(ledger(r)).toEqual(["Cerebras", "fallback:OpenAI,Groq", ["OpenAI", "Groq"]]);
  });

  it("control: OpenAI times out on the redraft, Groq serves: fallback:OpenAI, attempted [OpenAI]", async () => {
    const { redraftUrls } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { throws: true }, groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(redraftUrls.map(hostOf)).toEqual(["api.openai.com", "api.groq.com"]);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(ledger(r)).toEqual(["Groq", "fallback:OpenAI", ["OpenAI"]]);
  });

  it("control: OpenAI answers a billed empty 200 on the redraft, Groq serves: fallback:OpenAI, attempted [OpenAI]", async () => {
    const { redraftUrls } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 30 } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(redraftUrls.map(hostOf)).toEqual(["api.openai.com", "api.groq.com"]);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(ledger(r)).toEqual(["Groq", "fallback:OpenAI", ["OpenAI"]]);
  });

  it("control: draft 1 fell back to Groq on a 500 (no quarantine) and OpenAI serves the redraft: primary, attempted []", async () => {
    const { redraftUrls } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const { draft1Hosts } = failDraft1At("api.openai.com", 500);
    const r = await run(Q_PLAIN);
    // Precondition: draft 1's own list was [OpenAI]; the redraft must not inherit it.
    expect(draft1Hosts).toEqual(["api.openai.com", "api.groq.com"]);
    expect(redraftUrls.map(hostOf)).toEqual(["api.openai.com"]);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(ledger(r)).toEqual(["OpenAI", "primary", []]);
  });
});

describe("R1-C2 — a malformed draft-1 count makes the whole-turn total unknown (NULL), never a number", () => {
  beforeEach(() => {
    // Loose ceiling: a malformed draft-1 count books the whole request cap and the redraft still runs.
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });
  const totals = (r: Awaited<ReturnType<typeof run>>) => ({
    ledger: [r.usage.inputTokens, r.usage.outputTokens],
    packet: [r.gen.input_tokens, r.gen.output_tokens],
  });

  it("draft 1 reports -5, the redraft is judged unsafe (stop): output total NULL in the ledger and the packet", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")], { draft1Output: -5 });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(1);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
    expect(totals(r)).toEqual({ ledger: [12 + 50, null], packet: [12 + 50, null] });
  });

  it("draft 1 reports -50, the redraft is served: output total NULL in the ledger and the packet", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: -50 });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(totals(r)).toEqual({ ledger: [12 + 50, null], packet: [12 + 50, null] });
  });

  it("draft 1 reports a non-number count (\"7\"), the redraft is judged unsafe: output total NULL", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")], { draft1OutputRaw: '"7"' });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
    expect(totals(r)).toEqual({ ledger: [12 + 50, null], packet: [12 + 50, null] });
  });

  it("draft 1 reports a non-finite count (1e400), the redraft is judged unsafe: output total NULL", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")], { draft1OutputRaw: "1e400" });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
    expect(totals(r)).toEqual({ ledger: [12 + 50, null], packet: [12 + 50, null] });
  });

  it("control: draft 1 reports 7, the redraft is judged unsafe: both totals are the known sums", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")], { draft1Output: 7 });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
    expect(totals(r)).toEqual({ ledger: [12 + 50, 7 + 20], packet: [12 + 50, 7 + 20] });
  });
});

describe("R1-C4 — a malformed cached_tokens count on a redraft attempt is unknown, never stored", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });
  const withCached = (cached: unknown) =>
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: cached } } },
      },
    });

  it("cached_tokens -5 on the served redraft: cachedInputTokens NULL", async () => {
    withCached(-5);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage.cachedInputTokens).toBeNull();
  });

  it("cached_tokens \"7\" (a string) on the served redraft: cachedInputTokens NULL, never the string \"07\"", async () => {
    withCached("7");
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage.cachedInputTokens).toBeNull();
  });

  it("control: cached_tokens 5 on the served redraft is stored as 5", async () => {
    withCached(5);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage.cachedInputTokens).toBe(5);
  });
});

describe("R1-C6 — exactly one attempt is served, and a billed empty completion is not an unbilled rejection", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });

  it("a redraft served by the same provider: draft 1's attempt is DRAFT1_REPLACED and only the redraft's is served", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(allAttempts(r.gen)).toEqual([
      ["OpenAI", DRAFT1_REPLACED, false],
      ["OpenAI", "served", true],
    ]);
  });

  it("a redraft served by Groq after an unbilled 500: one served attempt, the redraft's, and served_provider Groq", async () => {
    process.env.GROQ_API_KEY = "g0";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { status: 500 }, groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(allAttempts(r.gen)).toEqual([
      ["OpenAI", DRAFT1_REPLACED, false],
      ["OpenAI", UNBILLED_REJECTION, true],
      ["Groq", "served", true],
    ]);
    expect(r.gen.served_provider).toBe("Groq");
  });

  it("control: a redraft judged unsafe leaves draft 1's attempt the only served one", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")]);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
    expect(allAttempts(r.gen)).toEqual([
      ["OpenAI", "served", false],
      ["OpenAI", NOT_SERVED, true],
    ]);
  });

  it("a billed empty 200 with known usage, then Groq serves: the empty attempt is BILLED_EMPTY, not http_error", async () => {
    process.env.GROQ_API_KEY = "g0";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 30 } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", BILLED_EMPTY],
      ["Groq", "served"],
    ]);
  });

  it("control: an unbilled HTTP 500, then Groq serves: the rejection is http_error", async () => {
    process.env.GROQ_API_KEY = "g0";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { status: 500 }, groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", UNBILLED_REJECTION],
      ["Groq", "served"],
    ]);
  });

  it("a billed attempt with a malformed count (-1000), then Groq serves: the attempt's usage is unknown (USAGE_UNKNOWN), matching the NULL total", async () => {
    process.env.GROQ_API_KEY = "g0";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: -1000 } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(r.usage.outputTokens).toBeNull();
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", USAGE_UNKNOWN],
      ["Groq", "served"],
    ]);
  });
});

describe("R1-C3 — one test per mutation the r1 review found surviving", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "g0";
  });

  it("M1 (spent = instead of +=): 600 ceiling, 200-token draft 1, billed empty 150-token first redraft: no backup request", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "600";
    const { redraftUrls, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1Output: 200,
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 150 } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    // 600 - 200 - 150 = 250 < 256: the held allowance leaves nothing for a backup.
    expect(redraftUrls.map((u, i) => [hostOf(u), capOf(redraftBodies[i])])).toEqual([["api.openai.com", 400]]);
    expect(r.streamed).toBe(SAFETY_STOP);
  });

  it("M2 (redraft counts summed unsanitised): a -1000 output count on a billed first redraft makes the output total NULL", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: -1000 } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50 + 50, null]);
  });

  it("M3 (exception folded into http_error): a timed-out redraft attempt is recorded USAGE_UNKNOWN", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { throws: true }, groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", USAGE_UNKNOWN],
      ["Groq", "served"],
    ]);
  });

  it("M6 (redraft route_reason dropped): each redraft attempt in the packet carries its own route reason", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: { "api.openai.com": { status: 500 }, groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(r.gen.attempts.filter((a) => a[REDRAFT_MARKER] === true).map((a) => [a.provider, a.route_reason])).toEqual([
      ["OpenAI", "primary"],
      ["Groq", "fallback:OpenAI"],
    ]);
  });

  describe("M4 (billed non-generating attempts dropped from the late-Stop usage)", () => {
    beforeEach(() => {
      process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
    });
    function holdCitedPageRead() {
      let release!: () => void;
      let entered!: () => void;
      const reached = new Promise<void>((res) => (entered = res));
      const gate = new Promise<void>((res) => (release = res));
      ragMock.retrieveNodeChunks.mockResolvedValue([{ ...chunks[0], sourceUrl: "nb://HP200.pdf", sourcePage: 41 }] as never);
      ragMock.retrieveCitedPageChunks.mockImplementation(async () => {
        entered();
        await gate;
        return [] as never;
      });
      return { reached, release };
    }

    it("billed empty OpenAI redraft, Groq redraft served, late Stop: the ledger keeps all three generations under draft 1", async () => {
      const ac = new AbortController();
      const { judgeBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
        byHost: {
          "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 30 } },
          groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
        },
      });
      const hold = holdCitedPageRead();
      const pending = run(Q_PLAIN, ac.signal);
      await hold.reached;
      // Precondition: the redraft passed its judge before the Stop (the late-Stop window).
      expect(judgeBodies).toHaveLength(2);
      ac.abort();
      hold.release();
      const r = await pending;
      expect(r.outcome.semantic_redraft).toBe("stopped_aborted");
      expect([r.usage.provider, r.usage.inputTokens, r.usage.outputTokens]).toEqual(["OpenAI", 12 + 50 + 50, 7 + 30 + 20]);
    });
  });
});

describe("round-1 open risks, pinned", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });

  it("an empty 200 with no usage block on the only redraft attempt: totals NULL and the attempt USAGE_UNKNOWN", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { byHost: { "api.openai.com": { content: "" } } });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([null, null]);
    expect(redraftAttempts(r.gen)).toEqual([["OpenAI", USAGE_UNKNOWN]]);
  });

  it("the allowance runs out after a billed attempt: the redraft outcome is stopped_generation, not stopped_turn_cap", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "500";
    process.env.GROQ_API_KEY = "g0";
    const { redraftUrls } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1Output: 200,
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 300 } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(redraftUrls.map(hostOf)).toEqual(["api.openai.com"]);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
  });
});

describe("R1-C5 route side — usage_unknown marks the generating attempt whose unknown usage nulls the totals", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });
  const flags = (g: PacketGeneration) => g.attempts.map((a) => [a.provider, a.outcome, a[REDRAFT_MARKER] === true, a.usage_unknown === true]);

  it("draft 1 reports -50, the redraft is served: draft 1's replaced attempt carries usage_unknown", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: -50 });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.gen.output_tokens).toBeNull();
    expect(flags(r.gen)).toEqual([
      ["OpenAI", DRAFT1_REPLACED, false, true],
      ["OpenAI", "served", true, false],
    ]);
  });

  it("a served redraft with no usage block: the served attempt carries usage_unknown and the totals are NULL", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { byHost: { "api.openai.com": { content: REDRAFT } } });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([null, null]);
    expect(flags(r.gen)).toEqual([
      ["OpenAI", DRAFT1_REPLACED, false, false],
      ["OpenAI", "served", true, true],
    ]);
  });

  it("control: a clean served redraft puts no usage_unknown key on any attempt", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")]);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12 + 50, 7 + 20]);
    expect(r.gen.attempts.some((a) => "usage_unknown" in a)).toBe(false);
  });
});

/** Round 3: [provider, outcome, redraft?, usage_unknown?] for every packet attempt. */
const flagsOf = (g: PacketGeneration) => g.attempts.map((a) => [a.provider, a.outcome, a[REDRAFT_MARKER] === true, a.usage_unknown === true]);

describe("R2-C2 — a malformed draft-1 count is unknown on a redraft turn that sends no redraft request", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "500";
  });

  it("500 ceiling, draft 1 reports -5, stopped_turn_cap: output NULL in the ledger and the packet, draft 1 marked usage_unknown", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: -5 });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(0);
    expect(r.outcome.semantic_redraft).toBe("stopped_turn_cap");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12, null]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12, null]);
    expect(flagsOf(r.gen)).toEqual([["OpenAI", "served", false, true]]);
  });

  it("control: 500 ceiling, draft 1 reports 300, stopped_turn_cap: the known count is stored, no usage_unknown", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: 300 });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(0);
    expect(r.outcome.semantic_redraft).toBe("stopped_turn_cap");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12, 300]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12, 300]);
    expect(r.gen.attempts.some((a) => "usage_unknown" in a)).toBe(false);
  });
});

describe("R2-C4 — a cached count is known only when its own prompt count is known and the cached count is no larger", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
    process.env.GROQ_API_KEY = "g0";
  });
  const servedWithCached = (cached: number) =>
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: cached } } },
      },
    });

  it("(a) cached_tokens 1e9 against a 50-token prompt on the served redraft: cachedInputTokens NULL", async () => {
    servedWithCached(1e9);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.cachedInputTokens]).toEqual([12 + 50, null]);
  });

  it("(a) control: cached_tokens equal to the 50-token prompt is stored as 50", async () => {
    servedWithCached(50);
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.cachedInputTokens]).toEqual([12 + 50, 50]);
  });

  it("(a) a billed empty attempt whose cached count exceeds its prompt is USAGE_UNKNOWN, matching the NULL cached total", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 60 } } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage.cachedInputTokens).toBeNull();
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", USAGE_UNKNOWN],
      ["Groq", "served"],
    ]);
  });

  it("(b) draft 1 cached 3, the first redraft times out, Groq serves: the cached total is NULL with the others", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1UsageRaw: '{"prompt_tokens":12,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":3}}',
      byHost: { "api.openai.com": { throws: true }, groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.outputTokens]).toEqual([null, null, null]);
  });

  it("(b) control: draft 1 cached 3, the first redraft rejected unbilled (500), Groq serves: cached 3 is kept", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1UsageRaw: '{"prompt_tokens":12,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":3}}',
      byHost: { "api.openai.com": { status: 500 }, groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.outputTokens]).toEqual([12 + 50, 3, 7 + 20]);
  });
});

describe("R2-C3 — one test per round-2 mutation that survived", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
    process.env.GROQ_API_KEY = "g0";
  });

  it("E8 (input side not cleaned): draft 1 reports prompt_tokens -5, the redraft is judged unsafe: input NULL in the ledger and the packet", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")], { draft1UsageRaw: '{"prompt_tokens":-5,"completion_tokens":7}' });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([null, 7 + 20]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([null, 7 + 20]);
  });

  it("E21 (draft 1 marked only when served): draft 1 reports -5, the redraft is judged unsafe: draft 1's attempt carries usage_unknown", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("unsafe")], { draft1Output: -5 });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("stopped_judge_unsafe");
    expect(r.gen.output_tokens).toBeNull();
    expect(flagsOf(r.gen)).toEqual([
      ["OpenAI", "served", false, true],
      ["OpenAI", NOT_SERVED, true, false],
    ]);
  });

  it("E2 (cached reset removed): draft 1 cached 3, the served redraft reports cached_tokens -5: cachedInputTokens NULL, never 3", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1UsageRaw: '{"prompt_tokens":12,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":3}}',
      byHost: {
        "api.openai.com": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: -5 } } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.cachedInputTokens]).toEqual([12 + 50, null]);
  });

  it("E3 (cached clause dropped from knownUsage): a billed empty attempt with only cached_tokens malformed is USAGE_UNKNOWN", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 30, prompt_tokens_details: { cached_tokens: -5 } } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", USAGE_UNKNOWN],
      ["Groq", "served"],
    ]);
  });

  it("E7 (prompt clause dropped from knownUsage): a billed empty attempt with only prompt_tokens malformed is USAGE_UNKNOWN and input is NULL", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: -5, completion_tokens: 30 } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([null, 7 + 30 + 20]);
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", USAGE_UNKNOWN],
      ["Groq", "served"],
    ]);
  });

  it("E9 (draft 1's malformed cached count not marked): draft 1 cached -5, the redraft is served: draft 1 carries usage_unknown", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1UsageRaw: '{"prompt_tokens":12,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":-5}}',
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage.cachedInputTokens).toBeNull();
    expect(flagsOf(r.gen)).toEqual([
      ["OpenAI", DRAFT1_REPLACED, false, true],
      ["OpenAI", "served", true, false],
    ]);
  });

  it("E5 (spent starts at 0 for an unknown draft-1 count): 1500 ceiling, draft 1 reports -5: the first redraft is sent with 700", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "1500";
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: -5 });
    await run(Q_PLAIN);
    expect(redraftBodies.map(capOf)).toEqual([700]);
  });

  it("E5 control: 1500 ceiling, draft 1 reports 7: the first redraft is sent with the full 800 request cap", async () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "1500";
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1Output: 7 });
    await run(Q_PLAIN);
    expect(redraftBodies.map(capOf)).toEqual([800]);
  });
});
