/**
 * Maintenance action library types.
 * Defines the data model for diagnostic plans, action definitions, templates, and execution records.
 */

/**
 * Possible outcomes of executing an action step.
 */
export type ActionOutcome = "PASS" | "FAIL" | "INCONCLUSIVE" | "BLOCKED" | "UNSAFE";

/**
 * Verification method used to confirm an action outcome.
 */
export type Verification = "machine" | "self_reported" | "attested";

/**
 * Who executes the action.
 */
export type Executor = "mira" | "technician";

/**
 * Describes a single action that can be executed within a diagnostic plan.
 */
export interface ActionDefinition {
  id: string;
  title: string;
  group: "identify" | "safety" | "measure" | "diagnose" | "record";
  executor: Executor;
  verification: Verification;
  requiresReport: boolean;
  attestation?: "named_person";
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  safetyWording?: string;
}

/**
 * Routing outcome for a step based on its ActionOutcome.
 */
export type StepRoute = { next: string } | { stop: "unsafe" | "blocked" | "escalate" | "resolved" };

/**
 * A step within a workflow template.
 */
export interface TemplateStep {
  id: string;
  action: string;
  executor?: Executor;
  expected?: string;
  on?: Partial<Record<ActionOutcome, StepRoute>>;
}

/**
 * A complete workflow template for a specific maintenance scenario.
 */
export interface WorkflowTemplate {
  id: string;
  title: string;
  appliesTo?: string[];
  steps: TemplateStep[];
}

/**
 * Record of a single executed step.
 */
export interface StepRecord {
  stepId: string;
  action: string;
  outcome: ActionOutcome;
  verification: Verification;
  observed?: string;
  expected?: string;
  reportedBy?: string;
}

/**
 * Complete record of a workflow execution.
 */
export interface RunRecord {
  templateId: string;
  records: StepRecord[];
}

/**
 * Result of the nextStep operation.
 */
export type NextStepResult =
  | { kind: "step"; step: TemplateStep }
  | { kind: "stop"; reason: string; atStep?: string }
  | { kind: "done" };
