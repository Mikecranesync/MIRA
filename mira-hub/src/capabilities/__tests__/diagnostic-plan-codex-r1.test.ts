/**
 * Regression tests for Codex review round 1 on PR #4500:
 * F1: a failed safety step stops the run; it never advances.
 * F2: the runner replays the whole history and checks verification and named attestation.
 * F3: the hazard-first rule follows routes, not array order.
 */

import { describe, it, expect } from "vitest";
import { nextStep } from "../diagnostic-plan/runner";
import { validateTemplate } from "../diagnostic-plan/validate";
import { LIBRARY } from "../diagnostic-plan/library";
import { MOTOR_WONT_START, VFD_FAULT, SENSOR_FAULT } from "../diagnostic-plan/templates";
import type { ActionDefinition, StepRecord, WorkflowTemplate } from "../diagnostic-plan/types";

const byId = new Map<string, ActionDefinition>(LIBRARY.map((a) => [a.id, a]));

/** A well-formed PASS record for template step `index`. */
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

function historyTo(t: WorkflowTemplate, index: number): StepRecord[] {
  return t.steps.slice(0, index).map((_, i) => pass(t, i));
}

describe("Codex F1: a failed safety step stops the run", () => {
  for (const t of [MOTOR_WONT_START, VFD_FAULT, SENSOR_FAULT]) {
    t.steps.forEach((step, i) => {
      if (byId.get(step.action)?.group !== "safety") return;
      it(`${t.id} ${step.id} ${step.action} FAIL stops`, () => {
        const records = [...historyTo(t, i), { ...pass(t, i), outcome: "FAIL" as const }];
        expect(nextStep(t, { templateId: t.id, records }).kind).toBe("stop");
      });
    });
  }

  it("validator rejects a safety step whose FAIL route advances (R9)", () => {
    const t: WorkflowTemplate = {
      id: "safety_fail_next",
      title: "Safety FAIL advances",
      steps: [
        { id: "s1", action: "IDENTIFY_ASSET" },
        { id: "s2", action: "ASSESS_HAZARDS", on: { FAIL: { next: "s3" } } },
        { id: "s3", action: "MEASURE" },
      ],
    };
    expect(validateTemplate(t, LIBRARY).errors.some((e) => e.rule === "R9" && e.stepId === "s2")).toBe(true);
  });
});

describe("Codex F2: the runner replays the full history", () => {
  const iso = VFD_FAULT.steps.findIndex((s) => s.action === "CONFIRM_ISOLATION");

  it("stops on a lone fabricated isolation record", () => {
    const records = [pass(VFD_FAULT, iso)];
    expect(nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records }).kind).toBe("stop");
  });

  it("control: the complete history with a named attester advances", () => {
    const result = nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records: historyTo(VFD_FAULT, iso + 1) });
    expect(result.kind).toBe("step");
    if (result.kind === "step") expect(result.step.id).toBe(VFD_FAULT.steps[iso + 1].id);
  });

  it("stops when the isolation record's verification is wrong", () => {
    const records = historyTo(VFD_FAULT, iso + 1);
    records[iso] = { ...records[iso], verification: "self_reported" };
    expect(nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records }).kind).toBe("stop");
  });

  it("stops when the isolation record names no attester", () => {
    const records = historyTo(VFD_FAULT, iso + 1);
    const { reportedBy: _dropped, ...rest } = records[iso];
    records[iso] = rest;
    expect(nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records }).kind).toBe("stop");
  });

  it("stops when a record arrives after the run already stopped", () => {
    const hazard = VFD_FAULT.steps.findIndex((s) => s.action === "ASSESS_HAZARDS");
    const records = [...historyTo(VFD_FAULT, hazard), { ...pass(VFD_FAULT, hazard), outcome: "UNSAFE" as const }, pass(VFD_FAULT, hazard + 1)];
    expect(nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records }).kind).toBe("stop");
  });
});

describe("Codex F3: hazard-first follows routes, not array order", () => {
  it("rejects a route that jumps past the hazard step to a technician measurement", () => {
    const t: WorkflowTemplate = {
      id: "bypass",
      title: "Bypass",
      steps: [
        { id: "s1", action: "IDENTIFY_ASSET", on: { PASS: { next: "s3" } } },
        { id: "s2", action: "ASSESS_HAZARDS" },
        { id: "s3", action: "MEASURE" },
      ],
    };
    expect(validateTemplate(t, LIBRARY).errors.some((e) => e.rule === "R6" && e.stepId === "s3")).toBe(true);
  });

  it("control: every route to the measurement passes the hazard step", () => {
    const t: WorkflowTemplate = {
      id: "through",
      title: "Through",
      steps: [
        { id: "s1", action: "IDENTIFY_ASSET", on: { PASS: { next: "s2" } } },
        { id: "s2", action: "ASSESS_HAZARDS" },
        { id: "s3", action: "MEASURE" },
      ],
    };
    expect(validateTemplate(t, LIBRARY).errors.filter((e) => e.rule === "R6")).toEqual([]);
  });
});
