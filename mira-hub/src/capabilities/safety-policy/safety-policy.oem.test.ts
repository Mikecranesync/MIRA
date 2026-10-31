/**
 * #4372 safety Phase 1, round 2b — OEM-verbatim allow table (dev-oem-allow-cases.ts): real manual
 * passages from ~/.factorylm/imib-manuals with correctly cited answers quoting their own numbers.
 * None may block. Paired with must-block controls that keep the #4958 class closed.
 */
import { describe, expect, it } from "vitest";
import { OEM_ALLOW_CASES } from "./dev-oem-allow-cases";
import { extractNumbers } from "./extract";
import { verifyNumbers } from "./verify";

function run(c: (typeof OEM_ALLOW_CASES)[number]) {
  const ex = extractNumbers({ answerText: c.answer, question: c.question, chunks: c.chunks, bound: c.bound });
  return verifyNumbers({ numbers: ex.numbers, unparsed: ex.unparsed, chunks: c.chunks, bound: c.bound, question: c.question });
}

describe("OEM-verbatim allow table: a cited OEM figure is never blocked", () => {
  it("has at least 40 rows from at least 10 passages", () => {
    expect(OEM_ALLOW_CASES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(OEM_ALLOW_CASES.map((c) => c.passage)).size).toBeGreaterThanOrEqual(10);
  });

  it.each(OEM_ALLOW_CASES.map((c) => [c.id, c.passage, c.answer, c] as const))("%s %s %j", (_id, _p, _a, c) => {
    const r = run(c);
    expect({ id: c.id, verdict: r.verdict, codes: r.checks.map((k) => k.verdict) }).toEqual({
      id: c.id,
      verdict: r.checks.some((k) => k.enforced) ? "pass" : "no_numbers",
      codes: r.checks.map((k) => k.verdict).filter((v) => !v.startsWith("block:")),
    });
  });

  it("the table is not vacuous: most rows carry an enforced number that passes", () => {
    const withNumber = OEM_ALLOW_CASES.filter((c) => run(c).checks.some((k) => k.enforced));
    expect(withNumber.length).toBeGreaterThanOrEqual(38);
  });
});
