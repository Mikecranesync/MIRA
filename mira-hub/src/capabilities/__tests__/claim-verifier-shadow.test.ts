import { afterEach, describe, expect, it, vi } from "vitest";
import { claimVerifierMode, shadowVerifyCitedTurn, shadowVerifyTurn } from "../claim-verifier-shadow";
import * as verifier from "../claim-verifier";

const Q = "PLC-5 block transfer: which bit is set when DLEN doesn't match RLEN?";
const P238 = "Transmitted Word Count (.DLEN) … If these numbers do not match, the processor sets the .ER bit  bit 12 .";

afterEach(() => {
  delete process.env.NOTEBOOK_CLAIM_VERIFIER;
  vi.restoreAllMocks();
});

describe("claim-verifier shadow adapter", () => {
  it("is off by default and returns nothing", () => {
    expect(claimVerifierMode()).toBe("off");
    expect(shadowVerifyTurn({ question: Q, answer: "bit 11 [1]", citations: [{ page: 238, chunks: [P238] }] })).toBeNull();
  });

  it("in shadow mode flags the TQ-06 lookalike and supports the right bit", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    const bad = shadowVerifyTurn({ question: Q, answer: ".ER (bit 11) is set [1].", citations: [{ page: 238, chunks: [P238] }] });
    expect(bad).toEqual(expect.objectContaining({ "mira.claim_verifier.verdict": "unsupported", "mira.claim_verifier.reason": "absent" }));
    const good = shadowVerifyTurn({ question: Q, answer: "The .ER bit, bit 12, when .DLEN ≠ .RLEN [1].", citations: [{ page: 238, chunks: [P238] }] });
    expect(good?.["mira.claim_verifier.verdict"]).toBe("supported");
  });

  it("judges only the model-visible prefix of each chunk (a value past it reads as absent)", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    const late = `${"filler ".repeat(300)}.DLEN … the processor sets the .ER bit bit 12.`;
    const v = shadowVerifyTurn({ question: Q, answer: "It is bit 12 [1].", citations: [{ page: 238, chunks: [late] }] });
    expect(v?.["mira.claim_verifier.verdict"]).toBe("unsupported");
  });

  it("joins wrapped lines before matching (V1b): '10\\nminutes' supports '10 minutes'", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    const v = shadowVerifyTurn({
      question: "How long do I wait before inspecting a GS10?",
      answer: "Wait 10 minutes [1].",
      citations: [{ page: 3, chunks: ["after 5 minutes for ≤ 30hp models and 10\nminutes for ≥ 40hp models"] }],
    });
    expect(v?.["mira.claim_verifier.verdict"]).toBe("supported");
  });

  it("never throws: an internal error becomes verdict 'error'", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    vi.spyOn(verifier, "verifyAnswer").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(shadowVerifyTurn({ question: Q, answer: "bit 12", citations: [] })).toEqual({
      "mira.claim_verifier.verdict": "error",
      "mira.claim_verifier.reason": "boom",
    });
  });
});

describe("shadowVerifyCitedTurn: [n] maps to the n-th distinct (source, page), like withSupportingQuotes", () => {
  it("judges [2] against the SECOND page, not the first", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    const chunks = [
      { content: "Error .ER (bit 11) is set when the operation overflows.", sourceUrl: "doc", sourcePage: 240 },
      { content: P238, sourceUrl: "doc", sourcePage: 238 },
    ];
    const good = shadowVerifyCitedTurn({ question: Q, answer: "The .ER bit, bit 12, when .DLEN ≠ .RLEN [2].", citationIds: ["2"], chunks });
    expect(good?.["mira.claim_verifier.verdict"]).toBe("supported");
    const wrongPage = shadowVerifyCitedTurn({ question: Q, answer: "The .ER bit, bit 12, when .DLEN ≠ .RLEN [1].", citationIds: ["1"], chunks });
    expect(wrongPage?.["mira.claim_verifier.verdict"]).toBe("unsupported");
  });

  it("is off by default", () => {
    expect(shadowVerifyCitedTurn({ question: Q, answer: "bit 12", citationIds: ["1"], chunks: [] })).toBeNull();
  });
});

describe("garage pilot PR-4: row chunks (table_models) + the record's catalog number", () => {
  // table-rows.ts's real output on the GS10 p.26 item dump, abbreviated: one chunk per model.
  const HEADER = "230V Class – 1-Phase Model-Specific Specifications / GS10 230V Class Specifications; Frame Size A, B, C — Model Name: GS11N-2xPx — ";
  const OWN = `${HEADER}GS11N-20P2\nGS11N-20P2: CT Rated Input Current 5.1 A\nGS11N-20P2: VT Rated Input Current 5.8 A`;
  const SIB = `${HEADER}GS11N-20P5\nGS11N-20P5: CT Rated Input Current 7.3 A\nGS11N-20P5: VT Rated Input Current 8.3 A`;
  const QI = "What is its CT rated input current?";
  const chunks = [
    { content: OWN, sourceUrl: "gs10", sourcePage: 26, tableModels: ["GS11N20P2"] },
    { content: SIB, sourceUrl: "gs10", sourcePage: 26, tableModels: ["GS11N20P5"] },
  ];

  it("route entry: with the record's number, the sibling's 7.3 A is unbound and the record's 5.1 A is row-bound (counted)", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    const bad = shadowVerifyCitedTurn({ question: QI, answer: "It is 7.3 A [1].", citationIds: ["1"], chunks, recordCatalogNumber: "GS11N-20P2" });
    expect(bad).toEqual(
      expect.objectContaining({ "mira.claim_verifier.verdict": "unsupported", "mira.claim_verifier.reason": "unbound", "mira.claim_verifier.row_bound": 0 }),
    );
    const good = shadowVerifyCitedTurn({ question: QI, answer: "It is 5.1 A [1].", citationIds: ["1"], chunks, recordCatalogNumber: "GS11N-20P2" });
    expect(good).toEqual(expect.objectContaining({ "mira.claim_verifier.verdict": "supported", "mira.claim_verifier.row_bound": 1 }));
  });

  it("control: without a record number the same chunks are joined as before — 7.3 A reads as supported", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    const v = shadowVerifyCitedTurn({ question: QI, answer: "It is 7.3 A [1].", citationIds: ["1"], chunks });
    expect(v).toEqual(expect.objectContaining({ "mira.claim_verifier.verdict": "supported", "mira.claim_verifier.row_bound": 0 }));
  });

  it("shadowVerifyTurn accepts object chunks beside strings and judges only the model-visible prefix of a row chunk", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    const v = shadowVerifyTurn({
      question: QI,
      answer: "It is 5.1 A [1].",
      citations: [{ page: 26, chunks: ["Specifications are listed per model below.", { text: OWN, tableModels: ["GS11N20P2"] }] }],
      recordCatalogNumber: "GS11N-20P2",
    });
    expect(v).toEqual(expect.objectContaining({ "mira.claim_verifier.verdict": "supported", "mira.claim_verifier.row_bound": 1 }));
    const late = shadowVerifyTurn({
      question: QI,
      answer: "It is 5.1 A [1].",
      citations: [{ page: 26, chunks: [{ text: `${"filler ".repeat(300)}\n${OWN}`, tableModels: ["GS11N20P2"] }] }],
      recordCatalogNumber: "GS11N-20P2",
    });
    expect(late?.["mira.claim_verifier.verdict"]).toBe("unsupported");
  });
});

describe("Codex F1 (#4550 r1): two manuals that share a page number stay separate", () => {
  it("manual B's bit 11 never binds to manual A's .DLEN just because both are page 5", () => {
    process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
    const q = "Which bit signals a DLEN mismatch?";
    const chunks = [
      { content: "If .DLEN does not match .RLEN the processor sets bit 12.", sourceUrl: "manual-a", sourcePage: 5 },
      { content: "Other operation errors set bit 11.", sourceUrl: "manual-b", sourcePage: 5 },
    ];
    const v = shadowVerifyCitedTurn({ question: q, answer: "It sets bit 11 [1][2].", citationIds: ["1", "2"], chunks });
    expect(v?.["mira.claim_verifier.verdict"]).toBe("unsupported");
  });
});
