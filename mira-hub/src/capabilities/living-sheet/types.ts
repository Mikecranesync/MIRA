/**
 * Living Work Sheet — shared types for the append-only event log.
 *
 * Schema: db/migrations/114_living_work_sheet.sql (proposed, not db/migrations).
 * One job on one confirmed machine. Every change is an event; the current
 * sheet is a pure reduce over those events (reduce.ts). A correction
 * supersedes and never deletes. Ticks never carry over from a template —
 * `JobSheetBody.steps` carries no `done` field; "done" lives only on the
 * reduced view (reduce.ts), derived from `step_marked` events.
 *
 * Templates' own store/routes are S4 (TASK-S1-events-store-api.md). S1 only
 * needs `JobSheetBody` + its validator because `job_started` snapshots it.
 */

export const JOB_ITEM_KINDS = [
  "tool",
  "part",
  "fastener",
  "consumable",
  "thread_locker",
  "lubricant",
  "ppe",
] as const;
export type JobItemKind = (typeof JOB_ITEM_KINDS)[number];

export const JOB_STEP_CHECKOFFS = ["none", "torque", "loctite", "measurement", "photo"] as const;
export type JobStepCheckoff = (typeof JOB_STEP_CHECKOFFS)[number];

export const JOB_TYPES = [
  "repair",
  "inspection",
  "pm",
  "lubrication",
  "adjustment",
  "replacement",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type JobSheetItem = {
  id: string;
  kind: JobItemKind;
  item: string;
  spec: string | null;
  qty: number | null;
  source: string | null;
  notes: string | null;
};

export type JobSheetTorque = {
  id: string;
  what: string;
  value: number | null;
  unit: string | null;
  pattern: string | null;
  threadLocker: string | null;
  tool: string | null;
  source: string | null;
};

export type JobSheetStep = {
  id: string;
  text: string;
  checkoff: JobStepCheckoff;
  torqueRef: string | null;
  source: string | null;
};

/** A job sheet's content, as snapshotted into a `job_started` event. Rule: any
 *  `value` that is not null requires `source` to be non-null (enforced on
 *  `torques` — the only sub-shape here that carries a `value`). */
export type JobSheetBody = {
  /** Server-owned structured evidence; never accepted by generic body writes. */
  instruction?: import("./instruction-metadata").InstructionMetadata;
  title: string;
  machineLabel: string | null;
  component: string | null;
  jobType: JobType | null;
  estHours: number | null;
  crewSize: number | null;
  isolationPoints: string | null;
  cautions: string | null;
  returnToService: string[];
  items: JobSheetItem[];
  torques: JobSheetTorque[];
  steps: JobSheetStep[];
  author: string | null;
  notes: string | null;
};

export const EVENT_KINDS = [
  "job_started",
  "step_marked",
  "reading_recorded",
  "reading_corrected",
  "note_added",
  "question_resolved",
  "part_logged",
  "photo_attached",
  "handover_written",
  "job_finished",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type JobStartedPayload = {
  title: string;
  machine: { entityId: string; name: string | null };
  templateRevisionId: string | null;
  template: JobSheetBody;
  /** Optional for back-compat with events recorded before TASK-S4. Present
   *  whenever `templateRevisionId` is non-null: the status
   *  (`job_sheet_revisions.status`) of the template revision snapshotted
   *  into `template`, as of the moment this job started. */
  templateStatus?: "draft" | "reviewed";
};

export type StepMarkedPayload = {
  stepId: string;
  done: boolean;
  note: string | null;
};

export type ReadingSource = { kind: "tech" | "manual"; ref: string | null };

export type ReadingRecordedPayload = {
  readingId: string;
  what: string;
  value: number;
  unit: string;
  source: ReadingSource;
};

export type ReadingCorrectedPayload = {
  readingId: string;
  value: number;
  unit: string;
  reason: string | null;
  /** R2-14 (additive — older stored events predate this key, and are read
   *  as if it were `null`): the correction's OWN source citation. When the
   *  technician doesn't state one, the corrected reading reports
   *  technician-reported — it must never keep showing the superseded
   *  value's citation (e.g. a manual page) beside a number that citation
   *  never supported. */
  source?: ReadingSource | null;
};

export const NOTE_KINDS = ["note", "question"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export type NoteAddedPayload = {
  noteId: string;
  text: string;
  noteKind: NoteKind;
};

export type QuestionResolvedPayload = {
  noteId: string;
  resolution: string;
};

export const PART_ACTIONS = ["planned", "replaced", "used"] as const;
export type PartAction = (typeof PART_ACTIONS)[number];

export type PartLoggedPayload = {
  partEntryId: string;
  item: string;
  action: PartAction;
  qty: number | null;
};

export type PhotoAttachedPayload = {
  photoId: string;
  fileId: string;
  caption: string | null;
};

export type HandoverWrittenPayload = {
  text: string;
};

export type JobFinishedPayload = {
  summary: string | null;
  openItemsAcknowledged: boolean;
};

/** The discriminated union of every event this capability can append.
 *  `job_started` is only ever produced by `store.ts::startJob` — the
 *  events route (`appendEvent`) refuses it (validate.ts). */
export type SheetEvent =
  | { kind: "job_started"; payload: JobStartedPayload }
  | { kind: "step_marked"; payload: StepMarkedPayload }
  | { kind: "reading_recorded"; payload: ReadingRecordedPayload }
  | { kind: "reading_corrected"; payload: ReadingCorrectedPayload }
  | { kind: "note_added"; payload: NoteAddedPayload }
  | { kind: "question_resolved"; payload: QuestionResolvedPayload }
  | { kind: "part_logged"; payload: PartLoggedPayload }
  | { kind: "photo_attached"; payload: PhotoAttachedPayload }
  | { kind: "handover_written"; payload: HandoverWrittenPayload }
  | { kind: "job_finished"; payload: JobFinishedPayload };

/** Text bounds mirrored in the DB CHECKs (114) so a rejected body never
 *  reaches Postgres. */
export const TEXT_FIELD_MAX = 2000;
export const LABEL_FIELD_MAX = 200;
