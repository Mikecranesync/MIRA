/**
 * Stranger Walk accounting contract (#4460 / #5045 / #5044 / #5050 / #5051).
 *
 * A deterministic safety stop makes no provider call and streams no usage frame. That is legitimate,
 * but "no usage frame" is also exactly what a paid call with lost usage looks like. So a stop is
 * accepted as zero-cost ONLY when the Hub's own ledger row for that turn (decision_traces, written
 * before the stop's response is returned) proves no provider ran. Anything else stays fail-closed.
 *
 * Fixtures are the verbatim streams of run charlie-20261031T1505Z (staging 01f4f512f).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JUDGE_OUTPUT_TOKENS } from "@/capabilities/answer-safety-check";
import { looksNonEnglish } from "@/capabilities/answer-language";
import { ENERGIZED_WORK_TRIGGER } from "@/capabilities/energized-work-stop";
import { buildDecisionRequest } from "@/capabilities/observability/jev-decision";
import { buildJevSufficiencyRequest } from "@/capabilities/observability/jev-shadow";
import { buildTurnDecisionState } from "@/capabilities/observability/turn-decision-state";
import corpusJson from "./corpus.json";
import fx from "./fixtures-accounting.json";
import { classify, scoreAll, scorecard, safetyStopTrace, type Corpus, type Observation } from "./score";
import {
  BUDGET, BudgetMeter, checkFingerprint, ledgerRowsFor, ledgerVerdictFor, JEV_CALLS_PER_TURN, JEV_CEILING_PER_MTOK_IN, JEV_INPUT_BOUND, pricesFromEnv,
  PROVIDER_PRICES, runtimeDrift, servedVerdict, TURN_BOUND, worstCaseTurnUsd, zeroCallVerdict, type LedgerRow,
} from "./staging";

const corpus = corpusJson as Corpus;
const STOP_SSE = fx.safetyStop.sse;
const SERVED_SSE = fx.served.sse;
const TRACE = "a08ed5d8e240893725d684ce7a0d3f7b";

/** The row the route's energized-work stop writes (route.ts `stopUsage` + the recorder packet). */
const stopRow = (over: Partial<LedgerRow> = {}, packet: Record<string, unknown> = {}): LedgerRow => ({
  provider: null, model: null, status: "empty", route_reason: "legacy_cascade", outcome: "safety_stop",
  input_tokens: null, output_tokens: null, cost_usd_estimate: null,
  evidence_packet: {
    trace_id: TRACE,
    generation: { attempts: [], served_provider: null, served_model: null, input_tokens: null, output_tokens: null },
    answer_gate: { reason: "energized_work_ask", safety_classification: "safety_stop", jev_sufficient: null, jev_skipped_reason: null, jev_input_tokens: null },
    ...packet,
  },
  ...over,
});

/** A served answer's row: the main cascade ran on OpenAI, both Jev calls ran. */
const servedRow = (over: Partial<LedgerRow> = {}, gate: Record<string, unknown> = {}, jevDecision: unknown = { skipped_reason: null, input_tokens: 964 }): LedgerRow => ({
  provider: "OpenAI", model: "gpt-5.4-mini", status: "ok", route_reason: "primary", outcome: "answered",
  input_tokens: 3434, output_tokens: 155, cost_usd_estimate: "0.003273",
  evidence_packet: {
    trace_id: TRACE,
    generation: { attempts: [{ provider: "OpenAI" }], served_provider: "OpenAI" },
    answer_gate: { reason: null, safety_classification: "none", jev_sufficient: 0.8, jev_skipped_reason: null, jev_input_tokens: 1681, ...gate },
    jev_decision: jevDecision,
  },
  ...over,
});

describe("a deterministic safety stop is recognised from its stream, never from its wording", () => {
  it("the recorded energized-work stop: trace id, safety frame, no usage frame", () => {
    expect(safetyStopTrace(STOP_SSE)).toBe(TRACE);
    expect(STOP_SSE).toContain(`"trigger":"${ENERGIZED_WORK_TRIGGER}"`);
  });
  it("control: a served answer carries a usage frame and is not a stop", () => {
    expect(safetyStopTrace(SERVED_SSE)).toBeNull();
  });
  it("a safety frame WITH a usage frame is a served answer with a notice, not a stop", () => {
    const usage = SERVED_SSE.split("\n").find((l) => l.includes('"kind":"usage"'))!;
    expect(safetyStopTrace(`${STOP_SSE}\n${usage}\n`)).toBeNull();
  });
  it("a stop without a trace frame cannot be tied to a ledger row: not recognised", () => {
    const noTrace = STOP_SSE.split("\n").filter((l) => !l.includes('"kind":"trace"')).join("\n");
    expect(safetyStopTrace(noTrace)).toBeNull();
  });
  it("a stop whose status is not 'answered' is not recognised", () => {
    expect(safetyStopTrace(STOP_SSE.replace('"status":"answered"', '"status":"error"'))).toBeNull();
  });
});

describe("zero-call proof: the Hub's own ledger row, all of it, or nothing", () => {
  it("accepts the row the stop path writes", () => {
    expect(zeroCallVerdict([stopRow()], TRACE)).toEqual({ ok: true, kind: "zero_call", answerUsd: 0, jevInputTokens: 0 });
  });
  it("no row, or more than one closed row, is not proof", () => {
    expect(zeroCallVerdict([], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/no ledger row/) });
    expect(zeroCallVerdict([stopRow(), stopRow()], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/2 ledger rows/) });
  });
  it("a row naming a provider or model is a PAID call whose usage never reached the stream", () => {
    expect(zeroCallVerdict([stopRow({ provider: "OpenAI" })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/paid call, usage missing/) });
    expect(zeroCallVerdict([stopRow({ model: "gpt-5.4-mini" })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/paid call, usage missing/) });
  });
  it("an exhausted cascade (status error: providers attempted and failed) is not a zero-call stop", () => {
    expect(zeroCallVerdict([stopRow({ status: "error", route_reason: "exhausted:OpenAI" })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/status error/) });
  });
  it("any recorded token or cost is not zero-call", () => {
    for (const k of ["input_tokens", "output_tokens", "cost_usd_estimate"] as const) {
      expect(zeroCallVerdict([stopRow({ [k]: 1 })], TRACE), k).toMatchObject({ ok: false });
    }
  });
  it("the outcome must be the safety stop, decided by the energized-work gate", () => {
    expect(zeroCallVerdict([stopRow({ outcome: "answered" })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/outcome/) });
    expect(zeroCallVerdict([stopRow({}, { answer_gate: { reason: "unsafe_answer", safety_classification: "safety_stop" } })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/energized_work_ask/) });
  });
  it("a recorded generation attempt or served provider is a provider call", () => {
    expect(zeroCallVerdict([stopRow({}, { generation: { attempts: [{ provider: "OpenAI" }], served_provider: null } })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/generation attempt/) });
    expect(zeroCallVerdict([stopRow({}, { generation: { attempts: [], served_provider: "OpenAI" } })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/served provider/) });
  });
  it("a Jev call recorded on the stop is metered activity, not zero-call", () => {
    expect(zeroCallVerdict([stopRow({}, { jev_decision: { skipped_reason: null, input_tokens: 900 } })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/Jev/) });
    expect(zeroCallVerdict([stopRow({}, { answer_gate: { reason: "energized_work_ask", safety_classification: "safety_stop", jev_input_tokens: 10, jev_skipped_reason: null } })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/Jev/) });
  });
  it("a packet for another trace is not this turn's proof", () => {
    expect(zeroCallVerdict([stopRow({}, { trace_id: "f".repeat(32) })], TRACE)).toMatchObject({ ok: false, reason: expect.stringMatching(/trace/) });
  });
});

describe("served turns reconcile against the same ledger, Jev included", () => {
  it("accepts a served row on the streamed provider and reports its answer cost and Jev tokens", () => {
    expect(servedVerdict([servedRow()], TRACE, "OpenAI")).toEqual({ ok: true, kind: "served", answerUsd: 0.003273, jevInputTokens: 1681 + 964 });
  });
  it("skipped Jev calls contribute no tokens (the booking still covers them)", () => {
    const v = servedVerdict([servedRow({}, { jev_sufficient: null, jev_skipped_reason: "disabled", jev_input_tokens: null }, null)], TRACE, "OpenAI");
    expect(v).toEqual({ ok: true, kind: "served", answerUsd: 0.003273, jevInputTokens: 0 });
  });
  it("a Jev call that ran with unknown usage is unknown spend: fail closed", () => {
    expect(servedVerdict([servedRow({}, { jev_input_tokens: null })], TRACE, "OpenAI")).toMatchObject({ ok: false, reason: expect.stringMatching(/Jev .*unknown/) });
    expect(servedVerdict([servedRow({}, {}, { skipped_reason: null, input_tokens: null })], TRACE, "OpenAI")).toMatchObject({ ok: false, reason: expect.stringMatching(/Jev .*unknown/) });
  });
  it("a Jev call above the booked input bound stops later paid turns", () => {
    expect(servedVerdict([servedRow({}, { jev_input_tokens: JEV_INPUT_BOUND + 1 })], TRACE, "OpenAI")).toMatchObject({ ok: false, reason: expect.stringMatching(/bound/) });
  });
  it("a ledger provider that disagrees with the stream, a missing row, or a foreign trace is not reconciled", () => {
    expect(servedVerdict([servedRow()], TRACE, "OpenRouter")).toMatchObject({ ok: false, reason: expect.stringMatching(/provider/) });
    expect(servedVerdict([], TRACE, "OpenAI")).toMatchObject({ ok: false, reason: expect.stringMatching(/no ledger row/) });
    expect(servedVerdict([servedRow({}, {}, undefined)].map((r) => ({ ...r, evidence_packet: { ...r.evidence_packet, trace_id: "0".repeat(32) } })), TRACE, "OpenAI")).toMatchObject({ ok: false, reason: expect.stringMatching(/trace/) });
  });
  it("answer cost is the ledger's own tokens at the booked rate: staging rows carry a null cost estimate", () => {
    // 2026-10-30 staging rows (gpt-5.4-mini, answered): tokens present, cost_usd_estimate NULL.
    expect(servedVerdict([servedRow({ cost_usd_estimate: null })], TRACE, "OpenAI")).toMatchObject({ ok: true, answerUsd: 0.003273 });
    expect(servedVerdict([servedRow({ input_tokens: "3434", output_tokens: "155" })], TRACE, "OpenAI")).toMatchObject({ ok: true, answerUsd: 0.003273 });
  });
  it("unknown ledger tokens are an unknown answer cost, never zero", () => {
    expect(servedVerdict([servedRow({ input_tokens: null })], TRACE, "OpenAI")).toMatchObject({ ok: true, answerUsd: null });
    expect(servedVerdict([servedRow({ output_tokens: -1 })], TRACE, "OpenAI")).toMatchObject({ ok: true, answerUsd: null });
  });
});

describe("per-turn ledger read: the walk ties each stream to its own row before teardown deletes it", () => {
  const T = "11111111-2222-3333-4444-555555555555";
  it("a stop is checked as zero-call against the row for ITS trace and tenant", async () => {
    const asked: string[][] = [];
    const v = await ledgerVerdictFor(T, STOP_SSE, async (t, tr) => { asked.push([t, tr]); return [stopRow()]; });
    expect(asked).toEqual([[T, TRACE]]);
    expect(v.verdict).toEqual({ ok: true, kind: "zero_call", answerUsd: 0, jevInputTokens: 0 });
    expect(v.rows).toHaveLength(1); // the copy the walk keeps
  });
  it("a served turn is reconciled against the provider its usage frame names", async () => {
    const servedTrace = JSON.parse(SERVED_SSE.split("\n").find((l) => l.includes('"kind":"trace"'))!.slice(6)).traceId as string;
    const row = (over: Partial<LedgerRow> = {}) => { const r = servedRow(over); return { ...r, evidence_packet: { ...r.evidence_packet, trace_id: servedTrace } }; };
    const asked: string[] = [];
    const served = await ledgerVerdictFor(T, SERVED_SSE, async (_t, tr) => { asked.push(tr); return [row()]; });
    expect(asked).toEqual([servedTrace]);
    expect(served.verdict).toMatchObject({ ok: true, kind: "served" });
    const other = await ledgerVerdictFor(T, SERVED_SSE, async () => [row({ provider: "OpenRouter" })]);
    expect(other.verdict).toMatchObject({ ok: false, reason: expect.stringMatching(/stream said OpenAI/) });
  });
  it("the ledger read selects the real columns, scoped to the walk tenant and the turn's trace, closed rows only", async () => {
    const seen: { sql: string; params: unknown[] }[] = [];
    const db = { query: async (sql: string, params: unknown[]) => { seen.push({ sql, params }); return { rows: [stopRow()] }; } };
    expect(await ledgerRowsFor(T, TRACE, { db, waitMs: 0 })).toHaveLength(1);
    expect(seen[0].params).toEqual([T, TRACE]);
    // decision_traces has `model_used`, not `model` (a live staging read 2026-10-31 rejected `model`).
    expect(seen[0].sql).toMatch(/model_used AS model/);
    expect(seen[0].sql).toMatch(/tenant_id = \$1 AND otel_trace_id = \$2 AND lifecycle = 'closed'/);
    await expect(ledgerRowsFor("mike", TRACE, { db, waitMs: 0 })).rejects.toThrow(/tenant uuid/);
    await expect(ledgerRowsFor(T, "x", { db, waitMs: 0 })).rejects.toThrow(/trace id/);
  });
  it("no trace frame, no stream, or an unreadable ledger is a failing verdict, never a pass", async () => {
    const noTrace = SERVED_SSE.split("\n").filter((l) => !l.includes('"kind":"trace"')).join("\n");
    expect((await ledgerVerdictFor(T, noTrace, async () => [servedRow()])).verdict).toMatchObject({ ok: false, reason: expect.stringMatching(/trace/) });
    expect((await ledgerVerdictFor(T, null, async () => [servedRow()])).verdict).toMatchObject({ ok: false });
    expect((await ledgerVerdictFor(T, STOP_SSE, async () => { throw new Error("db down"); })).verdict).toMatchObject({ ok: false, reason: expect.stringMatching(/ledger read failed: db down/) });
  });
});

describe("the meter: a verified zero-call stop passes, missing usage never does", () => {
  it("the recorded stop + its proving ledger row keeps the run going and counts as a zero-call turn", () => {
    const meter = new BudgetMeter();
    meter.book(); meter.verify("micro820-um-q4", STOP_SSE, zeroCallVerdict([stopRow()], TRACE));
    expect([meter.canAfford(), meter.unbounded, meter.zeroCallTurns]).toEqual([true, null, 1]);
  });
  it("the recorded stop with no ledger verdict stops every later paid turn (the 15:05Z behaviour, now with a reason)", () => {
    const meter = new BudgetMeter();
    meter.book(); meter.verify("micro820-um-q4", STOP_SSE);
    expect([meter.canAfford(), meter.unbounded]).toEqual([false, "micro820-um-q4"]);
    expect(meter.unboundedReason).toMatch(/zero-call not proven/);
  });
  it("the recorded stop with a failing verdict stops, carrying the ledger's reason", () => {
    const meter = new BudgetMeter();
    meter.book(); meter.verify("micro820-um-q4", STOP_SSE, zeroCallVerdict([stopRow({ provider: "OpenAI" })], TRACE));
    expect(meter.canAfford()).toBe(false);
    expect(meter.unboundedReason).toMatch(/paid call, usage missing/);
  });
  it("a served verdict cannot excuse a stop, and a zero-call verdict cannot excuse a stream without usage", () => {
    const a = new BudgetMeter();
    a.book(); a.verify("s", STOP_SSE, servedVerdict([servedRow()], TRACE, "OpenAI"));
    expect(a.canAfford()).toBe(false);
    const b = new BudgetMeter();
    const noUsage = SERVED_SSE.split("\n").filter((l) => !l.includes('"kind":"usage"')).join("\n");
    b.book(); b.verify("u", noUsage, zeroCallVerdict([stopRow()], TRACE));
    expect(b.canAfford()).toBe(false);
    expect(b.unboundedReason).toMatch(/usage missing/);
  });
  it("a served turn with a failing ledger verdict stops; with a passing one it reconciles", () => {
    const bad = new BudgetMeter();
    bad.book(); bad.verify("q", SERVED_SSE, servedVerdict([servedRow({}, { jev_input_tokens: null })], TRACE, "OpenAI"));
    expect(bad.canAfford()).toBe(false);
    const good = new BudgetMeter();
    good.book(); good.verify("q", SERVED_SSE, servedVerdict([servedRow()], TRACE, "OpenAI"));
    expect([good.canAfford(), good.reconciledAnswerUsd, good.jevInputTokens, good.unknownAnswerCostTurns]).toEqual([true, 0.003273, 2645, 0]);
    const unknown = new BudgetMeter();
    unknown.book(); unknown.verify("q", SERVED_SSE, servedVerdict([servedRow({ input_tokens: null })], TRACE, "OpenAI"));
    expect([unknown.reconciledAnswerUsd, unknown.unknownAnswerCostTurns]).toEqual([0, 1]);
  });
  it("halt() records a pre-dispatch refusal (drift) and stops the run", () => {
    const meter = new BudgetMeter();
    meter.halt("q9", "deploy changed");
    expect([meter.canAfford(), meter.unbounded, meter.unboundedReason]).toEqual([false, "q9", "deploy changed"]);
  });
});

describe("every metered lane is booked from production constants (#5044 Jev, #5050 judge, #5051 answer cap)", () => {
  it("the booking adds Jev (two calls, input-only, at the declared ceiling) to the answer + judge on every provider", () => {
    const one = (p: { input: number; output: number }, out: number) => (TURN_BOUND.inputTokens * p.input + out * p.output) / 1e6;
    let cascade = 0;
    for (const p of Object.values(PROVIDER_PRICES)) cascade += one(p, TURN_BOUND.answerOutputTokens) + one(p, TURN_BOUND.judgeOutputTokens);
    const jev = (JEV_CALLS_PER_TURN * JEV_INPUT_BOUND * JEV_CEILING_PER_MTOK_IN) / 1e6;
    expect(JEV_CALLS_PER_TURN).toBe(2);
    expect(worstCaseTurnUsd()).toBeCloseTo(cascade + jev, 12);
    expect(BUDGET.usdBookedPerTurn).toBe(worstCaseTurnUsd());
  });
  it("the declared Jev ceiling sits at least 2x above every measured Jev rate on record (~$0.042/Mtok input)", () => {
    for (const [tokens, usd] of [[21_683, 0.000911], [187_838, 0.0079], [2_866, 0.00012]]) {
      expect(JEV_CEILING_PER_MTOK_IN).toBeGreaterThan((usd / tokens) * 1e6 * 2);
    }
  });
  it("control: 50 questions still fit the $4.50 budget with Jev booked", () => {
    expect(50 * BUDGET.usdBookedPerTurn).toBeLessThanOrEqual(4.5);
  });
  it("the judge bound is the production judge cap (#5050: the walk books the judge exactly once per provider)", () => {
    expect(TURN_BOUND.judgeOutputTokens).toBe(JUDGE_OUTPUT_TOKENS);
  });
  it("the answer bound covers the largest cap the notebook route actually sends (#5051), not the global 4000", () => {
    const route = readFileSync(path.join(__dirname, "../../src/app/api/equipment-notebooks/[id]/chat/route.ts"), "utf8");
    const m = route.match(/const requestCap = seam \? Math\.min\(coverageDirective \? (\d+) : (\d+), outputCap\) : coverageDirective \? (\d+) : (\d+);/);
    expect(m, "requestCap expression moved: re-derive TURN_BOUND.answerOutputTokens").not.toBeNull();
    expect(Math.max(...m!.slice(1).map(Number))).toBeLessThanOrEqual(TURN_BOUND.answerOutputTokens);
  });
  it("both production Jev requests, built from oversized inputs, stay under the booked input bound (chars bound tokens)", () => {
    const big = (n: number) => "Lorem ipsum dolor sit amet 0123456789 ".repeat(Math.ceil(n / 38)).slice(0, n);
    const chunks = Array.from({ length: 20 }, () => ({ content: big(20_000), title: big(500), source: big(500), family: big(500) }));
    const observations = Array.from({ length: 20 }, () => big(20_000));
    const shadow = JSON.stringify(buildJevSufficiencyRequest(big(20_000), chunks, observations));
    const decision = JSON.stringify(buildDecisionRequest(buildTurnDecisionState({
      question: big(20_000), answer: big(20_000), assetIdentity: big(5_000), observations, evidence: chunks, traceId: "t", attemptId: "a",
      gates: { decision: big(40), evidence_sufficient: true, citations_shipped: 6, ungrounded_unit_claim: false, system_prompt_kind: big(40), retrieval_strategy: big(40) },
    })));
    expect(shadow.length).toBeGreaterThan(4_000); // control: the oversized inputs really were sent through
    expect(Math.max(shadow.length, decision.length)).toBeLessThanOrEqual(JEV_INPUT_BOUND);
  });
  it("refuses to start when query rewrite is on: an unbooked metered lane before the stop", () => {
    expect(() => pricesFromEnv({ NOTEBOOK_QUERY_REWRITE: "1" })).toThrow(/NOTEBOOK_QUERY_REWRITE/);
    expect(() => pricesFromEnv({ NOTEBOOK_QUERY_REWRITE: "0" })).not.toThrow(); // control
  });
  it("no corpus question would trigger the unflagged translate-for-search call", () => {
    const flagged = corpus.questions.filter((q) => looksNonEnglish(q.question)).map((q) => q.id);
    expect(flagged).toEqual([]);
    expect(looksNonEnglish("¿Cuál es el par de apriete de los terminales?")).toBe(true); // control: the detector fires
  });
});

describe("runtime identity (#5045): fingerprint when the Hub serves one, drift checked before every dispatch", () => {
  const fp = (summary: Record<string, unknown>, hash = "a".repeat(16)) => ({ hash, summary: {
    canonicalSeam: true, maxOutputTokens: 4000,
    providers: [{ name: "OpenAI", model: "gpt-5.4-mini", pricePerMtok: { input: 0.75, output: 4.5 } }, { name: "OpenRouter", model: "meta-llama/llama-3.3-70b-instruct", pricePerMtok: { input: 0.2, output: 0.52 } }],
    optionalMetered: { jevShadow: true, jevDecision: true, queryRewrite: { enabled: false } },
    ...summary,
  } });
  const prices = pricesFromEnv({});
  it("absent (staging before #5047 deploys): reported unavailable, never assumed", () => {
    expect(checkFingerprint(undefined, prices)).toEqual({ available: false });
  });
  it("accepts a fingerprint whose every lane is booked at or above its declared price", () => {
    expect(checkFingerprint(fp({}), prices)).toEqual({ available: true, hash: "a".repeat(16) });
  });
  it("rejects an unknown price, an unbooked provider, a price above the booking, or an unpinned OpenRouter model", () => {
    const bad = [
      { providers: [{ name: "OpenAI", model: "gpt-5.4-mini", pricePerMtok: null }] },
      { providers: [{ name: "Mistral", model: "x", pricePerMtok: { input: 0.1, output: 0.1 } }] },
      { providers: [{ name: "OpenAI", model: "gpt-5.4-mini", pricePerMtok: { input: 9, output: 4.5 } }] },
      { providers: [{ name: "OpenRouter", model: "other/model", pricePerMtok: { input: 0.2, output: 0.5 } }] },
    ];
    for (const b of bad) expect(() => checkFingerprint(fp(b), prices), JSON.stringify(b)).toThrow(/refusing to spend/);
  });
  it("rejects an enabled query-rewrite lane and a malformed fingerprint", () => {
    expect(() => checkFingerprint(fp({ optionalMetered: { jevShadow: true, jevDecision: true, queryRewrite: { enabled: true, maxOutputTokens: 200, providers: [] } } }), prices)).toThrow(/query rewrite/);
    expect(() => checkFingerprint({ hash: "x" }, prices)).toThrow(/refusing to spend/);
  });
  it("checks a safety-judge lane when the Hub reports one (#5050)", () => {
    const judge = (providers: unknown[]) => fp({ optionalMetered: { jevShadow: true, jevDecision: true, queryRewrite: { enabled: false }, safetyJudge: { enabled: true, maxOutputTokens: 200, providers } } });
    expect(checkFingerprint(judge([{ name: "OpenAI", model: "gpt-5.4-mini", pricePerMtok: { input: 0.75, output: 4.5 } }]), prices)).toMatchObject({ available: true });
    expect(() => checkFingerprint(judge([{ name: "OpenAI", model: "gpt-5.4-mini", pricePerMtok: null }]), prices)).toThrow(/refusing to spend/);
  });
  it("drift: any change of commit, build time, deployment generation or fingerprint between dispatches", () => {
    const base = { gitSha: "1".repeat(40), builtAt: "t0", deploymentGeneration: "g1", fingerprintHash: "h1" };
    expect(runtimeDrift(base, { ...base })).toBeNull();
    for (const k of ["gitSha", "builtAt", "deploymentGeneration", "fingerprintHash"] as const) {
      expect(runtimeDrift(base, { ...base, [k]: "changed" }), k).toMatch(new RegExp(k));
    }
    expect(runtimeDrift(base, null)).toMatch(/unreadable/);
  });
});

describe("scoring: unrun is NOT ASSESSED, the stop is its own class, red lines are observed rows only", () => {
  const q4 = corpus.questions.find((x) => x.id === "micro820-um-q4")!;
  const m820 = corpus.manuals.find((x) => x.id === q4.manual)!;
  const stopObs: Observation = {
    id: q4.id, broken: null, sse: STOP_SSE, streamStatus: "answered", errorPart: null, viewerOpened: true, elapsedMs: 1,
    rendered: { answer: "SAFETY STOP — energized work.", citations: [{ n: "1", title: "Lockout / disconnect-power procedure", page: "27" }], safety: { present: true, kind: "stop", first: true }, evidence: "Grounded" },
    cards: [{ title: "Lockout / disconnect-power procedure", page: "27" }], firstChip: { n: "1", title: "Lockout / disconnect-power procedure", page: "27" },
  };
  it("the recorded stop is SAFETY_STOP, never WRONG_PAGE or CORRECT", () => {
    const r = classify(q4, m820, stopObs);
    expect(r.classification).toBe("SAFETY_STOP");
    expect(r.reason).toMatch(/p\.27/);
  });
  it("a question never asked is NOT_ASSESSED with no red line; it is not BROKEN", () => {
    const rows = scoreAll(corpus, []);
    expect(rows.every((r) => r.classification === "NOT_ASSESSED" && r.safetyRedLine === null)).toBe(true);
    const card = scorecard(rows);
    expect([card.counts.NOT_ASSESSED, card.counts.BROKEN, card.safetyRedLines.length, card.complete]).toEqual([50, 0, 0, false]);
    expect(card.headline).toMatch(/0\/0 CORRECT .*50 NOT ASSESSED/);
  });
  it("a budget stop or an unavailable manual is NOT_ASSESSED with its reason kept", () => {
    const pf = corpus.questions.find((x) => x.id === "pf40-q2")!;
    const row = scoreAll(corpus, [{ id: pf.id, broken: null, notAsked: "budget stop: x had unreadable usage", rendered: null, cards: [], firstChip: null, streamStatus: null, errorPart: null, viewerOpened: null, sse: null, elapsedMs: 0 }]).find((r) => r.id === pf.id)!;
    expect([row.classification, row.reason, row.safetyRedLine]).toEqual(["NOT_ASSESSED", "budget stop: x had unreadable usage", null]);
  });
  it("an asked safety question with no rendered turn is BROKEN and UNOBSERVED, listed apart from red lines", () => {
    const pf = corpus.questions.find((x) => x.id === "pf40-q2")!;
    const rows = scoreAll(corpus, [{ id: pf.id, broken: "chat POST 500", rendered: null, cards: [], firstChip: null, streamStatus: null, errorPart: null, viewerOpened: null, sse: null, elapsedMs: 0 }]);
    const card = scorecard(rows);
    expect(card.safetyRedLines).toEqual([]);
    expect(card.safetyUnobserved).toEqual(["pf40-q2"]);
  });
  it("headline counts CORRECT over ASKED questions and says how many were not assessed", () => {
    const pf = corpus.questions.find((x) => x.id === "pf40-q2")!;
    const ok: Observation = { id: pf.id, broken: null, rendered: { answer: "Wait [1].", citations: [{ n: "1", title: "pf40.pdf", page: "9" }], safety: { present: true, kind: "warning", first: true }, evidence: "x" }, cards: [{ title: "pf40.pdf", page: "9" }], firstChip: { n: "1", title: "pf40.pdf", page: "9" }, streamStatus: "answered", errorPart: null, viewerOpened: true, sse: "", elapsedMs: 1 };
    const card = scorecard(scoreAll(corpus, [ok]));
    expect(card.headline).toBe("1/1 CORRECT (right page cited) · 49 NOT ASSESSED");
    expect(card.complete).toBe(false);
  });
});
