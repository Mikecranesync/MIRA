/**
 * Validation rules for diagnostic plan templates.
 * Nine validation rules ensure templates are well-formed and safe.
 */

import { ActionDefinition, ActionOutcome, WorkflowTemplate } from "./types";
import { routeAfter } from "./runner";

const OUTCOMES: ActionOutcome[] = ["PASS", "FAIL", "INCONCLUSIVE", "BLOCKED", "UNSAFE"];

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

  // R5: every next target exists, and every step is reachable under the runner's own routing
  const stepIds = new Set(template.steps.map((s) => s.id));
  for (const step of template.steps) {
    for (const outcome of OUTCOMES) {
      const route = step.on?.[outcome];
      if (route && "next" in route && !stepIds.has(route.next)) {
        errors.push({ rule: "R5", stepId: step.id, message: `Route target '${route.next}' does not exist` });
      }
    }
  }
  const reachableIds = new Set<string>();
  const pending = template.steps.length > 0 ? [0] : [];
  while (pending.length > 0) {
    const index = pending.pop()!;
    const step = template.steps[index];
    if (reachableIds.has(step.id)) continue;
    reachableIds.add(step.id);
    for (const outcome of OUTCOMES) {
      const result = routeAfter(template, index, outcome, actionMap.get(step.action));
      if (result.kind === "step") pending.push(template.steps.indexOf(result.step));
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

  // R6: on every route, a technician field step comes after a passed ASSESS_HAZARDS (isolation is not
  // a hazard assessment). Observing
  // (identify group) counts as well as measuring: both put the technician at the machine.
  // Walks the routing graph (shared with the runner), so a jump past the hazard step is caught.
  const flagged = new Set<string>();
  const visited = new Set<string>();
  const queue: Array<[number, boolean]> = template.steps.length > 0 ? [[0, false]] : [];
  while (queue.length > 0) {
    const [index, hazardPassed] = queue.shift()!;
    const key = `${index}:${hazardPassed}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const step = template.steps[index];
    const action = actionMap.get(step.action);
    const executor = step.executor ?? action?.executor;
    const fieldStep = action && executor === "technician" && (action.group === "measure" || action.group === "identify");
    if (fieldStep && !hazardPassed && !flagged.has(step.id)) {
      flagged.add(step.id);
      errors.push({
        rule: "R6",
        stepId: step.id,
        message: `Technician field step (measure or observe) is reachable without a passed hazard assessment`,
      });
    }

    for (const outcome of OUTCOMES) {
      const result = routeAfter(template, index, outcome, action);
      if (result.kind !== "step") continue;
      const nextIndex = template.steps.indexOf(result.step);
      const passedHere = action?.id === "ASSESS_HAZARDS" && outcome === "PASS";
      queue.push([nextIndex, hazardPassed || passedHere]);
    }
  }

  // R9: a safety step's FAIL or INCONCLUSIVE outcome may only stop the run, and never as "resolved"
  for (const step of template.steps) {
    if (actionMap.get(step.action)?.group !== "safety") continue;
    for (const outcome of ["FAIL", "INCONCLUSIVE"] as const) {
      const route = step.on?.[outcome];
      if (route && ("next" in route || route.stop === "resolved")) {
        errors.push({
          rule: "R9",
          stepId: step.id,
          message: `Safety step '${step.id}' cannot route ${outcome} to another step or to resolved`,
        });
      }
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
