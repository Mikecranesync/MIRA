/**
 * Pure, deterministic step runner for diagnostic workflows.
 * Routes through workflow templates based on action outcomes.
 */

import { WorkflowTemplate, TemplateStep, RunRecord, NextStepResult, ActionOutcome } from "./types";

/**
 * Determine the next step based on current run state.
 * Pure and deterministic: no I/O, Date, random, or external calls.
 */
export function nextStep(template: WorkflowTemplate, run: RunRecord | null): NextStepResult {
  // Check run is for this template (before the empty-run start, so a foreign run never starts)
  if (run && run.templateId !== template.id) {
    return {
      kind: "stop",
      reason: `Run templateId '${run.templateId}' does not match template '${template.id}'`,
    };
  }

  // Empty run: return first step
  if (!run || run.records.length === 0) {
    if (template.steps.length === 0) {
      return { kind: "done" };
    }
    return { kind: "step", step: template.steps[0] };
  }

  const lastRecord = run.records[run.records.length - 1];

  // Find the current step in the template
  const currentStepIndex = template.steps.findIndex((s) => s.id === lastRecord.stepId);
  if (currentStepIndex === -1) {
    return {
      kind: "stop",
      reason: `Step '${lastRecord.stepId}' not found in template`,
      atStep: lastRecord.stepId,
    };
  }

  const currentStep = template.steps[currentStepIndex];

  // Loop guard: same step more than 3 times
  const sameStepCount = run.records.filter((r) => r.stepId === lastRecord.stepId).length;
  if (sameStepCount > 3) {
    return {
      kind: "stop",
      reason: "Step executed more than 3 times, escalating",
      atStep: lastRecord.stepId,
    };
  }

  // Route by outcome
  const outcome = lastRecord.outcome;

  // UNSAFE always stops (explicit or default)
  if (outcome === "UNSAFE") {
    if (currentStep.on?.UNSAFE) {
      const route = currentStep.on.UNSAFE;
      if ("stop" in route) {
        return { kind: "stop", reason: route.stop, atStep: lastRecord.stepId };
      }
    }
    return { kind: "stop", reason: "unsafe", atStep: lastRecord.stepId };
  }

  // BLOCKED routes to stop (explicit or default)
  if (outcome === "BLOCKED") {
    if (currentStep.on?.BLOCKED) {
      const route = currentStep.on.BLOCKED;
      if ("stop" in route) {
        return { kind: "stop", reason: route.stop, atStep: lastRecord.stepId };
      }
    }
    return { kind: "stop", reason: "blocked", atStep: lastRecord.stepId };
  }

  // INCONCLUSIVE defaults to escalate
  if (outcome === "INCONCLUSIVE") {
    if (currentStep.on?.INCONCLUSIVE) {
      const route = currentStep.on.INCONCLUSIVE;
      return routeToNext(route, template, currentStepIndex, lastRecord.stepId);
    }
    return { kind: "stop", reason: "escalate", atStep: lastRecord.stepId };
  }

  // PASS or FAIL: check explicit route, then default to next step
  if (currentStep.on?.[outcome]) {
    const route = currentStep.on[outcome];
    return routeToNext(route, template, currentStepIndex, lastRecord.stepId);
  }

  // Default: advance to next step
  const nextIndex = currentStepIndex + 1;
  if (nextIndex >= template.steps.length) {
    return { kind: "done" };
  }

  return { kind: "step", step: template.steps[nextIndex] };
}

/**
 * Helper to route based on a StepRoute.
 */
function routeToNext(
  route: { next: string } | { stop: string },
  template: WorkflowTemplate,
  currentIndex: number,
  stepId: string,
): NextStepResult {
  if ("next" in route) {
    const nextStep = template.steps.find((s) => s.id === route.next);
    if (!nextStep) {
      return {
        kind: "stop",
        reason: `Route target '${route.next}' not found`,
        atStep: stepId,
      };
    }
    return { kind: "step", step: nextStep };
  } else {
    return { kind: "stop", reason: route.stop, atStep: stepId };
  }
}
