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
 * Where a step's content comes from in the manufacturer's document (WP-1).
 * `ref` names the figure, table or section on that page.
 */
export interface StepCite {
  page: number;
  ref: string;
}

/**
 * The manufacturer's own checks for a symptom or fault, quoted from the cited table row.
 */
export interface StepGuidance {
  causes: string[];
  solutions: string[];
  cite: StepCite;
}

/**
 * One documented answer to an option step. A PASS record that names this option routes to
 * `next` (or stops). Options are the manual's own branches; an answer that is not one of them
 * is never guessed (see the runner).
 */
export interface StepOption {
  label: string;
  next?: string;
  stop?: "resolved" | "escalate";
  guidance?: StepGuidance;
}

/**
 * A technician measurement with the manual's pass criterion (WP-1). Evaluated by
 * `evaluateMeasurement`; a reading outside the unit or not a number is INCONCLUSIVE.
 */
export interface StepMeasure {
  quantity: string;
  unit: string;
  points: string[];
  passIf: { op: ">" | ">=" | "<" | "<="; value: number };
  /** What the manual says to do when the criterion is not met, if it says anything. */
  failGuidance?: StepGuidance;
}

/**
 * A step within a workflow template.
 */
export interface TemplateStep {
  id: string;
  action: string;
  executor?: Executor;
  expected?: string;
  on?: Partial<Record<ActionOutcome, StepRoute>>;
  /** What the technician is asked, in the manual's words where it has them. */
  prompt?: string;
  /** Required on every step of a manufacturer template (validator R10). */
  cite?: StepCite;
  /** The manual's branches at this step. */
  options?: Record<string, StepOption>;
  measure?: StepMeasure;
  /**
   * Safety text for this step quoted from the manufacturer's document, with its cite. Overrides the
   * library's generic wording for this step only; it is the manual's text, never authored here.
   */
  safetyWording?: string;
}

/**
 * The manufacturer's document a template was compiled from. Present on manufacturer templates only.
 */
export interface TemplateSource {
  manufacturer: string;
  product: string;
  publication: string;
  revisionDate: string;
  /** sha256 of the exact PDF the steps were read from: the revision check compares against it. */
  fileSha256: string;
  chapter: string;
}

/**
 * A complete workflow template for a specific maintenance scenario.
 */
export interface WorkflowTemplate {
  id: string;
  title: string;
  appliesTo?: string[];
  steps: TemplateStep[];
  /** Semantic version of the compiled procedure; a new manual revision is a new version. */
  version?: string;
  source?: TemplateSource;
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
  /** The option the technician chose at an option step (a key of `TemplateStep.options`). */
  choice?: string;
  /** Readings at a measurement step, one per point. */
  readings?: { point: string; value: number; unit: string }[];
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
