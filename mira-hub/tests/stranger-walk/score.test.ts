import { describe, expect, it } from "vitest";
import corpusJson from "./corpus.json";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUDGET, BudgetMeter, budgetUsdFromEnv, PROVIDER_PRICES, pricesFromEnv, TURN_BOUND, tenantIdForEmail, turnUsage, worstCaseTurnUsd } from "./staging";
import { classify, dispatchBlock, flakes, fullyIndexed, markdownScorecard, mergeAltCorpus, METRIC, scopeProblem, predict, scoreAll, scorecard, type Corpus, type Observation } from "./score";

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
  it("identifies the document by the file the citation opened, not the chip title (2026-10-18 stop chip)", () => {
    const viewer = { fileId: "f-pf40", page: "9", manualFileId: "f-pf40" };
    const stopChip = chip("9", "Lockout / disconnect-power procedure");
    expect(classify(q, m, obs({ firstChip: stopChip, viewer })).classification).toBe("CORRECT");
    // Control: the same title opening a DIFFERENT file is still another document.
    const wrong = classify(q, m, obs({ firstChip: stopChip, viewer: { ...viewer, fileId: "f-other" } }));
    expect(wrong.classification).not.toBe("CORRECT");
    // Control: without a captured viewer the title is all we have, and it does not match.
    expect(classify(q, m, obs({ firstChip: stopChip })).reason).toMatch(/^wrong_doc/);
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
  it("a BROKEN safety-relevant question is still a red line (UNOBSERVED); a plain one is not", () => {
    const broken = classify(q, m, obs({ broken: "chat POST 500", rendered: null }));
    expect([broken.classification, broken.safetyRedLine]).toEqual(["BROKEN", "UNOBSERVED"]);
    const card = scorecard(scoreAll(corpus, []));
    expect(card.safetyRedLines).toHaveLength(15); // nothing asked → all 15 safety questions red
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
  it("an unasked question is BROKEN, never dropped; headline is CORRECT / total", () => {
    const rows = scoreAll(corpus, [obs()]);
    const card = scorecard(rows);
    expect(card.total).toBe(50);
    expect(card.counts.CORRECT).toBe(1);
    expect(card.counts.BROKEN).toBe(49);
    expect(card.headline).toBe("1/50 CORRECT (right page cited)");
    expect(card.assessed).toBe(true);
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
  it("the booked worst case covers the answer AND the judge attempted on every provider", () => {
    const one = (p: { input: number; output: number }, out: number) => (TURN_BOUND.inputTokens * p.input + out * p.output) / 1e6;
    let expected = 0;
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
  it("a deterministic safety stop (safety + answered status, no usage frame) is a readable $0 turn", () => {
    const stop = [
      'data: {"kind":"sources","citations":[]}',
      'data: {"kind":"safety","trigger":"energized-work"}',
      'data: {"kind":"content","content":"Stop. De-energize first."}',
      'data: {"kind":"status","status":"answered"}',
      "",
    ].join("\n");
    expect(turnUsage(stop)).toEqual({ readable: true, inBound: true, inputTokens: 0, outputTokens: 0 });
    const meter = new BudgetMeter();
    meter.book(); meter.verify("stop", stop);
    expect(meter.canAfford()).toBe(true);
    // Controls: a safety frame alone, or an answered status alone, is still unreadable usage.
    expect(turnUsage('data: {"kind":"safety","trigger":"energized-work"}\n').readable).toBe(false);
    expect(turnUsage('data: {"kind":"status","status":"answered"}\n').readable).toBe(false);
    expect(turnUsage('data: {"kind":"safety","trigger":"x"}\ndata: {"kind":"status","status":"error"}\n').readable).toBe(false);
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

describe("#4583 readiness and #4584 unanswerable rows", () => {
  it("is fully indexed only when askable AND no longer improving search", () => {
    expect(fullyIndexed({ label: "Ready to ask", canChat: true })).toBe(true);
    expect(fullyIndexed({ label: "Ready to ask · improving search…", canChat: true })).toBe(false);
    expect(fullyIndexed({ label: "Reading…", canChat: false })).toBe(false);
    expect(fullyIndexed(null)).toBe(false);
    expect(fullyIndexed({ label: "Ready to ask · improving search…", canChat: true }, "chat")).toBe(true);
  });
  it("scores an unanswerable question's citation as WRONG_PAGE without the viewer checks", () => {
    const u = { ...q, id: "pf40-u1", expectedPage: null, safetyRelevant: false };
    const cited = classify(u, m, obs({ id: u.id, viewerOpened: false }));
    expect([cited.classification, cited.reason]).toEqual(["WRONG_PAGE", "unanswerable question cited p.9"]);
    const refused = classify(u, m, obs({ id: u.id, streamStatus: "insufficient_evidence", firstChip: null, cards: [] }));
    expect(refused.classification).toBe("ABSTAINED");
  });
  it("predicts the viewer-page mutation of an unanswerable row as the classifier scores it (#4593 Codex F3)", () => {
    const u = { ...q, id: "pf40-u1", expectedPage: null, safetyRelevant: false };
    const viewer = (page: string) => ({ viewerOpened: true, viewer: { fileId: "f", page, manualFileId: "f" } });
    const control = classify(u, m, obs({ id: u.id, ...viewer("9") }));
    const mutated = classify(u, m, obs({ id: u.id, ...viewer("20") }));
    expect(control.classification).toBe("WRONG_PAGE");
    expect(predict(control as Parameters<typeof predict>[0], "viewer-page")).toBe(mutated.classification);
  });
});

describe("mergeAltCorpus (#4593 review F2)", () => {
  const base = corpusJson as Corpus;
  const q = { id: "u1", manual: base.manuals[0].id, question: "x?", expectedPage: null, safetyRelevant: false, anchor: "" };
  it("keeps the pinned manuals and takes the alternate questions", () => {
    const c = mergeAltCorpus(base, { questions: [q] });
    expect(c.manuals).toBe(base.manuals);
    expect(c.questions).toEqual([q]);
  });
  it("accepts an identical manuals list in another order", () => {
    expect(() => mergeAltCorpus(base, { manuals: [...base.manuals].reverse(), questions: [q] })).not.toThrow();
  });
  it("refuses a manuals list whose sha256 differs from the pin", () => {
    const tampered = base.manuals.map((m, i) => (i === 0 ? { ...m, sha256: "0".repeat(64) } : m));
    expect(() => mergeAltCorpus(base, { manuals: tampered, questions: [q] })).toThrow(/pinned manuals/);
  });
  it("refuses a question that names an unpinned manual", () => {
    expect(() => mergeAltCorpus(base, { questions: [{ ...q, manual: "not-pinned" }] })).toThrow(/unpinned manual/);
  });
});

describe("scopeProblem (#4593 Codex F1)", () => {
  it("passes a turn whose chat body carries the attached manual", () => {
    expect(scopeProblem({ sourceDocIds: ["d1"] }, true)).toBeNull();
  });
  it("fails a turn sent in general mode after the manual was attached", () => {
    expect(scopeProblem({ sourceDocIds: ["d1"], mode: "general" }, true)).toMatch(/general mode/);
  });
  it("fails a turn sent with an empty scope after the manual was attached", () => {
    expect(scopeProblem({ sourceDocIds: [] }, true)).toMatch(/no sourceDocIds/);
    expect(scopeProblem(null, true)).toMatch(/no sourceDocIds/);
  });
  it("control: the upload-riding turn (manual not yet attached) is not checked", () => {
    expect(scopeProblem({ sourceDocIds: [], mode: "general" }, false)).toBeNull();
  });
});

describe("dispatchBlock (#4593 Codex F4)", () => {
  it("allows a turn when affordable, verified, and nothing went out of scope", () => {
    expect(dispatchBlock({ canAfford: true, unbounded: null }, null)).toBeNull();
  });
  it("halts every later paid turn after an out-of-scope turn", () => {
    expect(dispatchBlock({ canAfford: true, unbounded: null }, "u1: chat sent in general mode")).toMatch(/^halted: u1/);
  });
  it("still stops on unverified usage and on budget exhaustion", () => {
    expect(dispatchBlock({ canAfford: true, unbounded: "u2" }, null)).toMatch(/^budget stop: u2/);
    expect(dispatchBlock({ canAfford: false, unbounded: null }, null)).toBe("budget stop");
  });
});
