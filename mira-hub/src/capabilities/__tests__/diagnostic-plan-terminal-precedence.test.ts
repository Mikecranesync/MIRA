/**
 * Regression tests for Codex review round 1 on PR #4510, F1: a terminal outcome
 * (UNSAFE, BLOCKED, or a safety step's FAIL/INCONCLUSIVE) keeps its own stop reason
 * even when the record is otherwise incomplete. A missing report, attester or
 * mismatched verification must never turn "unsafe" into a generic record error.
 */

import { describe, it, expect } from "vitest";
import { nextStep } from "../diagnostic-plan/runner";
import { LIBRARY } from "../diagnostic-plan/library";
import { VFD_FAULT } from "../diagnostic-plan/templates";
import type { ActionDefinition, ActionOutcome, StepRecord, WorkflowTemplate } from "../diagnostic-plan/types";

const byId = new Map<string, ActionDefinition>(LIBRARY.map((a) => [a.id, a]));

function complete(t: WorkflowTemplate, index: number, outcome: ActionOutcome = "PASS"): StepRecord {
  const step = t.steps[index];
  const action = byId.get(step.action)!;
  return {
    stepId: step.id,
    action: step.action,
    outcome,
    verification: action.verification,
    ...(action.requiresReport ? { observed: "reported" } : {}),
    ...(action.attestation ? { reportedBy: "J. Smith" } : {}),
  };
}

const hazard = VFD_FAULT.steps.findIndex((s) => s.action === "ASSESS_HAZARDS");
const isolation = VFD_FAULT.steps.findIndex((s) => s.action === "CONFIRM_ISOLATION");
const upTo = (n: number) => VFD_FAULT.steps.slice(0, n).map((_, i) => complete(VFD_FAULT, i));
const run = (records: StepRecord[]) => nextStep(VFD_FAULT, { templateId: VFD_FAULT.id, records });

describe("Codex #4510 F1: terminal outcomes keep their stop reason on incomplete records", () => {
  it("precondition: the hazard step needs a report and the isolation step a named attester", () => {
    expect(byId.get("ASSESS_HAZARDS")?.requiresReport).toBe(true);
    expect(byId.get("CONFIRM_ISOLATION")?.attestation).toBe("named_person");
  });

  it("UNSAFE hazard assessment with no report stops as unsafe", () => {
    const { observed: _dropped, ...noReport } = complete(VFD_FAULT, hazard, "UNSAFE");
    expect(run([...upTo(hazard), noReport])).toEqual({ kind: "stop", reason: "unsafe", atStep: VFD_FAULT.steps[hazard].id });
  });

  it("UNSAFE isolation with no attester stops as unsafe", () => {
    const { reportedBy: _dropped, ...noAttester } = complete(VFD_FAULT, isolation, "UNSAFE");
    expect(run([...upTo(isolation), noAttester])).toEqual({ kind: "stop", reason: "unsafe", atStep: VFD_FAULT.steps[isolation].id });
  });

  it("UNSAFE with a mismatched verification still stops as unsafe", () => {
    const record = { ...complete(VFD_FAULT, hazard, "UNSAFE"), verification: "machine" as const };
    expect(run([...upTo(hazard), record])).toMatchObject({ kind: "stop", reason: "unsafe" });
  });

  it("BLOCKED hazard assessment with no report stops as blocked", () => {
    const { observed: _dropped, ...noReport } = complete(VFD_FAULT, hazard, "BLOCKED");
    expect(run([...upTo(hazard), noReport])).toMatchObject({ kind: "stop", reason: "blocked" });
  });

  it("a failed safety step with no report stops as blocked, never as a report error", () => {
    const { observed: _dropped, ...noReport } = complete(VFD_FAULT, hazard, "FAIL");
    expect(run([...upTo(hazard), noReport])).toMatchObject({ kind: "stop", reason: "blocked" });
  });

  it("control: a PASS with no report still stops for the missing report", () => {
    const { observed: _dropped, ...noReport } = complete(VFD_FAULT, hazard, "PASS");
    const result = run([...upTo(hazard), noReport]);
    expect(result.kind).toBe("stop");
    expect(result).not.toMatchObject({ reason: "unsafe" });
    expect((result as { reason: string }).reason).toMatch(/report/);
  });

  it("control: an UNSAFE record for the wrong action is still a sequence error, not trusted", () => {
    const record = { ...complete(VFD_FAULT, hazard, "UNSAFE"), action: "MEASURE" };
    expect((run([...upTo(hazard), record]) as { reason: string }).reason).toMatch(/does not match/);
  });
});
