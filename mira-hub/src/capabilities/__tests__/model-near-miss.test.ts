/**
 * Mike's plan of 2026-11-19, item 3 (decision 7 plus #5465): a model written
 * one character off ("2080-LC20-20QWD") or short of the cover's number
 * ("LXM32" for "LXM32A") gets a "Did you mean …?" question instead of a flat
 * refusal. Record: #5232.
 *
 * What does NOT change: the verdict. A near miss is still refused, so nothing
 * is answered from the manual until the technician asks again with the model
 * the cover lists. Confirmation is that re-ask, never a bare "yes": the chat
 * route runs its safety and scope checks on the message text, and a "yes" turn
 * would answer the earlier question with those checks run on "yes".
 *
 * Run: npx vitest run src/capabilities/__tests__/model-near-miss.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  EARLIER_SUBJECT_WAY_OUT,
  manualAnswersFor,
  nearMissOf,
  summarizeUnlistedRefusals,
  unlistedModelNumbers,
  unlistedModelRefusalText,
  type ManualVerdict,
  type UnlistedModelRefusal,
} from "../manual-applicability";

const refusal = (v: ManualVerdict) => {
  if (v.admit) throw new Error("expected a refusal");
  return v;
};
const judged = (question: string, cover: string, filename = "manual.pdf") =>
  refusal(manualAnswersFor(unlistedModelNumbers(question), cover, filename));

// The real first stored block of the Micro820 installation sheet's cover.
const MICRO820 = "Installation Instructions\nMicro820 20-Point Programmable Controllers\n"
  + "Catalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR,\n2080-LC20-20QBBR, 2080-LC20-20AWBR";
const LXM32A = "Lexium 32A Servo Drive\nLXM32A\nProduct manual";
const LXM32M = "Lexium 32M Servo Drive\nLXM32M\nProduct manual";

const OTHER = (asked: string[], declared: string[], source: UnlistedModelRefusal["source"] = "question"): UnlistedModelRefusal =>
  ({ kind: "other-model", asked, declared, source });

describe("which declared model an asked number is a near miss of", () => {
  it("precondition: these covers refuse the asked numbers, as other-model, naming what they declare", () => {
    expect(judged("bus voltage on my lxm32?", LXM32A)).toMatchObject({ kind: "other-model", asked: ["LXM32"], declared: ["LXM32A"] });
    expect(judged("Relay ratings on the 2080-LC20-20QWD?", MICRO820)).toMatchObject({ kind: "other-model", asked: ["2080-LC20-20QWD"] });
  });

  it("a number written short of the cover's (one or two characters missing at the end)", () => {
    expect(nearMissOf(OTHER(["LXM32"], ["LXM32A"]))).toBe("LXM32A");
    expect(nearMissOf(OTHER(["LXM32"], ["LXM32AB"]))).toBe("LXM32AB");
  });

  it("a one-character typo, picked out of a cover that lists six numbers", () => {
    const r = summarizeUnlistedRefusals([judged("Relay ratings on the 2080-LC20-20QWD?", MICRO820)], "question");
    expect(nearMissOf(r)).toBe("2080-LC20-20QWB");
    expect(nearMissOf(OTHER(["LXM32AX"], ["LXM32A"]))).toBe("LXM32A"); // one character extra
    expect(nearMissOf(OTHER(["LXM3A"], ["LXM32A"]))).toBe("LXM32A"); // one character missing inside
  });

  it("stated cost: a sibling one digit away reads exactly like a typo, so it is asked about too", () => {
    expect(nearMissOf(OTHER(["RX420"], ["RX410"]))).toBe("RX410");
  });

  it("a number spelled with a Unicode hyphen is compared by its characters, not its hyphens", () => {
    expect(nearMissOf(OTHER(["2080‑LC20‑20QWD"], ["2080-LC20-20QWB"]))).toBe("2080-LC20-20QWB");
  });

  it("no suggestion when two declared models are equally near (across every refused manual)", () => {
    const r = summarizeUnlistedRefusals([judged("bus voltage on my lxm32?", LXM32A), judged("bus voltage on my lxm32?", LXM32M)], "question");
    expect(r).toMatchObject({ kind: "other-model", declared: ["LXM32A", "LXM32M"] });
    expect(nearMissOf(r)).toBeNull();
    expect(nearMissOf(OTHER(["2080-LC20-20QW"], ["2080-LC20-20QWB", "2080-LC20-20QWBR"]))).toBeNull();
  });

  it("no suggestion when the nearest declared model is further off", () => {
    expect(nearMissOf(OTHER(["CA3KN22BD"], ["CA3KN31BD"]))).toBeNull(); // two characters differ
    expect(nearMissOf(OTHER(["LXM32"], ["LXM32ABC"]))).toBeNull(); // three characters short
    expect(nearMissOf(OTHER(["2080-LC50-24QWB"], ["2080-LC20-20QWB"]))).toBeNull();
    expect(nearMissOf(OTHER(["LXM23A"], ["LXM32A"]))).toBeNull(); // two characters swapped
  });

  it("no suggestion where the question is not the technician's to answer", () => {
    // The near miss is the notebook's own record: the record needs correcting, not the question.
    expect(nearMissOf(OTHER(["LXM32"], ["LXM32A"], "notebook"))).toBeNull();
    // Two numbers asked, a photo reading, or a reason other than "the cover declares another model".
    expect(nearMissOf(OTHER(["LXM32", "RX420"], ["LXM32A"]))).toBeNull();
    expect(nearMissOf({ ...OTHER(["LXM32"], ["LXM32A"]), reading: true })).toBeNull();
    for (const kind of ["coverage-not-shown", "cover-and-file-disagree", "several-look-alikes"] as const)
      expect(nearMissOf({ kind, asked: ["LXM32"], declared: ["LXM32A"], source: "question" })).toBeNull();
  });

  it("an earlier question carried into this one is asked about too", () => {
    expect(nearMissOf(OTHER(["LXM32"], ["LXM32A"], "conversation"))).toBe("LXM32A");
  });
});

describe("the reply to a near miss asks 'Did you mean …?' and still answers nothing", () => {
  it("opens with the question, keeps the refusal, and says how to confirm", () => {
    expect(unlistedModelRefusalText(OTHER(["LXM32"], ["LXM32A"]))).toBe(
      "Did you mean the LXM32A? The manual in this notebook is for the LXM32A, not the LXM32 you asked about, so I won't answer from it — its values may not apply to the LXM32. If the plate on your unit reads LXM32A, ask again with LXM32A in the question. Otherwise add the LXM32 manual (or the page that covers it) to this notebook and ask again.",
    );
  });

  it("a carried near miss keeps the way out of the earlier subject", () => {
    const text = unlistedModelRefusalText(OTHER(["LXM32"], ["LXM32A"], "conversation"));
    expect(text.startsWith("Did you mean the LXM32A? ")).toBe(true);
    expect(text).toContain("not the LXM32 you asked about earlier in this conversation");
    expect(text).toContain("If the plate on your unit reads LXM32A, ask again with LXM32A in the question.");
    expect(text).toContain(EARLIER_SUBJECT_WAY_OUT);
  });

  it("the typo against the real Micro820 cover names the one catalog number it is near", () => {
    const text = unlistedModelRefusalText(summarizeUnlistedRefusals([judged("Relay ratings on the 2080-LC20-20QWD?", MICRO820)], "question"));
    expect(text.startsWith("Did you mean the 2080-LC20-20QWB? ")).toBe(true);
    expect(text).toContain("not the 2080-LC20-20QWD you asked about, so I won't answer from it");
  });

  it("controls: no near miss, no question — the reply is exactly as before", () => {
    expect(unlistedModelRefusalText(OTHER(["CA3KN22BD"], ["CA3KN31BD"]))).toBe(
      "The manual in this notebook is for the CA3KN31BD, not the CA3KN22BD you asked about, so I won't answer from it — its values may not apply to the CA3KN22BD. Add the CA3KN22BD manual (or the page that covers it) to this notebook and ask again.",
    );
    const twoNear = unlistedModelRefusalText(OTHER(["LXM32"], ["LXM32A", "LXM32M"]));
    expect(twoNear).not.toMatch(/did you mean/i);
    expect(unlistedModelRefusalText(OTHER(["LXM32"], ["LXM32A"], "notebook"))).not.toMatch(/did you mean|plate on your unit/i);
  });

  it("the question never tells the technician to drop the model number, and never answers", () => {
    const text = unlistedModelRefusalText(OTHER(["LXM32"], ["LXM32A"]));
    expect(text).not.toMatch(/without the model|leave out|drop the/i);
    expect(text).toMatch(/won't answer from it/);
  });
});
