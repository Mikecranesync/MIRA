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

// Garage pilot PR-4 (ledger L3/L5): a spec table is stored as ONE chunk per model (table-rows.ts),
// so the wrong column's value is never in the record's chunk — it sits in a sibling's chunk whose
// `table_models` lacks the record's key. A quantity claim binds on a row chunk only through the
// lines whose `MODEL:` prefix is the record's own number. Lines below are table-rows.ts's real
// output on the committed GS10 p.26 / p.27 item dumps (abbreviated to the lines in play).
const HEADER_1PH =
  "230V Class – 1-Phase Model-Specific Specifications / GS10 230V Class Specifications; Frame Size A, B, C — Model Name: GS11N-2xPx — ";
const OWN_ROWS = {
  tableModels: ["GS11N20P2"],
  text:
    `${HEADER_1PH}GS11N-20P2\n` +
    "GS11N-20P2: CT Rated Output Current 1.6 A\n" +
    "GS11N-20P2: CT Rated Input Current 5.1 A\n" +
    "GS11N-20P2: VT Rated Input Current 5.8 A\n" +
    "GS11N-20P2: Rated Voltage/Frequency One-phase 200-240 VAC (-15% to +10%), 50/60 Hz",
};
const SIBLING_ROWS = {
  tableModels: ["GS11N20P5"],
  text:
    `${HEADER_1PH}GS11N-20P5\n` +
    "GS11N-20P5: CT Rated Output Current 2.8 A\n" +
    "GS11N-20P5: CT Rated Input Current 7.3 A\n" +
    "GS11N-20P5: VT Rated Input Current 8.3 A",
};
const LOOKALIKE_ROWS = {
  tableModels: ["GS13N20P2"],
  text:
    "230V Class – 3-Phase Model-Specific Specifications / GS10 230V Class Specifications; Frame Size A, B — Model Name: GS13N-2xPx — GS13N-20P2\n" +
    "GS13N-20P2: CT Rated Input Current 1.9 A\n" +
    "GS13N-20P2: VT Rated Input Current 2.2 A",
};
const UNQUALIFIED_ROWS = {
  tableModels: ["GS11N20P2", "GS11N20P5", "GS11N21P0", "GS11N22P0", "GS11N23P0"],
  text: `${HEADER_1PH}unqualified\nCooling Method Convective Fan`,
};
const QI = "What is its CT rated input current?";
const RECORD = "GS11N-20P2";
const P26 = { page: 26, text: "", rows: [OWN_ROWS, SIBLING_ROWS] };

describe("claim-verifier: row-aware binding for a record with a catalog number (garage pilot PR-4)", () => {
  it("right row: 5.1 A on the record's own line is supported, via the row", () => {
    const v = verifyAnswer({ question: QI, answer: "The CT rated input current is 5.1 A [1].", evidence: [P26], recordCatalogNumber: RECORD });
    expect(v.verdict).toBe("supported");
    expect(v.claims).toEqual([expect.objectContaining({ key: "qty:5.1|A", status: "supported", page: 26, via: "row" })]);
  });

  it("wrong column: 7.3 A is on the cited page (the GS11N-20P5 chunk) but never on the record's line → unbound", () => {
    const v = verifyAnswer({ question: QI, answer: "The CT rated input current is 7.3 A [1].", evidence: [P26], recordCatalogNumber: RECORD });
    expect(v.verdict).toBe("unsupported");
    expect(v.reason).toBe("unbound");
    expect(v.claims).toEqual([expect.objectContaining({ key: "qty:7.3|A", status: "unbound", page: 26 })]);
  });

  it("look-alike: 1.9 A from the GS13N chunk, whose table_models lacks the record's key → unbound", () => {
    const v = verifyAnswer({
      question: QI,
      answer: "The CT rated input current is 1.9 A [1].",
      evidence: [{ page: 27, text: "", rows: [LOOKALIKE_ROWS] }],
      recordCatalogNumber: RECORD,
    });
    expect(v.verdict).toBe("unsupported");
    expect(v.reason).toBe("unbound");
  });

  it("control: without a record number the same rows bind by page co-occurrence, as today (7.3 A reads as supported)", () => {
    const v = verifyAnswer({ question: QI, answer: "The CT rated input current is 7.3 A [1].", evidence: [P26] });
    expect(v.verdict).toBe("supported");
    expect(v.claims[0]).not.toHaveProperty("via");
  });

  it("control: with a record number but flat page text (no rows — the pre-PR-1 shape) nothing changes", () => {
    const flat = { page: 26, text: `${OWN_ROWS.text}\n${SIBLING_ROWS.text}` };
    const v = verifyAnswer({ question: QI, answer: "The CT rated input current is 7.3 A [1].", evidence: [flat], recordCatalogNumber: RECORD });
    expect(v.verdict).toBe("supported");
  });

  it("a row chunk's title line is prose, not a column: 230 V from the header binds as before", () => {
    const v = verifyAnswer({ question: "What voltage class is it?", answer: "It is a 230 V class drive [1].", evidence: [P26], recordCatalogNumber: RECORD });
    expect(v.verdict).toBe("supported");
    expect(v.claims[0]).not.toHaveProperty("via");
  });

  it("control: an unqualified flat chunk (table_models lists every model, no MODEL: lines) is judged as prose", () => {
    const v = verifyAnswer({
      question: "What voltage class is it?",
      answer: "It is a 230 V class drive [1].",
      evidence: [{ page: 26, text: "", rows: [UNQUALIFIED_ROWS] }],
      recordCatalogNumber: RECORD,
    });
    expect(v.verdict).toBe("supported");
  });

  it("a strong subject the question names must still be on the cited page: the record's row alone does not bind without it", () => {
    // Before PR-4 a quantity on a page that never mentions the question's mnemonic was unbound;
    // the row rule binds BY the record's line, it does not waive the subject.
    const QS = "What is the CT rated input current at P00.04?";
    const miss = verifyAnswer({ question: QS, answer: "It is 5.1 A [1].", evidence: [P26], recordCatalogNumber: RECORD });
    expect(miss.reason).toBe("unbound");
    expect(miss.claims[0]).not.toHaveProperty("via");
    const hit = verifyAnswer({
      question: QS,
      answer: "It is 5.1 A [1].",
      evidence: [{ ...P26, text: "Parameter P00.04 displays the drive's rating." }],
      recordCatalogNumber: RECORD,
    });
    expect(hit.verdict).toBe("supported");
    expect(hit.claims[0]).toEqual(expect.objectContaining({ status: "supported", page: 26, via: "row" }));
  });

  it("a record number whose key matches no row on the cited page cannot be supported from another model's line", () => {
    const v = verifyAnswer({ question: QI, answer: "It is 5.1 A [1].", evidence: [P26], recordCatalogNumber: "GS11N-21P0" });
    expect(v.verdict).toBe("unsupported");
    expect(v.reason).toBe("unbound");
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
