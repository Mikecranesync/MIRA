/**
 * Pure, deterministic step runner for diagnostic workflows.
 * Replays the whole run record against the template and routes on each outcome.
 * No I/O, Date, random, or external calls.
 */

import { LIBRARY } from "./library";
import type { ActionDefinition, ActionOutcome, NextStepResult, RunRecord, StepRoute, TemplateStep, WorkflowTemplate } from "./types";

const LOOP_LIMIT = 3;

/**
 * Where a step's outcome leads. Shared with the validator so routing has one definition.
 * UNSAFE and BLOCKED always stop. A failed or inconclusive safety step stops and is never "resolved".
 */
export function routeAfter(
  template: WorkflowTemplate,
  index: number,
  outcome: ActionOutcome,
  action?: ActionDefinition,
): NextStepResult {
  const step = template.steps[index];
  const route = step.on?.[outcome];

  // UNSAFE always stops as unsafe; BLOCKED stops as blocked or escalate. Neither can be "resolved".
  if (outcome === "UNSAFE") return { kind: "stop", reason: "unsafe" };
  if (outcome === "BLOCKED") return { kind: "stop", reason: route && "stop" in route && route.stop === "escalate" ? "escalate" : "blocked" };
  // A failed or inconclusive safety step only ever stops, and never as "resolved"
  if (action?.group === "safety" && (outcome === "FAIL" || outcome === "INCONCLUSIVE")) {
    if (route && "stop" in route && route.stop !== "resolved") return { kind: "stop", reason: route.stop };
    return { kind: "stop", reason: outcome === "FAIL" ? "blocked" : "escalate" };
  }
  if (route) return follow(template, route);
  if (outcome === "INCONCLUSIVE") return { kind: "stop", reason: "escalate" };

  // PASS, or FAIL on a non-safety step: advance to the following step
  const next = template.steps[index + 1];
  return next ? { kind: "step", step: next } : { kind: "done" };
}

function follow(template: WorkflowTemplate, route: StepRoute): NextStepResult {
  if ("stop" in route) return { kind: "stop", reason: route.stop };
  const target = template.steps.find((s) => s.id === route.next);
  return target
    ? { kind: "step", step: target }
    : { kind: "stop", reason: `Route target '${route.next}' not found` };
}

/**
 * Determine the next step for a run. Every record must be the step the previous one routed to,
 * with the action, verification, report and (for named attestation) reporter its action declares.
 * Any mismatch stops the run rather than guessing.
 */
export function nextStep(
  template: WorkflowTemplate,
  run: RunRecord | null,
  library: readonly ActionDefinition[] = LIBRARY,
): NextStepResult {
  // Ownership first, so a foreign run never starts
  if (run && run.templateId !== template.id) {
    return { kind: "stop", reason: `Run templateId '${run.templateId}' does not match template '${template.id}'` };
  }

  if (template.steps.length === 0) return { kind: "done" };
  let expected: NextStepResult = { kind: "step", step: template.steps[0] };
  if (!run || run.records.length === 0) return expected;

  const actions = new Map<string, ActionDefinition>(library.map((a) => [a.id, a]));
  const seen = new Map<string, number>();

  for (const record of run.records) {
    const stop = (reason: string): NextStepResult => ({ kind: "stop", reason, atStep: record.stepId });

    if (expected.kind !== "step") return stop(`Record for '${record.stepId}' arrived after the run ended`);
    const step: TemplateStep = expected.step;
    if (record.stepId !== step.id) return stop(`Record '${record.stepId}' is out of sequence; expected '${step.id}'`);
    if (record.action !== step.action) {
      return stop(`Record action '${record.action}' does not match step '${step.id}' action '${step.action}'`);
    }

    const action = actions.get(step.action);
    if (!action) return stop(`Action '${step.action}' is not in the library`);
    if (record.verification !== action.verification) {
      return stop(`Record verification '${record.verification}' does not match action '${action.id}' (${action.verification})`);
    }
    if (action.requiresReport && !record.observed?.trim()) {
      return stop(`Step '${step.id}' needs the technician's report`);
    }
    if (action.attestation === "named_person" && !record.reportedBy?.trim()) {
      return stop(`Step '${step.id}' needs a named attester`);
    }

    const count = (seen.get(step.id) ?? 0) + 1;
    seen.set(step.id, count);
    if (count > LOOP_LIMIT) return stop("Step executed more than 3 times, escalating");

    const index = template.steps.indexOf(step);
    expected = routeAfter(template, index, record.outcome, action);
    if (expected.kind === "stop") expected = { ...expected, atStep: record.stepId };
  }

  return expected;
}
