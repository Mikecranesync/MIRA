/**
 * #4372 safety Phase 1, round 2 — extractor recall on the dev recall table (dev-recall-cases.ts):
 * implementer-authored paraphrases of how a model writes each enforced quantity, plus controls.
 * Every row is a test; a `knownMiss` row is pinned as still missed (with its reason) so a future
 * fix shows up as a deliberate change. Value parsing is shared by both sides; context, threshold
 * and approach cues widened for recall apply to the ANSWER side only (fail closed), never to the
 * source side, where they would turn unrelated sentences into support.
 */
import { describe, expect, it } from "vitest";
import { DEV_RECALL_CASES, extracted, recallHit, scoreRecall } from "./dev-recall-cases";
import { chunkStatements } from "./statements";
import { extractNumbers } from "./extract";
import { verifyNumbers } from "./verify";
import * as F from "./dev-fixtures";

const live = DEV_RECALL_CASES.filter((c) => !c.knownMiss);
const pinned = DEV_RECALL_CASES.filter((c) => c.knownMiss);

describe("dev recall table", () => {
  it.each(live.map((c) => [c.id, c.kind, c.answer, c] as const))("%s (%s) %j", (_id, _k, _a, c) => {
    const r3 = (xs: Array<[string, number]>) => xs.map(([q, v]) => [q, Math.round(v * 1000) / 1000]);
    const want = [...c.expect].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
    expect({ id: c.id, got: r3(extracted(c)) }).toEqual({ id: c.id, got: r3(want) });
    expect(recallHit(c)).toBe(true);
  });

  it.each(pinned.map((c) => [c.id, c.knownMiss!, c] as const))("known miss %s: %s", (_id, _why, c) => {
    expect(recallHit(c)).toBe(false);
  });

  it("score: every live row hits and no control extracts anything", () => {
    const s = scoreRecall();
    expect(s.controls.misses).toEqual([]);
    expect([...s.parse.misses, ...s.context.misses].sort()).toEqual(pinned.map((c) => c.id).sort());
  });
});

describe("recall widening stays on the answer side", () => {
  const src = (content: string) => F.manualChunk("c1", content, F.GS10, F.GS10_SHA, "2-14");

  it.each([
    ["a wait after power removal with 'you'", "Wait 5 minutes after you remove power.", "discharge_time"],
    ["'away from exposed energized' parts", "Stay 10 ft away from exposed energized conductors.", "approach_boundary"],
    ["a wait once the drive is de-energized", "Wait 5 minutes once the drive is de-energized.", "discharge_time"],
  ] as const)("%s is a claim in an answer but not support in a source", (_n, sentence, q) => {
    expect(extractNumbers({ answerText: sentence, chunks: [], bound: F.GS10 }).numbers.map((n) => n.quantity)).toContain(q);
    expect(chunkStatements(src(sentence)).map((s) => s.quantity)).not.toContain(q);
  });

  it("threshold comparators are value grammar, read on both sides ('50 V or less', 'no more than')", () => {
    for (const s of ["The DC bus should read 50 V or less before you touch it.", "The DC bus must be no more than 50 V before servicing."]) {
      expect(chunkStatements(src(s)).map((x) => [x.quantity, x.value])).toEqual([["residual_voltage", 50]]);
    }
  });

  // A rating ceiling is not a meter threshold: "maximum", "not to exceed" and a postfix "max" are
  // read as thresholds on the answer side only (fail closed), never as source support.
  it.each([
    ["The DC bus can reach a maximum of 800 VDC.", "Measure DC+ to DC- and confirm it reads below 800 V [1]."],
    ["DC bus voltage: 820 VDC max.", "Measure DC+ to DC- and confirm it reads below 820 V [1]."],
    ["DC bus voltage must not exceed 850 VDC.", "Measure DC+ to DC- and confirm it reads below 850 V [1]."],
  ])("a rating ceiling is not threshold support: %j", (sentence, answer) => {
    const chunks = [src(sentence)];
    const ex = extractNumbers({ answerText: answer, chunks, bound: F.GS10 });
    const r = verifyNumbers({ numbers: ex.numbers, unparsed: ex.unparsed, chunks, bound: F.GS10 });
    expect(r.checks.map((c) => c.verdict)).toEqual(["block:not_in_cited_sentence"]);
  });

  it("control: a source '50 V or less' still supports a 50 V meter threshold", () => {
    const chunks = [src("The DC bus should read 50 V or less before you touch it.")];
    const ex = extractNumbers({ answerText: "Confirm the DC bus reads below 50 V [1].", chunks, bound: F.GS10 });
    expect(verifyNumbers({ numbers: ex.numbers, chunks, bound: F.GS10 }).checks.map((c) => c.verdict)).toEqual(["pass"]);
  });

  it("source side reads the value fully: '3 ft 6 in' is 42 in, so an answer of 3 ft does not pass", () => {
    const chunks = [src("The limited approach boundary is 3 ft 6 in.")];
    const run = (answerText: string) => {
      const ex = extractNumbers({ answerText, chunks, bound: F.GS10 });
      return verifyNumbers({ numbers: ex.numbers, unparsed: ex.unparsed, chunks, bound: F.GS10 }).checks.map((c) => c.verdict);
    };
    expect(run("The limited approach boundary is 3 ft [1].")).toEqual(["block:not_in_cited_sentence"]);
    expect(run("The limited approach boundary is 42 inches [1].")).toEqual(["pass"]);
  });

  it("source side reads 'forty two minutes' as 42, not 2", () => {
    const st = chunkStatements(src("Wait forty two minutes for the DC bus capacitors to discharge."));
    expect(st.map((s) => [s.quantity, s.value])).toEqual([["discharge_time", 2520]]);
  });
});
