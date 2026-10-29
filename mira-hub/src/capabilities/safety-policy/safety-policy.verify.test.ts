/**
 * #4372 safety Phase 1 — L3 evidence verifier (NUM-1, NUM-2, SYS-2) and the decision-4
 * applicability rules A1–A5. Every invariant has a must-block and a must-pass control; each
 * must-block input is complete except for the one field under test (prove-the-test-fails §4).
 * Chunk text is verbatim OEM manual text (dev-fixtures.ts); labels are implementer-authored.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/safety-policy
 */
import { describe, expect, it } from "vitest";
import { extractNumbers } from "./extract";
import { verifyNumbers } from "./verify";
import type { BoundAsset, EvidenceChunk } from "./types";
import * as F from "./dev-fixtures";

function check(answerText: string, chunks: EvidenceChunk[], bound: BoundAsset | null, question = "") {
  const ex = extractNumbers({ answerText, chunks, bound, question });
  return verifyNumbers({ numbers: ex.numbers, unparsed: ex.unparsed, chunks, bound, question });
}
const verdicts = (r: ReturnType<typeof check>) => r.checks.map((c) => c.verdict);

const WAIT10 = "Wait at least 10 minutes for the DC bus capacitors to discharge [1].";

describe("NUM-1 — a hazard-critical number needs an applicable source stating it in the cited sentence", () => {
  it("pass: GS10 p6-4 states 10 minutes in the cited sentence", () => {
    const r = check(WAIT10, [F.gs10p64()], F.GS10);
    expect(verdicts(r)).toEqual(["pass"]);
    expect(r.verdict).toBe("pass");
  });

  it("block: same value cited to the tH1o fault row (10 minutes, but a thermal reset, not discharge)", () => {
    const r = check(WAIT10, [F.gs10th1o()], F.GS10);
    expect(verdicts(r)).toEqual(["block:not_in_cited_sentence"]);
    expect(r.verdict).toBe("block");
  });

  it("block: 5 seconds appears in the GS10 page only as the fault-reset wait", () => {
    const r = check("Wait 5 seconds for the DC bus capacitors to discharge [1].", [F.gs10p63()], F.GS10);
    expect(verdicts(r)).toEqual(["block:not_in_cited_sentence"]);
  });

  it("block: a recharge time (2 hours) is not support for a discharge time", () => {
    const r = check("The capacitors take 2 hours to discharge [1].", [F.gs10p63()], F.GS10);
    expect(verdicts(r)).toEqual(["block:not_in_cited_sentence"]);
  });

  it("block: an uncited number has no source; control: the same sentence cited passes", () => {
    expect(verdicts(check("Wait at least 10 minutes for the DC bus capacitors to discharge.", [F.gs10p64()], F.GS10))).toEqual(["block:no_source"]);
    expect(verdicts(check(WAIT10, [F.gs10p64()], F.GS10))).toEqual(["pass"]);
  });

  it("block: the value is in another retrieved chunk, not in the one the sentence cites", () => {
    const chunks = [F.gs10th1o("c1"), F.gs10p64("c2")];
    expect(verdicts(check("Wait at least 10 minutes for the DC bus capacitors to discharge [1].", chunks, F.GS10))).toEqual([
      "block:not_in_cited_sentence",
    ]);
    expect(verdicts(check("Wait at least 10 minutes for the DC bus capacitors to discharge [2].", chunks, F.GS10))).toEqual(["pass"]);
  });

  it("block: a cite to a chunk that was not retrieved this turn", () => {
    const r = check("Wait at least 10 minutes for the DC bus capacitors to discharge [7].", [F.gs10p64()], F.GS10);
    expect(verdicts(r)).toEqual(["block:unknown_chunk"]);
  });

  it("pass: PowerFlex 40 'Wait three minutes' and ABB ACS355 'wait for 5 minutes' (number words, wrapped lines)", () => {
    expect(verdicts(check("Wait 3 minutes for the capacitors to discharge [1].", [F.pf40p9()], F.PF40))).toEqual(["pass"]);
    expect(verdicts(check("Wait five minutes for the capacitors to discharge [1].", [F.acs355p18()], F.ACS355))).toEqual(["pass"]);
  });

  it("pass: the meter threshold the manual states (below 25 VDC); block: one it does not (50 V)", () => {
    expect(verdicts(check("Then measure DC+ to DC- and confirm it is below 25 VDC [1].", [F.gs10p64()], F.GS10))).toEqual(["pass"]);
    expect(verdicts(check("Then measure DC+ to DC- and confirm it is below 50 VDC [1].", [F.gs10p64()], F.GS10))).toEqual([
      "block:not_in_cited_sentence",
    ]);
  });

  it("pass: verifying absence of voltage (0 V) needs no source — the #4943 OEM procedure is not blocked", () => {
    const r = check("Lock out the drive, wait for the charge LED to go out, then measure DC+ to DC- and confirm 0 V.", [], F.GS10);
    expect(r.verdict).toBe("no_numbers"); // "0 V" with no threshold word is not a threshold claim
    const r2 = check("Lock out the drive, then measure DC+ to DC- and confirm the bus drops to 0 V.", [], F.GS10);
    expect(verdicts(r2)).toEqual(["pass_absence_of_voltage"]);
    expect(r2.verdict).toBe("pass");
  });
});

describe("Decision 4 applicability (A1–A5): only an applicable source supports a number", () => {
  it("A1 technician's own number: the asked figure is not support; control: an OEM chunk stating it is", () => {
    const q = "The label says to wait 3 minutes for the bus capacitors to discharge, right?";
    const a = "Yes, wait 3 minutes for the capacitors to discharge [1].";
    expect(verdicts(check(a, [F.gs10p64()], F.GS10, q))).toEqual(["block:technician_number"]);
    expect(verdicts(check(a, [F.pf40p9()], F.PF40, q))).toEqual(["pass"]);
  });

  it("A1 a technician-origin chunk is never support; control: the identical chunk as a manual passes", () => {
    const tech = F.gs10p64("c1", { origin: "technician" });
    expect(verdicts(check(WAIT10, [tech], F.GS10))).toEqual(["block:technician_number"]);
    expect(verdicts(check(WAIT10, [{ ...tech, origin: "manual" }], F.GS10))).toEqual(["pass"]);
  });

  it("A2 vendor_fallback is never support; control: the identical chunk without the flag passes", () => {
    expect(verdicts(check(WAIT10, [F.gs10p64("c1", { retrievalScope: "vendor_fallback" })], F.GS10))).toEqual(["block:vendor_fallback"]);
    expect(verdicts(check(WAIT10, [F.gs10p64("c1")], F.GS10))).toEqual(["pass"]);
  });

  it("A3 sibling model: the GS4's 'two minutes' does not support a GS10 answer; control: bound to the GS4 it does", () => {
    const a = "Wait 2 minutes for the capacitors to discharge [1].";
    expect(verdicts(check(a, [F.gs4warn()], F.GS10))).toEqual(["block:not_bound_asset"]);
    expect(verdicts(check(a, [F.gs4warn()], F.GS4))).toEqual(["pass"]);
  });

  it("A3 no bound asset: no manual chunk applies, and no photo either (#4955)", () => {
    expect(verdicts(check(WAIT10, [F.gs10p64()], null))).toEqual(["block:not_bound_asset"]);
    expect(verdicts(check("Wait 10 minutes for the capacitors to discharge [photo].", [F.gs10photo()], null))).toEqual([
      "block:not_bound_asset",
    ]);
  });

  it("A3 an approved document for the asset applies even when the chunk's model string differs", () => {
    const odd = F.gs10p64("c1", { modelNumber: "GS11N-20P2", verified: false });
    expect(verdicts(check(WAIT10, [odd], F.GS10))).toEqual(["block:not_bound_asset"]);
    expect(verdicts(check(WAIT10, [odd], { ...F.GS10, docIds: [F.GS10_SHA] }))).toEqual(["pass"]);
  });

  it("A4 unverified shared chunk: blocked; verified undefined counts as unverified; control verified:true passes", () => {
    expect(verdicts(check(WAIT10, [F.gs10p64("c1", { verified: false })], F.GS10))).toEqual(["block:unverified_source"]);
    expect(verdicts(check(WAIT10, [F.gs10p64("c1", { verified: undefined })], F.GS10))).toEqual(["block:unverified_source"]);
    expect(verdicts(check(WAIT10, [F.gs10p64("c1", { verified: true })], F.GS10))).toEqual(["pass"]);
  });

  it("A5 no page: blocked; control: a numeric sourcePage alone passes", () => {
    expect(verdicts(check(WAIT10, [F.gs10p64("c1", { pageLabel: null, sourcePage: null })], F.GS10))).toEqual(["block:no_page"]);
    expect(verdicts(check(WAIT10, [F.gs10p64("c1", { pageLabel: null, sourcePage: 4 })], F.GS10))).toEqual(["pass"]);
  });
});

describe("NUM-2 — several stated values: the most conservative, or the value with its condition", () => {
  // GS10 p6-3 states 5 min (after lamps out), 5 min for ≤ 30 hp and 10 min for ≥ 40 hp.
  it("block: an unconditioned 5 minutes when the page also gives 10 minutes", () => {
    const r = check("Wait 5 minutes for the capacitors to discharge [1].", [F.gs10p63()], F.GS10);
    expect(verdicts(r)).toEqual(["block:not_most_conservative"]);
  });

  it("pass: 5 minutes with the manual's own condition (30 hp or less)", () => {
    const r = check("For drives rated 30 hp or less, wait 5 minutes for the capacitors to discharge [1].", [F.gs10p63()], F.GS10);
    expect(verdicts(r)).toEqual(["pass_conditioned"]);
  });

  it("block: 5 minutes with the wrong condition (40 hp or more)", () => {
    const r = check("For drives rated 40 hp or more, wait 5 minutes for the capacitors to discharge [1].", [F.gs10p63()], F.GS10);
    expect(verdicts(r)).toEqual(["block:not_most_conservative"]);
  });

  it("pass: the most conservative value (10 minutes) needs no condition", () => {
    const r = check("Wait 10 minutes for the capacitors to discharge [1].", [F.gs10p63()], F.GS10);
    expect(verdicts(r)).toEqual(["pass_most_conservative"]);
  });

  it("conflict spans chunks: 5 minutes from the warning paragraph blocks when p6-4 (10 minutes) is also retrieved", () => {
    const a = "Wait at least five minutes after all display lamps have turned off for the capacitors to discharge [1].";
    expect(verdicts(check(a, [F.gs10warn("c1")], F.GS10))).toEqual(["pass"]);
    expect(verdicts(check(a, [F.gs10warn("c1"), F.gs10p64("c2")], F.GS10))).toEqual(["block:not_most_conservative"]);
  });

  it("a known rating resolves the conflict: a 5 hp GS10 drops the ≥ 40 hp value", () => {
    const a = "Wait 5 minutes for the capacitors to discharge [1].";
    expect(verdicts(check(a, [F.gs10p63()], { ...F.GS10, rating: { value: 5, unit: "hp" } }))).toEqual(["pass"]);
    expect(verdicts(check(a, [F.gs10p63()], { ...F.GS10, rating: { value: 50, unit: "hp" } }))).toEqual(["block:not_most_conservative"]);
  });

  it("condition dropped: the only source states the value for a rating; the answer generalises it", () => {
    const only = F.manualChunk(
      "c1",
      "When the power is off after 5 minutes for ≤ 30hp models, please confirm that the capacitors have fully discharged by measuring the voltage between + and -.",
      F.GS10,
      F.GS10_SHA,
      "6-3",
    );
    expect(verdicts(check("Wait 5 minutes for the capacitors to discharge [1].", [only], F.GS10))).toEqual(["block:condition_dropped"]);
    expect(verdicts(check("For 30 hp and below, wait 5 minutes for the capacitors to discharge [1].", [only], F.GS10))).toEqual([
      "pass_conditioned",
    ]);
  });

  it("residual voltage conflicts resolve to the LOWEST threshold", () => {
    const low = F.manualChunk("c2", "The DC bus voltage must fall below 10 VDC before you touch the terminals.", F.GS10, F.GS10_SHA, "6-9");
    expect(verdicts(check("Confirm the bus reads below 10 VDC [2].", [F.gs10p64("c1"), low], F.GS10))).toEqual(["pass_most_conservative"]);
    expect(verdicts(check("Confirm the bus reads below 25 VDC [1].", [F.gs10p64("c1"), low], F.GS10))).toEqual(["block:not_most_conservative"]);
  });
});

describe("SYS-2 — anything that cannot be classified fails closed", () => {
  const base = { quantity: "discharge_time", value: 600, unit: "s", sourceChunkId: "c1" };
  const run = (n: unknown) => verifyNumbers({ numbers: [n], chunks: [F.gs10p64()], bound: F.GS10 });

  it("control: a well-formed typed number passes", () => {
    expect(run(base).checks.map((c) => c.verdict)).toEqual(["pass"]);
  });

  it("control: a well-formed rating condition is accepted by the schema", () => {
    const r = run({ ...base, condition: { op: "ge", value: 40, unit: "hp" } });
    expect(r.checks.map((c) => c.verdict)).not.toContain("block:schema");
  });

  it.each([
    ["unit not canonical for the quantity", { ...base, unit: "V" }],
    ["unit not in the vocabulary", { ...base, unit: "min" }],
    ["unknown quantity", { ...base, quantity: "wait_time" }],
    ["unknown key", { ...base, note: "wait 10 minutes" }],
    ["non-finite value", { ...base, value: Number.POSITIVE_INFINITY }],
    ["negative value", { ...base, value: -1 }],
    ["missing sourceChunkId key", { quantity: "discharge_time", value: 600, unit: "s" }],
    ["empty sourceChunkId", { ...base, sourceChunkId: "" }],
    ["condition with an unknown op", { ...base, condition: { op: "lt", value: 30, unit: "hp" } }],
    ["condition with a non-positive rating", { ...base, condition: { op: "le", value: 0, unit: "hp" } }],
    ["condition with an unknown key", { ...base, condition: { op: "le", value: 30, unit: "hp", note: "x" } }],
    ["an array instead of an object", [base]],
    ["null", null],
  ])("block:schema — %s", (_name, n) => {
    const r = run(n);
    expect(r.checks.map((c) => c.verdict)).toEqual(["block:schema"]);
    expect(r.verdict).toBe("block");
  });

  it("block: a duration with no parsable number in a stored-energy clause; control: a parsed one passes", () => {
    expect(verdicts(check("Wait a few minutes for the capacitors to discharge [1].", [F.gs10p64()], F.GS10))).toEqual(["block:unparsed"]);
    expect(verdicts(check(WAIT10, [F.gs10p64()], F.GS10))).toEqual(["pass"]);
  });
});

describe("turn verdict and determinism (G6)", () => {
  it("deferred quantities are reported but never decide the turn", () => {
    const r = check("Torque the DC bus terminals to 4.4 lb-in [1].", [F.gs10p64()], F.GS10);
    expect(r.checks.map((c) => [c.verdict, c.enforced])).toEqual([["block:not_in_cited_sentence", false]]);
    expect(r.verdict).toBe("no_numbers");
    const mixed = check(`${WAIT10} Torque the DC bus terminals to 4.4 lb-in [1].`, [F.gs10p64()], F.GS10);
    expect(mixed.checks.map((c) => [c.verdict, c.enforced])).toEqual([
      ["pass", true],
      ["block:not_in_cited_sentence", false],
    ]);
    expect(mixed.verdict).toBe("pass");
  });

  it("identical verdicts on rerun", () => {
    const chunks = [F.gs10p63("c1"), F.gs10p64("c2"), F.gs4warn("c3", { retrievalScope: "vendor_fallback" })];
    const a = "Wait 5 minutes [1]. Then the caps can remain charged for 2 minutes [3]. Confirm below 25 VDC [2].";
    const runs = Array.from({ length: 5 }, () => JSON.stringify(check(a, chunks, F.GS10, "How long for the DC bus to discharge?")));
    expect(new Set(runs).size).toBe(1);
  });
});

// PR #4953 Codex round-1 follow-ups: #4954 (F1), #4955 (F2), #4956 (F3).
describe("review follow-ups", () => {
  const FAULT_CHECK = manual("Troubleshooting\n\nAfter a fault has been cleared, wait 5 seconds before checking the DC bus voltage.");
  const FIVE_S = "Wait 5 seconds for the DC bus capacitors to discharge [1].";

  it("#4954 block: a fault-reset delay that mentions the DC bus is not a discharge time", () => {
    expect(verdicts(check(FIVE_S, [FAULT_CHECK], F.GS10))).toEqual(["block:not_in_cited_sentence"]);
  });

  it("#4954 control: a discharge sentence that mentions the bus still supports its time", () => {
    const real = manual("After a fault, remove power and wait 5 seconds for the DC bus capacitors to discharge.");
    expect(verdicts(check(FIVE_S, [real], F.GS10))).toEqual(["pass"]);
  });

  it("#4954 control: the answer side still claims a fault-worded wait near the bus (fail closed)", () => {
    const ex = extractNumbers({ answerText: "After a fault has been cleared, wait 5 seconds before touching the DC bus.", chunks: [], bound: F.GS10 });
    expect(ex.numbers.map((n) => n.quantity)).toEqual(["discharge_time"]);
  });

  const PHOTO_A = "Wait 10 minutes for the capacitors to discharge [photo].";

  it("#4955 block: a photo of another model's label does not support the bound asset", () => {
    expect(verdicts(check(PHOTO_A, [F.gs10photo({ modelNumber: "GS4" })], F.GS10))).toEqual(["block:not_bound_asset"]);
  });

  it("#4955 block: a photo with no identified asset does not apply", () => {
    expect(verdicts(check(PHOTO_A, [F.gs10photo({ manufacturer: undefined, modelNumber: undefined })], F.GS10))).toEqual([
      "block:not_bound_asset",
    ]);
  });

  it("#4955 control: a photo identified as the bound asset applies (no page or verified flag needed)", () => {
    expect(verdicts(check(PHOTO_A, [F.gs10photo()], F.GS10))).toEqual(["pass"]);
  });

  const halfAndOne = (half: string) => [
    manual(`Wait ${half} minute for the DC bus capacitors to discharge.`, "c1"),
    manual("Wait 1 minute for the DC bus capacitors to discharge.", "c2"),
  ];

  // #4959: U+2215 DIVISION SLASH survives NFKC; it must read as a fraction like "/" and U+2044.
  for (const half of ["1/2", "\u00BD", "1\u22152", "1\u20442"]) {
    it(`#4956 '${half} minute' is 30 seconds, so citing it alone is not the most conservative`, () => {
      const r = check(`Wait ${half} minute for the capacitors to discharge [1].`, halfAndOne(half), F.GS10);
      expect(r.checks.map((c) => c.number?.value)).toEqual([30]);
      expect(verdicts(r)).toEqual(["block:not_most_conservative"]);
    });
  }

  it("#4956 control: the 1-minute source still passes as the most conservative", () => {
    expect(verdicts(check("Wait 1 minute for the capacitors to discharge [2].", halfAndOne("1/2"), F.GS10))).toEqual([
      "pass_most_conservative",
    ]);
  });
});

function manual(content: string, id = "c1"): EvidenceChunk {
  return F.manualChunk(id, content, F.GS10, F.GS10_SHA, "6-9");
}
