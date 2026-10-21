/**
 * Regression tests for Codex review round 2 on PR #4500:
 * F1: a step whose action requires a report needs a non-empty `observed`.
 * F2: only ASSESS_HAZARDS satisfies the hazard-first rule; isolation does not.
 * F3: a failed or inconclusive safety step can never end as "resolved".
 * F5: reachability follows the runner's routing (a safety FAIL stops).
 */

import { describe, it, expect } from "vitest";
import { nextStep } from "../diagnostic-plan/runner";
import { validateTemplate } from "../diagnostic-plan/validate";
import { LIBRARY } from "../diagnostic-plan/library";
import { VFD_FAULT } from "../diagnostic-plan/templates";
import type { ActionDefinition, StepRecord, WorkflowTemplate } from "../diagnostic-plan/types";

const byId = new Map<string, ActionDefinition>(LIBRARY.map((a) => [a.id, a]));

function pass(t: WorkflowTemplate, index: number): StepRecord {
  const step = t.steps[index];
  const action = byId.get(step.action)!;
  return {
    stepId: step.id,
    action: step.action,
    outcome: "PASS",
    verification: action.verification,
    ...(action.requiresReport ? { observed: "reported" } : {}),
    ...(action.attestation ? { reportedBy: "J. Smith" } : {}),
  };
}

describe("Codex r2 F1: report-required steps need a report", () => {
  const hazard = VFD_FAULT.steps.findIndex((s) => s.action === "ASSESS_HAZARDS");
  const history = VFD_FAULT.steps.slice(0, hazard + 1).map((_, i) => pass(VFD_FAULT, i));

  it("stops when the hazard assessment record has no report", () => {
    const records = [...history];
    const { observed: _dropped, ...rest } = records[hazard];
    records[hazard] = rest;
    expect(nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records }).kind).toBe("stop");
  });

  it("stops when the report is blank", () => {
    const records = [...history];
    records[hazard] = { ...records[hazard], observed: "   " };
    expect(nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records }).kind).toBe("stop");
  });

  it("control: a hazard record with a report advances", () => {
    expect(nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records: history }).kind).toBe("step");
  });
});

describe("Codex r2 F2: isolation is not a hazard assessment", () => {
  it("rejects CONFIRM_ISOLATION then MEASURE with no ASSESS_HAZARDS (R6)", () => {
    const t: WorkflowTemplate = {
      id: "isolation_only",
      title: "Isolation only",
      steps: [{ id: "s1", action: "CONFIRM_ISOLATION" }, { id: "s2", action: "MEASURE" }],
    };
    expect(validateTemplate(t, LIBRARY).errors.some((e) => e.rule === "R6" && e.stepId === "s2")).toBe(true);
  });
});

describe("Codex r2 F3: a failed safety step never resolves", () => {
  const resolvedOn = (outcome: "FAIL" | "INCONCLUSIVE"): WorkflowTemplate => ({
    id: `safety_${outcome}_resolved`,
    title: "Safety resolved",
    steps: [{ id: "s1", action: "IDENTIFY_ASSET" }, { id: "s2", action: "ASSESS_HAZARDS", on: { [outcome]: { stop: "resolved" } } }],
  });

  for (const outcome of ["FAIL", "INCONCLUSIVE"] as const) {
    it(`validator rejects ${outcome}→resolved on a safety step (R9)`, () => {
      const t = resolvedOn(outcome);
      expect(validateTemplate(t, LIBRARY).errors.some((e) => e.rule === "R9" && e.stepId === "s2")).toBe(true);
    });

    it(`runner never returns resolved for a safety ${outcome}, even unvalidated`, () => {
      const t = resolvedOn(outcome);
      const records = [pass(t, 0), { ...pass(t, 1), outcome }];
      const result = nextStep(t, { templateId: t.id, records });
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") expect(result.reason).not.toBe("resolved");
    });
  }
});

describe("Codex r2 F5: reachability follows runtime routing", () => {
  it("flags a step that only a safety FAIL default would have reached (R5)", () => {
    const t: WorkflowTemplate = {
      id: "dead_after_safety",
      title: "Dead after safety",
      steps: [{ id: "s1", action: "ASSESS_HAZARDS", on: { PASS: { stop: "resolved" } } }, { id: "s2", action: "READ_FAULT" }],
    };
    expect(validateTemplate(t, LIBRARY).errors.some((e) => e.rule === "R5" && e.stepId === "s2")).toBe(true);
  });
});

describe("Codex r3 F2: UNSAFE and BLOCKED never end as resolved, even unvalidated", () => {
  for (const outcome of ["UNSAFE", "BLOCKED"] as const) {
    it(`runner ignores an ${outcome}→resolved route`, () => {
      const t: WorkflowTemplate = {
        id: `${outcome}_resolved`,
        title: "Resolved",
        steps: [{ id: "s1", action: "IDENTIFY_ASSET", on: { [outcome]: { stop: "resolved" } } }],
      };
      const result = nextStep(t, { templateId: t.id, records: [{ ...pass(t, 0), outcome }] });
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") expect(result.reason).toBe(outcome === "UNSAFE" ? "unsafe" : "blocked");
    });
  }

  it("control: BLOCKED→escalate is still honoured", () => {
    const t: WorkflowTemplate = { id: "b_esc", title: "B", steps: [{ id: "s1", action: "IDENTIFY_ASSET", on: { BLOCKED: { stop: "escalate" } } }] };
    const result = nextStep(t, { templateId: t.id, records: [{ ...pass(t, 0), outcome: "BLOCKED" }] });
    expect(result.kind === "stop" && result.reason).toBe("escalate");
  });
});
