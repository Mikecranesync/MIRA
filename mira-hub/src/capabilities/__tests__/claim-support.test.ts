/**
 * TQ-08 (2026-10-17 prod test): a spec or yes/no claim must be stated in the
 * chunk the answer cites. The checker, in isolation.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAIM_NOT_STATED_TEXT,
  REDRAFT_DIRECTIVE,
  checkClaimSupport,
  claimSupportEnabled,
  polarLead,
} from "../claim-support";

const chunk = (content: string, page = 21) => ({
  sourceUrl: "node-doc/u1/gs10.pdf",
  sourcePage: page,
  content,
});

const TORQUE_PAGE = chunk(
  "Terminal screw torque: tighten the main circuit terminals to 1.76 N·m. Control circuit terminals: 0.5 N·m.",
);
const CARRIER_PAGE = chunk(
  "Carrier frequency P2.04 selects the PWM switching frequency. The default is 10 kHz for models up to 7.5 hp.",
  34,
);

afterEach(() => {
  delete process.env.NOTEBOOK_CLAIM_SUPPORT;
});

describe("claimSupportEnabled", () => {
  // OFF by default on purpose: enabled, this check flipped three existing
  // route contracts, including a correct grounded answer ("below 200 C")
  // whose fixture chunk never states that value. See the flag's own comment.
  it("defaults OFF and only '1' enables it", () => {
    expect(claimSupportEnabled()).toBe(false);
    process.env.NOTEBOOK_CLAIM_SUPPORT = "1";
    expect(claimSupportEnabled()).toBe(true);
    process.env.NOTEBOOK_CLAIM_SUPPORT = "true";
    expect(claimSupportEnabled()).toBe(false);
  });
});

describe("polarLead", () => {
  it("reads a lead affirmation or denial, not a mid-sentence 'no'", () => {
    expect(polarLead("Yes, that terminal is rated for it [1].")).toBe("yes");
    expect(polarLead("**No** — the drive does not support that [1].")).toBe("no");
    expect(polarLead("There is no derating below 40 °C [1].")).toBeNull();
    expect(polarLead("Set P2.04 to 8 kHz [1].")).toBeNull();
  });
});

describe("checkClaimSupport — spec values", () => {
  it("flags a torque the cited page does not state (the TQ-08 shape)", () => {
    const v = checkClaimSupport({
      answer: "Tighten the main terminals to 2.5 N·m [1].",
      question: "what is the terminal screw torque",
      citations: [{ citationId: "1" }],
      chunks: [TORQUE_PAGE],
    });
    expect(v.unsupported).toBe(true);
    expect(v.reason).toBe("spec_value_not_in_cited_chunk");
    expect(v.values.join(" ")).toMatch(/2\.5/);
  });

  it("control: the value the page DOES state is supported", () => {
    expect(
      checkClaimSupport({
        answer: "Tighten the main circuit terminals to 1.76 N·m [1].",
        question: "what is the terminal screw torque",
        citations: [{ citationId: "1" }],
        chunks: [TORQUE_PAGE],
      }).unsupported,
    ).toBe(false);
  });

  it("maps citation [2] to the SECOND unique page, so a value stated on page 1 does not excuse citation 2", () => {
    const v = checkClaimSupport({
      answer: "The default carrier frequency is 1.76 kHz [2].",
      question: "what is the default carrier frequency",
      citations: [{ citationId: "2" }],
      chunks: [TORQUE_PAGE, CARRIER_PAGE],
    });
    expect(v.unsupported).toBe(true);
  });

  it("control: a value stated on its own cited page is supported across two pages", () => {
    expect(
      checkClaimSupport({
        answer: "The default carrier frequency is 10 kHz [2].",
        question: "what is the default carrier frequency",
        citations: [{ citationId: "1" }, { citationId: "2" }],
        chunks: [TORQUE_PAGE, CARRIER_PAGE],
      }).unsupported,
    ).toBe(false);
  });
});

describe("checkClaimSupport — polar claims", () => {
  it("flags a bare Yes about an identifier that appears on no cited page", () => {
    const v = checkClaimSupport({
      answer: "Yes, that is supported [1].",
      question: "does parameter P9.99 enable the second encoder",
      citations: [{ citationId: "1" }],
      chunks: [CARRIER_PAGE],
    });
    expect(v.unsupported).toBe(true);
    expect(v.reason).toBe("polar_claim_not_in_cited_chunk");
  });

  it("control: a Yes about an identifier the cited page DOES carry is supported", () => {
    expect(
      checkClaimSupport({
        answer: "Yes, that parameter selects the PWM frequency [1].",
        question: "does parameter P2.04 set the switching frequency",
        citations: [{ citationId: "1" }],
        chunks: [CARRIER_PAGE],
      }).unsupported,
    ).toBe(false);
  });

  it("control: a non-polar answer with no parsed value is never flagged", () => {
    expect(
      checkClaimSupport({
        answer: "That parameter selects the PWM switching frequency [1].",
        question: "what does P2.04 do",
        citations: [{ citationId: "1" }],
        chunks: [CARRIER_PAGE],
      }).unsupported,
    ).toBe(false);
  });

  it("control: a polar answer whose question names no identifier is left to the semantic judge", () => {
    expect(
      checkClaimSupport({
        answer: "Yes, that is fine [1].",
        question: "can I run this drive on a long motor cable",
        citations: [{ citationId: "1" }],
        chunks: [CARRIER_PAGE],
      }).unsupported,
    ).toBe(false);
  });
});

describe("checkClaimSupport — unjudgeable inputs are never flagged", () => {
  it.each([
    ["no citations", { citations: [], chunks: [TORQUE_PAGE] }],
    ["no chunks", { citations: [{ citationId: "1" }], chunks: [] }],
    ["empty answer", { citations: [{ citationId: "1" }], chunks: [TORQUE_PAGE] }],
    ["a citation id with no page", { citations: [{ citationId: "9" }], chunks: [TORQUE_PAGE] }],
  ])("%s", (label, over) => {
    expect(
      checkClaimSupport({
        answer: label === "empty answer" ? "   " : "Tighten to 2.5 N·m [1].",
        question: "what is the terminal screw torque",
        ...over,
      }).unsupported,
    ).toBe(false);
  });
});

describe("the served replacement and the redraft directive", () => {
  it("the replacement states no value and no page from the rejected draft", () => {
    expect(CLAIM_NOT_STATED_TEXT).not.toMatch(/\d/);
    expect(CLAIM_NOT_STATED_TEXT).toMatch(/won't state it as fact/);
  });

  // The goal names this wording for the fallback ("not stated in the manual"),
  // so it is pinned rather than left to paraphrase drift.
  it("uses the goal's own phrasing: isn't stated in the manual", () => {
    expect(CLAIM_NOT_STATED_TEXT).toMatch(/isn't stated in the manual/);
  });
  it("the redraft directive never carries the wrong value back into the prompt", () => {
    expect(REDRAFT_DIRECTIVE).not.toMatch(/\d/);
    expect(REDRAFT_DIRECTIVE).toMatch(/appear verbatim/);
  });
});
