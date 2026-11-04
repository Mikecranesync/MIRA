/**
 * Pure reduce of a Living Work Sheet's event log into the current sheet view.
 * No I/O: the caller (store.ts) passes the rows and gets back the same
 * answer for the same rows — the GET route's `?atSeq=N` snapshot is just
 * `reduceSheet(events.filter(e => e.seq <= N), jobId)`.
 *
 * Append-only: a correction (`reading_corrected`) supersedes the prior value
 * and keeps it in history; nothing is ever deleted. An event that targets an
 * id this sheet doesn't know about (a stale client replaying against a
 * reduced sheet, a typo'd id) is recorded in `warnings` and otherwise
 * ignored — it must never throw. The only things that DO throw are seq gaps/
 * duplicates and a missing `job_started` as the first event: both indicate
 * the event log itself is corrupt, which is a bug in the writer, not a
 * reducible state.
 */
import type {
  EventKind,
  JobFinishedPayload,
  JobSheetBody,
  JobSheetStep,
  JobStartedPayload,
  NoteAddedPayload,
  PartAction,
  PartLoggedPayload,
  PhotoAttachedPayload,
  QuestionResolvedPayload,
  ReadingCorrectedPayload,
  ReadingRecordedPayload,
  ReadingSource,
  SheetEvent,
  StepMarkedPayload,
  HandoverWrittenPayload,
} from "./types";

/** One row of the append-only log, as the store reads it back. Pure shape —
 *  no tenant/notebook id (the caller already knows those; reduce doesn't
 *  need them to compute the view). */
export type StoredEvent = {
  id: string;
  seq: number;
  actorLabel: string | null;
  actorUserId: string | null;
  occurredAt: string;
  recordedAt: string;
  workOrderId: string | null;
} & SheetEvent;

export type StepHistoryEntry = { done: boolean; note: string | null; by: string | null; at: string; eventId: string };
export type SheetStepView = JobSheetStep & {
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
  note: string | null;
  history: StepHistoryEntry[];
};

export type ReadingHistoryEntry = {
  value: number;
  unit: string;
  by: string | null;
  at: string;
  eventId: string;
  superseded: boolean;
};
export type ReadingCurrent = { value: number; unit: string; by: string | null; at: string; eventId: string };
export type SheetReadingView = {
  id: string;
  what: string;
  current: ReadingCurrent;
  history: ReadingHistoryEntry[];
  source: ReadingSource | null;
};

export type SheetPartView = {
  id: string;
  item: string;
  action: PartAction;
  qty: number | null;
  by: string | null;
  at: string;
  eventId: string;
};

export type SheetNoteView = { id: string; text: string; by: string | null; at: string; eventId: string };
export type SheetQuestionView = SheetNoteView & {
  resolved: boolean;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

export type SheetPhotoView = {
  id: string;
  fileId: string;
  caption: string | null;
  by: string | null;
  at: string;
  eventId: string;
};

export type SheetHandoverEntry = { text: string; by: string | null; at: string; eventId: string };

export type SheetWarning = { eventId: string; seq: number; kind: EventKind; reason: string };

export type SheetView = {
  jobId: string;
  seq: number;
  title: string;
  machine: { entityId: string; name: string | null };
  templateRevisionId: string | null;
  template: JobSheetBody;
  steps: SheetStepView[];
  readings: SheetReadingView[];
  parts: SheetPartView[];
  notes: SheetNoteView[];
  questions: SheetQuestionView[];
  photos: SheetPhotoView[];
  handover: { current: SheetHandoverEntry | null; history: SheetHandoverEntry[] };
  finished: { by: string | null; at: string; summary: string | null } | null;
  openSteps: number;
  openQuestions: number;
  warnings: SheetWarning[];
};

function actorOf(e: StoredEvent): string | null {
  return e.actorLabel ?? e.actorUserId ?? null;
}

/** Sorted ascending by seq; throws if seq is not exactly 1..n with no gaps
 *  or duplicates (a corrupt log, not a reducible one). */
function sortedBySeq(events: StoredEvent[]): StoredEvent[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sorted.length; i++) {
    const expected = i + 1;
    if (sorted[i]!.seq !== expected) {
      throw new Error(
        `reduceSheet: event log has a seq gap or duplicate (position ${i}, expected seq ${expected}, got ${sorted[i]!.seq})`,
      );
    }
  }
  return sorted;
}

/**
 * Reduce one job's event log into its current view. `jobId` is supplied by
 * the caller (store.ts always knows it already — it's how the events were
 * loaded) rather than re-derived from the log, since no event payload
 * carries it.
 */
export function reduceSheet(events: StoredEvent[], jobId: string): SheetView {
  if (events.length === 0) throw new Error("reduceSheet: a job's event log cannot be empty");
  const sorted = sortedBySeq(events);
  const first = sorted[0]!;
  if (first.kind !== "job_started") {
    throw new Error("reduceSheet: the first event (seq 1) must be job_started");
  }
  const started: JobStartedPayload = first.payload;

  const steps = new Map<string, SheetStepView>(
    started.template.steps.map((s) => [
      s.id,
      { ...s, done: false, doneBy: null, doneAt: null, note: null, history: [] },
    ]),
  );
  const readings = new Map<string, SheetReadingView>();
  const parts: SheetPartView[] = [];
  const notes: SheetNoteView[] = [];
  const questions = new Map<string, SheetQuestionView>();
  const photos: SheetPhotoView[] = [];
  const handoverHistory: SheetHandoverEntry[] = [];
  let finished: SheetView["finished"] = null;
  const warnings: SheetWarning[] = [];

  const warn = (e: StoredEvent, reason: string) =>
    warnings.push({ eventId: e.id, seq: e.seq, kind: e.kind, reason });

  for (const e of sorted) {
    switch (e.kind) {
      case "job_started":
        // Only valid at seq 1; sortedBySeq + the check above guarantee that.
        break;
      case "step_marked": {
        const payload: StepMarkedPayload = e.payload;
        const step = steps.get(payload.stepId);
        if (!step) {
          warn(e, `unknown_step:${payload.stepId}`);
          break;
        }
        step.history.push({ done: payload.done, note: payload.note, by: actorOf(e), at: e.occurredAt, eventId: e.id });
        step.done = payload.done;
        step.doneBy = actorOf(e);
        step.doneAt = e.occurredAt;
        step.note = payload.note;
        break;
      }
      case "reading_recorded": {
        const payload: ReadingRecordedPayload = e.payload;
        const existing = readings.get(payload.readingId);
        const entry: ReadingHistoryEntry = {
          value: payload.value,
          unit: payload.unit,
          by: actorOf(e),
          at: e.occurredAt,
          eventId: e.id,
          superseded: false,
        };
        if (existing) {
          existing.history.push(entry);
        } else {
          readings.set(payload.readingId, {
            id: payload.readingId,
            what: payload.what,
            source: payload.source,
            current: { value: entry.value, unit: entry.unit, by: entry.by, at: entry.at, eventId: entry.eventId },
            history: [entry],
          });
        }
        break;
      }
      case "reading_corrected": {
        const payload: ReadingCorrectedPayload = e.payload;
        const reading = readings.get(payload.readingId);
        if (!reading) {
          warn(e, `unknown_reading:${payload.readingId}`);
          break;
        }
        reading.history.push({
          value: payload.value,
          unit: payload.unit,
          by: actorOf(e),
          at: e.occurredAt,
          eventId: e.id,
          superseded: false,
        });
        break;
      }
      case "note_added": {
        const payload: NoteAddedPayload = e.payload;
        if (payload.noteKind === "question") {
          questions.set(payload.noteId, {
            id: payload.noteId,
            text: payload.text,
            by: actorOf(e),
            at: e.occurredAt,
            eventId: e.id,
            resolved: false,
            resolution: null,
            resolvedBy: null,
            resolvedAt: null,
          });
        } else {
          notes.push({ id: payload.noteId, text: payload.text, by: actorOf(e), at: e.occurredAt, eventId: e.id });
        }
        break;
      }
      case "question_resolved": {
        const payload: QuestionResolvedPayload = e.payload;
        const question = questions.get(payload.noteId);
        if (!question) {
          warn(e, `unknown_note:${payload.noteId}`);
          break;
        }
        question.resolved = true;
        question.resolution = payload.resolution;
        question.resolvedBy = actorOf(e);
        question.resolvedAt = e.occurredAt;
        break;
      }
      case "part_logged": {
        const payload: PartLoggedPayload = e.payload;
        parts.push({
          id: payload.partEntryId,
          item: payload.item,
          action: payload.action,
          qty: payload.qty,
          by: actorOf(e),
          at: e.occurredAt,
          eventId: e.id,
        });
        break;
      }
      case "photo_attached": {
        const payload: PhotoAttachedPayload = e.payload;
        photos.push({
          id: payload.photoId,
          fileId: payload.fileId,
          caption: payload.caption,
          by: actorOf(e),
          at: e.occurredAt,
          eventId: e.id,
        });
        break;
      }
      case "handover_written": {
        const payload: HandoverWrittenPayload = e.payload;
        handoverHistory.push({ text: payload.text, by: actorOf(e), at: e.occurredAt, eventId: e.id });
        break;
      }
      case "job_finished": {
        const payload: JobFinishedPayload = e.payload;
        finished = { by: actorOf(e), at: e.occurredAt, summary: payload.summary };
        break;
      }
    }
  }

  // Mark every reading's history: the last entry (by event order) is current,
  // every earlier one is superseded. 48 -> 4.8: current is 4.8, both are kept,
  // 48 is superseded.
  for (const reading of readings.values()) {
    const last = reading.history[reading.history.length - 1]!;
    reading.current = { value: last.value, unit: last.unit, by: last.by, at: last.at, eventId: last.eventId };
    reading.history = reading.history.map((h, i) => ({ ...h, superseded: i !== reading.history.length - 1 }));
  }

  const stepViews = [...steps.values()];
  const questionViews = [...questions.values()];

  return {
    jobId,
    seq: sorted[sorted.length - 1]!.seq,
    title: started.title,
    machine: started.machine,
    templateRevisionId: started.templateRevisionId,
    template: started.template,
    steps: stepViews,
    readings: [...readings.values()],
    parts,
    notes,
    questions: questionViews,
    photos,
    handover: { current: handoverHistory[handoverHistory.length - 1] ?? null, history: handoverHistory },
    finished,
    openSteps: stepViews.filter((s) => !s.done).length,
    openQuestions: questionViews.filter((q) => !q.resolved).length,
    warnings,
  };
}
