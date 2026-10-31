import { describe, expect, it } from "vitest";
import corpusJson from "./corpus.json";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertOpenRouterCeiling, BUDGET, BudgetMeter, budgetUsdFromEnv, FROZEN_MANUAL_HINT, JEV_CALLS_PER_TURN, JEV_CEILING_PER_MTOK_IN, JEV_INPUT_BOUND, OPENROUTER_CEILING, OPENROUTER_PINNED_MODEL, openRouterCatalogMax, PROVIDER_PRICES, pricesFromEnv, releaseOwnPilotHold, TURN_BOUND, tenantIdForEmail, turnUsage, worstCaseTurnUsd } from "./staging";
import { classify, flakes, markdownScorecard, METRIC, predict, scoreAll, scorecard, type Corpus, type Observation } from "./score";

const corpus = corpusJson as Corpus;
const q = corpus.questions.find((x) => x.id === "pf40-q2")!; // p.9, safety-relevant
const m = corpus.manuals.find((x) => x.id === "pf40")!;

const turn = (over: Partial<NonNullable<Observation["rendered"]>> = {}): Observation["rendered"] => ({
  answer: "Wait three minutes [1].",
  citations: [{ n: "1", title: "pf40.pdf", page: "9" }],
  safety: { present: true, kind: "warning", first: true },
  evidence: "Grounded in this notebook's sources.",
  ...over,
});
const chip = (page: string | null, title = "pf40.pdf", n = "1") => ({ n, title, page });
const obs = (over: Partial<Observation> = {}): Observation => ({
  id: q.id, broken: null, rendered: turn(), cards: [{ title: "pf40.pdf", page: "9" }], firstChip: chip("9"),
  streamStatus: "answered", errorPart: null, viewerOpened: true, sse: "", elapsedMs: 1, ...over,
});

describe("corpus", () => {
  it("is 10 manuals x 5 questions with a sha256 per PDF", () => {
    expect(corpus.manuals).toHaveLength(10);
    expect(corpus.questions).toHaveLength(50);
    for (const mm of corpus.manuals) {
      expect(mm.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(corpus.questions.filter((x) => x.manual === mm.id)).toHaveLength(5);
    }
    expect(new Set(corpus.questions.map((x) => x.id)).size).toBe(50);
  });
});

describe("classify", () => {
  it("CORRECT within ±1 of the expected page", () => {
    expect(classify(q, m, obs()).classification).toBe("CORRECT");
    expect(classify(q, m, obs({ firstChip: chip("10") })).classification).toBe("CORRECT");
  });
  it("WRONG_PAGE beyond the tolerance, without a page, or on another document", () => {
    expect(classify(q, m, obs({ firstChip: chip("11") })).classification).toBe("WRONG_PAGE");
    expect(classify(q, m, obs({ firstChip: chip(null) })).classification).toBe("WRONG_PAGE");
    const other = classify(q, m, obs({ firstChip: chip("9", "pf4m.pdf") }));
    expect(other.classification).toBe("WRONG_PAGE");
    expect(other.reason).toMatch(/^wrong_doc/);
  });
  it("scores the first chip in READING order, not the id-sorted record", () => {
    // Answer reads "... [6] ... [5]": the technician opens [6] (p.9); id order would pick [5] (p.40).
    const rendered = turn({ citations: [{ n: "5", title: "pf40.pdf", page: "40" }, { n: "6", title: "pf40.pdf", page: "9" }] });
    expect(classify(q, m, obs({ rendered, firstChip: chip("9", "pf40.pdf", "6") })).classification).toBe("CORRECT");
    expect(classify(q, m, obs({ rendered, firstChip: chip("40", "pf40.pdf", "5") })).classification).toBe("WRONG_PAGE");
  });
  it("UNCITED: answered with a basis but no citation (no inline chip, no source card)", () => {
    expect(classify(q, m, obs({ rendered: turn({ citations: [] }), firstChip: null, cards: [] })).classification).toBe("UNCITED");
  });
  it("a source card counts when no inline chip rendered; an inline chip wins over a card", () => {
    const viaCard = classify(q, m, obs({ firstChip: null }));
    expect([viaCard.classification, viaCard.citedVia]).toEqual(["CORRECT", "card"]);
    const both = classify(q, m, obs({ firstChip: chip("40") }));
    expect([both.classification, both.citedVia]).toEqual(["WRONG_PAGE", "inline"]);
  });
  it("ABSTAINED: the server said insufficient_evidence, or nothing claims a basis", () => {
    expect(classify(q, m, obs({ streamStatus: "insufficient_evidence" })).classification).toBe("ABSTAINED");
    expect(classify(q, m, obs({ rendered: turn({ citations: [], evidence: null }), firstChip: null, cards: [] })).classification).toBe("ABSTAINED");
  });
  it("BROKEN outranks everything", () => {
    expect(classify(q, m, obs({ broken: "chat POST 500" })).classification).toBe("BROKEN");
    expect(classify(q, m, obs({ errorPart: "provider_failure" })).classification).toBe("BROKEN");
    expect(classify(q, m, obs({ streamStatus: "error" })).classification).toBe("BROKEN");
    expect(classify(q, m, obs({ rendered: turn({ answer: null }) })).classification).toBe("BROKEN");
    expect(classify(q, m, obs({ rendered: null })).classification).toBe("BROKEN");
  });
  it("a first citation whose source viewer does not open is BROKEN, not CORRECT", () => {
    const failed = classify(q, m, obs({ viewerOpened: false }));
    expect(failed.classification).toBe("BROKEN");
    expect(failed.reason).toMatch(/did not open/);
    expect(classify(q, m, obs({ viewerOpened: true })).classification).toBe("CORRECT"); // control
  });
  it("the viewer must open the cited manual at the cited page", () => {
    const at = (page: string | null, fileId = "f-manual") => ({ fileId, page, manualFileId: "f-manual" });
    expect(classify(q, m, obs({ viewer: at("9") })).classification).toBe("CORRECT"); // control
    const wrongPage = classify(q, m, obs({ viewer: at("1") }));
    expect([wrongPage.classification, wrongPage.reason]).toEqual(["BROKEN", "viewer opened p.1, citation says p.9"]);
    expect(classify(q, m, obs({ viewer: at(null) })).classification).toBe("BROKEN"); // opened without a page
    expect(classify(q, m, obs({ viewer: at("9", "f-other") })).classification).toBe("BROKEN"); // another file
  });
  it("viewer identity fails closed: opened but uncaptured, or either file id unknown, is BROKEN", () => {
    const at = (fileId: string | null, manualFileId: string | null) => ({ fileId, page: "9", manualFileId });
    expect(classify(q, m, obs({ viewer: at("f", "f") })).classification).toBe("CORRECT"); // control
    expect(classify(q, m, obs({ viewer: null })).classification).toBe("BROKEN");
    expect(classify(q, m, obs({ viewer: at(null, "f") })).classification).toBe("BROKEN");
    expect(classify(q, m, obs({ viewer: at("f", null) })).classification).toBe("BROKEN");
  });
  it("an ASKED but BROKEN safety-relevant question is UNOBSERVED; an unasked one has no safety verdict; a plain one neither", () => {
    const broken = classify(q, m, obs({ broken: "chat POST 500", rendered: null }));
    expect([broken.classification, broken.safetyRedLine]).toEqual(["BROKEN", "UNOBSERVED"]);
    const card = scorecard(scoreAll(corpus, []));
    expect([card.safetyRedLines.length, card.safetyUnobserved.length]).toEqual([0, 0]); // nothing asked → nothing observed, no invented failures
    const plain = corpus.questions.find((x) => x.id === "pf40-q1")!;
    expect(classify(plain, m, { ...obs(), id: plain.id, broken: "x", rendered: null }).safetyRedLine).toBeNull();
  });
  it("safety red line on a safety-relevant question: missing, or not first", () => {
    expect(classify(q, m, obs()).safetyRedLine).toBeNull();
    expect(classify(q, m, obs({ rendered: turn({ safety: { present: false, kind: null, first: null } }) })).safetyRedLine).toBe("NO_NOTICE");
    expect(classify(q, m, obs({ rendered: turn({ safety: { present: true, kind: "warning", first: false } }) })).safetyRedLine).toBe("NOT_FIRST");
    const plain = corpus.questions.find((x) => x.id === "pf40-q1")!;
    expect(classify(plain, m, { ...obs(), id: plain.id, rendered: turn({ safety: { present: false, kind: null, first: null } }) }).safetyRedLine).toBeNull();
  });
});

describe("scorecard, flakes, predictions", () => {
  it("an unasked question is NOT_ASSESSED, never dropped and never a failure; headline is CORRECT / asked", () => {
    const rows = scoreAll(corpus, [obs()]);
    const card = scorecard(rows);
    expect(card.total).toBe(50);
    expect(card.counts.CORRECT).toBe(1);
    expect([card.counts.BROKEN, card.counts.NOT_ASSESSED]).toEqual([0, 49]);
    expect(card.headline).toBe("1/1 CORRECT (right page cited) · 49 NOT ASSESSED");
    expect([card.assessed, card.complete]).toEqual([true, false]);
  });
  it("a run whose staging changed mid-walk is NOT ASSESSED — no CORRECT headline is published", () => {
    const rows = scoreAll(corpus, [obs()]);
    const card = scorecard(rows, true);
    expect(card.assessed).toBe(false);
    expect(card.headline).toBe("NOT ASSESSED — staging changed during the run");
    expect(card.headline).not.toMatch(/CORRECT/);
    expect(scorecard(rows, false).assessed).toBe(true); // control
  });
  it("every scorecard states what CORRECT measures (citation targeting, not answer wording)", () => {
    const rows = scoreAll(corpus, [obs()]);
    const md = markdownScorecard(rows, scorecard(rows), { gitSha: "0".repeat(40), builtAt: "t", runId: "r" });
    expect(md).toContain(METRIC);
    expect(METRIC).toMatch(/not graded/);
  });
  it("flakes lists rows by name whose class differs", () => {
    const a = scoreAll(corpus, [obs()]);
    const b = scoreAll(corpus, [obs({ rendered: turn({ citations: [] }), firstChip: null, cards: [] })]);
    expect(flakes(a, b)).toEqual([{ id: "pf40-q2", a: "CORRECT", b: "UNCITED" }]);
    expect(flakes(a, a)).toEqual([]);
  });
  it("predicts each seeded defect per row", () => {
    const row = scoreAll(corpus, [obs()]).find((r) => r.id === q.id)!;
    expect(predict(row, "strip-sources")).toBe("UNCITED");
    expect(predict(row, "page-offset")).toBe("WRONG_PAGE");
    expect(predict(row, "viewer-page")).toBe("BROKEN");
    const low = scoreAll(corpus, [obs({ firstChip: chip("4") })]).find((r) => r.id === q.id)!;
    expect(low.classification).toBe("WRONG_PAGE");
    expect(predict(low, "page-offset")).toBe("CORRECT"); // 4 + 5 = 9: the offset can also FIX a row, and must be predicted
  });
});

describe("budget (worst case booked at dispatch, never released; fail closed)", () => {
  const frame = (f: Record<string, unknown>) => `data: ${JSON.stringify({ kind: "usage", ...f })}\n\ndata: [DONE]\n`;
  const usage = (inputTokens: number, outputTokens: number) => frame({ inputTokens, cachedInputTokens: 0, outputTokens });
  it("the booked worst case covers the answer AND the judge attempted on every provider (plus Jev, accounting.test.ts)", () => {
    const one = (p: { input: number; output: number }, out: number) => (TURN_BOUND.inputTokens * p.input + out * p.output) / 1e6;
    let expected = (JEV_CALLS_PER_TURN * JEV_INPUT_BOUND * JEV_CEILING_PER_MTOK_IN) / 1e6;
    for (const p of Object.values(PROVIDER_PRICES)) expected += one(p, TURN_BOUND.answerOutputTokens) + one(p, TURN_BOUND.judgeOutputTokens);
    expect(worstCaseTurnUsd()).toBeCloseTo(expected, 12);
    expect(BUDGET.usdBookedPerTurn).toBe(worstCaseTurnUsd());
    // A turn with a fully billed hidden OpenAI attempt + a fallback answer + the judge is inside it.
    const hidden = one(PROVIDER_PRICES.OpenAI, TURN_BOUND.answerOutputTokens) + one(PROVIDER_PRICES.OpenRouter, TURN_BOUND.answerOutputTokens) + one(PROVIDER_PRICES.OpenAI, TURN_BOUND.judgeOutputTokens);
    expect(hidden).toBeLessThan(BUDGET.usdBookedPerTurn);
  });
  it("refuses the first dispatch whose worst case would cross the budget; booked never passes it", () => {
    const meter = new BudgetMeter(3);
    let sent = 0;
    while (meter.canAfford()) { meter.book(); meter.verify(`t${sent}`, usage(3000, 250)); sent++; }
    expect(sent).toBe(Math.floor(3 / BUDGET.usdBookedPerTurn));
    expect(meter.booked).toBeLessThanOrEqual(3 + 1e-9);
    expect(meter.booked + meter.perTurn).toBeGreaterThan(3); // the next one would cross
  });
  it("control: the declared budget fits all 50 questions", () => {
    const meter = new BudgetMeter();
    let sent = 0;
    for (let i = 0; i < 50 && meter.canAfford(); i++) { meter.book(); meter.verify(`q${i}`, usage(3200, 120)); sent++; }
    expect(sent).toBe(50);
    expect(meter.booked).toBeLessThanOrEqual(BUDGET.usdPerRun);
  });
  it("books the deployed OpenAI price (production's env), and refuses once it would cross $4.50", () => {
    const pricey = pricesFromEnv({ OPENAI_PRICE_PER_MTOK_IN: "10", OPENAI_PRICE_PER_MTOK_OUT: "50" });
    expect(pricey.OpenAI).toEqual({ input: 10, output: 50 });
    const meter = new BudgetMeter(4.5, worstCaseTurnUsd(pricey));
    expect(meter.perTurn).toBeGreaterThan(BUDGET.usdBookedPerTurn);
    let sent = 0;
    while (meter.canAfford()) { meter.book(); sent++; }
    expect(sent).toBeLessThan(50);
    expect(meter.booked).toBeLessThanOrEqual(4.5);
    expect(pricesFromEnv({}).OpenAI).toEqual(PROVIDER_PRICES.OpenAI); // control: defaults
  });
  it("refuses to price (throws before any paid request) an overridden model or an invalid price", () => {
    expect(() => pricesFromEnv({ OPENAI_MODEL: "gpt-5.5" })).toThrow(/unpriced model/);
    expect(() => pricesFromEnv({ OPENROUTER_MODEL: "x" })).toThrow(/unpriced model/);
    expect(() => pricesFromEnv({ OPENAI_PRICE_PER_MTOK_IN: "abc" })).toThrow(/not a valid price/);
    expect(() => pricesFromEnv({ OPENAI_PRICE_PER_MTOK_OUT: "-1" })).toThrow(/not a valid price/);
  });
  it("refuses every answer and safety-judge model override the deployed cascades honour", () => {
    for (const k of ["TOGETHERAI_MODEL", "OPENAI_CLASSIFIER_MODEL", "GROQ_CLASSIFIER_MODEL", "CEREBRAS_CLASSIFIER_MODEL", "TOGETHERAI_CLASSIFIER_MODEL"]) {
      expect(() => pricesFromEnv({ [k]: "x" })).toThrow(/unpriced model/);
    }
  });
  it("prices a zero OpenAI rate the way production does: the nonzero default", () => {
    expect(pricesFromEnv({ OPENAI_PRICE_PER_MTOK_IN: "0", OPENAI_PRICE_PER_MTOK_OUT: "0" }).OpenAI).toEqual(PROVIDER_PRICES.OpenAI);
    expect(pricesFromEnv({ OPENAI_PRICE_PER_MTOK_IN: "2" }).OpenAI.input).toBe(2); // control: a positive rate is kept
  });
  it("caps the run budget at $4.50: an inherited larger or invalid value refuses to start", () => {
    expect(budgetUsdFromEnv({})).toBe(4.5);
    expect(budgetUsdFromEnv({ STRANGER_WALK_BUDGET_USD: "1.25" })).toBe(1.25); // control: lower is allowed
    for (const v of ["100", "Infinity", "4.51", "-1", "abc"]) {
      expect(() => budgetUsdFromEnv({ STRANGER_WALK_BUDGET_USD: v })).toThrow(/budget/);
    }
  });
  it("usage is unreadable for: no response, no frame, null / negative / non-finite / string counts", () => {
    expect(turnUsage(usage(3000, 250))).toMatchObject({ readable: true, inBound: true });
    for (const sse of [
      null,
      "data: [DONE]\n",
      frame({ inputTokens: null, cachedInputTokens: null, outputTokens: null }),
      frame({ inputTokens: 3000, cachedInputTokens: 0, outputTokens: -5 }),
      frame({ inputTokens: "3000", cachedInputTokens: 0, outputTokens: 250 }),
      'data: {"kind":"usage","inputTokens":1e999,"cachedInputTokens":0,"outputTokens":1}\n',
    ]) expect(turnUsage(sse).readable, String(sse)).toBe(false);
  });
  it("a turn with unreadable or out-of-bound usage stops every later paid turn", () => {
    for (const bad of [null, usage(TURN_BOUND.inputTokens + 1, 100), usage(3000, TURN_BOUND.answerOutputTokens + 1)]) {
      const meter = new BudgetMeter();
      meter.book(); meter.verify("ok", usage(3000, 250));
      expect(meter.canAfford()).toBe(true);
      meter.book(); meter.verify("bad", bad);
      expect([meter.canAfford(), meter.unbounded]).toEqual([false, "bad"]);
    }
  });
});

describe("teardown fallback lookup", () => {
  it("throws, never returns 'no tenant', when the database is not configured", async () => {
    const prior = process.env.NEON_DATABASE_URL;
    delete process.env.NEON_DATABASE_URL;
    try {
      await expect(tenantIdForEmail("strangerwalk-x@factorylm.com")).rejects.toThrow(/NEON_DATABASE_URL unset/);
    } finally {
      if (prior !== undefined) process.env.NEON_DATABASE_URL = prior;
    }
  });
  it("refuses anything but a run-unique walk email", async () => {
    await expect(tenantIdForEmail("mike@factorylm.com")).rejects.toThrow(/non-walk email/);
  });
});

describe("OpenRouter is booked at a declared ceiling, not the cascade's estimate (#4461 Codex F3)", () => {
  const catalog = (hosts: Array<[number, number]>) => JSON.stringify({
    data: { id: OPENROUTER_PINNED_MODEL, endpoints: hosts.map(([i, o], n) => ({ provider_name: `host${n}`, pricing: { prompt: String(i / 1e6), completion: String(o / 1e6) } })) },
  });
  const ok = catalog([[0.1, 0.32], [0.72, 0.72], [0.293, 2.253]]); // the 2026-10-31 live spread
  const fetchOf = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  it("the booked OpenRouter rate is the ceiling, above the cascade's 0.20/0.52 estimate and every 2026-10-31 host", () => {
    expect(PROVIDER_PRICES.OpenRouter).toEqual(OPENROUTER_CEILING);
    expect(OPENROUTER_CEILING.input).toBeGreaterThan(0.2);
    expect(OPENROUTER_CEILING.output).toBeGreaterThan(0.52);
    const live = openRouterCatalogMax(JSON.parse(ok));
    expect(live).toEqual({ input: 0.72, output: 2.253, hosts: 3 });
    expect(live.input).toBeLessThanOrEqual(OPENROUTER_CEILING.input);
    expect(live.output).toBeLessThanOrEqual(OPENROUTER_CEILING.output);
  });
  it("preflight refuses to spend when any catalog host is priced above the ceiling (and control: passes at or below it)", async () => {
    await expect(assertOpenRouterCeiling(fetchOf(200, ok))).resolves.toMatchObject({ hosts: 3 });
    const pricierIn = catalog([[0.1, 0.32], [OPENROUTER_CEILING.input + 0.01, 0.5]]);
    const pricierOut = catalog([[0.1, 0.32], [0.2, OPENROUTER_CEILING.output + 0.01]]);
    await expect(assertOpenRouterCeiling(fetchOf(200, pricierIn))).rejects.toThrow(/above the booked ceiling.*refusing to spend/);
    await expect(assertOpenRouterCeiling(fetchOf(200, pricierOut))).rejects.toThrow(/above the booked ceiling.*refusing to spend/);
  });
  it("preflight refuses to spend when the catalog is unreadable: non-200, empty, malformed, non-numeric, or the wrong model", async () => {
    await expect(assertOpenRouterCeiling(fetchOf(503, ok))).rejects.toThrow(/refusing to spend/);
    await expect(assertOpenRouterCeiling(fetchOf(200, catalog([])))).rejects.toThrow(/refusing to spend/);
    await expect(assertOpenRouterCeiling(fetchOf(200, "{not json"))).rejects.toThrow(/refusing to spend/);
    await expect(assertOpenRouterCeiling(fetchOf(200, JSON.stringify({ data: { id: OPENROUTER_PINNED_MODEL, endpoints: [{ pricing: { prompt: "abc", completion: "1" } }] } })))).rejects.toThrow(/refusing to spend/);
    await expect(assertOpenRouterCeiling(fetchOf(200, ok.replace(OPENROUTER_PINNED_MODEL, "other/model")))).rejects.toThrow(/refusing to spend/);
    await expect(assertOpenRouterCeiling((async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch)).rejects.toThrow(/refusing to spend/);
  });
  it("a turn served by OpenRouter on an unpinned model, or by an unpriced provider, stops every later paid turn", () => {
    const served = (provider: string | null, model: string | null) => `data: ${JSON.stringify({ kind: "usage", provider, model, inputTokens: 3000, cachedInputTokens: 0, outputTokens: 250 })}\n\ndata: [DONE]\n`;
    expect(turnUsage(served("OpenRouter", OPENROUTER_PINNED_MODEL)).inBound).toBe(true); // control
    expect(turnUsage(served("OpenAI", "gpt-5.4-mini")).inBound).toBe(true); // control
    expect(turnUsage(served(null, null)).inBound).toBe(true); // control: no provider served (error/empty turn)
    for (const sse of [served("OpenRouter", "anthropic/claude-sonnet-4"), served("OpenRouter", null), served("Anthropic", "claude")]) {
      expect(turnUsage(sse).inBound, sse).toBe(false);
      const meter = new BudgetMeter();
      meter.book(); meter.verify("bad", sse);
      expect([meter.canAfford(), meter.unbounded]).toEqual([false, "bad"]);
    }
  });
  it("control: 50 questions still fit the $4.50 budget with the ceiling booked", () => {
    expect(worstCaseTurnUsd() * 50).toBeLessThanOrEqual(4.5);
  });
});

describe("honest residual risk (#4461 Codex F1/F2, accepted by Mike 2026-10-18)", () => {
  const read = (p: string) => readFileSync(path.join(__dirname, p), "utf8");
  const docs = {
    readme: read("README.md"),
    workflow: read("../../../.github/workflows/stranger-walk.yml"),
    staging: read("staging.ts"),
    walk: read("walk.spec.ts"),
  };
  it("no file claims spend can never pass the cap or that every mid-walk deploy is caught", () => {
    for (const [name, text] of Object.entries(docs)) {
      expect(text, name).not.toMatch(/can never pass|never passes the cap|hard stop;/);
      expect(text, name).not.toMatch(/(?:is caught by|caught instead by) the start\/end identity check/);
    }
  });
  it("the README names both accepted gaps and the fix issue", () => {
    const limits = docs.readme.slice(docs.readme.indexOf("## Known limits"));
    expect(docs.readme).toContain("## Known limits");
    expect(limits).toMatch(/without a redeploy/);
    expect(limits).toMatch(/A→B→A/);
    expect(limits).toMatch(/#4507/);
  });
});

describe("pilot approval gate: the walk releases only its own throwaway tenant (#4927, as #4928)", () => {
  const T = "4c36ea9a-1464-4d3f-8af6-e6d8541b15bb";
  const E = "strangerwalk-charlie-20261031t1358z@factorylm.com";
  const fakeDb = (fail?: { onTenants?: string }) => {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (fail?.onTenants && /hub_tenants/.test(sql)) throw Object.assign(new Error("boom"), { code: fail.onTenants });
        return { rowCount: 1 };
      },
    };
  };
  it("puts the owner on a trial and the tenant back to pilot_status NULL, never 'active'", async () => {
    const db = fakeDb();
    await releaseOwnPilotHold(T, E, db);
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].sql).toMatch(/UPDATE hub_users SET status = 'trial'/);
    expect(db.calls[0].sql).toMatch(/tenant_id = \$1 AND email = \$2 AND status = 'pending'/);
    expect(db.calls[0].params).toEqual([T, E]);
    expect(db.calls[1].sql).toMatch(/UPDATE hub_tenants SET pilot_status = NULL WHERE id = \$1 AND pilot_status = 'pending'/);
    expect(db.calls[1].sql).toMatch(/EXISTS \(SELECT 1 FROM hub_users WHERE tenant_id = \$1 AND email = \$2\)/);
    expect(db.calls.map((c) => c.sql).join("\n")).not.toMatch(/'active'/);
  });
  it("refuses anything but a walk email or a uuid tenant, before touching the database", async () => {
    const db = fakeDb();
    await expect(releaseOwnPilotHold(T, "mike@factorylm.com", db)).rejects.toThrow(/non-walk email/);
    await expect(releaseOwnPilotHold("mike", E, db)).rejects.toThrow(/not a tenant uuid/);
    expect(db.calls).toHaveLength(0);
  });
  it("tolerates a schema without pilot_status (42703) and rethrows anything else", async () => {
    await expect(releaseOwnPilotHold(T, E, fakeDb({ onTenants: "42703" }))).resolves.toBeUndefined();
    await expect(releaseOwnPilotHold(T, E, fakeDb({ onTenants: "08006" }))).rejects.toThrow(/boom/);
  });
  it("fails closed when no database is configured", async () => {
    const prior = process.env.NEON_DATABASE_URL;
    delete process.env.NEON_DATABASE_URL;
    try {
      await expect(releaseOwnPilotHold(T, E)).rejects.toThrow(/NEON_DATABASE_URL unset/);
    } finally {
      if (prior !== undefined) process.env.NEON_DATABASE_URL = prior;
    }
  });
  it("signUp releases the hold after persisting the tenant and before waiting for /v3", () => {
    const spec = readFileSync(path.join(__dirname, "walk.spec.ts"), "utf8");
    const persist = spec.indexOf("persistTenant(created);");
    const release = spec.indexOf("await releaseOwnPilotHold(created, EMAIL);");
    // The session cookie still says 'pending' until a session read re-runs the jwt callback.
    const refresh = spec.indexOf('fetch("/api/auth/session/")');
    const wait = spec.indexOf("await page.waitForURL(/\\/v3\\/?/");
    expect(persist).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(persist);
    expect(refresh).toBeGreaterThan(release);
    expect(wait).toBeGreaterThan(refresh);
  });
});

describe("frozen manuals are reproduced before any account exists (OEM URLs are not durable)", () => {
  const spec = readFileSync(path.join(__dirname, "walk.spec.ts"), "utf8");
  it("every in-scope manual is fetched and sha-verified before signUp; the loop reuses those bytes", () => {
    const fetchAll = spec.indexOf("pdfs.set(m.id, await manualBytes(m, cacheDir))");
    const abort = spec.indexOf("throw new Error(`no frozen manual could be reproduced");
    const signup = spec.indexOf("await signUp(page, base);");
    expect(fetchAll).toBeGreaterThan(-1);
    expect(abort).toBeGreaterThan(fetchAll);
    expect(signup).toBeGreaterThan(abort);
    expect(spec.slice(signup)).not.toContain("await manualBytes(");
  });
  it("the hint names the fix, not just the failure", () => {
    expect(FROZEN_MANUAL_HINT).toMatch(/STRANGER_WALK_CACHE/);
    expect(FROZEN_MANUAL_HINT).toMatch(/<sha256>\.pdf/);
  });
});

describe("workflow", () => {
  const yml = readFileSync(path.join(__dirname, "../../../.github/workflows/stranger-walk.yml"), "utf8");
  it("never joins the shared staging deploy queue (it could cancel a pending deploy); PR runs never walk", () => {
    expect(yml).not.toMatch(/^concurrency:/m);
    expect(yml).not.toMatch(/group: staging-environment/);
    const walk = yml.slice(yml.indexOf("\n  walk:"));
    expect(walk).toMatch(/\n {4}concurrency:\n {6}group: stranger-walk/);
    expect(walk).toMatch(/if: \$\{\{ github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main' \}\}/);
  });
});
