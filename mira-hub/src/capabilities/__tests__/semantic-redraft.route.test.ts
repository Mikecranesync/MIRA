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
// Codex round 2 on #6082 (F5): a call-through spy, so a test can see whether the handoff
// tracker was installed at all.
vi.mock("@/capabilities/response-handoff", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/response-handoff")>();
  return { ...o, createResponseHandoff: vi.fn(o.createResponseHandoff) };
});
// The sheet receipt wrapper: real, unless a test makes it fail.
vi.mock("@/capabilities/living-sheet/receipt", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/living-sheet/receipt")>();
  return { ...o, withSheetReceipt: vi.fn(o.withSheetReceipt) };
});
// The Living Work Sheet job read: the route reads the job once before it generates, and the
// sheet receipt reads it again after the turn handler has returned. Not found unless a test
// says otherwise, so no test here depends on the sheet.
const JOB_NOT_FOUND = { status: "job_not_found" };
const storeMock = vi.hoisted(() => ({ loadJob: vi.fn(async (): Promise<unknown> => ({ status: "job_not_found" })) }));
vi.mock("@/capabilities/living-sheet/store", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/living-sheet/store")>();
  return { ...o, loadJob: storeMock.loadJob };
});
// #6048: span attributes are recorded (the "traced" half of #6062's no-text check), and the
// normal path's post-settle span write can be made to throw (the once-guard case).
// R1-D2: the settle itself can be made to reject (`throwInSettle`: the span write inside
// finishAndPersist, outside its own try), and the root span's recordException / end are counted.
const spanTap = vi.hoisted(() => ({
  calls: [] as unknown[],
  throwOnPersistOk: false,
  throwInSettle: false,
  rootExceptions: [] as unknown[],
  rootEnds: 0,
}));
vi.mock("@/capabilities/observability/tracing", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/observability/tracing")>();
  return {
    ...o,
    setSpanAttrs: (...a: Parameters<typeof o.setSpanAttrs>) => {
      spanTap.calls.push(a[0]);
      if (spanTap.throwOnPersistOk && (a[0] as Record<string, unknown>)["mira.persist.outcome"] === "ok") {
        throw new Error("post-settle span write failed (test)");
      }
      if (spanTap.throwInSettle && "mira.anomalies" in (a[0] as Record<string, unknown>)) {
        throw new Error("settle span write failed (test)");
      }
      return o.setSpanAttrs(...a);
    },
    getTracer: () => {
      const tracer = o.getTracer();
      return new Proxy(tracer, {
        get(target, prop) {
          const v = Reflect.get(target, prop, target) as unknown;
          if (prop !== "startSpan") return typeof v === "function" ? v.bind(target) : v;
          return (...a: Parameters<typeof tracer.startSpan>) => {
            const span = target.startSpan(...a);
            if (a[0] !== "mira.turn") return span;
            const recordException = span.recordException.bind(span);
            const end = span.end.bind(span);
            span.recordException = (...e: Parameters<typeof span.recordException>) => {
              spanTap.rootExceptions.push(e[0]);
              return recordException(...e);
            };
            span.end = (...e: Parameters<typeof span.end>) => {
              spanTap.rootEnds += 1;
              return end(...e);
            };
            return span;
          };
        },
      });
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
// R1-D3: every string the bypass check was handed is recorded.
const bypassTap = vi.hoisted(() => ({ args: [] as string[] }));
vi.mock("@/capabilities/safety-bypass-advisory", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/capabilities/safety-bypass-advisory")>();
  return {
    ...o,
    safetyBypassAsk: (t: string) => {
      bypassTap.args.push(t);
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

/** Round 4: draft 1's stream with no usage block. */
function answerStreamNoUsage(text: string): Response {
  const parts = [...text.split(" ").map((w, i, all) => delta(i < all.length - 1 ? w + " " : w)), STOP, "data: [DONE]\n\n"];
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
  /** Round 4: draft 1's stream carries no usage block at all. Overrides the three above. */
  draft1NoUsage?: boolean;
  /** Round 4: runs when the first judge call arrives, before it answers. */
  onFirstJudge?: () => void;
  /** Round 4: the judge's usage block (default 40 prompt, 9 completion). */
  judgeUsage?: unknown;
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
      if (o.draft1NoUsage) return answerStreamNoUsage(DRAFT1);
      if (o.draft1UsageRaw !== undefined) return answerStreamRawUsage(DRAFT1, o.draft1UsageRaw);
      return o.draft1OutputRaw === undefined ? answerStream(DRAFT1, o.draft1Output) : answerStreamRawCount(DRAFT1, o.draft1OutputRaw);
    }
    if (body.includes("candidate_answer")) {
      const content = judgeVerdicts[judgeBodies.length] ?? "not a verdict";
      judgeBodies.push(body);
      if (judgeBodies.length === 1) o.onFirstJudge?.();
      if (judgeBodies.length === 2) o.onSecondJudge?.();
      return Response.json({ choices: [{ message: { content } }], usage: o.judgeUsage ?? { prompt_tokens: 40, completion_tokens: 9 } });
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

// #6049 (Codex round 3 on #6001, F8): the source check exempted every zero value, so a redraft
// could tell the technician to set a delay to 0 ms while citing a page that says 800 ms.
describe("#6049 — a cited zero setpoint is checked against its page", () => {
  const ZERO_DELAY = "With the press stopped and locked out, set the pre-charge delay to 0 ms [1].";
  const PAGE_800 = "SECTION 7.4 Pre-charge sequence. Set the pre-charge delay to 800 ms before enabling the main contactor.";
  const PAGE_0 = "SECTION 7.4 Pre-charge sequence. Set the pre-charge delay to 0 ms when the bypass kit is fitted.";

  it("a redraft that sets the delay to 0 ms while its page says 800 ms: the stop stands, zero citations, the judge never asked", async () => {
    // The page gives no zero delay ("800 ms" contains the text "0 ms", so look for a zero that stands alone).
    expect(PAGE_800).not.toMatch(/(?<![\d.,])0 ms/);
    expect(PAGE_0).toMatch(/(?<![\d.,])0 ms/);
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
import { JEV_ENDPOINT } from "@/capabilities/observability/jev-shadow";
import { createResponseHandoff as createResponseHandoffSpy } from "@/capabilities/response-handoff";
import { withSheetReceipt as withSheetReceiptSpy } from "@/capabilities/living-sheet/receipt";

const ROW_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REQ_ID = "44444444-4444-4444-8444-444444444444";

type PersistCall = [
  { outcome: string; citationsPresent: boolean; answerText: string | null; latencyMs: number | null },
  { provider: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null; status: string; routeReason: string },
  {
    turnRowId: string | null;
    packet: {
      answer_gate: Record<string, unknown>;
      persistence: { turn_row_id: string | null; outcome: string };
      jev_decision?: unknown;
      response_write?: { frames_written: boolean; citations_written: number };
    };
  },
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
    spanTap.throwInSettle = false;
    domainMock.abandonNotebookTurnRequest.mockImplementation(async () => undefined);
    delete process.env.MIRA_JEV_DECISION;
    delete process.env.JEV_API_KEY;
    storeMock.loadJob.mockReset();
    storeMock.loadJob.mockImplementation(async () => JOB_NOT_FOUND);
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

  /**
   * The persisted disposition equals what history holds. `decisionCalls`: a turn whose
   * delivery failed or was cancelled makes no decision call (Codex round 1 on #6082, F1); a
   * turn delivered in full makes one.
   */
  function expectDispositionMatchesHistory(r: Awaited<ReturnType<typeof settled>>, decisionCalls: 0 | 1 = 0) {
    // A stored citation entry is the EvidenceCitation itself (it carries citationId, no kind).
    const historyCitations = r.evidence.filter((e) => typeof e.citationId === "string").length;
    expect(r.gate.citations_shipped).toBe(historyCitations);
    expect(r.meta.citationsPresent).toBe(historyCitations > 0);
    expect(r.packet.persistence.turn_row_id).toBe(ROW_ID);
    expect(r.packet.persistence.outcome).toBe("ok");
    expect(String(r.turn.model).startsWith(`${r.usage.provider}:`)).toBe(true);
    // The lifecycle row was closed by the usage write, never by endRoot's bare close.
    expect(closeTurnMock).not.toHaveBeenCalled();
    expect(evaluateMock).toHaveBeenCalledTimes(decisionCalls);
    // R1-D3: the settle writes the turn's wall time, a non-negative number (never null).
    expect(r.meta.latencyMs).toEqual(expect.any(Number));
    expect(r.meta.latencyMs).toBeGreaterThanOrEqual(0);
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
    return r;
  }

  it("redraft: body cancelled during the held cited-page read -> one stop in history, ONE packet stopped_aborted with both generations' usage", async () => {
    await redraftCancelledDuringRead(false);
  });

  it("redraft, progress stream on: the same cancel -> one stop, ONE packet stopped_aborted, both generations' usage", async () => {
    await redraftCancelledDuringRead(true);
  });

  /** An ordinary answered turn (safe first verdict, no redraft), the body cancelled at `when`. */
  async function answeredCancelledAt(when: "during_read" | "during_commit" | "after_content" | "after_usage", progress = false, withId = true) {
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
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], ...(withId ? { clientRequestId: REQ_ID } : {}) }, progress), params);
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
    return r;
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
    expectDispositionMatchesHistory(r, 1);
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

  // ── Review round 1 (R1-D1, R1-D2, R1-D3) ─────────────────────────────────────
  /** Reads the body to its end; resolves "closed", or with the error the stream surfaced. */
  const drain = (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> =>
    (async () => {
      for (;;) if ((await reader.read()).done) return "closed";
    })().catch((e: unknown) => e);
  /** A delivery failure AFTER the commit with the reader still attached: the first log line after the content frames throws. */
  function failDeliveryAfterContent() {
    const boom = new Error("delivery failed after the commit (test)");
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      if (String(a[0]).includes("gate released")) throw boom;
    });
    return boom;
  }
  /** Holds the settle's ledger write (one call) until released; it then reports a written row. */
  function holdLedgerWrite() {
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((res) => (entered = res));
    const gate = new Promise<void>((res) => (release = res));
    persistMock.persistTurnUsage.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { persisted: true, traceId: "trace-1" };
    });
    return { reached, release };
  }
  const stillPending = (ms: number) => new Promise<string>((res) => setTimeout(() => res("still pending"), ms));

  it("R1-D1: delivery throws after the commit with the reader attached -> the reader gets that error while the settle's ledger write is still pending, then ONE packet", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = failDeliveryAfterContent();
    // The settle's ledger write is parked. (Before Codex round 1 on #6082 this test parked the
    // decision call, which a failed delivery no longer makes: F1.)
    const hold = holdLedgerWrite();
    try {
      const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
      const seen = drain(res.body!.getReader());
      await hold.reached;
      expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
      // The transport error is already out: the attached reader does not wait for the settle.
      expect(await Promise.race([seen, stillPending(400)])).toBe(boom);
    } finally {
      hold.release();
    }
    const r = await settled();
    expect(r.meta.outcome).toBe("answered");
    expect(r.meta.answerText).toBe(DRAFT1);
    expectDispositionMatchesHistory(r);
  });

  it("R1-D1: the history write fails on a request with an id -> the reader gets that error while the failed-turn packet's ledger write is still pending", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = new Error("history write failed (test)");
    domainMock.recordTurn.mockImplementation(async () => {
      throw boom;
    });
    // The failed-turn packet's ledger write is parked. (This test parked the decision call
    // until the advisor pass after Codex round 1 on #6082: that exit no longer makes one.)
    const hold = holdLedgerWrite();
    try {
      const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
      const seen = drain(res.body!.getReader());
      await hold.reached;
      expect(await Promise.race([seen, stillPending(400)])).toBe(boom);
    } finally {
      hold.release();
    }
    await settleAll();
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    const [, , telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    expect(telemetry.packet.persistence.outcome).toBe("failed");
  });

  it("R1-D2: the settle rejects on the catch path -> the delivery error is the one surfaced, the completed claim is left alone, the root span records it and ends, the turn is closed", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = failDeliveryAfterContent();
    spanTap.throwInSettle = true;
    spanTap.rootExceptions.length = 0;
    spanTap.rootEnds = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
      const seen = await drain(res.body!.getReader());
      await settleAll();
      // Preconditions: the turn was committed, and the settle ran on the catch path and failed.
      expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("settle after a post-commit failure did not complete"),
        "settle span write failed (test)",
      );
      expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(0);
      // The original error, not the settle's.
      expect(seen).toBe(boom);
      expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
      expect(spanTap.rootExceptions).toEqual([boom]);
      expect(spanTap.rootEnds).toBe(1);
      // No usage write closed the row, so endRoot's own close did, once.
      expect(closeTurnMock).toHaveBeenCalledTimes(1);
      expect(closeTurnMock.mock.calls[0][0]).toMatchObject({ outcome: "answered" });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("R1-D2 control: the same delivery failure with a settle that succeeds writes ONE packet and never the bare close", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = failDeliveryAfterContent();
    spanTap.rootExceptions.length = 0;
    spanTap.rootEnds = 0;
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(await drain(res.body!.getReader())).toBe(boom);
    const r = await settled();
    expectDispositionMatchesHistory(r);
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
    expect(spanTap.rootExceptions).toEqual([boom]);
    expect(spanTap.rootEnds).toBe(1);
  });

  /** A committed turn no provider served (every provider call answers 500), cancelled during the history write or delivered. */
  async function unservedTurn(cancel: boolean, internal = false) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // A route bug (not a provider outage): the stream call throws a RangeError.
        if (internal) throw new RangeError("route bug (test)");
        return new Response("down", { status: 500 });
      }),
    );
    // eslint-disable-next-line prefer-const -- assigned after POST; read by the hook below
    let reader!: ReadableStreamDefaultReader<Uint8Array>;
    if (cancel) {
      domainMock.recordTurn.mockImplementation(async () => {
        await new Promise((res) => setTimeout(res, 0));
        void reader.cancel();
        return ROW_ID as never;
      });
    }
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(res.status).toBe(200);
    reader = res.body!.getReader();
    // Delivered: how many providers.exhausted lines existed when the status frame reached the reader.
    let exhaustedLinesAtStatus = -1;
    if (!cancel) {
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
        if (exhaustedLinesAtStatus < 0 && text.includes('"kind":"status"')) exhaustedLinesAtStatus = exhaustedLines().length;
      }
    }
    const r = await settled();
    // Preconditions: committed as an unserved (error) turn; a cancelled one never got its closing frames.
    expect(r.turn.answerStatus).toBe("error");
    expect(r.turn.answerText).toBeNull();
    expect(r.packet.persistence.turn_row_id).toBe(ROW_ID);
    expect(closeTurnMock).not.toHaveBeenCalled();
    return { ...r, exhaustedLinesAtStatus };
  }

  for (const cancel of [true, false]) {
    const how = cancel ? "cancelled during the history write" : "delivered";
    it(`R1-D3: a committed turn no provider served, ${how}: the ledger row stores a null answer text`, async () => {
      const r = await unservedTurn(cancel);
      expect(r.usage.routeReason).not.toBe("legacy_cascade");
      expect(r.meta.answerText).toBeNull();
    });

    it(`R1-D3: the legacy cascade (canonical seam off), no provider served, ${how}: the ledger row's status is error`, async () => {
      process.env.MIRA_CANONICAL_SEAM = "0";
      process.env.GROQ_API_KEY = "g0";
      const r = await unservedTurn(cancel);
      // Precondition: this is the legacy branch of the settle.
      expect(r.usage.routeReason).toBe("legacy_cascade");
      expect(r.usage.status).toBe("error");
    });
  }

  it("R1-D3 control: the legacy cascade's served turn is recorded ok", async () => {
    process.env.MIRA_CANONICAL_SEAM = "0";
    process.env.GROQ_API_KEY = "g0";
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(r.turn.answerStatus).toBe("answered");
    expect(r.usage.routeReason).toBe("legacy_cascade");
    expect(r.usage.status).toBe("ok");
    expect(r.meta.answerText).toBe(DRAFT1);
  });

  // ── Review round 1 (R1-D4): the catch settles only a decision that IS in history ──
  const logged = (spy: unknown, marker: string) =>
    (spy as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((l) => l.includes(marker));
  /** The `turn.usage` and `providers.exhausted` structured log lines of this turn. */
  const usageLines = () => logged(console.log, '"event":"turn.usage"');
  const exhaustedLines = () => logged(console.error, '"event":"providers.exhausted"');

  /**
   * The history write FAILS on a request with no id: there is no claim to abandon, so the
   * route logs the failure and carries on to delivery (with an id it stops there instead).
   */
  async function historyWriteFailed(cancel: boolean) {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    // eslint-disable-next-line prefer-const -- assigned after POST; read by the hook below
    let reader!: ReadableStreamDefaultReader<Uint8Array>;
    domainMock.recordTurn.mockImplementation(async () => {
      await new Promise((res) => setTimeout(res, 0));
      if (cancel) void reader.cancel();
      throw new Error("history write failed (test)");
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A] }, false), params);
    expect(res.status).toBe(200);
    reader = res.body!.getReader();
    let text = "";
    if (!cancel) {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    }
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    await settleAll();
    // Preconditions: the write failed, once, and the route continued past it.
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[notebook-chat] recordTurn failed:", "history write failed (test)");
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
    return text
      .split("\n\n")
      .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)) as Frame & { status?: string });
  }

  it("R1-D4: body cancelled after a FAILED history write: the catch persists nothing (no packet, no usage row, no decision call), the bare close as before #6048", async () => {
    await historyWriteFailed(true);
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(usageLines()).toHaveLength(0);
    // The delivery failure reached the catch, whose endRoot closed the row bare.
    expect(closeTurnMock).toHaveBeenCalledTimes(1);
    expect(closeTurnMock.mock.calls[0][0]).toMatchObject({ outcome: "answered" });
  });

  it("R1-D4 control: DELIVERED after a failed history write is unchanged: the same frames, ONE packet with the failed persistence outcome and no row id", async () => {
    const frames = await historyWriteFailed(false);
    expect(frames.map((f) => f.kind)).toEqual(["content", "sources", "evidence", "usage", "status"]);
    expect(frames.filter((f) => f.kind === "content").map((f) => f.content).join("")).toBe(DRAFT1);
    expect(frames.at(-1)).toMatchObject({ kind: "status", status: "answered" });
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    const [meta, usage, telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    expect(meta).toMatchObject({ outcome: "answered", answerText: DRAFT1, citationsPresent: true });
    expect(usage).toMatchObject({ provider: "OpenAI", inputTokens: 12, outputTokens: 7 });
    expect(telemetry.turnRowId).toBeNull();
    expect(telemetry.packet.persistence).toMatchObject({ turn_row_id: null, outcome: "failed" });
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(usageLines()).toHaveLength(1);
    expect(closeTurnMock).not.toHaveBeenCalled();
  });

  // ── Review round 1 (R1-D5): the incident log lines are owed once per committed turn too ──
  it("R1-D5: an answered turn cancelled BEFORE the usage frame still logs turn.usage, once, with the ledger row's numbers", async () => {
    const r = await answeredCancelledAt("during_commit");
    expect(usageLines()).toHaveLength(1);
    expect(JSON.parse(usageLines()[0])).toMatchObject({
      provider: r.usage.provider,
      model: r.usage.model,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      status: r.usage.status,
    });
    expect(exhaustedLines()).toHaveLength(0);
  });

  it("R1-D5 control: an answered turn cancelled AFTER the usage frame logs turn.usage once, not twice", async () => {
    await answeredCancelledAt("after_usage");
    expect(usageLines()).toHaveLength(1);
  });

  it("R1-D5 control: a delivered answered turn logs turn.usage once, before its status frame goes out, and no exhausted line", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    let linesWhenStatusArrived = -1;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
      if (linesWhenStatusArrived < 0 && text.includes('"kind":"status"')) linesWhenStatusArrived = usageLines().length;
    }
    await settled();
    // Emitted where it always was (with the usage frame), not deferred to the settle.
    expect(linesWhenStatusArrived).toBe(1);
    expect(usageLines()).toHaveLength(1);
    expect(exhaustedLines()).toHaveLength(0);
  });

  for (const cancel of [true, false]) {
    const how = cancel ? "cancelled during the history write" : "delivered";
    it(`R1-D5${cancel ? "" : " control"}: a committed turn no provider served, ${how}: one providers.exhausted line and one turn.usage line`, async () => {
      const r = await unservedTurn(cancel);
      expect(r.usage.routeReason).not.toBe("legacy_cascade");
      expect(exhaustedLines()).toHaveLength(1);
      expect(usageLines()).toHaveLength(1);
      expect(JSON.parse(usageLines()[0])).toMatchObject({ status: r.usage.status, attempted: ["OpenAI"] });
      // Delivered: the exhausted line is written where it always was (before the status frame), not by the settle.
      if (!cancel) expect(r.exhaustedLinesAtStatus).toBe(1);
    });

    it(`R1-D5 control: the legacy cascade (seam off), no provider served, ${how}: neither line (they are canonical-seam lines)`, async () => {
      process.env.MIRA_CANONICAL_SEAM = "0";
      process.env.GROQ_API_KEY = "g0";
      const r = await unservedTurn(cancel);
      expect(r.usage.routeReason).toBe("legacy_cascade");
      expect(usageLines()).toHaveLength(0);
      expect(exhaustedLines()).toHaveLength(0);
    });
  }

  // ── Review round 2 (R2-D1 to R2-D4) ──────────────────────────────────────────
  it("R2-D1: a committed turn with NO client request id, body cancelled while the history write is in flight -> ONE packet, ONE usage row, disposition equal to history", async () => {
    await answeredCancelledAt("during_commit", false, false);
    // Precondition: the request carried no id, so no claim was taken or released.
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn.clientRequestId ?? null).toBeNull();
    expect(domainMock.claimNotebookTurnRequest).not.toHaveBeenCalled();
    expect(usageLines()).toHaveLength(1);
  });

  it("R2-D2: a committed canonical-seam turn that ended in an INTERNAL error, cancelled during the history write -> the settle writes no providers.exhausted line", async () => {
    const r = await unservedTurn(true, true);
    // Preconditions: a route bug (not exhaustion) on the canonical seam, settled once by the catch.
    expect(console.error).toHaveBeenCalledWith("[notebook-chat] internal error (NOT provider exhaustion):", expect.any(RangeError));
    expect(r.usage.routeReason).not.toBe("legacy_cascade");
    expect(usageLines()).toHaveLength(1);
    expect(exhaustedLines()).toHaveLength(0);
  });

  /** A committed turn cancelled during the history write whose settle then rejects (the span write inside finishAndPersist throws). */
  async function cancelledThenSettleRejects(kind: "answered" | "exhausted") {
    if (kind === "answered") stubFetch(REDRAFT, [verdict("safe", "none")]);
    else vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    spanTap.throwInSettle = true;
    // eslint-disable-next-line prefer-const -- assigned after POST; read by the hook below
    let reader!: ReadableStreamDefaultReader<Uint8Array>;
    domainMock.recordTurn.mockImplementation(async () => {
      await new Promise((res) => setTimeout(res, 0));
      void reader.cancel();
      return ROW_ID as never;
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(res.status).toBe(200);
    reader = res.body!.getReader();
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    await settleAll();
    // Preconditions: the settle ran on the catch path and rejected, so no ledger row was written.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("settle after a post-commit failure did not complete"),
      "settle span write failed (test)",
    );
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(0);
    // R2-D6 control: this IS a delivery failure, so the delivered-turn line is not written.
    expect(logged(console.error, "settle after a delivered turn did not complete")).toHaveLength(0);
  }

  it("R2-D3: an answered turn cancelled during the history write whose settle rejects has still logged turn.usage, once", async () => {
    await cancelledThenSettleRejects("answered");
    expect(usageLines()).toHaveLength(1);
    expect(exhaustedLines()).toHaveLength(0);
  });

  it("R2-D3: a provider-exhausted turn cancelled during the history write whose settle rejects has still logged providers.exhausted and turn.usage, once each", async () => {
    await cancelledThenSettleRejects("exhausted");
    expect(exhaustedLines()).toHaveLength(1);
    expect(usageLines()).toHaveLength(1);
  });

  /** Draft 1 streams `text`; any judge call answers safe; nothing else is expected. */
  function stubDraft(text: string) {
    const judgeBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (body.includes('"stream":true')) return answerStream(text);
        if (body.includes("candidate_answer")) judgeBodies.push(body);
        return Response.json({ choices: [{ message: { content: verdict("safe", "none") } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
      }),
    );
    return { judgeBodies };
  }
  /** Cancels the body while the (successful) history write is in flight, then returns the settled turn. */
  async function cancelDuringCommit() {
    // eslint-disable-next-line prefer-const -- assigned after POST; read by the hook below
    let reader!: ReadableStreamDefaultReader<Uint8Array>;
    domainMock.recordTurn.mockImplementation(async () => {
      await new Promise((res) => setTimeout(res, 0));
      void reader.cancel();
      return ROW_ID as never;
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(res.status).toBe(200);
    reader = res.body!.getReader();
    return settled();
  }

  it("R2-D4: a refusal (insufficient evidence) turn cancelled during the history write -> ONE packet and ONE usage row, disposition equal to history", async () => {
    stubDraft("The provided excerpts do not contain information about this. I don't have enough information to answer.");
    const r = await cancelDuringCommit();
    // Precondition: the committed turn is a refusal.
    expect(r.turn.answerStatus).toBe("insufficient_evidence");
    expect(r.meta.outcome).toBe("abstained");
    expectDispositionMatchesHistory(r);
    expect(usageLines()).toHaveLength(1);
  });

  it("R2-D4: a turn with NOTEBOOK_ANSWER_GATE=0 cancelled during the history write -> ONE packet and ONE usage row, disposition equal to history", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    const { judgeBodies } = stubDraft(DRAFT1);
    const r = await cancelDuringCommit();
    // Preconditions: the gate really was off (no gated release, no judge call), and the turn was answered.
    expect(logged(console.log, "gate released")).toHaveLength(0);
    expect(judgeBodies).toHaveLength(0);
    expect(r.turn.answerStatus).toBe("answered");
    expect(r.turn.answerText).toBe(DRAFT1);
    expectDispositionMatchesHistory(r);
    expect(usageLines()).toHaveLength(1);
  });

  it("R2-D6: a DELIVERED turn whose normal-path settle rejects logs that the settle after a delivered turn failed, never a post-commit delivery failure", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    spanTap.throwInSettle = true;
    spanTap.rootExceptions.length = 0;
    spanTap.rootEnds = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
      // Precondition: the body was delivered in full, a clean close.
      expect(await drain(res.body!.getReader())).toBe("closed");
      await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
      await settleAll();
      // Precondition: the settle rejected, so no ledger row was written.
      expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(0);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("settle after a delivered turn did not complete"),
        "settle span write failed (test)",
      );
      expect(logged(console.error, "settle after a post-commit failure did not complete")).toHaveLength(0);
      // Everything else as before: the completed claim left alone, the settle's error recorded, root span ended once.
      expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
      expect(spanTap.rootExceptions.map((e) => (e as Error).message)).toEqual(["settle span write failed (test)"]);
      expect(spanTap.rootEnds).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  // ── Codex round 1 on #6082 (F1, F2, F3) ──────────────────────────────────────
  /** Requests the route sent to the decision vendor. */
  const vendorRequests = () =>
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => String(u) === JEV_ENDPOINT);
  const decisionCallOn = () => {
    process.env.MIRA_JEV_DECISION = "1";
    process.env.JEV_API_KEY = "dummy-key";
  };

  it("F1: decision call on, an answered turn cancelled before its first post-commit frame: nothing is sent to the vendor; ONE packet and usage row, no decision record", async () => {
    decisionCallOn();
    const r = await answeredCancelledAt("during_read");
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
  });

  it("F1: decision call on, a redraft turn stopped by a cancel during the held read: nothing is sent to the vendor", async () => {
    decisionCallOn();
    const r = await redraftCancelledDuringRead(false);
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
  });

  it("F1: decision call on, delivery fails after the commit with the reader attached: nothing is sent to the vendor", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = failDeliveryAfterContent();
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(await drain(res.body!.getReader())).toBe(boom);
    const r = await settled();
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
    expectDispositionMatchesHistory(r);
  });

  it("F1 control: decision call on, the same answered turn drained to its end sends ONE request and carries a decision record", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(vendorRequests()).toHaveLength(1);
    expect(r.packet.jev_decision ?? null).not.toBeNull();
    expectDispositionMatchesHistory(r, 1);
  });

  // ── Codex round 3 on #6082 (F8) ──────────────────────────────────────────────
  // A turn no provider served carries no answer. Its error stream ends cleanly and can be
  // read to its end, so "every frame written" and "handed off" are both true of it. The
  // decision call still has nothing to judge, and it must not send the question, the excerpts
  // and any photo observations to the vendor for an answer that was never given.
  /** Every provider answers 500; the response is read to its end. Returns the frames that arrived. */
  async function exhaustedReadToEnd() {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(res.status).toBe(200);
    const frames = (await res.text())
      .split("\n\n")
      .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)) as Frame & { status?: string });
    const r = await settled();
    // Preconditions: an unserved turn, committed, whose response carried no answer and ended with the error status.
    expect(r.turn.answerStatus).toBe("error");
    expect(r.turn.answerText).toBeNull();
    expect(frames.filter((f) => f.kind === "content")).toHaveLength(0);
    expect(frames.at(-1)).toMatchObject({ kind: "status", status: "error" });
    return r;
  }

  it("F8: decision call on, every provider fails and the error response is read to its end: nothing is sent to the vendor, no decision record, ONE packet and usage row", async () => {
    decisionCallOn();
    const r = await exhaustedReadToEnd();
    expect(vendorRequests()).toHaveLength(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.packet.persistence).toMatchObject({ turn_row_id: ROW_ID, outcome: "ok" });
    expect(closeTurnMock).not.toHaveBeenCalled();
  });

  // A completion that is only whitespace is recorded as an answered turn (unchanged here, and
  // the same on main): one content frame of blanks goes out and history keeps the blanks. There
  // is still no answer to judge, so the question and the excerpts are not sent for it either.
  /** The provider's whole completion is whitespace; the response is read to its end. Returns the frames that arrived. */
  async function blankCompletionReadToEnd() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
        typeof init?.body === "string" && init.body.includes('"stream":true') ? answerStream(" \n ") : new Response("down", { status: 500 }),
      ),
    );
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(res.status).toBe(200);
    return (await res.text())
      .split("\n\n")
      .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)) as Frame & { status?: string });
  }

  it("F8: decision call on, the provider's whole completion is whitespace and the response is read to its end: nothing is sent to the vendor, no decision record, ONE packet and usage row", async () => {
    decisionCallOn();
    const frames = await blankCompletionReadToEnd();
    const r = await settled();
    // Preconditions: what the client got as content is blanks only, the turn is recorded as
    // answered, and the whole recorded answer is blanks (not null, not empty).
    const content = frames.filter((f) => f.kind === "content");
    expect(content.length).toBeGreaterThan(0);
    expect(content.map((f) => f.content ?? "").join("").trim()).toBe("");
    expect(r.turn.answerStatus).toBe("answered");
    expect(typeof r.turn.answerText).toBe("string");
    expect(String(r.turn.answerText).length).toBeGreaterThan(0);
    expect(String(r.turn.answerText).trim()).toBe("");
    expect(vendorRequests()).toHaveLength(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.packet.persistence).toMatchObject({ turn_row_id: ROW_ID, outcome: "ok" });
    expect(closeTurnMock).not.toHaveBeenCalled();
  });

  it("F8 control: decision call OFF, the same blank answered turn read to its end: the packet carries the disabled record as before", async () => {
    await blankCompletionReadToEnd();
    const r = await settled();
    expect(r.turn.answerStatus).toBe("answered");
    expect(String(r.turn.answerText).trim()).toBe("");
    expect(handoffSpy).not.toHaveBeenCalled();
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(r.packet.jev_decision).toMatchObject({ skipped_reason: "disabled" });
  });

  // The answer check comes before the handoff: a turn with no answer has nothing to wait for.
  // An answered turn nobody reads waits out the handoff (pinned below, "a response nobody reads");
  // this one must not.
  it("F8: decision call on, every provider fails and NOBODY reads the response: the settle does not wait for the handoff, and nothing is sent", async () => {
    decisionCallOn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(res.status).toBe(200);
    // Well inside the 4 second handoff wait, with the body never read.
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1), { timeout: 1500, interval: 25 });
    expect(handoffSpy).toHaveBeenCalledTimes(1); // the tracker was installed; the settle did not need its answer
    const r = await settled();
    expect(r.turn.answerStatus).toBe("error");
    expect(r.turn.answerText).toBeNull();
    expect(vendorRequests()).toHaveLength(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(r.packet.jev_decision ?? null).toBeNull();
    await res.body!.cancel();
  });

  // With the answer gate OFF the draft is streamed as it arrives. A provider that fails part-way
  // has already put fragments on the wire; the turn is still an error with no answer, and the
  // fragments are not sent to the vendor as "the answer MIRA delivered" (on main they were).
  it("F8: decision call on, answer gate off, the only provider fails part-way through its stream: fragments reached the client, the turn is an error, and nothing is sent", async () => {
    decisionCallOn();
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (!(typeof init?.body === "string" && init.body.includes('"stream":true'))) return new Response("down", { status: 500 });
        let sent = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              if (!sent) {
                sent = true;
                for (const w of ["Check ", "the ", "ribbon ", "cable ", "connector ", "first. "]) c.enqueue(enc.encode(delta(w)));
                return;
              }
              c.error(new Error("connection reset (test)"));
            },
          }),
          { status: 200 },
        );
      }),
    );
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(res.status).toBe(200);
    const frames = (await res.text())
      .split("\n\n")
      .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)) as Frame & { status?: string });
    const r = await settled();
    // Preconditions: a fragment did reach the client, and the turn is an error with no answer.
    expect(frames.filter((f) => f.kind === "content").map((f) => f.content ?? "").join("")).toContain("Check the ribbon");
    expect(frames.at(-1)).toMatchObject({ kind: "status", status: "error" });
    expect(r.turn.answerStatus).toBe("error");
    expect(r.turn.answerText).toBeNull();
    expect(vendorRequests()).toHaveLength(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.packet.persistence).toMatchObject({ turn_row_id: ROW_ID, outcome: "ok" });
  });

  it("F8 control: decision call OFF, the same unserved turn read to its end: no tracker, and the packet carries the disabled record as before", async () => {
    const r = await exhaustedReadToEnd();
    expect(handoffSpy).not.toHaveBeenCalled();
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(r.packet.jev_decision).toMatchObject({ skipped_reason: "disabled" });
  });

  it("F1: decision call on, the history write fails on a request with an id: the response is errored, nothing is sent to the vendor, the failed-turn packet carries no decision record", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = new Error("history write failed (test)");
    domainMock.recordTurn.mockImplementation(async () => {
      throw boom;
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(await drain(res.body!.getReader())).toBe(boom);
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await settleAll();
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    const [, , telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    expect(telemetry.packet.persistence.outcome).toBe("failed");
    expect(vendorRequests()).toHaveLength(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(telemetry.packet.jev_decision ?? null).toBeNull();
  });

  // With the call ON the handoff tracker also says no for this exit (the response is errored),
  // so the test above cannot tell whether the exit itself marks the turn undelivered. With the
  // call OFF only that mark keeps the helper from being asked at all.
  it("F1: decision call OFF, the history write fails on a request with an id: the decision helper is not asked and the failed-turn packet carries no decision record, not even a disabled one", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = new Error("history write failed (test)");
    domainMock.recordTurn.mockImplementation(async () => {
      throw boom;
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(await drain(res.body!.getReader())).toBe(boom);
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await settleAll();
    const [, , telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    expect(telemetry.packet.persistence.outcome).toBe("failed");
    expect(evaluateMock).not.toHaveBeenCalled();
    expect("jev_decision" in telemetry.packet).toBe(false);
  });

  it("F1 control: decision call OFF, the history write fails on a request with NO id: the answer is delivered and the packet carries the disabled record", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    domainMock.recordTurn.mockImplementation(async () => {
      throw new Error("history write failed (test)");
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A] }, false), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await settleAll();
    const [, , telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    expect(telemetry.packet.persistence.outcome).toBe("failed");
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(telemetry.packet.jev_decision).toMatchObject({ skipped_reason: "disabled" });
    expect(vendorRequests()).toHaveLength(0);
  });

  it("F1 control: decision call on, the history write fails on a request with NO id: the route carries on, the answer is delivered, ONE request is sent", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    domainMock.recordTurn.mockImplementation(async () => {
      throw new Error("history write failed (test)");
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A] }, false), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await settleAll();
    const [, , telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    expect(telemetry.packet.persistence.outcome).toBe("failed");
    expect(vendorRequests()).toHaveLength(1);
    expect(telemetry.packet.jev_decision ?? null).not.toBeNull();
  });

  // ── Codex round 2 on #6082 (F5, F6) ──────────────────────────────────────────
  // F5: the route closing its own stream is not the answer being handed off. The decision
  // call needs the OUTERMOST response read to its end, with no cancel and no request abort.
  const JOB_ID = "55555555-5555-4555-8555-555555555555";
  const handoffSpy = createResponseHandoffSpy as unknown as ReturnType<typeof vi.fn>;
  const sheetOn = () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
  };
  const reqWith = (body: Record<string, unknown>, o: { progress?: boolean; signal?: AbortSignal } = {}) => {
    if (o.progress) process.env.MIRA_CHAT_PROGRESS = "1";
    return new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...(o.progress ? { "x-mira-progress": "1" } : {}) },
      ...(o.signal ? { signal: o.signal } : {}),
    });
  };
  const SHEET_TURN = { message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID, livingSheetJobId: JOB_ID };
  const PLAIN_TURN = { message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID };
  /** A job the receipt can use: the receipt frame goes out when the job read returns this. */
  const SHEET_JOB = {
    status: "ok",
    view: { jobId: JOB_ID, seq: 4, title: "PM", steps: [], readings: [], parts: [], notes: [], questions: [], photos: [], warnings: [] },
  };
  /**
   * Holds the sheet receipt's job read. It is the SECOND job read of the turn: the route
   * reads the job once itself, before it generates, and that one is not held.
   */
  function holdReceiptRead(result: unknown = JOB_NOT_FOUND) {
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((res) => (entered = res));
    const gate = new Promise<void>((res) => (release = res));
    let reads = 0;
    storeMock.loadJob.mockImplementation(async () => {
      reads += 1;
      if (reads !== 2) return JOB_NOT_FOUND;
      entered();
      await gate;
      return result;
    });
    return { reached, release };
  }
  /** Reads a response in the background and keeps what arrived; `stop()` cancels its reader. */
  function follow(res: Response) {
    const reader = res.body!.getReader();
    const d = new TextDecoder();
    let text = "";
    const ended = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return "closed";
        text += d.decode(value, { stream: true });
      }
    })().catch((e: unknown) => e);
    return { text: () => text, ended, stop: () => reader.cancel() };
  }
  /**
   * The turn committed and wrote its whole answer to its own stream. The usage line is
   * logged with the usage frame, and the status frame, the end marker and the close follow
   * it in the same synchronous run, so one more turn of the event loop is past the close.
   */
  async function turnWroteEverything() {
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(usageLines()).toHaveLength(1));
    await settleAll();
  }

  it("F5: decision call on, progress and sheet on: the outer response is cancelled while the receipt's job read is held, after the turn committed and wrote every frame -> no answer frame went out, nothing is sent to the vendor, ONE packet and usage row", async () => {
    decisionCallOn();
    sheetOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const hold = holdReceiptRead();
    const res = await POST(reqWith(SHEET_TURN, { progress: true }), params);
    expect(res.status).toBe(200);
    const out = follow(res);
    await hold.reached;
    await turnWroteEverything();
    // The settle is waiting for the handoff: nothing is written or sent yet.
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
    expect(vendorRequests()).toHaveLength(0);
    await out.stop(); // the technician is gone; no answer frame has reached the outer response
    hold.release();
    const r = await settled();
    expect(out.text()).not.toContain('"kind":"content"');
    expect(out.text()).not.toContain(DRAFT1);
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.meta.outcome).toBe("answered");
    expect(r.packet.response_write).toEqual({ frames_written: true, citations_written: 1 });
    expectDispositionMatchesHistory(r);
    expect(handoffSpy).toHaveBeenCalledTimes(1);
  });

  it("F5 control: the same turn with the receipt's job read held and then released, the response read to its end: ONE request, a decision record", async () => {
    decisionCallOn();
    sheetOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const hold = holdReceiptRead();
    const res = await POST(reqWith(SHEET_TURN, { progress: true }), params);
    const out = follow(res);
    await hold.reached;
    await turnWroteEverything();
    expect(vendorRequests()).toHaveLength(0);
    hold.release();
    expect(await out.ended).toBe("closed");
    const r = await settled();
    expect(out.text()).toContain(DRAFT1.split(" ")[0]);
    expect(out.text()).toContain("data: [DONE]");
    expect(vendorRequests()).toHaveLength(1);
    expect(r.packet.jev_decision ?? null).not.toBeNull();
    expectDispositionMatchesHistory(r, 1);
  });

  it("F5: decision call on, sheet on without the progress stream: the request is aborted while the receipt's job read is held -> nothing is sent, even when the response is then read to its end", async () => {
    decisionCallOn();
    sheetOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const hold = holdReceiptRead();
    const ac = new AbortController();
    // Without the progress stream the route does not return until the receipt has its job.
    const pending = POST(reqWith(SHEET_TURN, { signal: ac.signal }), params);
    await hold.reached;
    await turnWroteEverything();
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
    ac.abort(); // the route's own abort listeners were detached before the history write
    hold.release();
    const res = await pending;
    expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
    expectDispositionMatchesHistory(r);
  });

  // ── Codex round 4 on #6082 (F9, F11) ─────────────────────────────────────────
  // F9: the sheet receipt RE-ENCODES the turn's bytes (it decodes them, looks for the end
  // marker anywhere in the text and encodes the text again), and it can corrupt the answer
  // frame on the way (#6105). Both responses are still read to their end, so the tracker
  // alone would say yes. A response the receipt wrapped is not a verified handoff, whether
  // or not this one was damaged: no decision call.
  it.each([false, true])("F9: decision call on, sheet on (progress stream %s), the receipt frame inserted, an intact answer read to its end: the receipt re-encoded the response, so nothing is sent to the vendor; ONE packet and usage row", async (progress) => {
    decisionCallOn();
    sheetOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    holdReceiptRead(SHEET_JOB).release();
    const res = await POST(reqWith(SHEET_TURN, { progress }), params);
    const text = await res.text();
    const r = await settled();
    // Preconditions: the receipt really wrapped this response, and THIS answer went out
    // whole (every frame parses, the content is the recorded answer). The refusal is for
    // every response the receipt re-encoded, damaged or not: the route cannot tell which.
    expect(text).toContain('"kind":"sheet_receipt"');
    const frames = text
      .split("\n\n")
      .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)) as Frame);
    expect(frames.filter((f) => f.kind === "content").map((f) => f.content ?? "").join("")).toBe(r.turn.answerText);
    expect(text.split("\n\n").filter((l) => l.trim() === "data: [DONE]")).toHaveLength(1);
    expect(vendorRequests()).toHaveLength(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.meta.outcome).toBe("answered");
    expect(r.packet.response_write).toEqual({ frames_written: true, citations_written: 1 });
    expectDispositionMatchesHistory(r);
    expect(handoffSpy).toHaveBeenCalledTimes(1);
  });

  // Codex's own case: the answer quotes the stream's end marker. The receipt puts its frame
  // INSIDE the answer's JSON, so the client cannot parse the content frame and never shows
  // the answer, while the status frame and the end still arrive.
  it("F9: decision call on, sheet on, the answer quotes the end marker: the receipt lands inside the answer frame, the client can parse no content frame, and nothing is sent to the vendor", async () => {
    decisionCallOn();
    sheetOn();
    const QUOTING = "Hold reset until the panel log shows data: [DONE] then release it.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
        typeof init?.body === "string" && init.body.includes('"stream":true') ? answerStream(QUOTING) : new Response("down", { status: 500 }),
      ),
    );
    holdReceiptRead(SHEET_JOB).release();
    const res = await POST(reqWith(SHEET_TURN), params);
    const raw = await res.text();
    const parsed: Array<Frame & { status?: string }> = [];
    let unparseable = 0;
    for (const l of raw.split("\n\n")) {
      if (!l.startsWith("data: ") || l.trim() === "data: [DONE]") continue;
      try {
        parsed.push(JSON.parse(l.slice(6)) as Frame & { status?: string });
      } catch {
        unparseable += 1;
      }
    }
    const r = await settled();
    // Preconditions: the turn is recorded as answered with the quoting text, the receipt
    // frame went out, and what the client can parse holds no content frame with the answer.
    expect(r.turn.answerStatus).toBe("answered");
    expect(String(r.turn.answerText)).toContain("data: [DONE]");
    expect(raw).toContain('"kind":"sheet_receipt"');
    expect(unparseable).toBeGreaterThan(0);
    expect(parsed.filter((f) => f.kind === "content").map((f) => f.content ?? "").join("")).not.toContain("release it");
    expect(vendorRequests()).toHaveLength(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.packet.persistence).toMatchObject({ turn_row_id: ROW_ID, outcome: "ok" });
  });

  // The other side of F9. The progress stream is a wrapper too, and it stays trusted: it
  // forwards the turn's bytes as they are, cut only at the end of a whole frame. The same
  // awkward answer (it quotes the end marker and carries a character outside the basic
  // plane) reaches the client exactly as recorded, with and without the progress stream,
  // and the decision call is made once.
  it.each([false, true])("F9 control: decision call on, no sheet (progress stream %s), the answer quotes the end marker and carries a wide character: the client parses every frame, the content is the recorded answer, ONE request", async (progress) => {
    decisionCallOn();
    const QUOTING = "Hold reset until the panel log shows data: [DONE] then release it \u{1F527} slowly.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
        typeof init?.body === "string" && init.body.includes('"stream":true') ? answerStream(QUOTING) : new Response("down", { status: 500 }),
      ),
    );
    const res = await POST(reqWith(PLAIN_TURN, { progress }), params);
    const raw = await res.text();
    const frames = raw
      .split("\n\n")
      .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)) as Frame & { status?: string }); // throws on a frame that was cut or rewritten
    const r = await settled();
    expect(r.turn.answerStatus).toBe("answered");
    expect(String(r.turn.answerText)).toContain(QUOTING);
    const shown = frames.filter((f) => f.kind === "content").map((f) => f.content ?? "").join("");
    expect(shown).toBe(r.turn.answerText);
    expect(raw.split("\n\n").filter((l) => l.trim() === "data: [DONE]")).toHaveLength(1);
    expect(frames.some((f) => (f as { kind?: string }).kind === "progress")).toBe(progress);
    expect(vendorRequests()).toHaveLength(1);
    expect(r.packet.jev_decision ?? null).not.toBeNull();
    expectDispositionMatchesHistory(r, 1);
  });

  // F11: the tracker says yes the moment both responses are read to their end, and a
  // promise keeps its first answer. A request abort seen after that, before the settle
  // reaches the decision call, must still stop the call. The packet and usage do not depend on it.
  it("F11: decision call on, the response is read to its end and the request is then aborted before the settle reaches the decision call: nothing is sent to the vendor, ONE packet and usage row", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const ac = new AbortController();
    const res = await POST(reqWith(PLAIN_TURN, { signal: ac.signal }), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    // Preconditions: read to the end, and the settle has not reached the call or the ledger.
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(vendorRequests()).toHaveLength(0);
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
    ac.abort();
    const r = await settled();
    expect(vendorRequests()).toHaveLength(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.meta.outcome).toBe("answered");
    expect(r.packet.response_write).toEqual({ frames_written: true, citations_written: 1 });
    expectDispositionMatchesHistory(r);
  });

  it("F11 control: the same request with its signal never aborted, read to its end: ONE request, a decision record", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const ac = new AbortController();
    const res = await POST(reqWith(PLAIN_TURN, { signal: ac.signal }), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(vendorRequests()).toHaveLength(1);
    expect(r.packet.jev_decision ?? null).not.toBeNull();
    expectDispositionMatchesHistory(r, 1);
  });

  it("F5: sheet on without the progress stream, the receipt frame inserted: the reader takes every frame through the end marker and then cancels -> nothing is sent, ONE packet and usage row", async () => {
    decisionCallOn();
    sheetOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    holdReceiptRead(SHEET_JOB).release();
    const res = await POST(reqWith(SHEET_TURN), params);
    const reader = res.body!.getReader();
    const d = new TextDecoder();
    let seen = "";
    while (!seen.includes("data: [DONE]")) {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      seen += d.decode(value, { stream: true });
    }
    expect(seen).toContain('"kind":"sheet_receipt"');
    // The receipt has by now read the turn's own stream to its end; the reader has not.
    await settleAll();
    await reader.cancel();
    const r = await settled();
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
    expectDispositionMatchesHistory(r);
  });

  it("F5 control: sheet on, the job is not found so the receipt hands back the bare response, read to its end: ONE request", async () => {
    decisionCallOn();
    sheetOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const receiptCallsBefore = (withSheetReceiptSpy as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const res = await POST(reqWith(SHEET_TURN), params);
    const text = await res.text();
    expect(text).not.toContain('"kind":"sheet_receipt"');
    // The sheet path really ran: the receipt wrapper was called, read the job a second time
    // (the route read it once before generating), and handed back the response as it was.
    expect((withSheetReceiptSpy as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(receiptCallsBefore + 1);
    expect(storeMock.loadJob).toHaveBeenCalledTimes(2);
    const r = await settled();
    expect(vendorRequests()).toHaveLength(1);
    expectDispositionMatchesHistory(r, 1);
  });

  // With the progress stream on, the progress stream reads the turn's own response to its
  // end by itself, whether or not anyone reads what it writes: only the final response tells.
  it.each([false, true])("F5: decision call on, a response nobody reads (progress stream %s): the settle waits a bounded time for the handoff and then gives up -> nothing is sent, ONE packet and usage row, and reading the body afterwards changes nothing", async (progress) => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(reqWith(PLAIN_TURN, { progress }), params);
    expect(res.status).toBe(200);
    await turnWroteEverything();
    await new Promise((r) => setTimeout(r, 1000));
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled(); // waiting, not skipped
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1), { timeout: 12_000, interval: 50 });
    expect(vendorRequests()).toHaveLength(0);
    expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.packet.response_write).toEqual({ frames_written: true, citations_written: 1 });
    expectDispositionMatchesHistory(r);
  }, 30_000);

  it("F5: decision call on, progress and sheet on, the sheet receipt wrapper FAILS after the turn handler returned: the progress stream ends cleanly with an error frame, the response is read to its end, and nothing is sent", async () => {
    decisionCallOn();
    sheetOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    (withSheetReceiptSpy as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("sheet receipt failed (test)");
    });
    const res = await POST(reqWith(SHEET_TURN, { progress: true }), params);
    const out = follow(res);
    // A clean end, read in full: the final response alone would look handed off.
    expect(await out.ended).toBe("closed");
    expect(out.text()).toContain('"kind":"http_error"');
    expect(out.text()).toContain("data: [DONE]");
    expect(out.text()).not.toContain('"kind":"content"');
    // The turn itself ran to its end behind the failed wrapper and wrote every frame.
    await turnWroteEverything();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1), { timeout: 12_000, interval: 50 });
    const r = await settled();
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
    expect(r.packet.response_write).toEqual({ frames_written: true, citations_written: 1 });
    // (The route's entry point closes the attempt itself when a wrapper throws, as on main, so
    // the usual "closed by the usage write alone" check does not apply to this exit.)
    expect(r.meta.outcome).toBe("answered");
    expect(evaluateMock).not.toHaveBeenCalled();
  }, 30_000);

  it("F5: decision call on, the reader takes every frame through the end marker and then cancels instead of reading the end: nothing is sent", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(reqWith(PLAIN_TURN), params);
    const reader = res.body!.getReader();
    const d = new TextDecoder();
    let seen = "";
    while (!seen.includes("data: [DONE]")) {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      seen += d.decode(value, { stream: true });
    }
    await reader.cancel();
    const r = await settled();
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
    expectDispositionMatchesHistory(r);
  });

  it("F5: decision call on, progress stream on: the outer response is cancelled after the status frame -> nothing is sent", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(reqWith(PLAIN_TURN, { progress: true }), params);
    const reader = res.body!.getReader();
    const d = new TextDecoder();
    let seen = "";
    while (!seen.includes('"kind":"status"')) {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      seen += d.decode(value, { stream: true });
    }
    // The progress stream has by now read the turn's own response to its end; the reader has not.
    await settleAll();
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
    await reader.cancel();
    const r = await settled();
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
  });

  it("F5 control: decision call on, progress stream on, the response read to its end: ONE request, and one tracker for the turn", async () => {
    decisionCallOn();
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(reqWith(PLAIN_TURN, { progress: true }), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(vendorRequests()).toHaveLength(1);
    expect(r.packet.jev_decision ?? null).not.toBeNull();
    expectDispositionMatchesHistory(r, 1);
    expect(handoffSpy).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("F5 control: decision call OFF (progress stream %s): no tracker is installed, nothing waits for a reader, and the record says disabled as before", async (progress) => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(reqWith(PLAIN_TURN, { progress }), params);
    expect(res.status).toBe(200);
    // Without the progress stream nobody reads this body at all, and the turn still settles
    // at once. (The progress stream moves the frames itself, so there it is read.)
    if (progress) expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(handoffSpy).not.toHaveBeenCalled();
    expect(r.packet.jev_decision).toMatchObject({ skipped_reason: "disabled" });
    expect(vendorRequests()).toHaveLength(0);
    expectDispositionMatchesHistory(r, 1);
  });

  it("F5: the call is switched on after the request arrived, so no tracker exists for this turn: an unknown handoff is a no, even with the response read to its end", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const hold = holdRead();
    const res = await POST(reqWith(PLAIN_TURN), params);
    await hold.reached;
    decisionCallOn();
    hold.release();
    expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(handoffSpy).not.toHaveBeenCalled();
    expect(vendorRequests()).toHaveLength(0);
    expect(r.packet.jev_decision ?? null).toBeNull();
    expectDispositionMatchesHistory(r);
  });

  // F6: what the answer COMMITTED (history, `citations_shipped`, the ledger's citation flag)
  // is kept apart from what the route WROTE to its response stream (`response_write`).
  it("F6: a cited answer cancelled before its sources frame: history and the committed count keep the citation, the write record says none was written, ONE usage row", async () => {
    const r = await answeredCancelledAt("after_content");
    expect(r.evidence.filter((e) => typeof e.citationId === "string")).toHaveLength(1);
    expect(r.gate.citations_shipped).toBe(1);
    expect(r.meta.citationsPresent).toBe(true);
    expect(r.packet.response_write).toEqual({ frames_written: false, citations_written: 0 });
  });

  it("F6: cancelled after the sources frame (after the usage frame, before status): the citation was written, the body was not completed", async () => {
    const r = await answeredCancelledAt("after_usage");
    expect(r.gate.citations_shipped).toBe(1);
    expect(r.packet.response_write).toEqual({ frames_written: false, citations_written: 1 });
  });

  it("F6 control: the same answer read to its end: one citation written, every frame written", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(reqWith(PLAIN_TURN), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    const r = await settled();
    expect(r.gate.citations_shipped).toBe(1);
    expect(r.packet.response_write).toEqual({ frames_written: true, citations_written: 1 });
  });

  it("F6 control: an exit that is not the final path writes no write record (the history write failed on a request with an id)", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = new Error("history write failed (test)");
    domainMock.recordTurn.mockImplementation(async () => {
      throw boom;
    });
    const res = await POST(reqWith(PLAIN_TURN), params);
    expect(await drain(res.body!.getReader())).toBe(boom);
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, , telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    expect(telemetry.packet.persistence.outcome).toBe("failed");
    expect("response_write" in telemetry.packet).toBe(false);
  });

  it("F2: after the commit a delivery failure does not wait on releasing the request claim: the reader gets the error and ONE packet is written while a release would never return", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const boom = failDeliveryAfterContent();
    domainMock.abandonNotebookTurnRequest.mockImplementation(() => new Promise<undefined>(() => {}));
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(await Promise.race([drain(res.body!.getReader()), stillPending(400)])).toBe(boom);
    const r = await settled();
    expectDispositionMatchesHistory(r);
    // The claim was completed by the history write: there is nothing to release.
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
  });

  /** A committed turn whose ledger write reports `result`; `cancel` cancels the body during the history write. */
  async function ledgerWriteReports(result: { persisted: false; reason: string }, verdicts: string[], cancel: boolean) {
    stubFetch(REDRAFT, verdicts);
    persistMock.persistTurnUsage.mockImplementationOnce(async () => result as never);
    // eslint-disable-next-line prefer-const -- assigned after POST; read by the hook that runs later
    let reader!: ReadableStreamDefaultReader<Uint8Array>;
    if (cancel) {
      domainMock.recordTurn.mockImplementation(async () => {
        void reader.cancel();
        return ROW_ID as never;
      });
    }
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    reader = res.body!.getReader();
    if (!cancel) expect(await drain(reader)).toBe("closed");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await settleAll();
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
  }
  const NOT_PERSISTED = "turn usage write did not persist";

  it.each([
    ["cancelled during the history write", true],
    ["delivered in full", false],
  ] as const)("F3: an answered turn %s whose ledger write FAILS: the attempt is closed once by the fallback close as answered, and the failure is logged", async (_how, cancel) => {
    await ledgerWriteReports({ persisted: false, reason: "57014" }, [verdict("safe", "none")], cancel);
    expect(closeTurnMock).toHaveBeenCalledTimes(1);
    expect(closeTurnMock.mock.calls[0][0]).toMatchObject({ outcome: "answered" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(NOT_PERSISTED), "57014");
  });

  it("F3: a stopped turn (both verdicts unsafe) cancelled during the history write whose ledger write FAILS: closed once as a safety stop", async () => {
    await ledgerWriteReports({ persisted: false, reason: "57014" }, [verdict("unsafe"), verdict("unsafe")], true);
    expect(closeTurnMock).toHaveBeenCalledTimes(1);
    expect(closeTurnMock.mock.calls[0][0]).toMatchObject({ outcome: "safety_stop" });
  });

  it("F3 control: the ledger write returns no row because a closed row already exists: no second close, and one line says the packet was not stored", async () => {
    await ledgerWriteReports({ persisted: false, reason: "no_row_returned" }, [verdict("safe", "none")], true);
    expect(closeTurnMock).not.toHaveBeenCalled();
    expect(logged(console.error, NOT_PERSISTED)).toHaveLength(0);
    expect(logged(console.error, "found the attempt already closed")).toHaveLength(1);
  });

  it("F3 control: a ledger write that succeeds is followed by no fallback close and neither line", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    expect(await drain(res.body!.getReader())).toBe("closed");
    await settled();
    expect(closeTurnMock).not.toHaveBeenCalled();
    expect(logged(console.error, NOT_PERSISTED)).toHaveLength(0);
    expect(logged(console.error, "found the attempt already closed")).toHaveLength(0);
  });

  it("F3: the response body cancelled DURING generation, ledger write FAILS: the fallback close records the outcome that write attempted, not the close's own default", async () => {
    // Draft 1 never finishes: one word, then the provider stream stays open until it is cancelled.
    // eslint-disable-next-line prefer-const -- assigned after POST; read by the timer that runs later
    let cancelBody!: () => void;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (!body.includes('"stream":true')) throw new Error("no judge or redraft call is expected on a stopped turn (test)");
      setTimeout(() => cancelBody(), 30);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Check " } }] })}\n\n`));
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    persistMock.persistTurnUsage.mockImplementationOnce(async () => ({ persisted: false, reason: "57014" }) as never);
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    const reader = res.body!.getReader();
    cancelBody = () => void reader.cancel();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await settleAll();
    // Precondition: this is the client-stop exit (history holds an errored turn), with one failed write.
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn.answerStatus).toBe("error");
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    const [meta] = persistMock.persistTurnUsage.mock.calls[0] as unknown as PersistCall;
    expect(closeTurnMock).toHaveBeenCalledTimes(1);
    expect(closeTurnMock.mock.calls[0][0]).toMatchObject({ outcome: meta.outcome });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(NOT_PERSISTED), "57014");
  });

  it("F3: a ledger write that THROWS on a committed turn cancelled during the history write leaves the fallback close to record the outcome", async () => {
    stubFetch(REDRAFT, [verdict("safe", "none")]);
    persistMock.persistTurnUsage.mockImplementationOnce(async () => {
      throw new Error("ledger writer threw (test)");
    });
    // eslint-disable-next-line prefer-const -- assigned after POST; read by the hook that runs later
    let reader!: ReadableStreamDefaultReader<Uint8Array>;
    domainMock.recordTurn.mockImplementation(async () => {
      void reader.cancel();
      return ROW_ID as never;
    });
    const res = await POST(req({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }, false), params);
    reader = res.body!.getReader();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await settleAll();
    expect(closeTurnMock).toHaveBeenCalledTimes(1);
    expect(closeTurnMock.mock.calls[0][0]).toMatchObject({ outcome: "answered" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(NOT_PERSISTED), "exception");
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
    bypassTap.args.length = 0;
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
    // R1-D3: the log line names the floor too (the code, never the text).
    expect(console.warn).toHaveBeenCalledWith("[notebook-chat] semantic redraft stopped_check (refusal)");
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
    // R1-D3: the advisory replacement applies here (banner + redraft), and the bypass check
    // still reads the redraft's own text, not the replacement.
    const v = validateAnswer({ ...vbase, answerText: FLOOR_REDRAFT.bypass_ask }) as { replacement: string };
    expect(v.replacement).not.toBe(FLOOR_REDRAFT.bypass_ask);
    expect(v.replacement).toContain(FLOOR_REDRAFT.bypass_ask);
    expect(bypassTap.args.filter((a) => a.includes(TOKEN))).toEqual([FLOOR_REDRAFT.bypass_ask]);
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
      // R1-D3 control: the log line carries a floor code only beside stopped_check.
      if (c.want) expect(console.warn).toHaveBeenCalledWith(`[notebook-chat] semantic redraft ${c.want}`);
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

  // #6081 F3 (Codex round 1): a gateway reporting that its relay timed out or broke does not
  // establish that the provider never ran the request.
  it.each([408, 502, 504, 524])(
    "a gateway timeout (HTTP %i) on the first redraft may have run: the whole cap is debited, no backup request, totals unknown",
    async (status) => {
      const { redraftUrls, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
        draft1Output: 200,
        byHost: { "api.openai.com": { status }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
      });
      const r = await run(Q_PLAIN);
      expect(sent(redraftUrls, redraftBodies)).toEqual([["api.openai.com", 300]]);
      expect(r.streamed).toBe(SAFETY_STOP);
      expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([null, null]);
      expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([null, null]);
      expect(r.gen.attempts.map((a) => [a.provider, a.outcome])).toEqual([
        ["OpenAI", "served"],
        ["OpenAI", USAGE_UNKNOWN],
      ]);
    },
  );

  it.each([400, 429, 503])(
    "control: the provider's own rejection (HTTP %i) leaves the allowance, and the backup is asked with 300",
    async (status) => {
      const { redraftUrls, redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
        draft1Output: 200,
        byHost: { "api.openai.com": { status }, "groq": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } } },
      });
      const r = await run(Q_PLAIN);
      expect(sent(redraftUrls, redraftBodies)).toEqual([
        ["api.openai.com", 300],
        ["api.groq.com", 300],
      ]);
      expect(r.outcome.semantic_redraft).toBe("served");
      expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50, 200 + 20]);
    },
  );

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

  // #6081 F2 (Codex round 1): a reported number above the ledger range is spent, not unknown.
  // An unknown count books one request cap (800 of 4000) and the redraft runs, as above; this
  // one leaves nothing. 2147483648 is one past the ledger's INTEGER column, 1e400 parses to Infinity.
  it.each(["2147483648", "1e300", "1e400"])(
    "draft 1 reports %s, a number above the ledger range: no redraft request, stopped_turn_cap, output total NULL",
    async (raw) => {
      const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1OutputRaw: raw });
      const r = await run(Q_PLAIN);
      expect(redraftBodies).toHaveLength(0);
      expect(r.outcome.semantic_redraft).toBe("stopped_turn_cap");
      expect(totals(r)).toEqual({ ledger: [12, null], packet: [12, null] });
      // An unknown count is an unknown cost, never a price worked out from the reported number.
      expect(r.usage.costUsdEstimate).toBeNull();
    },
  );

  it("control: draft 1 reports 2147483647, the largest count the ledger holds: no redraft request, and the count is stored", async () => {
    const { redraftBodies } = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], { draft1OutputRaw: "2147483647" });
    const r = await run(Q_PLAIN);
    expect(redraftBodies).toHaveLength(0);
    expect(r.outcome.semantic_redraft).toBe("stopped_turn_cap");
    expect(totals(r)).toEqual({ ledger: [12, 2147483647], packet: [12, 2147483647] });
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
    // knownUsage applies the same boundary: the served attempt's usage is known.
    expect(r.gen.attempts.some((a) => "usage_unknown" in a)).toBe(false);
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

describe("R3-C1 — one test per round-3 mutation that survived", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
  });
  // The three ways a redraft-path turn sends no redraft request.
  type ZeroRequest = "stopped_turn_cap" | "stopped_aborted" | "stopped_generation";
  async function zeroRequestTurn(kind: ZeroRequest, o: StubOpts) {
    const ac = new AbortController();
    if (kind === "stopped_turn_cap") process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "500";
    if (kind === "stopped_generation") {
      // The first judge's usage spends the whole OpenAI run budget; OpenAI is the only keyed provider.
      process.env.OPENAI_RUN_BUDGET_USD = "2";
      resetOpenAiRunBudgetForTests();
    }
    const stub = stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      ...o,
      ...(kind === "stopped_aborted" ? { onFirstJudge: () => ac.abort() } : {}),
      ...(kind === "stopped_generation" ? { judgeUsage: { prompt_tokens: 2_000_000_000, completion_tokens: 9 } } : {}),
    });
    const r = await run(Q_PLAIN, ac.signal);
    // Preconditions: one judge call, no redraft request, the outcome named, draft 1 served by OpenAI.
    expect(stub.judgeBodies).toHaveLength(1);
    expect(stub.redraftBodies).toHaveLength(0);
    expect(r.outcome.semantic_redraft).toBe(kind);
    expect(draft1Providers(r.gen)).toEqual(["OpenAI"]);
    return r;
  }

  it("K1 (clean-up on stopped_turn_cap only): a Stop during the first judge, draft 1 reports -5: output NULL in the ledger and the packet, draft 1 marked", async () => {
    const r = await zeroRequestTurn("stopped_aborted", { draft1Output: -5 });
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12, null]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12, null]);
    expect(flagsOf(r.gen)).toEqual([["OpenAI", "served", false, true]]);
  });

  it("K1 (clean-up on stopped_turn_cap only): every provider budget-refused, draft 1 reports -5: output NULL in the ledger and the packet, draft 1 marked", async () => {
    const r = await zeroRequestTurn("stopped_generation", { draft1Output: -5 });
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12, null]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12, null]);
    expect(flagsOf(r.gen)).toEqual([["OpenAI", "served", false, true]]);
  });

  it.each(["stopped_turn_cap", "stopped_aborted", "stopped_generation"] as const)(
    "K3 (lost usage block not marked): draft 1's stream has no usage block, %s: totals NULL, draft 1 marked usage_unknown",
    async (kind) => {
      const r = await zeroRequestTurn(kind, { draft1NoUsage: true });
      expect([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.outputTokens]).toEqual([null, null, null]);
      expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([null, null]);
      expect(flagsOf(r.gen)).toEqual([["OpenAI", "served", false, true]]);
    },
  );

  it("K6 (input side not cleaned with no request sent): 500 ceiling, draft 1 prompt_tokens -5: input NULL in the ledger and the packet", async () => {
    const r = await zeroRequestTurn("stopped_turn_cap", { draft1UsageRaw: '{"prompt_tokens":-5,"completion_tokens":300}' });
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([null, 300]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([null, 300]);
    expect(flagsOf(r.gen)).toEqual([["OpenAI", "served", false, true]]);
  });

  it("K7 (cached rule skipped with no request sent): 500 ceiling, draft 1 cached 60 of a 12-token prompt: cachedInputTokens NULL, draft 1 marked", async () => {
    const r = await zeroRequestTurn("stopped_turn_cap", {
      draft1UsageRaw: '{"prompt_tokens":12,"completion_tokens":300,"prompt_tokens_details":{"cached_tokens":60}}',
    });
    expect([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.outputTokens]).toEqual([12, null, 300]);
    expect(flagsOf(r.gen)).toEqual([["OpenAI", "served", false, true]]);
  });

  it("K7 control: 500 ceiling, draft 1 cached 3 of 12: cached 3 is kept, no usage_unknown", async () => {
    const r = await zeroRequestTurn("stopped_turn_cap", {
      draft1UsageRaw: '{"prompt_tokens":12,"completion_tokens":300,"prompt_tokens_details":{"cached_tokens":3}}',
    });
    expect([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.outputTokens]).toEqual([12, 3, 300]);
    expect(r.gen.attempts.some((a) => "usage_unknown" in a)).toBe(false);
  });

  it("K4 (draft 1 exempt from the cached rule): draft 1 cached 13 of a 12-token prompt, the redraft is served: cachedInputTokens NULL, draft 1 marked", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1UsageRaw: '{"prompt_tokens":12,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":13}}',
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.outputTokens]).toEqual([12 + 50, null, 7 + 20]);
    expect(flagsOf(r.gen)).toEqual([
      ["OpenAI", DRAFT1_REPLACED, false, true],
      ["OpenAI", "served", true, false],
    ]);
  });

  it("K4 control: draft 1 cached 12 of a 12-token prompt, the redraft is served: cached 12 is kept, no usage_unknown", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1UsageRaw: '{"prompt_tokens":12,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":12}}',
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.outputTokens]).toEqual([12 + 50, 12, 7 + 20]);
    expect(r.gen.attempts.some((a) => "usage_unknown" in a)).toBe(false);
  });

  it("K8 (an unknown draft-1 prompt keeps a cached 0): draft 1 prompt_tokens -5 with cached 0, the redraft is served: cachedInputTokens NULL", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1UsageRaw: '{"prompt_tokens":-5,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":0}}',
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.cachedInputTokens, r.usage.outputTokens]).toEqual([null, null, 7 + 20]);
  });

  it("K9 (cached larger than prompt not marked on a generating attempt): the served redraft reports cached 1e9 of 50: the served attempt carries usage_unknown", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 1e9 } } },
      },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12 + 50, 7 + 20]);
    expect(flagsOf(r.gen)).toEqual([
      ["OpenAI", DRAFT1_REPLACED, false, false],
      ["OpenAI", "served", true, true],
    ]);
  });
});

describe("R3-C3 — a redraft count beyond the safe-integer range exhausts the allowance", () => {
  beforeEach(() => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "1500";
    process.env.GROQ_API_KEY = "g0";
    process.env.CEREBRAS_API_KEY = "c0";
  });
  const billedEmptyThenServed = (completion: number) =>
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1Output: 200,
      byHost: {
        "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: completion } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
        cerebras: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });

  it("1500 ceiling, draft 1 200, a billed empty first redraft reports completion_tokens 2^53-1 (above the ledger range): no further request, a stop, output NULL", async () => {
    const { redraftUrls, redraftBodies } = billedEmptyThenServed(Number.MAX_SAFE_INTEGER);
    const r = await run(Q_PLAIN);
    expect(redraftUrls.map(hostOf)).toEqual(["api.openai.com"]);
    expect(redraftBodies.map(capOf)).toEqual([800]);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
    expectStopped(r);
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50, null]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12 + 50, null]);
    // A count the ledger cannot hold is unknown usage: the attempt is labelled as such.
    expect(flagsOf(r.gen)).toEqual([
      ["OpenAI", "served", false, false],
      ["OpenAI", USAGE_UNKNOWN, true, false],
    ]);
  });

  it("#6081 F4: well-formed counts whose SUM leaves the ledger range: the row and the packet are still written, that total NULL", async () => {
    const { redraftUrls } = billedEmptyThenServed(2147483647);
    const r = await run(Q_PLAIN);
    expect(redraftUrls.map(hostOf)).toEqual(["api.openai.com"]);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
    expectStopped(r);
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50, null]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12 + 50, null]);
    // Each count is well formed, so nothing is labelled unknown: the null is the sum's.
    expect(flagsOf(r.gen)).toEqual([
      ["OpenAI", "served", false, false],
      ["OpenAI", BILLED_EMPTY, true, false],
    ]);
  });

  it("#6081 F4: draft 1 prompt 12 and a served redraft prompt of 2147483647: the input total is NULL, the output total is kept", async () => {
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      draft1Output: 200,
      byHost: { "api.openai.com": { content: REDRAFT, usage: { prompt_tokens: 2147483647, completion_tokens: 20 } } },
    });
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([null, 200 + 20]);
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([null, 200 + 20]);
  });

  it("a billed empty first redraft reporting completion_tokens 1e300 (above the safe range): no further request, a stop, output NULL", async () => {
    const { redraftUrls } = billedEmptyThenServed(1e300);
    const r = await run(Q_PLAIN);
    expect(redraftUrls.map(hostOf)).toEqual(["api.openai.com"]);
    expect(r.outcome.semantic_redraft).toBe("stopped_generation");
    expectStopped(r);
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50, null]);
  });

  it("control: the same billed empty first redraft at an ordinary count (300): Groq is asked with 800 and serves", async () => {
    const { redraftUrls, redraftBodies } = billedEmptyThenServed(300);
    const r = await run(Q_PLAIN);
    expect(redraftUrls.map(hostOf)).toEqual(["api.openai.com", "api.groq.com"]);
    expect(redraftBodies.map(capOf)).toEqual([800, 800]);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect([r.usage.inputTokens, r.usage.outputTokens]).toEqual([12 + 50 + 50, 200 + 300 + 20]);
  });
});

describe("#6081 F5 — a failed history write still records what the turn measurably spent", () => {
  const F5_REQ_ID = "55555555-5555-4555-8555-555555555555";
  type Persisted = [unknown, Record<string, unknown>, { packet: { persistence: { outcome: string }; generation: PacketGeneration } }];
  async function failedHistoryWrite(judgeVerdicts: string[]) {
    domainMock.recordTurn.mockRejectedValueOnce(new Error("history down"));
    stubFetch(REDRAFT, judgeVerdicts);
    const res = await POST(chatReq({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: F5_REQ_ID }), params);
    await res.text().catch(() => undefined);
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    const [, usage, extra] = persistMock.persistTurnUsage.mock.calls[0] as unknown as Persisted;
    return { usage, packet: extra.packet };
  }

  it("a redraft that passed its judge, then the history write fails: the ledger names the provider and holds both generations' counts, status error", async () => {
    const { usage, packet } = await failedHistoryWrite([verdict("unsafe"), verdict("safe", "none")]);
    expect(packet.persistence.outcome).toBe("failed");
    expect(usage).toMatchObject({ provider: "OpenAI", inputTokens: 12 + 50, outputTokens: 7 + 20, status: "error" });
    expect([packet.generation.input_tokens, packet.generation.output_tokens]).toEqual([12 + 50, 7 + 20]);
  });

  it("control: an answered turn with no redraft, then the history write fails: the ledger holds draft 1's counts, status error", async () => {
    const { usage, packet } = await failedHistoryWrite([verdict("safe", "none")]);
    expect(packet.persistence.outcome).toBe("failed");
    expect(usage).toMatchObject({ provider: "OpenAI", inputTokens: 12, outputTokens: 7, status: "error" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #6081 round 1, F1: the #6048 hole seen from this change. A response body cancelled after
// the history write used to lose the packet and the usage row, and with them everything this
// change records about a redraft: the allowance spent (#6021), every billed attempt (#6022)
// and the attempt list (#6023). #6082 settles a committed turn once; these pin that the one
// settle writes THIS change's totals and attempts, not draft 1's alone.
// ─────────────────────────────────────────────────────────────────────────────
describe("#6081 F1 — a body cancel after the commit persists the redraft's whole accounting, once", () => {
  const closeTurnMock = closeTurnSpy as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Pinned: an inherited low ceiling would end these in stopped_turn_cap.
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "4000";
    process.env.GROQ_API_KEY = "g0";
    domainMock.recordTurn.mockImplementation(async () => ROW_ID as never);
  });
  afterEach(() => {
    domainMock.recordTurn.mockImplementation(async () => undefined);
  });

  /** Draft 1 unsafe (12 in, 7 out); the redraft: OpenAI billed and empty (50 in, 30 out), then Groq writes it (50 in, 20 out). */
  const billedEmptyThenGroq = () =>
    stubFetch(REDRAFT, [verdict("unsafe"), verdict("safe", "none")], {
      byHost: {
        "api.openai.com": { content: "", finish: "length", usage: { prompt_tokens: 50, completion_tokens: 30 } },
        groq: { content: REDRAFT, usage: { prompt_tokens: 50, completion_tokens: 20 } },
      },
    });

  /** The one persisted row, read after everything has had time to settle. */
  async function theOnePersistedRow() {
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 150));
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    const [meta, usage, telemetry] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
      { packet: { answer_gate: Record<string, unknown>; generation: PacketGeneration; persistence: { turn_row_id: string | null; outcome: string } } },
    ];
    const outcome = telemetry.packet.answer_gate.safety_outcome as Record<string, unknown>;
    return { turn, meta, usage, gen: telemetry.packet.generation, persistence: telemetry.packet.persistence, outcome };
  }

  it("redraft with a billed empty first attempt, body cancelled during the held cited-page read: ONE row, with all three generations' usage and both redraft attempts", async () => {
    const { judgeBodies } = billedEmptyThenGroq();
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
    const res = await POST(
      new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
        method: "POST",
        body: JSON.stringify({ message: Q_PLAIN, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }),
        headers: { "Content-Type": "application/json" },
      }),
      params,
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reached;
    // Precondition: the redraft was generated and passed its judge before the cancel.
    expect(judgeBodies).toHaveLength(2);
    await reader.cancel();
    release();
    const r = await theOnePersistedRow();
    // History holds the stop; the row was written by the settle, never by a bare close.
    expect(r.turn.answerText).toBe(SAFETY_STOP);
    expect(r.outcome.semantic_redraft).toBe("stopped_aborted");
    expect(r.persistence).toMatchObject({ turn_row_id: ROW_ID, outcome: "ok" });
    expect(closeTurnMock).not.toHaveBeenCalled();
    // #6022: draft 1 + the billed empty attempt + the generation that was not served.
    expect(r.usage).toMatchObject({ provider: "OpenAI", inputTokens: 12 + 50 + 50, outputTokens: 7 + 30 + 20 });
    // #6023: both redraft requests are on the packet, neither as served; its totals equal the ledger row.
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", "empty_completion"],
      ["Groq", NOT_SERVED],
    ]);
    expect(r.gen.served_provider).toBe("OpenAI");
    expect([r.gen.input_tokens, r.gen.output_tokens]).toEqual([12 + 50 + 50, 7 + 30 + 20]);
  });

  it("control: the same redraft read to its end is served by Groq, with the same three generations' usage", async () => {
    billedEmptyThenGroq();
    const r = await run(Q_PLAIN);
    expect(r.outcome.semantic_redraft).toBe("served");
    expect(r.usage).toMatchObject({ inputTokens: 12 + 50 + 50, outputTokens: 7 + 30 + 20 });
    expect(redraftAttempts(r.gen)).toEqual([
      ["OpenAI", "empty_completion"],
      ["Groq", "served"],
    ]);
    expect(r.gen.served_provider).toBe("Groq");
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
  });
});
