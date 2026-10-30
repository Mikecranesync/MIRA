import { describe, expect, it } from "vitest";
import { buildPlan } from "../plan";
import type { InvestigationInput } from "../types";

function baseInput(overrides: Partial<InvestigationInput> = {}): InvestigationInput {
  return {
    message: "",
    role: "technician",
    tenantId: "t1",
    nodeId: null,
    docIds: ["doc-1"],
    equipment: { manufacturer: null, model: null, identityStatus: "user_confirmed", drivePackId: null },
    ...overrides,
  };
}

describe("buildPlan — codes", () => {
  it("extracts a fault code named plainly", () => {
    const plan = buildPlan(baseInput({ message: "how do I reset F004" }));
    expect(plan.codes).toContain("F004");
    expect(plan.intent).toBe("fault_code");
  });

  it("extracts a PowerFlex 525 parameter (P036) and an advanced parameter (A055)", () => {
    const plan = buildPlan(baseInput({ message: "what does P036 do and how does it relate to A055?" }));
    expect(plan.parameters).toContain("P036");
    expect(plan.parameters).toContain("A055");
  });

  it("extracts 'parameter 39' as a parameter", () => {
    const plan = buildPlan(baseInput({ message: "what is parameter 39 set to?" }));
    expect(plan.parameters.some((p) => /39/.test(p))).toBe(true);
  });

  it("strips the equipment's own model number from the code pool (GS10 fault oL)", () => {
    // "PowerFlex 525" never meaningfully exercised this: plain "525" has no
    // letter prefix, so it was never classified as a code either way. "GS10"
    // IS picked up by the hub's own code-shaped extraction (letter+digit
    // mix, CODE_BEFORE_KEYWORD next to "fault") — a real token to strip.
    const withModel = buildPlan(
      baseInput({
        message: "GS10 fault oL",
        equipment: { manufacturer: "AutomationDirect", model: "GS10", identityStatus: "user_confirmed", drivePackId: null },
      }),
    );
    expect(withModel.codes).toEqual(["oL"]);

    const withoutModel = buildPlan(baseInput({ message: "GS10 fault oL", equipment: {} }));
    expect(withoutModel.codes).toContain("GS10");
    expect(withoutModel.codes).toContain("oL");
  });

  it("extracts a GS10-style dotted parameter id (P09.03) whole, not as a cut fragment", () => {
    const plan = buildPlan(baseInput({ message: "what does P09.03 do?" }));
    expect(plan.parameters).toContain("P09.03");
    expect(plan.parameters).not.toContain("P09");
    expect(plan.parameters).not.toContain("P009");
    expect(plan.codes).toEqual([]);
  });

  it("extracts a Mitsubishi-style 'Pr.xx' parameter id", () => {
    const plan = buildPlan(baseInput({ message: "what is Pr.7 set to?" }));
    expect(plan.parameters).toContain("Pr.7");
  });
});

describe("buildPlan — quantities", () => {
  it("extracts a number+unit quantity with canonical units", () => {
    const plan = buildPlan(baseInput({ message: "the DC bus reads 620V and the fan draws 1,750 rpm" }));
    expect(plan.quantities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 620, unit: "V" }),
        expect.objectContaining({ value: 1750, unit: "rpm" }),
      ]),
    );
  });
});

describe("buildPlan — symptoms", () => {
  it("extracts a concrete symptom keyword", () => {
    const plan = buildPlan(baseInput({ message: "the conveyor is making a grinding noise and vibrating" }));
    expect(plan.symptoms.length).toBeGreaterThan(0);
    expect(plan.intent).toBe("symptom");
  });
});

describe("buildPlan — intent", () => {
  it("classifies a procedure ask", () => {
    const plan = buildPlan(baseInput({ message: "how do I commission this drive?" }));
    expect(plan.intent).toBe("procedure");
  });

  it("classifies a spec_check when an observation is attached", () => {
    const plan = buildPlan(
      baseInput({
        message: "is 620V on the DC bus within spec?",
        observations: [{ name: "DC bus", value: 620, unit: "V" }],
      }),
    );
    expect(plan.intent).toBe("spec_check");
  });

  it("falls back to other when nothing matches", () => {
    const plan = buildPlan(baseInput({ message: "thanks, that helped" }));
    expect(plan.intent).toBe("other");
  });
});

describe("buildPlan — missingFacts", () => {
  it("flags 'manual' when there are no docIds and no drivePackId", () => {
    const plan = buildPlan(baseInput({ message: "what does F004 mean", docIds: [], equipment: { drivePackId: null } }));
    expect(plan.missingFacts).toContain("manual");
  });

  it("does not flag 'manual' when a drivePackId is present even with no docIds", () => {
    const plan = buildPlan(
      baseInput({ message: "what does F004 mean", docIds: [], equipment: { drivePackId: "durapulse_gs10" } }),
    );
    expect(plan.missingFacts).not.toContain("manual");
  });

  it("flags 'equipment_identity' when identity is unconfirmed and no model is known", () => {
    const plan = buildPlan(
      baseInput({ message: "what does F004 mean", equipment: { identityStatus: "candidate", model: null } }),
    );
    expect(plan.missingFacts).toContain("equipment_identity");
  });

  it("does not flag 'equipment_identity' when a model is known even without confirmation", () => {
    const plan = buildPlan(
      baseInput({ message: "what does F004 mean", equipment: { identityStatus: "candidate", model: "525" } }),
    );
    expect(plan.missingFacts).not.toContain("equipment_identity");
  });

  it("does not flag 'equipment_identity' when identity is user_confirmed", () => {
    const plan = buildPlan(
      baseInput({ message: "what does F004 mean", equipment: { identityStatus: "user_confirmed", model: null } }),
    );
    expect(plan.missingFacts).not.toContain("equipment_identity");
  });

  it("flags 'observation' for a spec_check intent with no observations", () => {
    const plan = buildPlan(baseInput({ message: "what is the maximum frequency range for this drive?" }));
    expect(plan.intent).toBe("spec_check");
    expect(plan.missingFacts).toContain("observation");
  });

  it("flags 'symptom_detail' for a vague symptom report with no code and no concrete symptom", () => {
    const plan = buildPlan(baseInput({ message: "something's wrong with the conveyor" }));
    expect(plan.intent).toBe("symptom");
    expect(plan.missingFacts).toContain("symptom_detail");
  });

  it("does not flag 'symptom_detail' when a concrete symptom is named", () => {
    const plan = buildPlan(baseInput({ message: "the conveyor is making a grinding noise" }));
    expect(plan.missingFacts).not.toContain("symptom_detail");
  });
});
