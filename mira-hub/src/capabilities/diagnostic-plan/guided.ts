/**
 * WP-1 guided troubleshooting — the pure layer between a technician's tap and the run record.
 * No I/O. The route persists the records this module builds; `nextStep` (the runner) decides
 * what comes next. Everything shown carries the manual's page; nothing here invents a branch.
 */

import { LIBRARY } from "./library";
import { nextStep } from "./runner";
import type { ActionOutcome, RunRecord, StepGuidance, StepMeasure, StepRecord, TemplateStep, WorkflowTemplate } from "./types";
import { SMC_FLEX_TROUBLESHOOTING } from "./manufacturer/smc-flex";

// ---------------------------------------------------------------- registry + applicability

export interface ManufacturerProcedure {
  template: WorkflowTemplate;
  manufacturers: RegExp[];
  models: RegExp[];
  /** Matches a manual's filename/title as this publication, any revision letter. */
  publication: RegExp;
}

export const MANUFACTURER_PROCEDURES: readonly ManufacturerProcedure[] = [
  {
    template: SMC_FLEX_TROUBLESHOOTING,
    manufacturers: [/rockwell/i, /allen[\s-]*bradley/i],
    models: [/smc[\s-]*flex/i, /^150-F/i],
    publication: /150[\s_-]*um008/i,
  },
];

export interface EquipmentIdentity {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
}

export interface NotebookManual {
  filename: string | null;
  sha256: string | null;
}

export type Applicability =
  | { applies: true; revision: "exact" | "not_attached"; notice: string }
  | { applies: false; reason: "different_equipment" | "different_revision"; message: string };

/**
 * Is this procedure valid for this machine and its manual? The revision check compares the
 * notebook's own copy of the manual (sha256) with the exact PDF the procedure was compiled from.
 */
export function checkApplicability(
  proc: ManufacturerProcedure,
  identity: EquipmentIdentity,
  manuals: readonly NotebookManual[],
): Applicability {
  const src = proc.template.source;
  const mfr = identity.manufacturer ?? "";
  const ids = [identity.model ?? "", identity.catalogNumber ?? ""];
  const machine = proc.manufacturers.some((r) => r.test(mfr)) && ids.some((v) => proc.models.some((r) => r.test(v)));
  if (!src || !machine) {
    return { applies: false, reason: "different_equipment", message: `${proc.template.title} does not apply to this machine.` };
  }
  if (manuals.some((m) => m.sha256 === src.fileSha256)) {
    return { applies: true, revision: "exact", notice: `Steps from ${src.publication}, the same manual revision attached to this notebook.` };
  }
  const other = manuals.find((m) => m.filename && proc.publication.test(m.filename));
  if (other) {
    return {
      applies: false,
      reason: "different_revision",
      message: `This notebook's manual (${other.filename}) is a different revision from ${src.publication}, which these steps were compiled from. The steps are not offered against a revision they were not checked on.`,
    };
  }
  return {
    applies: true,
    revision: "not_attached",
    notice: `Steps from ${src.publication} (${src.revisionDate}). That manual is not attached to this notebook, so confirm your controller's documentation matches.`,
  };
}

export function proceduresFor(identity: EquipmentIdentity, manuals: readonly NotebookManual[]) {
  return MANUFACTURER_PROCEDURES.map((proc) => ({ proc, applicability: checkApplicability(proc, identity, manuals) })).filter(
    (p) => p.applicability.applies || p.applicability.reason === "different_revision",
  );
}

// ---------------------------------------------------------------- measurement

export interface Reading {
  point: string;
  value: number;
  unit: string;
}

const OPS: Record<StepMeasure["passIf"]["op"], (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
};

/**
 * PASS only when every point was read, in the manual's unit, and meets the criterion; FAIL when
 * any point does not; INCONCLUSIVE when a point is missing, not a number, or in another unit —
 * a unit is never converted on the technician's behalf.
 */
export function evaluateMeasurement(measure: StepMeasure, readings: readonly Reading[]): { outcome: ActionOutcome; detail: string } {
  for (const point of measure.points) {
    const r = readings.find((x) => x.point === point);
    if (!r) return { outcome: "INCONCLUSIVE", detail: `No reading for ${point}` };
    if (r.unit !== measure.unit) return { outcome: "INCONCLUSIVE", detail: `${point} was read in ${r.unit || "no unit"}, not ${measure.unit}` };
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) return { outcome: "INCONCLUSIVE", detail: `${point} is not a number` };
  }
  const failing = measure.points.filter((p) => !OPS[measure.passIf.op](readings.find((x) => x.point === p)!.value, measure.passIf.value));
  return failing.length === 0
    ? { outcome: "PASS", detail: `All points ${measure.passIf.op} ${measure.passIf.value} ${measure.unit}` }
    : { outcome: "FAIL", detail: `Not ${measure.passIf.op} ${measure.passIf.value} ${measure.unit}: ${failing.join(", ")}` };
}

// ---------------------------------------------------------------- technician input → record

export type StepInput =
  | { kind: "acknowledge"; stepId: string; acknowledged: boolean }
  | { kind: "isolation"; stepId: string; confirmed: boolean; reportedBy: string }
  | { kind: "choice"; stepId: string; choice: string | null }
  | { kind: "measurement"; stepId: string; readings: Reading[] }
  | { kind: "result"; stepId: string; fixed: boolean; note?: string };

export type BuildResult = { ok: true; record: StepRecord } | { ok: false; error: string };

/**
 * Validate an untrusted JSON body into a StepInput (Codex #4573 F2). Booleans must be real
 * booleans — the string "false" is never a confirmation — and readings real numbers with string
 * points and units. Anything else is rejected before a record can be built.
 */
export function parseStepInput(raw: unknown): { ok: true; input: StepInput } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("Answer must be an object.");
  const o = raw as Record<string, unknown>;
  if (typeof o.stepId !== "string" || !o.stepId) return bad("Answer needs its step.");
  const stepId = o.stepId;
  switch (o.kind) {
    case "acknowledge":
      if (typeof o.acknowledged !== "boolean") return bad("acknowledged must be true or false.");
      return { ok: true, input: { kind: "acknowledge", stepId, acknowledged: o.acknowledged } };
    case "isolation":
      if (typeof o.confirmed !== "boolean") return bad("confirmed must be true or false.");
      if (typeof o.reportedBy !== "string") return bad("reportedBy must be a name.");
      return { ok: true, input: { kind: "isolation", stepId, confirmed: o.confirmed, reportedBy: o.reportedBy } };
    case "choice":
      if (o.choice !== null && typeof o.choice !== "string") return bad("choice must be an option key or null.");
      return { ok: true, input: { kind: "choice", stepId, choice: o.choice as string | null } };
    case "measurement": {
      if (!Array.isArray(o.readings) || o.readings.length === 0 || o.readings.length > 32) return bad("readings must be a list.");
      const readings: Reading[] = [];
      for (const r of o.readings) {
        if (!r || typeof r !== "object") return bad("Each reading must be an object.");
        const { point, value, unit } = r as Record<string, unknown>;
        if (typeof point !== "string" || typeof unit !== "string" || typeof value !== "number") {
          return bad("Each reading needs a point, a numeric value and a unit.");
        }
        readings.push({ point, value, unit });
      }
      return { ok: true, input: { kind: "measurement", stepId, readings } };
    }
    case "result":
      if (typeof o.fixed !== "boolean") return bad("fixed must be true or false.");
      if (o.note !== undefined && typeof o.note !== "string") return bad("note must be text.");
      return { ok: true, input: { kind: "result", stepId, fixed: o.fixed, note: o.note as string | undefined } };
    default:
      return bad("Unknown answer kind.");
  }
}

/**
 * Build the record for the CURRENT step from a technician's input. The outcome is derived here,
 * deterministically — never taken from the client.
 */
export function buildRecord(template: WorkflowTemplate, run: RunRecord, input: StepInput): BuildResult {
  const next = nextStep(template, run);
  if (next.kind !== "step") return { ok: false, error: "This troubleshooting session has already ended." };
  const step = next.step;
  if (input.stepId !== step.id) return { ok: false, error: `Expected an answer for '${step.id}', got '${input.stepId}'.` };
  const action = LIBRARY.find((a) => a.id === step.action);
  if (!action) return { ok: false, error: `Unknown action '${step.action}'.` };
  const base = { stepId: step.id, action: step.action, verification: action.verification, expected: step.expected };

  if (action.id === "ASSESS_HAZARDS") {
    if (input.kind !== "acknowledge") return { ok: false, error: "This step needs the safety notices acknowledged." };
    return input.acknowledged
      ? { ok: true, record: { ...base, outcome: "PASS", observed: `Read the manufacturer's safety notices (p.${step.cite?.page})` } }
      : { ok: true, record: { ...base, outcome: "UNSAFE", observed: "Safety notices not acknowledged" } };
  }
  if (action.id === "CONFIRM_ISOLATION") {
    if (input.kind !== "isolation") return { ok: false, error: "This step needs the isolation confirmed." };
    const who = input.reportedBy.trim();
    if (!who) return { ok: false, error: "Enter the name of the person confirming isolation." };
    return input.confirmed
      ? { ok: true, record: { ...base, outcome: "PASS", observed: "Main power disconnected", reportedBy: who } }
      : { ok: true, record: { ...base, outcome: "FAIL", observed: "Main power not confirmed disconnected", reportedBy: who } };
  }
  if (step.options) {
    if (input.kind !== "choice") return { ok: false, error: "This step needs one of the manual's options." };
    if (input.choice === null) return { ok: true, record: { ...base, outcome: "INCONCLUSIVE", observed: "None of the documented options" } };
    const option = Object.prototype.hasOwnProperty.call(step.options, input.choice) ? step.options[input.choice] : undefined;
    if (!option) return { ok: false, error: "That is not one of this step's options." };
    return { ok: true, record: { ...base, outcome: "PASS", observed: option.label, choice: input.choice } };
  }
  if (step.measure) {
    if (input.kind !== "measurement") return { ok: false, error: "This step needs the measured readings." };
    const { outcome, detail } = evaluateMeasurement(step.measure, input.readings);
    const shown = input.readings.map((r) => `${r.point} ${r.value} ${r.unit}`).join("; ");
    return { ok: true, record: { ...base, outcome, observed: `${shown} — ${detail}`, readings: input.readings } };
  }
  if (input.kind !== "result") return { ok: false, error: "This step needs a fixed / not fixed answer." };
  const note = input.note?.trim();
  return {
    ok: true,
    record: { ...base, outcome: input.fixed ? "PASS" : "FAIL", observed: `${input.fixed ? "Fixed" : "Not fixed"}${note ? `: ${note}` : ""}` },
  };
}

// ---------------------------------------------------------------- what the technician sees

export interface StepView {
  id: string;
  kind: "safety" | "isolation" | "choice" | "measure" | "result";
  prompt: string;
  safetyWording?: string;
  cite: { publication: string; page: number; ref: string };
  options?: Array<{ key: string; label: string }>;
  measure?: StepMeasure;
  expected?: string;
  /** The manufacturer's causes and solutions the technician is working through now. */
  guidance?: StepGuidance;
}

export interface SessionView {
  status: "active" | "resolved" | "escalate" | "stopped";
  step?: StepView;
  /** Why the run ended (escalate / unsafe / blocked / resolved) — plain words. */
  endReason?: string;
  guidance?: StepGuidance;
  history: Array<{ stepId: string; answer: string; outcome: ActionOutcome; page?: number; ref?: string }>;
  source: { publication: string; revisionDate: string; title: string; version: string };
}

function stepById(template: WorkflowTemplate, id: string): TemplateStep | undefined {
  return template.steps.find((s) => s.id === id);
}

/** The manual's guidance the latest answer points at: the chosen row, or a failed measurement's. */
export function currentGuidance(template: WorkflowTemplate, run: RunRecord): StepGuidance | undefined {
  for (let i = run.records.length - 1; i >= 0; i--) {
    const rec = run.records[i];
    const step = stepById(template, rec.stepId);
    if (!step) continue;
    if (step.measure && rec.outcome === "FAIL") return step.measure.failGuidance;
    if (rec.choice && step.options?.[rec.choice]?.guidance) return step.options[rec.choice].guidance;
  }
  return undefined;
}

const END_REASON: Record<string, string> = {
  resolved: "The manufacturer's action fixed the problem, as confirmed by the technician.",
  escalate: "The manual does not document what to do next for this case.",
  unsafe: "Stopped for safety: the safety notices were not acknowledged.",
  blocked: "Stopped: the isolation was not confirmed.",
};

export function viewSession(template: WorkflowTemplate, run: RunRecord): SessionView {
  const src = template.source!;
  const history = run.records.map((r) => {
    const step = stepById(template, r.stepId);
    return { stepId: r.stepId, answer: r.observed ?? "", outcome: r.outcome, page: step?.cite?.page, ref: step?.cite?.ref };
  });
  const source = { publication: src.publication, revisionDate: src.revisionDate, title: template.title, version: template.version ?? "" };
  const next = nextStep(template, run);
  if (next.kind === "step") {
    const step = next.step;
    const action = LIBRARY.find((a) => a.id === step.action);
    const kind: StepView["kind"] =
      action?.id === "ASSESS_HAZARDS" ? "safety"
      : action?.id === "CONFIRM_ISOLATION" ? "isolation"
      : step.options ? "choice"
      : step.measure ? "measure"
      : "result";
    return {
      status: "active",
      history,
      source,
      step: {
        id: step.id,
        kind,
        prompt: step.prompt ?? action?.title ?? step.id,
        safetyWording: step.safetyWording,
        cite: { publication: src.publication, page: step.cite?.page ?? 0, ref: step.cite?.ref ?? "" },
        options: step.options ? Object.entries(step.options).map(([key, o]) => ({ key, label: o.label })) : undefined,
        measure: step.measure,
        expected: step.expected,
        guidance: kind === "result" ? currentGuidance(template, run) : undefined,
      },
    };
  }
  if (next.kind === "done") return { status: "resolved", endReason: END_REASON.resolved, history, source, guidance: currentGuidance(template, run) };
  const reason = next.reason;
  const status: SessionView["status"] = reason === "resolved" ? "resolved" : reason === "escalate" ? "escalate" : "stopped";
  return { status, endReason: END_REASON[reason] ?? reason, history, source, guidance: currentGuidance(template, run) };
}

/**
 * The evidence handed to MIRA's chat when the manual runs out: what was checked, on which pages,
 * and the readings — so the AI reasons from the session, labelled as beyond the manual.
 */
export function escalationQuestion(template: WorkflowTemplate, run: RunRecord): string {
  const view = viewSession(template, run);
  const steps = view.history.map((h) => `- ${h.ref ?? h.stepId} (p.${h.page ?? "?"}): ${h.answer}`).join("\n");
  return [
    `I followed the manufacturer's troubleshooting for this machine (${view.source.publication}, ${view.source.title}).`,
    view.endReason ?? "",
    "What I checked:",
    steps,
    "The manual does not cover what to do next. What else could cause this, and what should I check?",
  ].join("\n");
}
