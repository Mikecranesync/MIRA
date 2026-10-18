/**
 * Runner tests for pure step routing.
 * Tests all outcomes, defaults, routes, and edge cases.
 */

import { describe, it, expect } from "bun:test";
import { nextStep } from "../diagnostic-plan/runner";
import { WorkflowTemplate, RunRecord } from "../diagnostic-plan/types";

describe("Diagnostic Plan Runner (nextStep)", () => {
  const simpleTemplate: WorkflowTemplate = {
    id: "simple",
    title: "Simple",
    steps: [
      { id: "step1", action: "IDENTIFY_ASSET" },
      { id: "step2", action: "READ_FAULT" },
      { id: "step3", action: "RECORD_FINDING" },
    ],
  };

  const routedTemplate: WorkflowTemplate = {
    id: "routed",
    title: "Routed",
    steps: [
      {
        id: "step1",
        action: "IDENTIFY_ASSET",
        on: {
          PASS: { next: "step2" },
          FAIL: { stop: "escalate" },
        },
      },
      {
        id: "step2",
        action: "READ_FAULT",
        on: {
          UNSAFE: { stop: "unsafe" },
          BLOCKED: { stop: "blocked" },
          INCONCLUSIVE: { stop: "escalate" },
        },
      },
      {
        id: "step3",
        action: "RECORD_FINDING",
        on: {
          PASS: { stop: "resolved" },
        },
      },
    ],
  };

  describe("Empty run", () => {
    it("should return first step for empty run", () => {
      const result = nextStep(simpleTemplate, null);
      expect(result.kind).toBe("step");
      if (result.kind === "step") {
        expect(result.step.id).toBe("step1");
      }
    });

    it("should return first step for empty records", () => {
      const run: RunRecord = { templateId: "simple", records: [] };
      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("step");
      if (result.kind === "step") {
        expect(result.step.id).toBe("step1");
      }
    });

    it("should return done for empty template", () => {
      const emptyTemplate: WorkflowTemplate = { id: "empty", title: "Empty", steps: [] };
      const result = nextStep(emptyTemplate, null);
      expect(result.kind).toBe("done");
    });
  });

  describe("Default outcomes (no explicit routing)", () => {
    it("PASS should default to next step", () => {
      const run: RunRecord = {
        templateId: "simple",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS", verification: "machine" }],
      };

      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("step");
      if (result.kind === "step") {
        expect(result.step.id).toBe("step2");
      }
    });

    it("FAIL should default to next step", () => {
      const run: RunRecord = {
        templateId: "simple",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "FAIL", verification: "machine" }],
      };

      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("step");
      if (result.kind === "step") {
        expect(result.step.id).toBe("step2");
      }
    });

    it("INCONCLUSIVE should default to escalate", () => {
      const run: RunRecord = {
        templateId: "simple",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "INCONCLUSIVE", verification: "machine" }],
      };

      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("escalate");
      }
    });

    it("BLOCKED should default to blocked", () => {
      const run: RunRecord = {
        templateId: "simple",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "BLOCKED", verification: "machine" }],
      };

      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("blocked");
      }
    });

    it("UNSAFE should default to unsafe", () => {
      const run: RunRecord = {
        templateId: "simple",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "UNSAFE", verification: "machine" }],
      };

      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("unsafe");
      }
    });
  });

  describe("Explicit routing", () => {
    it("should follow explicit PASS route", () => {
      const run: RunRecord = {
        templateId: "routed",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS", verification: "machine" }],
      };

      const result = nextStep(routedTemplate, run);
      expect(result.kind).toBe("step");
      if (result.kind === "step") {
        expect(result.step.id).toBe("step2");
      }
    });

    it("should follow explicit FAIL route to escalate", () => {
      const run: RunRecord = {
        templateId: "routed",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "FAIL", verification: "machine" }],
      };

      const result = nextStep(routedTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("escalate");
      }
    });

    it("should follow explicit UNSAFE route", () => {
      const run: RunRecord = {
        templateId: "routed",
        records: [
          { stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS", verification: "machine" },
          { stepId: "step2", action: "READ_FAULT", outcome: "UNSAFE", verification: "machine" },
        ],
      };

      const result = nextStep(routedTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("unsafe");
      }
    });

    it("should follow explicit BLOCKED route to blocked", () => {
      const run: RunRecord = {
        templateId: "routed",
        records: [
          { stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS", verification: "machine" },
          { stepId: "step2", action: "READ_FAULT", outcome: "BLOCKED", verification: "machine" },
        ],
      };

      const result = nextStep(routedTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("blocked");
      }
    });

    it("should follow explicit BLOCKED route to escalate", () => {
      const blockedEscalateTemplate: WorkflowTemplate = {
        id: "blocked-escalate",
        title: "Blocked Escalate",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              BLOCKED: { stop: "escalate" },
            },
          },
        ],
      };

      const run: RunRecord = {
        templateId: "blocked-escalate",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "BLOCKED", verification: "machine" }],
      };

      const result = nextStep(blockedEscalateTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("escalate");
      }
    });

    it("should follow explicit INCONCLUSIVE route to escalate", () => {
      const run: RunRecord = {
        templateId: "routed",
        records: [
          { stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS", verification: "machine" },
          { stepId: "step2", action: "READ_FAULT", outcome: "INCONCLUSIVE", verification: "machine" },
        ],
      };

      const result = nextStep(routedTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("escalate");
      }
    });

    it("should follow explicit PASS route to resolved", () => {
      const run: RunRecord = {
        templateId: "routed",
        records: [
          { stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS", verification: "machine" },
          { stepId: "step2", action: "READ_FAULT", outcome: "PASS", verification: "machine" },
          { stepId: "step3", action: "RECORD_FINDING", outcome: "PASS", verification: "self_reported", observed: "finding recorded" },
        ],
      };

      const result = nextStep(routedTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toBe("resolved");
      }
    });
  });

  describe("Unknown step", () => {
    it("should stop and escalate on unknown step", () => {
      const run: RunRecord = {
        templateId: "simple",
        records: [{ stepId: "unknown_step", action: "UNKNOWN_ACTION", outcome: "PASS", verification: "machine" }],
      };

      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toContain("unknown_step");
      }
    });
  });

  describe("Loop guard", () => {
    // A retry loop: step2 FAIL routes back to step2
    const loopTemplate: WorkflowTemplate = {
      id: "loop",
      title: "Loop",
      steps: [
        { id: "step1", action: "IDENTIFY_ASSET" },
        { id: "step2", action: "READ_FAULT", on: { FAIL: { next: "step2" } } },
        { id: "step3", action: "RECORD_FINDING" },
      ],
    };
    const identify = { stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS" as const, verification: "machine" as const };
    const readFail = { stepId: "step2", action: "READ_FAULT", outcome: "FAIL" as const, verification: "machine" as const };

    it("should allow the same step up to 3 times (retry offered after the 3rd)", () => {
      const run: RunRecord = { templateId: "loop", records: [identify, readFail, readFail, readFail] };
      const result = nextStep(loopTemplate, run);
      expect(result.kind).toBe("step");
      if (result.kind === "step") {
        expect(result.step.id).toBe("step2");
      }
    });

    it("should escalate on 4th occurrence of same step", () => {
      const run: RunRecord = { templateId: "loop", records: [identify, readFail, readFail, readFail, readFail] };
      const result = nextStep(loopTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toContain("more than 3");
      }
    });
  });

  describe("Done state", () => {
    it("should return done when at last step and PASS", () => {
      const run: RunRecord = {
        templateId: "simple",
        records: [
          { stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS", verification: "machine" },
          { stepId: "step2", action: "READ_FAULT", outcome: "PASS", verification: "machine" },
          { stepId: "step3", action: "RECORD_FINDING", outcome: "PASS", verification: "self_reported", observed: "finding recorded" },
        ],
      };

      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("done");
    });
  });

  describe("Template ID mismatch", () => {
    it("should stop and escalate on template ID mismatch", () => {
      const run: RunRecord = {
        templateId: "other_template",
        records: [{ stepId: "step1", action: "IDENTIFY_ASSET", outcome: "PASS", verification: "machine" }],
      };

      const result = nextStep(simpleTemplate, run);
      expect(result.kind).toBe("stop");
      if (result.kind === "stop") {
        expect(result.reason).toContain("templateId");
      }
    });
  });
});
