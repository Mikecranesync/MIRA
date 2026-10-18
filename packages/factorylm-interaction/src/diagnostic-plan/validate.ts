/**
 * Validation rules for diagnostic plan templates.
 * Eight validation rules ensure templates are well-formed and safe.
 */

import { ActionDefinition, ActionOutcome, WorkflowTemplate } from "./types";

export interface ValidationError {
  rule: string;
  stepId?: string;
  message: string;
}

/**
 * Validate a template against the action library.
 */
export function validateTemplate(
  template: WorkflowTemplate,
  library: ActionDefinition[]
): {
  ok: boolean;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];
  const actionMap = new Map(library.map((a) => [a.id, a]));

  // R1: every action id exists
  for (const step of template.steps) {
    if (!actionMap.has(step.action)) {
      errors.push({
        rule: "R1",
        stepId: step.id,
        message: `Action '${step.action}' not found in library`,
      });
    }
  }

  // R8: step ids are unique; the runner resolves a record to the first matching id
  const seenStepIds = new Set<string>();
  for (const step of template.steps) {
    if (seenStepIds.has(step.id)) {
      errors.push({ rule: "R8", stepId: step.id, message: `Duplicate step id '${step.id}'` });
    }
    seenStepIds.add(step.id);
  }

  // R7: a step may not run under a different executor than its action declares
  for (const step of template.steps) {
    const action = actionMap.get(step.action);
    if (action && step.executor !== undefined && step.executor !== action.executor) {
      errors.push({
        rule: "R7",
        stepId: step.id,
        message: `Step '${step.id}' executor '${step.executor}' does not match action '${action.id}' executor '${action.executor}'`,
      });
    }
  }

  // R2: technician steps have requiresReport
  for (const step of template.steps) {
    const action = actionMap.get(step.action);
    if (action) {
      const executor = step.executor ?? action.executor;
      if (executor === "technician" && !action.requiresReport) {
        errors.push({
          rule: "R2",
          stepId: step.id,
          message: `Technician step '${step.id}' must have requiresReport=true`,
        });
      }
    }
  }

  // R3: UNSAFE outcome routes to stop:unsafe, default if absent
  for (const step of template.steps) {
    if (step.on?.UNSAFE) {
      const route = step.on.UNSAFE;
      if ("next" in route) {
        errors.push({
          rule: "R3",
          stepId: step.id,
          message: `UNSAFE outcome cannot route to next step`,
        });
      } else if ("stop" in route && route.stop !== "unsafe") {
        errors.push({
          rule: "R3",
          stepId: step.id,
          message: `UNSAFE outcome must route to stop:unsafe, not stop:${route.stop}`,
        });
      }
    }
  }

  // R4: BLOCKED outcome routes to stop:blocked or stop:escalate, never next
  for (const step of template.steps) {
    if (step.on?.BLOCKED) {
      const route = step.on.BLOCKED;
      if ("next" in route) {
        errors.push({
          rule: "R4",
          stepId: step.id,
          message: `BLOCKED outcome cannot route to next step`,
        });
      } else if ("stop" in route && route.stop !== "blocked" && route.stop !== "escalate") {
        errors.push({
          rule: "R4",
          stepId: step.id,
          message: `BLOCKED outcome must route to stop:blocked or stop:escalate, not stop:${route.stop}`,
        });
      }
    }
  }

  // R5: every next target exists, no unreachable step
  const stepIds = new Set(template.steps.map((s) => s.id));
  const reachableIds = new Set<string>();
  reachableIds.add(template.steps[0]?.id || "");

  let changed = true;
  while (changed) {
    changed = false;
    for (const step of template.steps) {
      if (reachableIds.has(step.id)) {
        const stepIdx = template.steps.findIndex((s) => s.id === step.id);
        const nextStepIdx = stepIdx + 1;
        const hasNextStep = nextStepIdx < template.steps.length;

        // Check explicit routes and default routing
        const outcomes: ActionOutcome[] = ["PASS", "FAIL", "INCONCLUSIVE", "BLOCKED", "UNSAFE"];

        for (const outcome of outcomes) {
          if (step.on?.[outcome]) {
            const route = step.on[outcome];
            if ("next" in route) {
              if (!stepIds.has(route.next)) {
                errors.push({
                  rule: "R5",
                  stepId: step.id,
                  message: `Route target '${route.next}' does not exist`,
                });
              } else if (!reachableIds.has(route.next)) {
                reachableIds.add(route.next);
                changed = true;
              }
            }
          } else if ((outcome === "PASS" || outcome === "FAIL") && hasNextStep) {
            // Default PASS/FAIL to next step if not explicitly routed
            if (!reachableIds.has(template.steps[nextStepIdx].id)) {
              reachableIds.add(template.steps[nextStepIdx].id);
              changed = true;
            }
          }
        }
      }
    }
  }

  // Check for unreachable steps
  for (const step of template.steps) {
    if (!reachableIds.has(step.id)) {
      errors.push({
        rule: "R5",
        stepId: step.id,
        message: `Step '${step.id}' is unreachable`,
      });
    }
  }

  // R6: hazard step before the first technician field step. Observing (identify group) counts as well
  // as measuring: both put the technician at the machine, so the hazard step comes first on purpose.
  let hazardFound = false;
  let firstTechnicianMeasurement = false;

  for (const step of template.steps) {
    const action = actionMap.get(step.action);
    if (action?.group === "safety") {
      hazardFound = true;
    }
    if (action && action.executor === "technician" && (action.group === "measure" || action.group === "identify")) {
      if (!hazardFound) {
        errors.push({
          rule: "R6",
          stepId: step.id,
          message: `Technician field step (measure or observe) must come after hazard assessment`,
        });
      }
      firstTechnicianMeasurement = true;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * Validate the entire action library for uniqueness.
 */
export function validateLibrary(actions: ActionDefinition[]): {
  ok: boolean;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];
  const ids = new Set<string>();

  for (const action of actions) {
    if (ids.has(action.id)) {
      errors.push({
        rule: "LIB",
        message: `Duplicate action id: '${action.id}'`,
      });
    }
    ids.add(action.id);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
