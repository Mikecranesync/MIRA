import { describe, expect, it } from "vitest";
import { checkSufficiency, keyTermCoverage, keyTerms, SECOND_ROUND_WIDE_TOPK, secondRoundCalls } from "../evaluate";
import type { EquipmentContext, EvidenceItem, InvestigationPlan } from "../types";

function basePlan(overrides: Partial<InvestigationPlan> = {}): InvestigationPlan {
  return {
    codes: [],
    parameters: [],
    quantities: [],
    symptoms: [],
    intent: "other",
    missingFacts: [],
    ...overrides,
  };
}

function ev(text: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: overrides.id ?? `ev-${Math.random().toString(36).slice(2, 8)}`,
    source: overrides.source ?? "manual",
    docId: overrides.docId ?? "doc-1",
    title: overrides.title ?? "Manual",
    page: overrides.page ?? 1,
    text,
    toolCallIndex: 0,
    ...overrides,
  };
}

const unknownEquipment: EquipmentContext = { manufacturer: null, model: null, identityStatus: "unknown", drivePackId: null };

describe("checkSufficiency — uncoveredTerms", () => {
  it("flags a plan code with no evidence support as uncovered, and is insufficient", () => {
    const plan = basePlan({ codes: ["F004"], intent: "fault_code" });
    const check = checkSufficiency(plan, [ev("Nothing relevant here.")], unknownEquipment);
    expect(check.uncoveredTerms).toEqual(["F004"]);
    expect(check.sufficient).toBe(false);
    expect(check.reasons.some((r) => r.includes("F004"))).toBe(true);
  });

  it("does not flag a code whose evidence text contains it (via codeSpellings/codeTokenMatcher)", () => {
    const plan = basePlan({ codes: ["F004"], intent: "fault_code" });
    const check = checkSufficiency(plan, [ev("F004: Power Loss — check incoming supply.")], unknownEquipment);
    expect(check.uncoveredTerms).toEqual([]);
  });

  it("matches a zero-padding spelling variant (F4 <-> F004 shape via codeSpellings)", () => {
    const plan = basePlan({ parameters: ["P36"], intent: "parameter" });
    const check = checkSufficiency(plan, [ev("P036 Accel Time controls ramp-up.")], unknownEquipment);
    expect(check.uncoveredTerms).toEqual([]);
  });

  it("de-dupes a term that appears in both codes and parameters", () => {
    const plan = basePlan({ codes: ["F004"], parameters: ["F004"] });
    const check = checkSufficiency(plan, [], unknownEquipment);
    expect(check.uncoveredTerms).toEqual(["F004"]);
  });
});

describe("checkSufficiency — inapplicableEvidenceIds", () => {
  const confirmedPf525: EquipmentContext = {
    manufacturer: "Rockwell",
    model: "525",
    identityStatus: "user_confirmed",
    drivePackId: null,
  };

  it("does not flag evidence naming the SAME model, even as a bare number vs a full spelling", () => {
    const item = ev("PowerFlex 525 quick start", { title: "PowerFlex 525 Quick Start Guide" });
    const check = checkSufficiency(basePlan(), [item], confirmedPf525);
    expect(check.inapplicableEvidenceIds).toEqual([]);
  });

  it("flags evidence whose title names a DIFFERENT model than the confirmed identity", () => {
    const item = ev("PowerFlex 753 setup", { title: "PowerFlex 753 Quick Start Guide" });
    const check = checkSufficiency(basePlan(), [item], confirmedPf525);
    expect(check.inapplicableEvidenceIds).toEqual([item.id]);
  });

  it("flags evidence naming an entirely different drive family (GS10 vs PowerFlex 525)", () => {
    const item = ev("GS10 fault table", { title: "GS10 Fault Code Table" });
    const check = checkSufficiency(basePlan(), [item], confirmedPf525);
    expect(check.inapplicableEvidenceIds).toEqual([item.id]);
  });

  it("never flags evidence whose title names NO model at all (silence isn't a mismatch)", () => {
    const item = ev("General lockout/tagout procedure", { title: "Site Safety Policy" });
    const check = checkSufficiency(basePlan(), [item], confirmedPf525);
    expect(check.inapplicableEvidenceIds).toEqual([]);
  });

  it("never flags anything when identity is NOT confirmed, even with a clearly different model in the title", () => {
    const item = ev("GS10 fault table", { title: "GS10 Fault Code Table" });
    const unconfirmed: EquipmentContext = { manufacturer: "Rockwell", model: "525", identityStatus: "candidate", drivePackId: null };
    const check = checkSufficiency(basePlan(), [item], unconfirmed);
    expect(check.inapplicableEvidenceIds).toEqual([]);
  });

  it("≥1 applicable evidence item is required for sufficient=true, even with uncoveredTerms empty", () => {
    const item = ev("GS10 fault table", { title: "GS10 Fault Code Table" });
    const check = checkSufficiency(basePlan(), [item], confirmedPf525);
    expect(check.uncoveredTerms).toEqual([]); // no codes/parameters named by this empty plan
    expect(check.inapplicableEvidenceIds).toEqual([item.id]);
    expect(check.sufficient).toBe(false); // zero APPLICABLE evidence items
    expect(check.reasons.some((r) => r.includes("no applicable evidence"))).toBe(true);
  });
});

describe("checkSufficiency — contradictions", () => {
  it("flags two evidence items reporting different values near the SAME plan parameter", () => {
    const a = ev("P036 Accel Time: 50Hz default.", { id: "a" });
    const b = ev("P036 Accel Time: 60Hz default.", { id: "b" });
    const plan = basePlan({ parameters: ["P036"], intent: "parameter" });
    const check = checkSufficiency(plan, [a, b], unknownEquipment);
    expect(check.contradictions).toHaveLength(1);
    expect(check.contradictions[0].quantity).toBe("P036");
    expect(check.contradictions[0].values.sort((x, y) => x.evidenceId.localeCompare(y.evidenceId))).toEqual([
      { value: "50Hz", evidenceId: "a" },
      { value: "60Hz", evidenceId: "b" },
    ]);
  });

  it("does not flag a contradiction when both items report the SAME value", () => {
    const a = ev("P036 Accel Time: 50Hz default.", { id: "a" });
    const b = ev("See P036 Accel Time: 50Hz for details.", { id: "b" });
    const plan = basePlan({ parameters: ["P036"], intent: "parameter" });
    const check = checkSufficiency(plan, [a, b], unknownEquipment);
    expect(check.contradictions).toEqual([]);
  });

  it("does not flag a contradiction when the identifier is never followed by a quantity", () => {
    const a = ev("P036 controls the acceleration ramp.", { id: "a" });
    const plan = basePlan({ parameters: ["P036"], intent: "parameter" });
    const check = checkSufficiency(plan, [a], unknownEquipment);
    expect(check.contradictions).toEqual([]);
  });

  it("a contradiction alone does not flip sufficient=false (the model is told via the prompt, not forced by this boolean)", () => {
    const a = ev("F004: reset to clear, 50Hz nominal.", { id: "a" });
    const b = ev("F004: reset to clear, 60Hz nominal.", { id: "b" });
    const plan = basePlan({ codes: ["F004"], intent: "fault_code" });
    const check = checkSufficiency(plan, [a, b], unknownEquipment);
    expect(check.contradictions).toHaveLength(1);
    expect(check.uncoveredTerms).toEqual([]);
    expect(check.sufficient).toBe(true);
  });
});

describe("checkSufficiency — sufficient", () => {
  it("true when codes are covered, there is applicable evidence, and no contradiction", () => {
    const plan = basePlan({ codes: ["F004"], intent: "fault_code" });
    const check = checkSufficiency(plan, [ev("F004: Power Loss.")], unknownEquipment);
    expect(check.sufficient).toBe(true);
  });

  it("false when evidence is completely empty", () => {
    const check = checkSufficiency(basePlan(), [], unknownEquipment);
    expect(check.sufficient).toBe(false);
  });
});

describe("secondRoundCalls", () => {
  it("returns [] when remainingToolBudget is 0", () => {
    const plan = basePlan({ codes: ["F004"] });
    const check = checkSufficiency(plan, [], unknownEquipment);
    expect(secondRoundCalls(plan, check, 0)).toEqual([]);
  });

  it("an uncovered code -> a lookup_code call", () => {
    const plan = basePlan({ codes: ["F004"] });
    const check = checkSufficiency(plan, [], unknownEquipment);
    const calls = secondRoundCalls(plan, check, 5);
    expect(calls).toContainEqual({ tool: "lookup_code", input: { code: "F004" } });
  });

  it("an uncovered parameter -> a lookup_parameter call", () => {
    const plan = basePlan({ parameters: ["P036"] });
    const check = checkSufficiency(plan, [], unknownEquipment);
    const calls = secondRoundCalls(plan, check, 5);
    expect(calls).toContainEqual({ tool: "lookup_parameter", input: { parameter: "P036" } });
  });

  it("an uncovered parameter + a known drive pack id -> ALSO a drive_pack_lookup call", () => {
    const plan = basePlan({ parameters: ["P036"] });
    const check = checkSufficiency(plan, [], unknownEquipment);
    const calls = secondRoundCalls(plan, check, 5, "powerflex_525");
    expect(calls).toContainEqual({ tool: "lookup_parameter", input: { parameter: "P036" } });
    expect(calls).toContainEqual({ tool: "drive_pack_lookup", input: { packId: "powerflex_525", parameter: "P036" } });
  });

  it("an uncovered code + a known drive pack id -> ALSO a drive_pack_lookup call", () => {
    const plan = basePlan({ codes: ["F004"] });
    const check = checkSufficiency(plan, [], unknownEquipment);
    const calls = secondRoundCalls(plan, check, 5, "powerflex_525");
    expect(calls).toContainEqual({ tool: "drive_pack_lookup", input: { packId: "powerflex_525", code: "F004" } });
  });

  it("no uncovered terms (deficiency is applicability/contradiction) -> exactly ONE search_manual over symptoms+parameters", () => {
    const plan = basePlan({ parameters: ["P036"], symptoms: ["noisy"] });
    // uncoveredTerms empty: evidence covers P036, but is inapplicable.
    const check = checkSufficiency(plan, [ev("P036 Accel Time.", { title: "PowerFlex 753 Manual" })], {
      manufacturer: "Rockwell",
      model: "525",
      identityStatus: "user_confirmed",
      drivePackId: null,
    });
    expect(check.uncoveredTerms).toEqual([]);
    const calls = secondRoundCalls(plan, check, 5);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("search_manual");
    expect(calls[0].input.query).toBe("noisy P036");
  });

  it("no uncovered terms AND no symptoms/parameters to search -> []", () => {
    const plan = basePlan();
    const check = checkSufficiency(plan, [], unknownEquipment);
    expect(secondRoundCalls(plan, check, 5)).toEqual([]);
  });

  it("never exceeds remainingToolBudget", () => {
    const plan = basePlan({ codes: ["F004", "F005"], parameters: ["P036"] });
    const check = checkSufficiency(plan, [], unknownEquipment);
    const calls = secondRoundCalls(plan, check, 2, "powerflex_525");
    expect(calls.length).toBeLessThanOrEqual(2);
  });
});

describe("narrative questions — topical sufficiency", () => {
  const msg = "Conveyor motor hums but will not accelerate after the soft starter ramp completes";
  const equipment: EquipmentContext = { manufacturer: null, model: null, identityStatus: "user_confirmed", drivePackId: null };

  it("keyTerms drops stopwords, short tokens, bare numbers and repeats", () => {
    expect(keyTerms("The motor and the MOTOR will not start at 60 Hz, please help")).toEqual(["motor", "start"]);
  });

  it("keyTermCoverage is the best single item's share of key terms", () => {
    const terms = keyTerms(msg);
    const strong = ev("If the motor hums and does not accelerate when the soft starter ramp completes, check the conveyor load.");
    const weak = ev("Mounting dimensions and enclosure ratings.");
    expect(keyTermCoverage(msg, [weak])).toBe(0);
    expect(keyTermCoverage(msg, [weak, strong])).toBeGreaterThanOrEqual(0.5);
    expect(terms.length).toBeGreaterThanOrEqual(3);
  });

  it("off-topic evidence makes a narrative question insufficient; on-topic evidence does not", () => {
    const plan = basePlan({ intent: "symptom" });
    const off = checkSufficiency(plan, [ev("Mounting dimensions and enclosure ratings.")], equipment, msg);
    expect(off.sufficient).toBe(false);
    expect(off.reasons.join(" ")).toMatch(/weak topical match/);
    const on = checkSufficiency(
      plan,
      [ev("If the motor hums and does not accelerate when the soft starter ramp completes, check the conveyor load.")],
      equipment,
      msg,
    );
    expect(on.sufficient).toBe(true);
  });

  it("the topical check never applies to fault-code questions or when no message is given", () => {
    const plan = basePlan({ codes: ["F004"], intent: "fault_code" });
    expect(checkSufficiency(plan, [ev("F004 UnderVoltage")], equipment, msg).sufficient).toBe(true);
    expect(checkSufficiency(basePlan({ intent: "symptom" }), [ev("Mounting dimensions.")], equipment).sufficient).toBe(true);
  });

  it("round 2 for a narrative question re-searches the message with the wide pool", () => {
    const plan = basePlan({ intent: "symptom" });
    const check = checkSufficiency(plan, [ev("Mounting dimensions.")], equipment, msg);
    expect(secondRoundCalls(plan, check, 3, null, msg)).toEqual([
      { tool: "search_manual", input: { query: msg, rawQuery: msg, topK: SECOND_ROUND_WIDE_TOPK } },
    ]);
  });
});
