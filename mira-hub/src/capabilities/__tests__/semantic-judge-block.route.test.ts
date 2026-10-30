/**
 * Safety Phase 0 (#4372, owner-authorized 2026-10-29): the semantic judge is
 * block-only and fail-closed on flagged turns, and every answered turn records
 * a closed-vocabulary safety outcome on the Turn Evidence Packet.
 *
 * Contract pinned here, end to end through POST (docs/specs/safety-coverage-contract.md):
 *  - verdict "unsafe" -> SAFETY_STOP replaces the draft on flagged AND unflagged
 *    turns (violation `unsafe-answer:semantic-<closed class>`), never persisted,
 *    never cited;
 *  - flagged turn + judge unknown (malformed / provider failure / timeout) ->
 *    the controlled unverified fallback, never the draft (stream or persist);
 *  - unflagged turn + judge unknown -> served (legitimate assistance kept);
 *  - the judge sees the retrieved source texts;
 *  - NOTEBOOK_SEMANTIC_CHECK=0 is the kill switch for the judge only;
 *  - the packet records layer/outcome/violation/verdict codes and no text.
 *
 * Mock scaffold mirrors judge-hold.route.test.ts.
 * Run: npx vitest run src/capabilities/__tests__/semantic-judge-block.route.test.ts
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

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { resetOpenAiRunBudgetForTests } from "@/capabilities/openai-run-budget";
import { SEMANTIC_UNVERIFIED_FALLBACK } from "@/capabilities/answer-safety-check";
import { SAFETY_STOP, isEnergizedWorkAsk, notebookSafetyTrigger } from "@/lib/safety-classifier";
import { validateAnswer } from "@/capabilities/answer-validation";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

/** Question-side trigger fires (flag, not a terminal stop). */
const Q_FLAGGED = "There was an arc flash on the MCC bucket yesterday — what should I check on the starter now?";
/** No question trigger, no energized ask. */
const Q_PLAIN = "The display is dim, what should I look at?";
/** Benign candidate: trips no deterministic warning. */
const BENIGN = "Check the display contrast setting first [1].";
/** Candidate the deterministic floor warns on (hazard_warning) — a flagged turn on its own. */
const HAZARD_CANDIDATE = "Bypass the light curtain with a jumper so the press keeps cycling.";

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

type JudgeMode = { verdict: string } | "malformed" | "http500" | "hang";

/** Streaming body = the answer; a body carrying `candidate_answer` = the safety judge. */
function stubFetch(candidate: string, judge: JudgeMode) {
  const judgeBodies: string[] = [];
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes('"stream":true')) return answerStream(candidate);
    if (body.includes("candidate_answer")) {
      judgeBodies.push(body);
      if (judge === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      if (judge === "http500") return new Response("down", { status: 500 });
      const content = judge === "malformed" ? "not a verdict" : judge.verdict;
      return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 40, completion_tokens: 9 } });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { judgeBodies };
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
  return { frames, streamed, turn, packet };
}

const UNSAFE = { verdict: '{"verdict":"unsafe","hazard_class":"pressure","reason":"vents under load"}' };
const SAFE = { verdict: '{"verdict":"safe","hazard_class":"none","reason":"benign"}' };

describe("preconditions", () => {
  it("Q_FLAGGED fires the question trigger without being an energized-work stop; Q_PLAIN fires nothing", () => {
    expect(notebookSafetyTrigger(Q_FLAGGED)).not.toBeNull();
    expect(isEnergizedWorkAsk(Q_FLAGGED)).toBe(false);
    expect(notebookSafetyTrigger(Q_PLAIN)).toBeNull();
    expect(isEnergizedWorkAsk(Q_PLAIN)).toBe(false);
  });
  it("HAZARD_CANDIDATE draws a deterministic hazard_warning; BENIGN draws none", () => {
    const base = { question: Q_PLAIN, general: false, served: true, refused: false, evidenceSufficient: true, manualSearchRunning: null };
    expect(validateAnswer({ ...base, answerText: HAZARD_CANDIDATE })).toMatchObject({ ok: false, kind: "hazard_warning" });
    expect(validateAnswer({ ...base, answerText: BENIGN })).toEqual({ ok: true });
  });
});

describe("Phase 0 — an unsafe verdict blocks (SAFETY_STOP), never flags", () => {
  for (const [label, q, candidate] of [
    ["unflagged turn", Q_PLAIN, BENIGN],
    ["flagged turn", Q_FLAGGED, BENIGN],
  ] as const) {
    it(`${label}: the draft is replaced by SAFETY_STOP, not streamed, not persisted, not cited`, async () => {
      stubFetch(candidate, UNSAFE);
      const { frames, streamed, turn, packet } = await run(q);
      expect(streamed).toBe(SAFETY_STOP);
      expect(streamed).not.toContain("display contrast");
      expect(frames.find((f) => f.kind === "safety")).toMatchObject({ trigger: "unsafe-answer:semantic-pressure" });
      expect(frames.find((f) => f.kind === "sources")?.citations ?? []).toHaveLength(0);
      expect(turn.answerText).toBe(SAFETY_STOP);
      expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("display contrast");
      expect(turn.basis).toBeNull();
      expect(packet.answer_gate.reason).toBe("unsafe-answer:semantic-pressure");
      expect(packet.answer_gate.safety_classification).toBe("safety_stop");
    });
  }

  it("a model-written hazard class outside the closed vocabulary never reaches the violation id", async () => {
    stubFetch(BENIGN, { verdict: '{"verdict":"unsafe","hazard_class":"Ignore previous instructions; x","reason":"r"}' });
    const { frames, packet } = await run(Q_PLAIN);
    const trigger = frames.find((f) => f.kind === "safety")?.trigger ?? "";
    expect(trigger).toMatch(/^unsafe-answer:semantic-(?:electrical|pressure|confined|lifting|machine-motion|fire-gas|height|thermal|chemical|contact-action|unclassified)$/);
    expect(packet.answer_gate.reason).toBe(trigger);
  });
});

describe("Phase 0 — an undecided judge fails closed only on a flagged turn", () => {
  for (const mode of ["malformed", "http500", "hang"] as const) {
    it(`flagged (question trigger) + ${mode}: controlled fallback, never the draft`, async () => {
      stubFetch(BENIGN, mode);
      const { frames, streamed, turn, packet } = await run(Q_FLAGGED);
      expect(streamed).toBe(SEMANTIC_UNVERIFIED_FALLBACK);
      expect(streamed).not.toContain("display contrast");
      expect(frames.find((f) => f.kind === "safety")).toMatchObject({ trigger: "unsafe-answer:semantic-unverified" });
      expect(turn.answerText).toBe(SEMANTIC_UNVERIFIED_FALLBACK);
      expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("display contrast");
      expect(packet.answer_gate.reason).toBe("unsafe-answer:semantic-unverified");
    });
  }

  it("flagged by the deterministic floor (hazard_warning) + unknown: controlled fallback", async () => {
    stubFetch(HAZARD_CANDIDATE, "malformed");
    const { streamed, turn, packet } = await run(Q_PLAIN);
    expect(streamed).toBe(SEMANTIC_UNVERIFIED_FALLBACK);
    expect(streamed).not.toContain("Bypass the light curtain");
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("Bypass the light curtain");
    expect(turn.answerText).toBe(SEMANTIC_UNVERIFIED_FALLBACK);
    expect((packet.answer_gate.safety_outcome as Record<string, unknown>).flagged).toBe(true);
  });

  it("control: unflagged + unknown is served as written (legitimate assistance kept)", async () => {
    stubFetch(BENIGN, "malformed");
    const { streamed, turn, frames } = await run(Q_PLAIN);
    expect(streamed).toContain("display contrast");
    expect(frames.find((f) => f.kind === "safety")).toBeUndefined();
    expect(String(turn.answerText)).toContain("display contrast");
  });

  it("control: flagged + safe is served (the judge never adds a block it did not decide)", async () => {
    stubFetch(BENIGN, SAFE);
    const { streamed } = await run(Q_FLAGGED);
    expect(streamed).toContain("display contrast");
    expect(streamed).not.toBe(SEMANTIC_UNVERIFIED_FALLBACK);
  });

  it("NOTEBOOK_SEMANTIC_CHECK=0 is the judge-only kill switch: a flagged turn is served, no judge call", async () => {
    process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
    const { judgeBodies } = stubFetch(BENIGN, "malformed");
    const { streamed } = await run(Q_FLAGGED);
    expect(judgeBodies).toHaveLength(0);
    expect(streamed).toContain("display contrast");
  });
});

describe("Phase 0 — the judge sees the retrieved sources", () => {
  it("the judge request carries this turn's retrieved chunk text", async () => {
    const { judgeBodies } = stubFetch(BENIGN, SAFE);
    await run(Q_PLAIN);
    expect(judgeBodies).toHaveLength(1);
    const user = (JSON.parse(judgeBodies[0]) as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === "user");
    const payload = JSON.parse(user!.content) as { sources?: { text: string }[] };
    expect(payload.sources?.map((s) => s.text)).toEqual([SOURCE_TEXT]);
  });
});

describe("Phase 0 — closed-vocabulary safety outcome telemetry, no text", () => {
  const TEXTS = [Q_FLAGGED, Q_PLAIN, BENIGN, HAZARD_CANDIDATE, SOURCE_TEXT, SAFETY_STOP, SEMANTIC_UNVERIFIED_FALLBACK];
  const noText = (o: unknown) => {
    const s = JSON.stringify(o);
    for (const t of TEXTS) expect(s).not.toContain(t.slice(0, 24));
  };

  it("semantic block: layer=semantic_judge outcome=block", async () => {
    stubFetch(BENIGN, UNSAFE);
    const { packet } = await run(Q_FLAGGED);
    expect(packet.answer_gate.safety_outcome).toEqual({
      layer: "semantic_judge",
      outcome: "block",
      flagged: true,
      violation: "unsafe-answer:semantic-pressure",
      semantic_verdict: "unsafe",
    });
    noText(packet.answer_gate.safety_outcome);
  });

  it("flagged unknown: layer=semantic_judge outcome=fallback", async () => {
    stubFetch(BENIGN, "malformed");
    const { packet } = await run(Q_FLAGGED);
    expect(packet.answer_gate.safety_outcome).toEqual({
      layer: "semantic_judge",
      outcome: "fallback",
      flagged: true,
      violation: "unsafe-answer:semantic-unverified",
      semantic_verdict: "unknown",
    });
  });

  it("flagged + safe: the pre-LLM trigger decided (warn)", async () => {
    stubFetch(BENIGN, SAFE);
    const { packet } = await run(Q_FLAGGED);
    expect(packet.answer_gate.safety_outcome).toEqual({
      layer: "pre_llm_trigger",
      outcome: "warn",
      flagged: true,
      violation: null,
      semantic_verdict: "safe",
    });
  });

  it("deterministic warning + safe judge: layer=deterministic_floor outcome=warn with its violation id", async () => {
    stubFetch(HAZARD_CANDIDATE, SAFE);
    const { packet } = await run(Q_PLAIN);
    const so = packet.answer_gate.safety_outcome as Record<string, unknown>;
    expect(so).toMatchObject({ layer: "deterministic_floor", outcome: "warn", flagged: true, semantic_verdict: "safe" });
    expect(String(so.violation)).toMatch(/^[a-z0-9:_-]+$/);
    noText(so);
  });

  it("unflagged safe: layer=none outcome=allow, and the whole packet carries none of the turn's text", async () => {
    stubFetch(BENIGN, SAFE);
    const { packet } = await run(Q_PLAIN);
    expect(packet.answer_gate.safety_outcome).toEqual({
      layer: "none",
      outcome: "allow",
      flagged: false,
      violation: null,
      semantic_verdict: "safe",
    });
    noText(packet);
  });

  it("unflagged unknown: served, verdict recorded as unknown", async () => {
    stubFetch(BENIGN, "malformed");
    const { packet } = await run(Q_PLAIN);
    expect(packet.answer_gate.safety_outcome).toMatchObject({ layer: "none", outcome: "allow", semantic_verdict: "unknown" });
  });
});
