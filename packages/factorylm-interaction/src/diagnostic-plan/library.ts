/**
 * Library of 13 maintenance diagnostic actions.
 * Grouped by category: identify, safety, measure, diagnose, record.
 */

import { ActionDefinition } from "./types";

const ACTIONS = {
  // Identify actions - read-only discovery
  IDENTIFY_ASSET: {
    id: "IDENTIFY_ASSET",
    title: "Identify Asset",
    group: "identify",
    executor: "mira",
    verification: "machine",
    requiresReport: false,
    inputs: { asset_context: {} },
    outputs: { asset_id: "", equipment_path: "" },
  } as ActionDefinition,

  READ_FAULT: {
    id: "READ_FAULT",
    title: "Read Fault Code",
    group: "identify",
    executor: "mira",
    verification: "machine",
    requiresReport: false,
    inputs: { fault_source: "" },
    outputs: { fault_code: "", fault_text: "" },
  } as ActionDefinition,

  OBSERVE_STATE: {
    id: "OBSERVE_STATE",
    title: "Observe Current State",
    group: "identify",
    executor: "technician",
    verification: "self_reported",
    requiresReport: true,
    inputs: { observation_type: "" },
    outputs: { observed_state: "" },
  } as ActionDefinition,

  REVIEW_HISTORY: {
    id: "REVIEW_HISTORY",
    title: "Review Event History",
    group: "identify",
    executor: "mira",
    verification: "machine",
    requiresReport: false,
    inputs: { asset_id: "" },
    outputs: { events: [] },
  } as ActionDefinition,

  // Safety actions - hazard and isolation
  ASSESS_HAZARDS: {
    id: "ASSESS_HAZARDS",
    title: "Assess Hazards",
    group: "safety",
    executor: "technician",
    verification: "self_reported",
    requiresReport: true,
    inputs: { hazard_type: "" },
    outputs: { hazards_identified: "" },
    safetyWording: "PENDING_R3",
  } as ActionDefinition,

  CONFIRM_ISOLATION: {
    id: "CONFIRM_ISOLATION",
    title: "Confirm Isolation",
    group: "safety",
    executor: "technician",
    verification: "attested",
    requiresReport: true,
    attestation: "named_person",
    inputs: { isolation_points: [] },
    outputs: { isolation_confirmed: false },
    safetyWording: "PENDING_R3",
  } as ActionDefinition,

  // Measure actions - data collection
  READ_PLC_TAG: {
    id: "READ_PLC_TAG",
    title: "Read PLC Tag",
    group: "measure",
    executor: "mira",
    verification: "machine",
    requiresReport: false,
    inputs: { tag_name: "" },
    outputs: { tag_value: "", timestamp: "" },
  } as ActionDefinition,

  READ_DRIVE_PARAMETER: {
    id: "READ_DRIVE_PARAMETER",
    title: "Read Drive Parameter",
    group: "measure",
    executor: "mira",
    verification: "machine",
    requiresReport: false,
    inputs: { parameter_id: "", drive_type: "" },
    outputs: { parameter_value: "", unit: "" },
  } as ActionDefinition,

  MEASURE: {
    id: "MEASURE",
    title: "Measure Quantity",
    group: "measure",
    executor: "technician",
    verification: "self_reported",
    requiresReport: true,
    inputs: { quantity: "" as "voltage" | "resistance" | "current" | "continuity" | "temperature" },
    outputs: { measured_value: 0, unit: "" },
  } as ActionDefinition,

  // Diagnose actions - analysis
  COMPARE_TO_SPEC: {
    id: "COMPARE_TO_SPEC",
    title: "Compare to Specification",
    group: "diagnose",
    executor: "mira",
    verification: "machine",
    requiresReport: false,
    inputs: { measured: 0, specification: 0 },
    outputs: { comparison_result: "" },
  } as ActionDefinition,

  SELECT_NEXT_TEST: {
    id: "SELECT_NEXT_TEST",
    title: "Select Next Test",
    group: "diagnose",
    executor: "mira",
    verification: "machine",
    requiresReport: false,
    inputs: { findings: [] },
    outputs: { recommended_action: "" },
  } as ActionDefinition,

  // Record actions - documentation
  RECORD_FINDING: {
    id: "RECORD_FINDING",
    title: "Record Finding",
    group: "record",
    executor: "technician",
    verification: "self_reported",
    requiresReport: true,
    inputs: { finding_text: "" },
    outputs: { record_id: "" },
  } as ActionDefinition,

  ESCALATE: {
    id: "ESCALATE",
    title: "Escalate Issue",
    group: "record",
    executor: "technician",
    verification: "self_reported",
    requiresReport: true,
    inputs: { reason: "" },
    outputs: { escalation_id: "" },
  } as ActionDefinition,
} as const satisfies Record<string, ActionDefinition>;

export const LIBRARY = Object.values(ACTIONS);

export type ActionLibrary = typeof LIBRARY;
