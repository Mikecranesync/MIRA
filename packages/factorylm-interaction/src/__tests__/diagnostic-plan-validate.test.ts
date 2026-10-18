/**
 * Validation tests for diagnostic plan templates.
 * Tests all 6 validation rules with explicit bad templates.
 */

import { describe, it, expect } from "bun:test";
import { validateTemplate, validateLibrary } from "../diagnostic-plan/validate";
import type { ActionDefinition } from "../diagnostic-plan/types";
import { LIBRARY } from "../diagnostic-plan/library";
import { MOTOR_WONT_START, VFD_FAULT, SENSOR_FAULT } from "../diagnostic-plan/templates";

describe("Diagnostic Plan Validation", () => {
  describe("R1: Action IDs exist", () => {
    it("should accept template with all valid actions", () => {
      const result = validateTemplate(MOTOR_WONT_START, LIBRARY);
      expect(result.ok).toBe(true);
      const r1Errors = result.errors.filter((e) => e.rule === "R1");
      expect(r1Errors).toHaveLength(0);
    });

    it("should fail on non-existent action", () => {
      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [{ id: "step1", action: "NONEXISTENT_ACTION" }],
      };

      const result = validateTemplate(badTemplate, LIBRARY);
      expect(result.ok).toBe(false);
      const r1Errors = result.errors.filter((e) => e.rule === "R1");
      expect(r1Errors.length).toBeGreaterThan(0);
      expect(r1Errors[0].message).toContain("not found in library");
    });
  });

  describe("R2: Technician steps have requiresReport", () => {
    it("should fail when technician step lacks requiresReport", () => {
      // Create a test library with a technician action that has requiresReport: false
      const badAction = {
        id: "BAD_TECH_ACTION",
        title: "Bad Tech Action",
        group: "identify" as const,
        executor: "technician" as const,
        verification: "self_reported" as const,
        requiresReport: false,
        inputs: {},
        outputs: {},
      } satisfies ActionDefinition;

      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [{ id: "step1", action: "BAD_TECH_ACTION" }],
      };

      const result = validateTemplate(badTemplate, [badAction]);
      const r2Errors = result.errors.filter((e) => e.rule === "R2");
      expect(r2Errors.length).toBeGreaterThan(0);
      expect(r2Errors[0].message).toContain("requiresReport");
    });

    it("should accept technician step with requiresReport", () => {
      const template = {
        id: "good_template",
        title: "Good Template",
        steps: [{ id: "step1", action: "OBSERVE_STATE" }],
      };

      const result = validateTemplate(template, LIBRARY);
      const r2Errors = result.errors.filter((e) => e.rule === "R2");
      expect(r2Errors).toHaveLength(0);
    });
  });

  describe("R3: UNSAFE outcome routes to stop:unsafe", () => {
    it("should fail when UNSAFE routes to next", () => {
      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              UNSAFE: { next: "step2" },
            },
          },
          { id: "step2", action: "READ_FAULT" },
        ],
      };

      const result = validateTemplate(badTemplate, LIBRARY);
      const r3Errors = result.errors.filter((e) => e.rule === "R3");
      expect(r3Errors.length).toBeGreaterThan(0);
      expect(r3Errors[0].message).toContain("UNSAFE");
    });

    it("should accept UNSAFE routing to stop:unsafe", () => {
      const template = {
        id: "good_template",
        title: "Good Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              UNSAFE: { stop: "unsafe" as const },
            },
          },
        ],
      };

      const result = validateTemplate(template, LIBRARY);
      const r3Errors = result.errors.filter((e) => e.rule === "R3");
      expect(r3Errors).toHaveLength(0);
    });

    it("should fail when UNSAFE routes to wrong stop value", () => {
      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              UNSAFE: { stop: "blocked" as const },
            },
          },
        ],
      };

      const result = validateTemplate(badTemplate, LIBRARY);
      const r3Errors = result.errors.filter((e) => e.rule === "R3");
      expect(r3Errors.length).toBeGreaterThan(0);
      expect(r3Errors[0].message).toContain("stop:unsafe");
    });
  });

  describe("R4: BLOCKED outcome never routes to next", () => {
    it("should fail when BLOCKED routes to next", () => {
      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              BLOCKED: { next: "step2" },
            },
          },
          { id: "step2", action: "READ_FAULT" },
        ],
      };

      const result = validateTemplate(badTemplate, LIBRARY);
      const r4Errors = result.errors.filter((e) => e.rule === "R4");
      expect(r4Errors.length).toBeGreaterThan(0);
      expect(r4Errors[0].message).toContain("BLOCKED");
    });

    it("should accept BLOCKED routing to stop:blocked", () => {
      const template = {
        id: "good_template",
        title: "Good Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              BLOCKED: { stop: "blocked" as const },
            },
          },
        ],
      };

      const result = validateTemplate(template, LIBRARY);
      const r4Errors = result.errors.filter((e) => e.rule === "R4");
      expect(r4Errors).toHaveLength(0);
    });

    it("should accept BLOCKED routing to stop:escalate", () => {
      const template = {
        id: "good_template",
        title: "Good Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              BLOCKED: { stop: "escalate" as const },
            },
          },
        ],
      };

      const result = validateTemplate(template, LIBRARY);
      const r4Errors = result.errors.filter((e) => e.rule === "R4");
      expect(r4Errors).toHaveLength(0);
    });

    it("should fail when BLOCKED routes to wrong stop value", () => {
      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              BLOCKED: { stop: "unsafe" as const },
            },
          },
        ],
      };

      const result = validateTemplate(badTemplate, LIBRARY);
      const r4Errors = result.errors.filter((e) => e.rule === "R4");
      expect(r4Errors.length).toBeGreaterThan(0);
      expect(r4Errors[0].message).toContain("stop:blocked or stop:escalate");
    });
  });

  describe("R5: Next targets exist and all steps reachable", () => {
    it("should fail on non-existent next target", () => {
      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              PASS: { next: "nonexistent_step" },
            },
          },
        ],
      };

      const result = validateTemplate(badTemplate, LIBRARY);
      const r5Errors = result.errors.filter((e) => e.rule === "R5");
      expect(r5Errors.length).toBeGreaterThan(0);
      expect(r5Errors[0].message).toContain("does not exist");
    });

    it("should fail on unreachable step", () => {
      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              PASS: { next: "step3" },
              FAIL: { stop: "escalate" as const },
            },
          },
          { id: "step2", action: "READ_FAULT" },
          { id: "step3", action: "RECORD_FINDING" },
        ],
      };

      const result = validateTemplate(badTemplate, LIBRARY);
      const r5Errors = result.errors.filter((e) => e.rule === "R5");
      expect(r5Errors.length).toBeGreaterThan(0);
      expect(r5Errors[0].message).toContain("unreachable");
    });

    it("should accept valid routing chain", () => {
      const template = {
        id: "good_template",
        title: "Good Template",
        steps: [
          {
            id: "step1",
            action: "IDENTIFY_ASSET",
            on: {
              PASS: { next: "step2" },
            },
          },
          { id: "step2", action: "READ_FAULT" },
        ],
      };

      const result = validateTemplate(template, LIBRARY);
      const r5Errors = result.errors.filter((e) => e.rule === "R5");
      expect(r5Errors).toHaveLength(0);
    });
  });

  describe("R6: Hazard step before technician measurement", () => {
    it("should fail when technician measurement without hazard", () => {
      const badTemplate = {
        id: "bad_template",
        title: "Bad Template",
        steps: [{ id: "step1", action: "MEASURE" }],
      };

      const result = validateTemplate(badTemplate, LIBRARY);
      const r6Errors = result.errors.filter((e) => e.rule === "R6");
      expect(r6Errors.length).toBeGreaterThan(0);
      expect(r6Errors[0].message).toContain("hazard");
    });

    it("should accept hazard before measurement", () => {
      const template = {
        id: "good_template",
        title: "Good Template",
        steps: [
          { id: "step1", action: "ASSESS_HAZARDS" },
          { id: "step2", action: "MEASURE" },
        ],
      };

      const result = validateTemplate(template, LIBRARY);
      const r6Errors = result.errors.filter((e) => e.rule === "R6");
      expect(r6Errors).toHaveLength(0);
    });
  });

  describe("Shipped templates", () => {
    it("MOTOR_WONT_START should validate clean", () => {
      const result = validateTemplate(MOTOR_WONT_START, LIBRARY);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("VFD_FAULT should validate clean", () => {
      const result = validateTemplate(VFD_FAULT, LIBRARY);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("SENSOR_FAULT should validate clean", () => {
      const result = validateTemplate(SENSOR_FAULT, LIBRARY);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Library validation", () => {
    it("should validate library for unique IDs", () => {
      const result = validateLibrary(LIBRARY);
      expect(result.ok).toBe(true);
    });

    it("should fail on duplicate IDs", () => {
      const dupAction = {
        id: "DUP",
        title: "A",
        group: "identify" as const,
        executor: "mira" as const,
        verification: "machine" as const,
        requiresReport: false,
        inputs: {},
        outputs: {},
      } satisfies ActionDefinition;

      const badLibrary: ActionDefinition[] = [dupAction, { ...dupAction, title: "B" }];

      const result = validateLibrary(badLibrary);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
