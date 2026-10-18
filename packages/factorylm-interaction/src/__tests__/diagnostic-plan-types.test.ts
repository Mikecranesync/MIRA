/**
 * Type system validation for diagnostic plans.
 */

import { describe, it, expect } from "bun:test";
import type {
  ActionOutcome,
  Verification,
  Executor,
  ActionDefinition,
  TemplateStep,
  WorkflowTemplate,
  StepRecord,
  RunRecord,
  NextStepResult,
} from "../diagnostic-plan/types";

describe("Diagnostic Plan Types", () => {
  it("should construct valid ActionDefinition", () => {
    const action: ActionDefinition = {
      id: "TEST_ACTION",
      title: "Test Action",
      group: "identify",
      executor: "mira",
      verification: "machine",
      requiresReport: false,
      inputs: { input1: {} },
      outputs: { output1: "" },
    };

    expect(action.id).toBe("TEST_ACTION");
    expect(action.executor).toBe("mira");
    expect(action.verification).toBe("machine");
  });

  it("should construct valid TemplateStep with routing", () => {
    const step: TemplateStep = {
      id: "step1",
      action: "IDENTIFY_ASSET",
      executor: "mira",
      on: {
        PASS: { next: "step2" },
        FAIL: { stop: "escalate" },
      },
    };

    expect(step.id).toBe("step1");
    expect(step.on?.PASS).toEqual({ next: "step2" });
    expect(step.on?.FAIL).toEqual({ stop: "escalate" });
  });

  it("should construct valid WorkflowTemplate", () => {
    const template: WorkflowTemplate = {
      id: "test_workflow",
      title: "Test Workflow",
      steps: [
        { id: "step1", action: "IDENTIFY_ASSET" },
        { id: "step2", action: "READ_FAULT" },
      ],
    };

    expect(template.id).toBe("test_workflow");
    expect(template.steps).toHaveLength(2);
  });

  it("should construct valid StepRecord", () => {
    const record: StepRecord = {
      stepId: "step1",
      action: "IDENTIFY_ASSET",
      outcome: "PASS",
      verification: "machine",
      observed: "asset found",
    };

    expect(record.outcome).toBe("PASS");
    expect(record.verification).toBe("machine");
  });

  it("should construct valid RunRecord", () => {
    const run: RunRecord = {
      templateId: "test_workflow",
      records: [
        {
          stepId: "step1",
          action: "IDENTIFY_ASSET",
          outcome: "PASS",
          verification: "machine",
        },
      ],
    };

    expect(run.records).toHaveLength(1);
    expect(run.records[0].outcome).toBe("PASS");
  });

  it("should support all ActionOutcome variants", () => {
    const outcomes: ActionOutcome[] = ["PASS", "FAIL", "INCONCLUSIVE", "BLOCKED", "UNSAFE"];
    expect(outcomes).toHaveLength(5);
  });

  it("should support all Verification variants", () => {
    const verifications: Verification[] = ["machine", "self_reported", "attested"];
    expect(verifications).toHaveLength(3);
  });

  it("should support all Executor variants", () => {
    const executors: Executor[] = ["mira", "technician"];
    expect(executors).toHaveLength(2);
  });

  it("should support NextStepResult variants", () => {
    const results: NextStepResult[] = [
      { kind: "step", step: { id: "s1", action: "A1" } },
      { kind: "stop", reason: "unsafe" },
      { kind: "done" },
    ];

    expect(results).toHaveLength(3);
  });

  it("should support safety wording on ActionDefinition", () => {
    const action: ActionDefinition = {
      id: "ASSESS_HAZARDS",
      title: "Assess Hazards",
      group: "safety",
      executor: "technician",
      verification: "self_reported",
      requiresReport: true,
      inputs: {},
      outputs: {},
      safetyWording: "PENDING_R3",
    };

    expect(action.safetyWording).toBe("PENDING_R3");
  });

  it("should support attestation on ActionDefinition", () => {
    const action: ActionDefinition = {
      id: "CONFIRM_ISOLATION",
      title: "Confirm Isolation",
      group: "safety",
      executor: "technician",
      verification: "attested",
      requiresReport: true,
      attestation: "named_person",
      inputs: {},
      outputs: {},
    };

    expect(action.attestation).toBe("named_person");
  });

  it("should support appliesTo in WorkflowTemplate", () => {
    const template: WorkflowTemplate = {
      id: "motor_test",
      title: "Motor Test",
      appliesTo: ["AC_Motor", "DC_Motor"],
      steps: [{ id: "step1", action: "IDENTIFY_ASSET" }],
    };

    expect(template.appliesTo).toContain("AC_Motor");
    expect(template.appliesTo).toHaveLength(2);
  });
});
