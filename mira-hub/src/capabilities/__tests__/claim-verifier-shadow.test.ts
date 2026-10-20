import { afterEach, describe, expect, it, vi } from "vitest";
import { claimVerifierMode, shadowVerifyTurn } from "../claim-verifier-shadow";
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
