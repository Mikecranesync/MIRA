/**
 * Validation for the Living Work Sheet's two write surfaces: starting a job
 * (which snapshots a `JobSheetBody` into the `job_started` event) and
 * appending an event to an already-started job. Mirrors the DB CHECKs in
 * db/proposed/114_living_work_sheet.sql so a rejected body never reaches
 * Postgres — same discipline as capabilities/observations/validate.ts.
 */
import { isUuid } from "@/capabilities/fix-records";
import {
  EVENT_KINDS,
  JOB_ITEM_KINDS,
  JOB_STEP_CHECKOFFS,
  JOB_TYPES,
  LABEL_FIELD_MAX,
  NOTE_KINDS,
  PART_ACTIONS,
  TEXT_FIELD_MAX,
  type EventKind,
  type HandoverWrittenPayload,
  type JobFinishedPayload,
  type JobItemKind,
  type JobSheetBody,
  type JobSheetItem,
  type JobSheetStep,
  type JobSheetTorque,
  type JobStepCheckoff,
  type JobType,
  type NoteAddedPayload,
  type NoteKind,
  type PartAction,
  type PartLoggedPayload,
  type PhotoAttachedPayload,
  type QuestionResolvedPayload,
  type ReadingCorrectedPayload,
  type ReadingRecordedPayload,
  type StepMarkedPayload,
} from "./types";

/** Clock skew tolerated between the technician's device and the server —
 *  same bound as capabilities/observations/validate.ts. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

function fail(error: string, field?: string): { ok: false; error: string; field?: string } {
  return field === undefined ? { ok: false, error } : { ok: false, error, field };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function noUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(obj).every((k) => allowed.includes(k));
}

/** Non-empty string, length <= max. */
function isText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

/** null, or a non-empty string length <= max. */
function isNullableText(v: unknown, max: number): v is string | null {
  return v === null || isText(v, max);
}

function isNullableFiniteNumber(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}

function isIsoInstant(v: unknown, now: Date): v is string {
  if (typeof v !== "string") return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  return t <= now.getTime() + FUTURE_SKEW_MS;
}

// ---------------------------------------------------------------------------
// JobSheetBody
// ---------------------------------------------------------------------------

const ITEM_KEYS = ["id", "kind", "item", "spec", "qty", "source", "notes"] as const;

function validateItem(raw: unknown, idx: number): ValidationResult<JobSheetItem> {
  if (!isPlainObject(raw)) return fail("invalid_item", `items[${idx}]`);
  if (!noUnknownKeys(raw, ITEM_KEYS)) return fail("unknown_field", `items[${idx}]`);
  if (!isText(raw.id, LABEL_FIELD_MAX)) return fail("invalid_item_id", `items[${idx}].id`);
  if (typeof raw.kind !== "string" || !(JOB_ITEM_KINDS as readonly string[]).includes(raw.kind)) {
    return fail("invalid_item_kind", `items[${idx}].kind`);
  }
  if (!isText(raw.item, LABEL_FIELD_MAX)) return fail("invalid_item_name", `items[${idx}].item`);
  if (!isNullableText(raw.spec, LABEL_FIELD_MAX)) return fail("invalid_item_spec", `items[${idx}].spec`);
  if (!isNullableFiniteNumber(raw.qty)) return fail("invalid_item_qty", `items[${idx}].qty`);
  if (!isNullableText(raw.source, LABEL_FIELD_MAX)) return fail("invalid_item_source", `items[${idx}].source`);
  if (!isNullableText(raw.notes, TEXT_FIELD_MAX)) return fail("invalid_item_notes", `items[${idx}].notes`);
  return {
    ok: true,
    value: {
      id: raw.id,
      kind: raw.kind as JobItemKind,
      item: raw.item,
      spec: raw.spec,
      qty: raw.qty,
      source: raw.source,
      notes: raw.notes,
    },
  };
}

const TORQUE_KEYS = ["id", "what", "value", "unit", "pattern", "threadLocker", "tool", "source"] as const;

function validateTorque(raw: unknown, idx: number): ValidationResult<JobSheetTorque> {
  if (!isPlainObject(raw)) return fail("invalid_torque", `torques[${idx}]`);
  if (!noUnknownKeys(raw, TORQUE_KEYS)) return fail("unknown_field", `torques[${idx}]`);
  if (!isText(raw.id, LABEL_FIELD_MAX)) return fail("invalid_torque_id", `torques[${idx}].id`);
  if (!isText(raw.what, LABEL_FIELD_MAX)) return fail("invalid_torque_what", `torques[${idx}].what`);
  if (!isNullableFiniteNumber(raw.value)) return fail("invalid_torque_value", `torques[${idx}].value`);
  if (!isNullableText(raw.unit, LABEL_FIELD_MAX)) return fail("invalid_torque_unit", `torques[${idx}].unit`);
  if (!isNullableText(raw.pattern, LABEL_FIELD_MAX)) return fail("invalid_torque_pattern", `torques[${idx}].pattern`);
  if (!isNullableText(raw.threadLocker, LABEL_FIELD_MAX)) {
    return fail("invalid_torque_thread_locker", `torques[${idx}].threadLocker`);
  }
  if (!isNullableText(raw.tool, LABEL_FIELD_MAX)) return fail("invalid_torque_tool", `torques[${idx}].tool`);
  if (!isNullableText(raw.source, LABEL_FIELD_MAX)) return fail("invalid_torque_source", `torques[${idx}].source`);
  // Rule: any `value` that is not null requires `source` to be non-null.
  if (raw.value !== null && raw.source === null) {
    return fail("torque_value_requires_source", `torques[${idx}].source`);
  }
  return {
    ok: true,
    value: {
      id: raw.id,
      what: raw.what,
      value: raw.value,
      unit: raw.unit,
      pattern: raw.pattern,
      threadLocker: raw.threadLocker,
      tool: raw.tool,
      source: raw.source,
    },
  };
}

const STEP_KEYS = ["id", "text", "checkoff", "torqueRef", "source"] as const;

function validateStep(raw: unknown, idx: number): ValidationResult<JobSheetStep> {
  if (!isPlainObject(raw)) return fail("invalid_step", `steps[${idx}]`);
  if (!noUnknownKeys(raw, STEP_KEYS)) return fail("unknown_field", `steps[${idx}]`);
  if (!isText(raw.id, LABEL_FIELD_MAX)) return fail("invalid_step_id", `steps[${idx}].id`);
  if (!isText(raw.text, TEXT_FIELD_MAX)) return fail("invalid_step_text", `steps[${idx}].text`);
  if (typeof raw.checkoff !== "string" || !(JOB_STEP_CHECKOFFS as readonly string[]).includes(raw.checkoff)) {
    return fail("invalid_step_checkoff", `steps[${idx}].checkoff`);
  }
  if (!isNullableText(raw.torqueRef, LABEL_FIELD_MAX)) return fail("invalid_step_torque_ref", `steps[${idx}].torqueRef`);
  if (!isNullableText(raw.source, LABEL_FIELD_MAX)) return fail("invalid_step_source", `steps[${idx}].source`);
  return {
    ok: true,
    value: {
      id: raw.id,
      text: raw.text,
      checkoff: raw.checkoff as JobStepCheckoff,
      torqueRef: raw.torqueRef,
      source: raw.source,
    },
  };
}

const JOB_SHEET_BODY_KEYS = [
  "title",
  "machineLabel",
  "component",
  "jobType",
  "estHours",
  "crewSize",
  "isolationPoints",
  "cautions",
  "returnToService",
  "items",
  "torques",
  "steps",
  "author",
  "notes",
] as const;

export function validateJobSheetBody(raw: unknown): ValidationResult<JobSheetBody> {
  if (!isPlainObject(raw)) return fail("invalid_body");
  if (!noUnknownKeys(raw, JOB_SHEET_BODY_KEYS)) return fail("unknown_field");

  if (!isText(raw.title, LABEL_FIELD_MAX)) return fail("invalid_title", "title");
  if (!isNullableText(raw.machineLabel, LABEL_FIELD_MAX)) return fail("invalid_machine_label", "machineLabel");
  if (!isNullableText(raw.component, LABEL_FIELD_MAX)) return fail("invalid_component", "component");
  if (raw.jobType !== null && !(JOB_TYPES as readonly string[]).includes(raw.jobType as string)) {
    return fail("invalid_job_type", "jobType");
  }
  if (!isNullableFiniteNumber(raw.estHours)) return fail("invalid_est_hours", "estHours");
  if (!(raw.crewSize === null || (typeof raw.crewSize === "number" && Number.isInteger(raw.crewSize) && raw.crewSize >= 0))) {
    return fail("invalid_crew_size", "crewSize");
  }
  if (!isNullableText(raw.isolationPoints, TEXT_FIELD_MAX)) return fail("invalid_isolation_points", "isolationPoints");
  if (!isNullableText(raw.cautions, TEXT_FIELD_MAX)) return fail("invalid_cautions", "cautions");

  if (!Array.isArray(raw.returnToService) || !raw.returnToService.every((v) => isText(v, LABEL_FIELD_MAX))) {
    return fail("invalid_return_to_service", "returnToService");
  }

  if (!Array.isArray(raw.items)) return fail("invalid_items", "items");
  const items: JobSheetItem[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const r = validateItem(raw.items[i], i);
    if (!r.ok) return r;
    items.push(r.value);
  }

  if (!Array.isArray(raw.torques)) return fail("invalid_torques", "torques");
  const torques: JobSheetTorque[] = [];
  for (let i = 0; i < raw.torques.length; i++) {
    const r = validateTorque(raw.torques[i], i);
    if (!r.ok) return r;
    torques.push(r.value);
  }

  if (!Array.isArray(raw.steps)) return fail("invalid_steps", "steps");
  const steps: JobSheetStep[] = [];
  for (let i = 0; i < raw.steps.length; i++) {
    const r = validateStep(raw.steps[i], i);
    if (!r.ok) return r;
    steps.push(r.value);
  }

  if (!isNullableText(raw.author, LABEL_FIELD_MAX)) return fail("invalid_author", "author");
  if (!isNullableText(raw.notes, TEXT_FIELD_MAX)) return fail("invalid_notes", "notes");

  return {
    ok: true,
    value: {
      title: raw.title,
      machineLabel: raw.machineLabel,
      component: raw.component,
      jobType: raw.jobType as JobType | null,
      estHours: raw.estHours,
      crewSize: raw.crewSize,
      isolationPoints: raw.isolationPoints,
      cautions: raw.cautions,
      returnToService: raw.returnToService as string[],
      items,
      torques,
      steps,
      author: raw.author,
      notes: raw.notes,
    },
  };
}

// ---------------------------------------------------------------------------
// Start job (POST /sheets)
// ---------------------------------------------------------------------------

export type ValidatedStartJobInput = {
  title: string;
  templateRevisionId: string | null;
  template: JobSheetBody;
  clientEventId: string;
  occurredAt: string;
};

const START_JOB_KEYS = ["title", "templateRevisionId", "template", "clientEventId", "occurredAt"] as const;

export function validateStartJobInput(raw: unknown, opts: { now: Date }): ValidationResult<ValidatedStartJobInput> {
  if (!isPlainObject(raw)) return fail("invalid_body");
  if (!noUnknownKeys(raw, START_JOB_KEYS)) return fail("unknown_field");

  if (!isText(raw.title, LABEL_FIELD_MAX)) return fail("invalid_title", "title");
  if (raw.templateRevisionId !== null && !isUuid(String(raw.templateRevisionId))) {
    return fail("invalid_template_revision_id", "templateRevisionId");
  }
  const template = validateJobSheetBody(raw.template);
  if (!template.ok) return template;

  if (typeof raw.clientEventId !== "string" || !isUuid(raw.clientEventId)) {
    return fail("invalid_client_event_id", "clientEventId");
  }
  if (!isIsoInstant(raw.occurredAt, opts.now)) return fail("invalid_occurred_at", "occurredAt");

  return {
    ok: true,
    value: {
      title: raw.title,
      templateRevisionId: (raw.templateRevisionId as string | null) ?? null,
      template: template.value,
      clientEventId: raw.clientEventId,
      occurredAt: new Date(raw.occurredAt).toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Append event (POST /sheets/[jobId]/events)
// ---------------------------------------------------------------------------

export type ValidatedAppendInput = {
  clientEventId: string;
  baseSeq: number;
  kind: Exclude<EventKind, "job_started">;
  payload:
    | StepMarkedPayload
    | ReadingRecordedPayload
    | ReadingCorrectedPayload
    | NoteAddedPayload
    | QuestionResolvedPayload
    | PartLoggedPayload
    | PhotoAttachedPayload
    | HandoverWrittenPayload
    | JobFinishedPayload;
  occurredAt: string;
  workOrderId: string | null;
};

function validateStepMarkedPayload(raw: unknown): ValidationResult<StepMarkedPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["stepId", "done", "note"])) return fail("unknown_field", "payload");
  if (!isText(raw.stepId, LABEL_FIELD_MAX)) return fail("invalid_step_id", "payload.stepId");
  if (typeof raw.done !== "boolean") return fail("invalid_done", "payload.done");
  if (!isNullableText(raw.note, TEXT_FIELD_MAX)) return fail("invalid_note", "payload.note");
  return { ok: true, value: { stepId: raw.stepId, done: raw.done, note: raw.note } };
}

function validateReadingRecordedPayload(raw: unknown): ValidationResult<ReadingRecordedPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["readingId", "what", "value", "unit", "source"])) return fail("unknown_field", "payload");
  if (typeof raw.readingId !== "string" || !isUuid(raw.readingId)) return fail("invalid_reading_id", "payload.readingId");
  if (!isText(raw.what, LABEL_FIELD_MAX)) return fail("invalid_what", "payload.what");
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) return fail("invalid_value", "payload.value");
  // unit is required: no unit means validation rejects it.
  if (!isText(raw.unit, LABEL_FIELD_MAX)) return fail("unit_required", "payload.unit");
  if (!isPlainObject(raw.source)) return fail("invalid_source", "payload.source");
  if (!noUnknownKeys(raw.source, ["kind", "ref"])) return fail("unknown_field", "payload.source");
  if (raw.source.kind !== "tech" && raw.source.kind !== "manual") return fail("invalid_source_kind", "payload.source.kind");
  if (!isNullableText(raw.source.ref, LABEL_FIELD_MAX)) return fail("invalid_source_ref", "payload.source.ref");
  return {
    ok: true,
    value: {
      readingId: raw.readingId,
      what: raw.what,
      value: raw.value,
      unit: raw.unit,
      source: { kind: raw.source.kind, ref: raw.source.ref },
    },
  };
}

function validateReadingCorrectedPayload(raw: unknown): ValidationResult<ReadingCorrectedPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["readingId", "value", "unit", "reason"])) return fail("unknown_field", "payload");
  if (typeof raw.readingId !== "string" || !isUuid(raw.readingId)) return fail("invalid_reading_id", "payload.readingId");
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) return fail("invalid_value", "payload.value");
  if (!isText(raw.unit, LABEL_FIELD_MAX)) return fail("unit_required", "payload.unit");
  if (!isNullableText(raw.reason, TEXT_FIELD_MAX)) return fail("invalid_reason", "payload.reason");
  return { ok: true, value: { readingId: raw.readingId, value: raw.value, unit: raw.unit, reason: raw.reason } };
}

function validateNoteAddedPayload(raw: unknown): ValidationResult<NoteAddedPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["noteId", "text", "noteKind"])) return fail("unknown_field", "payload");
  if (typeof raw.noteId !== "string" || !isUuid(raw.noteId)) return fail("invalid_note_id", "payload.noteId");
  if (!isText(raw.text, TEXT_FIELD_MAX)) return fail("invalid_text", "payload.text");
  if (typeof raw.noteKind !== "string" || !(NOTE_KINDS as readonly string[]).includes(raw.noteKind)) {
    return fail("invalid_note_kind", "payload.noteKind");
  }
  return { ok: true, value: { noteId: raw.noteId, text: raw.text, noteKind: raw.noteKind as NoteKind } };
}

function validateQuestionResolvedPayload(raw: unknown): ValidationResult<QuestionResolvedPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["noteId", "resolution"])) return fail("unknown_field", "payload");
  if (typeof raw.noteId !== "string" || !isUuid(raw.noteId)) return fail("invalid_note_id", "payload.noteId");
  if (!isText(raw.resolution, TEXT_FIELD_MAX)) return fail("invalid_resolution", "payload.resolution");
  return { ok: true, value: { noteId: raw.noteId, resolution: raw.resolution } };
}

function validatePartLoggedPayload(raw: unknown): ValidationResult<PartLoggedPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["partEntryId", "item", "action", "qty"])) return fail("unknown_field", "payload");
  if (typeof raw.partEntryId !== "string" || !isUuid(raw.partEntryId)) {
    return fail("invalid_part_entry_id", "payload.partEntryId");
  }
  if (!isText(raw.item, LABEL_FIELD_MAX)) return fail("invalid_item", "payload.item");
  if (typeof raw.action !== "string" || !(PART_ACTIONS as readonly string[]).includes(raw.action)) {
    return fail("invalid_action", "payload.action");
  }
  if (!isNullableFiniteNumber(raw.qty)) return fail("invalid_qty", "payload.qty");
  return { ok: true, value: { partEntryId: raw.partEntryId, item: raw.item, action: raw.action as PartAction, qty: raw.qty } };
}

function validatePhotoAttachedPayload(raw: unknown): ValidationResult<PhotoAttachedPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["photoId", "fileId", "caption"])) return fail("unknown_field", "payload");
  if (typeof raw.photoId !== "string" || !isUuid(raw.photoId)) return fail("invalid_photo_id", "payload.photoId");
  if (!isText(raw.fileId, LABEL_FIELD_MAX)) return fail("invalid_file_id", "payload.fileId");
  if (!isNullableText(raw.caption, TEXT_FIELD_MAX)) return fail("invalid_caption", "payload.caption");
  return { ok: true, value: { photoId: raw.photoId, fileId: raw.fileId, caption: raw.caption } };
}

function validateHandoverWrittenPayload(raw: unknown): ValidationResult<HandoverWrittenPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["text"])) return fail("unknown_field", "payload");
  if (!isText(raw.text, TEXT_FIELD_MAX)) return fail("invalid_text", "payload.text");
  return { ok: true, value: { text: raw.text } };
}

function validateJobFinishedPayload(raw: unknown): ValidationResult<JobFinishedPayload> {
  if (!isPlainObject(raw)) return fail("invalid_payload", "payload");
  if (!noUnknownKeys(raw, ["summary", "openItemsAcknowledged"])) return fail("unknown_field", "payload");
  if (!isNullableText(raw.summary, TEXT_FIELD_MAX)) return fail("invalid_summary", "payload.summary");
  if (typeof raw.openItemsAcknowledged !== "boolean") return fail("invalid_open_items_acknowledged", "payload.openItemsAcknowledged");
  return { ok: true, value: { summary: raw.summary, openItemsAcknowledged: raw.openItemsAcknowledged } };
}

const PAYLOAD_VALIDATORS: Record<Exclude<EventKind, "job_started">, (raw: unknown) => ValidationResult<unknown>> = {
  step_marked: validateStepMarkedPayload,
  reading_recorded: validateReadingRecordedPayload,
  reading_corrected: validateReadingCorrectedPayload,
  note_added: validateNoteAddedPayload,
  question_resolved: validateQuestionResolvedPayload,
  part_logged: validatePartLoggedPayload,
  photo_attached: validatePhotoAttachedPayload,
  handover_written: validateHandoverWrittenPayload,
  job_finished: validateJobFinishedPayload,
};

const APPEND_KEYS = ["clientEventId", "baseSeq", "kind", "payload", "occurredAt", "workOrderId"] as const;

export function validateAppendEventInput(raw: unknown, opts: { now: Date }): ValidationResult<ValidatedAppendInput> {
  if (!isPlainObject(raw)) return fail("invalid_body");
  if (!noUnknownKeys(raw, APPEND_KEYS)) return fail("unknown_field");

  if (typeof raw.clientEventId !== "string" || !isUuid(raw.clientEventId)) {
    return fail("invalid_client_event_id", "clientEventId");
  }
  if (typeof raw.baseSeq !== "number" || !Number.isInteger(raw.baseSeq) || raw.baseSeq < 0) {
    return fail("invalid_base_seq", "baseSeq");
  }
  // job_started is only ever produced by startJob; the events route never
  // accepts it directly (it would be a second, out-of-band seq-1 event).
  if (raw.kind === "job_started" || typeof raw.kind !== "string" || !(EVENT_KINDS as readonly string[]).includes(raw.kind)) {
    return fail("invalid_kind", "kind");
  }
  const kind = raw.kind as Exclude<EventKind, "job_started">;
  const payload = PAYLOAD_VALIDATORS[kind](raw.payload);
  if (!payload.ok) return payload;

  if (!isIsoInstant(raw.occurredAt, opts.now)) return fail("invalid_occurred_at", "occurredAt");
  if (raw.workOrderId !== undefined && raw.workOrderId !== null && !isText(raw.workOrderId, LABEL_FIELD_MAX)) {
    return fail("invalid_work_order_id", "workOrderId");
  }

  return {
    ok: true,
    value: {
      clientEventId: raw.clientEventId,
      baseSeq: raw.baseSeq,
      kind,
      payload: payload.value as ValidatedAppendInput["payload"],
      occurredAt: new Date(raw.occurredAt).toISOString(),
      workOrderId: (raw.workOrderId as string | null | undefined) ?? null,
    },
  };
}
