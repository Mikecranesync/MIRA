/**
 * Template workflows for common maintenance scenarios.
 * Three canonical templates: motor_wont_start, vfd_fault, sensor_fault.
 */

import type { WorkflowTemplate } from "./types";

export const MOTOR_WONT_START: WorkflowTemplate = {
  id: "motor_wont_start",
  title: "Motor Won't Start",
  appliesTo: ["AC_Motor", "DC_Motor"],
  steps: [
    { id: "step1", action: "IDENTIFY_ASSET", executor: "mira" },
    { id: "step2", action: "ASSESS_HAZARDS", executor: "technician", expected: "hazards identified" },
    { id: "step3", action: "READ_FAULT", executor: "mira" },
    { id: "step4", action: "READ_PLC_TAG", executor: "mira", expected: "run signal present" },
    { id: "step5", action: "MEASURE", executor: "technician", expected: "voltage measured" },
    { id: "step6", action: "COMPARE_TO_SPEC", executor: "mira" },
    { id: "step7", action: "SELECT_NEXT_TEST", executor: "mira" },
    { id: "step8", action: "RECORD_FINDING", executor: "technician" },
  ],
};

export const VFD_FAULT: WorkflowTemplate = {
  id: "vfd_fault",
  title: "VFD Fault Code",
  appliesTo: ["VFD", "PowerFlex", "AC_Drive"],
  steps: [
    { id: "step1", action: "IDENTIFY_ASSET", executor: "mira" },
    { id: "step2", action: "ASSESS_HAZARDS", executor: "technician", expected: "hazards cleared" },
    { id: "step3", action: "CONFIRM_ISOLATION", executor: "technician", expected: "isolation confirmed" },
    { id: "step4", action: "READ_FAULT", executor: "mira" },
    { id: "step5", action: "READ_DRIVE_PARAMETER", executor: "mira", expected: "parameters read" },
    { id: "step6", action: "REVIEW_HISTORY", executor: "mira" },
    { id: "step7", action: "COMPARE_TO_SPEC", executor: "mira" },
    { id: "step8", action: "SELECT_NEXT_TEST", executor: "mira" },
    { id: "step9", action: "RECORD_FINDING", executor: "technician" },
  ],
};

export const SENSOR_FAULT: WorkflowTemplate = {
  id: "sensor_fault",
  title: "Sensor Fault Diagnosis",
  appliesTo: ["Proximity_Sensor", "Pressure_Sensor", "Temperature_Sensor"],
  steps: [
    { id: "step1", action: "IDENTIFY_ASSET", executor: "mira" },
    { id: "step2", action: "ASSESS_HAZARDS", executor: "technician", expected: "safe to proceed" },
    { id: "step3", action: "OBSERVE_STATE", executor: "technician", expected: "sensor state observed" },
    { id: "step4", action: "MEASURE", executor: "technician", expected: "measurements taken" },
    { id: "step5", action: "READ_PLC_TAG", executor: "mira", expected: "PLC tag value" },
    { id: "step6", action: "COMPARE_TO_SPEC", executor: "mira" },
    { id: "step7", action: "SELECT_NEXT_TEST", executor: "mira" },
    { id: "step8", action: "RECORD_FINDING", executor: "technician" },
  ],
};

export const TEMPLATES = [MOTOR_WONT_START, VFD_FAULT, SENSOR_FAULT] as const;

export type TemplateLibrary = typeof TEMPLATES;
