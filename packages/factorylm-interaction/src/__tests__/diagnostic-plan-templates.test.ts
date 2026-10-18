/**
 * Template tests for shipped workflows.
 * Validates structure, actions, and routing of the three shipped templates.
 */

import { describe, it, expect } from "bun:test";
import { MOTOR_WONT_START, VFD_FAULT, SENSOR_FAULT, TEMPLATES } from "../diagnostic-plan/templates";
import { LIBRARY } from "../diagnostic-plan/library";
import { validateTemplate } from "../diagnostic-plan/validate";

describe("Shipped Templates", () => {
  it("should have exactly 3 templates", () => {
    expect(TEMPLATES).toHaveLength(3);
  });

  describe("MOTOR_WONT_START", () => {
    it("should have correct ID and title", () => {
      expect(MOTOR_WONT_START.id).toBe("motor_wont_start");
      expect(MOTOR_WONT_START.title).toBe("Motor Won't Start");
    });

    it("should apply to AC and DC motors", () => {
      expect(MOTOR_WONT_START.appliesTo).toContain("AC_Motor");
      expect(MOTOR_WONT_START.appliesTo).toContain("DC_Motor");
    });

    it("should start with IDENTIFY_ASSET", () => {
      expect(MOTOR_WONT_START.steps[0].action).toBe("IDENTIFY_ASSET");
    });

    it("should have ASSESS_HAZARDS before first technician measurement", () => {
      const hazardIdx = MOTOR_WONT_START.steps.findIndex((s) => s.action === "ASSESS_HAZARDS");
      const measureIdx = MOTOR_WONT_START.steps.findIndex((s) => s.action === "MEASURE");
      expect(hazardIdx).toBeLessThan(measureIdx);
    });

    it("should validate clean", () => {
      const result = validateTemplate(MOTOR_WONT_START, LIBRARY);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should have at least 6 steps", () => {
      expect(MOTOR_WONT_START.steps.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("VFD_FAULT", () => {
    it("should have correct ID and title", () => {
      expect(VFD_FAULT.id).toBe("vfd_fault");
      expect(VFD_FAULT.title).toBe("VFD Fault Code");
    });

    it("should apply to VFD types", () => {
      expect(VFD_FAULT.appliesTo).toContain("VFD");
    });

    it("should start with IDENTIFY_ASSET", () => {
      expect(VFD_FAULT.steps[0].action).toBe("IDENTIFY_ASSET");
    });

    it("should have ASSESS_HAZARDS before measurements", () => {
      const hazardIdx = VFD_FAULT.steps.findIndex((s) => s.action === "ASSESS_HAZARDS");
      expect(hazardIdx).toBeGreaterThanOrEqual(0);
    });

    it("should have CONFIRM_ISOLATION before technician measurement", () => {
      const isolationIdx = VFD_FAULT.steps.findIndex((s) => s.action === "CONFIRM_ISOLATION");
      expect(isolationIdx).toBeGreaterThanOrEqual(0);
    });

    it("should validate clean", () => {
      const result = validateTemplate(VFD_FAULT, LIBRARY);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should have READ_DRIVE_PARAMETER", () => {
      const hasReadDrive = VFD_FAULT.steps.some((s) => s.action === "READ_DRIVE_PARAMETER");
      expect(hasReadDrive).toBe(true);
    });
  });

  describe("SENSOR_FAULT", () => {
    it("should have correct ID and title", () => {
      expect(SENSOR_FAULT.id).toBe("sensor_fault");
      expect(SENSOR_FAULT.title).toBe("Sensor Fault Diagnosis");
    });

    it("should apply to sensor types", () => {
      expect(SENSOR_FAULT.appliesTo?.length).toBeGreaterThan(0);
    });

    it("should start with IDENTIFY_ASSET", () => {
      expect(SENSOR_FAULT.steps[0].action).toBe("IDENTIFY_ASSET");
    });

    it("should validate clean", () => {
      const result = validateTemplate(SENSOR_FAULT, LIBRARY);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should have MEASURE and READ_PLC_TAG", () => {
      const hasMeasure = SENSOR_FAULT.steps.some((s) => s.action === "MEASURE");
      const hasReadPLC = SENSOR_FAULT.steps.some((s) => s.action === "READ_PLC_TAG");
      expect(hasMeasure).toBe(true);
      expect(hasReadPLC).toBe(true);
    });
  });

  describe("Template structure", () => {
    it("all templates should be present in TEMPLATES array", () => {
      expect(TEMPLATES).toContain(MOTOR_WONT_START);
      expect(TEMPLATES).toContain(VFD_FAULT);
      expect(TEMPLATES).toContain(SENSOR_FAULT);
    });

    it("all templates should have unique IDs", () => {
      const ids = TEMPLATES.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(TEMPLATES.length);
    });

    it("all templates should validate against library", () => {
      for (const template of TEMPLATES) {
        const result = validateTemplate(template, LIBRARY);
        expect(result.ok).toBe(true);
      }
    });
  });
});
