/**
 * The journey receipt's pass rule: a run is PASS only when every owed step ran and passed.
 *   npx vitest run --config tests/stranger-walk/vitest.stranger-walk.config.ts journey-receipt
 */
import { describe, expect, it } from "vitest";
import { receiptOf, type Step, type Verdict } from "./journey-receipt";

const RUN = { build: "abc123", target: "tablet", paid: true, runId: "t1" };
const IDS = ["S1", "S2", "S3"] as const;
const step = (id: string, verdict: Verdict, actual = "ok"): Step => ({ id, verdict, expected: `want ${id}`, actual, trace: [], shots: [`${id}.png`], at: "" });

describe("journey receipt", () => {
  it("is PASS when every owed step passed (control)", () => {
    const r = receiptOf(RUN, IDS.map((id) => step(id, "PASS")), IDS);
    expect(r.overall).toBe("PASS");
    expect(r.md).toContain("PASS 3 · FAIL 0 · NOT TESTED 0 · BLOCKED 0 · NOT RUN 0 of 3");
  });

  it("never counts a NOT TESTED step as a pass", () => {
    const r = receiptOf(RUN, [step("S1", "PASS"), step("S2", "NOT TESTED"), step("S3", "PASS")], IDS);
    expect(r.overall).toBe("INCOMPLETE");
    expect(r.md).toContain("| S2 | NOT TESTED |");
  });

  it("never counts a BLOCKED step as a pass", () => {
    expect(receiptOf(RUN, [step("S1", "PASS"), step("S2", "BLOCKED"), step("S3", "PASS")], IDS).overall).toBe("INCOMPLETE");
  });

  it("lists a step the run never reached as NOT RUN, and the run is not a pass", () => {
    const r = receiptOf(RUN, [step("S1", "PASS"), step("S2", "PASS")], IDS);
    expect(r.overall).toBe("INCOMPLETE");
    expect(r.md).toContain("| S3 | NOT RUN |");
  });

  it("is FAIL when any step failed, even if others were not tested", () => {
    expect(receiptOf(RUN, [step("S1", "FAIL"), step("S2", "NOT TESTED")], IDS).overall).toBe("FAIL");
  });

  it("keeps a pipe in the evidence from breaking the table row", () => {
    const r = receiptOf(RUN, [step("S1", "PASS", "a | b")], ["S1"]);
    expect(r.md).toContain("| S1 | PASS | want S1 | a \\| b | S1.png |");
  });

  it("names the build, target and whether money was spent", () => {
    expect(receiptOf({ ...RUN, paid: false }, [], IDS).md).toContain("Build abc123 · target tablet · $0 run (no question sent) · run t1");
  });
});
