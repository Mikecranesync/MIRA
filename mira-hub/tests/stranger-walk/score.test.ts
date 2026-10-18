import { describe, expect, it } from "vitest";
import corpusJson from "./corpus.json";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUDGET, BudgetMeter, TURN_BOUND, turnCostUsd } from "./staging";
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

describe("budget meter (declared per-turn reservation, fail closed)", () => {
  const frame = (f: Record<string, unknown>) => `data: ${JSON.stringify({ kind: "usage", ...f })}\n\ndata: [DONE]\n`;
  const usage = (inputTokens: number, outputTokens: number) => frame({ inputTokens, cachedInputTokens: 0, outputTokens });
  it("prices an in-bound turn from a fully numeric usage frame, below the reservation", () => {
    const c = turnCostUsd(usage(3000, 250));
    expect([c.metered, c.inBound]).toEqual([true, true]);
    expect(c.usd).toBeGreaterThan(0);
    expect(c.usd).toBeLessThan(BUDGET.usdReservePerTurn);
    // The declared bound's own cost is exactly the reservation: the reservation covers any in-bound turn.
    expect(turnCostUsd(usage(TURN_BOUND.inputTokens, TURN_BOUND.outputTokens)).usd).toBeCloseTo(BUDGET.usdReservePerTurn, 9);
  });
  it("a turn whose cost cannot be read is unmetered: no response, no frame, null / negative / non-finite counts", () => {
    for (const sse of [
      null,
      "data: [DONE]\n",
      frame({ inputTokens: null, cachedInputTokens: null, outputTokens: null }),
      frame({ inputTokens: 3000, cachedInputTokens: 0, outputTokens: -5 }),
      frame({ inputTokens: "3000", cachedInputTokens: 0, outputTokens: 250 }),
      'data: {"kind":"usage","inputTokens":1e999,"cachedInputTokens":0,"outputTokens":1}\n',
    ]) expect(turnCostUsd(sse).metered, String(sse)).toBe(false);
  });
  it("an unmetered or out-of-bound turn stops every later paid turn", () => {
    const a = new BudgetMeter(3);
    a.charge("a", usage(3000, 250));
    expect(a.canAfford()).toBe(true);
    a.charge("b", frame({ inputTokens: null, cachedInputTokens: null, outputTokens: null }));
    expect([a.canAfford(), a.unbounded]).toEqual([false, "b"]);
    const b = new BudgetMeter(3);
    b.charge("c", usage(TURN_BOUND.inputTokens + 1, 100)); // broke the declared bound
    expect([b.canAfford(), b.unbounded]).toEqual([false, "c"]);
  });
  it("refuses a dispatch BEFORE it could pass the budget: two $0.10 turns, then the reserve must fit", () => {
    const meter = new BudgetMeter(0.2 + BUDGET.usdReservePerTurn - 0.001);
    meter.spent = 0.2; // two earlier turns
    expect(meter.canAfford()).toBe(false); // the next turn's declared worst case would not fit
    expect(new BudgetMeter(0.2 + BUDGET.usdReservePerTurn).canAfford()).toBe(true); // control
  });
  it("no sequence of in-bound turns can leave spent above the budget", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 200; trial++) {
      const meter = new BudgetMeter(3);
      for (let t = 0; t < 200 && meter.canAfford(); t++) {
        meter.charge(`t${t}`, usage(Math.floor(rnd() * TURN_BOUND.inputTokens), Math.floor(rnd() * TURN_BOUND.outputTokens)));
      }
      expect(meter.spent).toBeLessThanOrEqual(3 + 1e-9);
    }
  });
  it("control: 50 ordinary turns fit the $3 budget", () => {
    const meter = new BudgetMeter(3);
    let asked = 0;
    for (let i = 0; i < 50 && meter.canAfford(); i++) { meter.charge(`q${i}`, usage(3200, 120)); asked++; }
    expect(asked).toBe(50);
    expect(meter.spent).toBeLessThanOrEqual(3);
  });
});

describe("workflow", () => {
  const yml = readFileSync(path.join(__dirname, "../../../.github/workflows/stranger-walk.yml"), "utf8");
  it("only the paid walk job joins the shared staging queue; the PR unit job never does", () => {
    expect(yml).not.toMatch(/^concurrency:/m); // no workflow-level group: a PR run would enter it
    const walk = yml.slice(yml.indexOf("\n  walk:"));
    const unit = yml.slice(yml.indexOf("\n  unit:"), yml.indexOf("\n  walk:"));
    expect(walk).toMatch(/\n {4}concurrency:\n {6}group: staging-environment/);
    expect(unit).not.toMatch(/staging-environment/);
    expect(walk).toMatch(/if: \$\{\{ github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main' \}\}/);
  });
});
