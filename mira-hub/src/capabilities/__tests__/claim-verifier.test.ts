import { describe, expect, it } from "vitest";
import { extractTypedClaims, questionSubjects, verifyAnswer } from "../claim-verifier";

// Real staging text (PLC-5 1785-rm001 doc 47329062, stored chunks, decoded by #4515). p.238 lost
// its parentheses in extraction: ".ER bit  bit 12 ." — the verifier must still read it.
const P238 =
  "Transmitted Word Count (.DLEN) This is the number of words the module actually transferred after the " +
  "instruction completes execution. The processor uses this number to verify the transfer. This number should " +
  "match the requested word count  unless the transmitted word count is zero . If these numbers do not match, " +
  "the processor sets the .ER bit  bit 12 . The Enhanced PLC-5";
// A different instruction's status table on a neighbouring page: the TQ-06 lookalike.
const P240 = "Status Bits  Error .ER (bit 11) is set when the operation generates an overflow. The instruction stops.";
const Q = "PLC-5 block transfer: which bit is set when DLEN doesn't match RLEN?";

describe("claim-verifier: TQ-06 (bit 11 vs bit 12)", () => {
  it("supports bit 12 cited to p.238, bound to .DLEN", () => {
    const v = verifyAnswer({ question: Q, answer: "The processor sets the **.ER bit, bit 12** when .DLEN does not match .RLEN [1].", evidence: [{ page: 238, text: P238 }] });
    expect(v.verdict).toBe("supported");
    expect(v.claims).toEqual([expect.objectContaining({ key: "bit:12", status: "supported", page: 238 })]);
  });

  it("rejects bit 11 even though p.240 really says bit 11 — no .DLEN/.RLEN near it", () => {
    const v = verifyAnswer({ question: Q, answer: ".ER (bit 11) is set if an error occurs during the block transfer [1].", evidence: [{ page: 240, text: P240 }] });
    expect(v.verdict).toBe("unsupported");
    expect(v.reason).toBe("unbound");
  });

  it("rejects bit 11 cited to p.238 (the page states a different bit)", () => {
    const v = verifyAnswer({ question: Q, answer: ".ER (bit 11) is set when DLEN does not match RLEN [1].", evidence: [{ page: 238, text: P238 }] });
    expect(v.verdict).toBe("unsupported");
    expect(v.reason).toBe("absent");
  });

  it("rejects S:7/15 cited to p.234: the value is on the page but the page never mentions .DLEN/.RLEN", () => {
    // Real Lane A answer (real-36 tq-28) against the real p.234 rack-queue table.
    const P234 = "S:7/14 Block-transfer queue for rack 6 is full S:7/15 Block-transfer queue for rack 7 is full";
    const v = verifyAnswer({ question: Q, answer: "The bit that is set is S:7/15 [1].", evidence: [{ page: 234, text: P234 }] });
    expect(v.verdict).toBe("unsupported");
    expect(v.claims[0]).toEqual(expect.objectContaining({ key: "addr:s:7/15", status: "unbound", page: 234 }));
  });

  it("rejects a fabricated status address (S:3/10) that no cited page states", () => {
    const v = verifyAnswer({ question: Q, answer: "The bit set is S:3/10 [1].", evidence: [{ page: 238, text: P238 }] });
    expect(v.verdict).toBe("unsupported");
    expect(v.claims[0]).toEqual(expect.objectContaining({ kind: "address", status: "absent" }));
  });
});

describe("claim-verifier: never refuses what it cannot judge (#4488 lesson)", () => {
  it("prose answer with no typed claim → no_opinion", () => {
    const v = verifyAnswer({ question: Q, answer: "The processor flags an error when the counts differ [1].", evidence: [{ page: 238, text: P238 }] });
    expect(v.verdict).toBe("no_opinion");
  });

  it("an honest abstention → no_opinion", () => {
    const v = verifyAnswer({ question: Q, answer: "The excerpts do not say which bit is set when DLEN does not match RLEN.", evidence: [] });
    expect(v.verdict).toBe("no_opinion");
  });

  it("a value the QUESTION named is the subject, not a claim", () => {
    expect(extractTypedClaims("P09.03 sets the comm timeout.", "What does P09.03 do?")).toEqual([]);
  });

  it("a typed claim with no citation at all → unsupported (uncited)", () => {
    const v = verifyAnswer({ question: Q, answer: "It is bit 12.", evidence: [] });
    expect(v).toEqual(expect.objectContaining({ verdict: "unsupported", reason: "uncited" }));
  });
});

describe("claim-verifier: subjects and kinds", () => {
  it("strong subjects are the question's mnemonics; product names are weak", () => {
    expect(questionSubjects(Q)).toEqual({ strong: ["dlen", "rlen"], weak: ["plc-5"] });
  });

  it("a weak-only question binds on presence: a quantity on the cited page is supported", () => {
    const v = verifyAnswer({
      question: "What supply voltage does the GS4 need?",
      answer: "It needs 24 V DC [1].",
      evidence: [{ page: 5, text: "Control power: 24 V DC, 0.5 A" }],
    });
    expect(v.verdict).toBe("supported");
  });

  it("a parameter code is matched separator-insensitively", () => {
    const v = verifyAnswer({
      question: "Which parameter sets over-current stall prevention on a GS10?",
      answer: "Use P06-03 [1].",
      evidence: [{ page: 17, text: "d) Set over-current stall prevention function (P06.03)" }],
    });
    expect(v.verdict).toBe("supported");
  });
});
