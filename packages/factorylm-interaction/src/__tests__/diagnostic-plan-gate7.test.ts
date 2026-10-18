/**
 * Regression tests for the Gate-7 round 1 findings on PR #4500:
 * F1: an empty run belonging to another template must stop, never start.
 * F2: a step may not run under a different executor than its action declares.
 * Round 2: R6 deliberately gates technician observation as well as measurement.
 */

import { describe, it, expect } from "bun:test";
import { nextStep } from "../diagnostic-plan/runner";
import { validateTemplate } from "../diagnostic-plan/validate";
import { LIBRARY } from "../diagnostic-plan/library";
import { VFD_FAULT } from "../diagnostic-plan/templates";
import type { WorkflowTemplate } from "../diagnostic-plan/types";

describe("Gate-7 F1: run ownership is checked before the first step", () => {
  it("stops an empty run whose templateId belongs to another template", () => {
    const result = nextStep(VFD_FAULT, { templateId: "motor_wont_start", records: [] });
    expect(result.kind).toBe("stop");
  });

  it("control: an empty run for this template still gets the first step", () => {
    const result = nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records: [] });
    expect(result.kind).toBe("step");
    if (result.kind === "step") expect(result.step.id).toBe(VFD_FAULT.steps[0].id);
  });

  it("control: a null run still gets the first step", () => {
    expect(nextStep(VFD_FAULT, null).kind).toBe("step");
  });
});

describe("Gate-7 F2: step executor must match the action's executor (R7)", () => {
  const base: WorkflowTemplate = {
    id: "executor_check",
    title: "Executor check",
    steps: [
      { id: "s1", action: "IDENTIFY_ASSET", executor: "mira" },
      { id: "s2", action: "ASSESS_HAZARDS", executor: "technician" },
      { id: "s3", action: "READ_FAULT", executor: "mira" },
    ],
  };

  it("rejects a technician executor on a MIRA action", () => {
    const bad: WorkflowTemplate = {
      ...base,
      steps: [base.steps[0], base.steps[1], { id: "s3", action: "READ_FAULT", executor: "technician" }],
    };
    const result = validateTemplate(bad, LIBRARY);
    expect(result.errors.some((e) => e.rule === "R7" && e.stepId === "s3")).toBe(true);
  });

  it("rejects a MIRA executor on a technician action", () => {
    const bad: WorkflowTemplate = {
      ...base,
      steps: [base.steps[0], { id: "s2", action: "ASSESS_HAZARDS", executor: "mira" }, base.steps[2]],
    };
    const result = validateTemplate(bad, LIBRARY);
    expect(result.errors.some((e) => e.rule === "R7" && e.stepId === "s2")).toBe(true);
  });

  it("control: matching executors validate clean", () => {
    expect(validateTemplate(base, LIBRARY).errors).toEqual([]);
  });

  it("control: an omitted step executor inherits the action's and validates clean", () => {
    const inherit: WorkflowTemplate = { ...base, steps: base.steps.map(({ id, action }) => ({ id, action })) };
    expect(validateTemplate(inherit, LIBRARY).errors).toEqual([]);
  });
});

describe("Gate-7 round 2: R6 gates technician observation, not only measurement", () => {
  it("rejects a technician OBSERVE_STATE before the hazard step", () => {
    const t: WorkflowTemplate = {
      id: "observe_first",
      title: "Observe first",
      steps: [{ id: "s1", action: "OBSERVE_STATE" }, { id: "s2", action: "ASSESS_HAZARDS" }],
    };
    expect(validateTemplate(t, LIBRARY).errors.some((e) => e.rule === "R6" && e.stepId === "s1")).toBe(true);
  });

  it("control: a MIRA identify step before the hazard step is allowed", () => {
    const t: WorkflowTemplate = {
      id: "identify_first",
      title: "Identify first",
      steps: [{ id: "s1", action: "IDENTIFY_ASSET" }, { id: "s2", action: "ASSESS_HAZARDS" }],
    };
    expect(validateTemplate(t, LIBRARY).errors.filter((e) => e.rule === "R6")).toEqual([]);
  });
});

describe("Gate-7 round 3: a record must match its step's action", () => {
  const firstStep = VFD_FAULT.steps[0];

  it("stops when the last record's action differs from the template step's action", () => {
    const result = nextStep(VFD_FAULT, {
      templateId: VFD_FAULT.id,
      records: [{ stepId: firstStep.id, action: "MEASURE", outcome: "PASS", verification: "self_reported" }],
    });
    expect(result.kind).toBe("stop");
  });

  it("control: a record whose action matches advances to the next step", () => {
    const result = nextStep(VFD_FAULT, {
      templateId: VFD_FAULT.id,
      records: [{ stepId: firstStep.id, action: firstStep.action, outcome: "PASS", verification: "machine" }],
    });
    expect(result.kind).toBe("step");
    if (result.kind === "step") expect(result.step.id).toBe(VFD_FAULT.steps[1].id);
  });
});
