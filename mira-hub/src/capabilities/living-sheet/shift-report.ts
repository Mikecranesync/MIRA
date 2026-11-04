/**
 * Living Work Sheet — shift report for the lead (S6).
 *
 * Pure: `shiftReport(jobs, window, opts?)` takes jobs already loaded by the
 * store (`listJobsActiveBetween` in store.ts — each job's FULL event log, not
 * just the in-window slice, so corrections and step numbering can be
 * resolved against the job's own history) and turns them into plain-English
 * lines for a maintenance lead. No I/O.
 *
 * It lists every event whose `occurredAt` falls in the window, including the
 * job's own `job_started` (the earlier missing-first-report defect this
 * guards against). Banned words — "fixed", "safe", "repaired successfully",
 * "resolved" (applied to the machine) — never appear; a question is
 * "answered", never "resolved". Corrections render as
 * "<who> corrected <what> <old> → <new> at <local time>" in the given time
 * zone (default `America/New_York`). A handover's technician words are
 * never altered, only quoted and attributed (who/when) by the UI.
 *
 * F15: `needsAttention`, `counts`, `finished`, and `handover` are computed
 * from each job's state AS OF `window.to` (`viewAsOfWindowEnd`), not from
 * `job.view` (the live, current-moment reduction) — a finish or handover
 * written after the window closed must not retroactively change an earlier
 * report. `window`-filtered narrative entries (`byTechnician`) were already
 * correct; only the log-wide summary fields had this defect.
 *
 * F20: `jobSnapshots` names each job's short id and its event seq as of
 * `window.to`, so this report can be matched to the exact state a job-sheet
 * export (`living-sheet-print.ts`) printed for the same job at the same seq.
 */
import type {
  SheetEvent,
  HandoverWrittenPayload,
  JobFinishedPayload,
  JobStartedPayload,
  NoteAddedPayload,
  PartLoggedPayload,
  PhotoAttachedPayload,
  QuestionResolvedPayload,
  ReadingCorrectedPayload,
  ReadingRecordedPayload,
  StepMarkedPayload,
} from "./types";
import { reduceSheet, type SheetView, type StoredEvent } from "./reduce";

const DEFAULT_TIME_ZONE = "America/New_York";

export type ShiftReportJobInput = {
  notebookId: string;
  notebookName: string;
  jobId: string;
  view: SheetView;
  /** This job's full event log (not just the window) — needed to resolve
   *  step numbers and "old value" deltas for corrections that may have
   *  happened before the window started. */
  events: StoredEvent[];
};

export type ShiftReportWindow = { from: string; to: string };

export type ShiftReportEntry = {
  notebookId: string;
  notebookName: string;
  jobId: string;
  jobTitle: string;
  machineName: string;
  eventId: string;
  kind: SheetEvent["kind"];
  at: string;
  atLocal: string;
  by: string | null;
  text: string;
};

export type ShiftReportTechnicianGroup = { technician: string; entries: ShiftReportEntry[] };

export type ShiftReportAttentionReason = "open_steps" | "open_questions" | "not_finished" | "correction";

export type ShiftReportAttentionItem = {
  notebookId: string;
  notebookName: string;
  jobId: string;
  jobTitle: string;
  machineName: string;
  reason: ShiftReportAttentionReason;
  text: string;
  by: string | null;
  at: string | null;
};

export type ShiftReportHandoverEntry = {
  notebookId: string;
  notebookName: string;
  jobId: string;
  jobTitle: string;
  machineName: string;
  text: string;
  by: string | null;
  at: string;
};

export type ShiftReportCounts = { jobsTouched: number; jobsFinished: number; jobsOpen: number };

/** F20: identifies exactly which stored state a job's line in this report
 *  corresponds to — the job short id plus its event seq as of the window's
 *  end — so the report can be matched to an exact job-sheet export (which
 *  prints the same seq) rather than "the current state, whenever that is." */
export type ShiftReportJobSnapshot = { jobId: string; jobIdShort: string; seq: number };

export type ShiftReport = {
  window: ShiftReportWindow;
  needsAttention: ShiftReportAttentionItem[];
  byTechnician: ShiftReportTechnicianGroup[];
  handover: ShiftReportHandoverEntry[];
  counts: ShiftReportCounts;
  /** One entry per job included in this report, identifying its exact
   *  snapshot (F20) — see `ShiftReportJobSnapshot`. */
  jobSnapshots: ShiftReportJobSnapshot[];
  /** Set only when no job had any event in the window. */
  emptyMessage: string | null;
  /** Every visible string, newline-joined — the surface the banned-words
   *  test scans. */
  plainText: string;
};

export type ShiftReportOpts = { timeZone?: string };

function actorLabelOf(e: StoredEvent): string | null {
  return e.actorLabel ?? e.actorUserId ?? null;
}

function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(iso),
  );
}

function formatReading(value: number, unit: string): string {
  return `${value} ${unit}`;
}

function inWindow(iso: string, window: ShiftReportWindow): boolean {
  const t = Date.parse(iso);
  return t >= Date.parse(window.from) && t <= Date.parse(window.to);
}

/**
 * Narrative line for one event, or `null` for an event kind this report
 * doesn't render (there are none today — every `EventKind` is covered).
 * `stepIndex`/`readingState` are threaded through by the caller because they
 * accumulate across the job's FULL event log, not just the in-window slice.
 */
function narrativeOf(
  e: StoredEvent,
  stepIndex: Map<string, number>,
  readingState: Map<string, { value: number; unit: string; what: string }>,
  timeZone: string,
): string {
  switch (e.kind) {
    case "job_started": {
      const p = e.payload as JobStartedPayload;
      return `started job "${p.title}"`;
    }
    case "step_marked": {
      const p = e.payload as StepMarkedPayload;
      const n = stepIndex.get(p.stepId) ?? p.stepId;
      return p.done ? `marked step ${n} done` : `marked step ${n} not done`;
    }
    case "reading_recorded": {
      const p = e.payload as ReadingRecordedPayload;
      readingState.set(p.readingId, { value: p.value, unit: p.unit, what: p.what });
      return `recorded ${p.what} ${formatReading(p.value, p.unit)}`;
    }
    case "reading_corrected": {
      const p = e.payload as ReadingCorrectedPayload;
      const prior = readingState.get(p.readingId);
      const what = prior?.what ?? "reading";
      const oldText = prior ? formatReading(prior.value, prior.unit) : "unknown";
      readingState.set(p.readingId, { value: p.value, unit: p.unit, what });
      return `corrected ${what} ${oldText} → ${formatReading(p.value, p.unit)} at ${localTime(e.occurredAt, timeZone)}`;
    }
    case "note_added": {
      const p = e.payload as NoteAddedPayload;
      return p.noteKind === "question" ? `asked: ${p.text}` : `noted: ${p.text}`;
    }
    case "question_resolved": {
      const p = e.payload as QuestionResolvedPayload;
      return `answered: ${p.resolution}`;
    }
    case "part_logged": {
      const p = e.payload as PartLoggedPayload;
      return p.action === "planned" ? `planned: ${p.item}` : `${p.action}: ${p.item} (reported)`;
    }
    case "photo_attached": {
      const p = e.payload as PhotoAttachedPayload;
      return `photo: ${p.caption ?? "no caption"}`;
    }
    case "handover_written": {
      const p = e.payload as HandoverWrittenPayload;
      return `handover: “${p.text}”`; // the technician's words, quoted verbatim
    }
    case "job_finished": {
      const p = e.payload as JobFinishedPayload;
      const by = actorLabelOf(e) ?? "unknown";
      return `finished (reported by ${by})${p.openItemsAcknowledged ? " — open items acknowledged" : ""}`;
    }
  }
}

/**
 * F15: a shift report for window [from,to] must reflect the job's state AS
 * OF the window's end, not whatever the log has grown to by the time the
 * report happens to run — a finish or handover written after `to` must not
 * retroactively change an earlier report. Re-reduces the job's full log,
 * filtered to events that occurred at or before `window.to`.
 *
 * `job.view` (the caller's full-log reduction) stays the source for fields
 * that cannot change after `job_started` — `template`, `title`, `machine` —
 * since `job_started` is always at or before any window end that selected
 * this job (`listJobsActiveBetween` only returns jobs with >=1 event whose
 * `occurredAt` is in [from,to] ⊆ (-inf,to]).
 */
function viewAsOfWindowEnd(job: ShiftReportJobInput, window: ShiftReportWindow): SheetView {
  const toMs = Date.parse(window.to);
  const eventsUpToTo = job.events.filter((e) => Date.parse(e.occurredAt) <= toMs);
  if (eventsUpToTo.length === 0) return job.view; // defensive; unreachable per the note above
  return reduceSheet(eventsUpToTo, job.jobId);
}

function buildEntries(job: ShiftReportJobInput, window: ShiftReportWindow, timeZone: string): ShiftReportEntry[] {
  const stepIndex = new Map<string, number>(job.view.template.steps.map((s, i) => [s.id, i + 1]));
  const readingState = new Map<string, { value: number; unit: string; what: string }>();
  const machineName = job.view.machine.name ?? job.notebookName;
  const sorted = [...job.events].sort((a, b) => a.seq - b.seq);

  const entries: ShiftReportEntry[] = [];
  for (const e of sorted) {
    const text = narrativeOf(e, stepIndex, readingState, timeZone);
    if (!inWindow(e.occurredAt, window)) continue;
    entries.push({
      notebookId: job.notebookId,
      notebookName: job.notebookName,
      jobId: job.jobId,
      jobTitle: job.view.title,
      machineName,
      eventId: e.id,
      kind: e.kind,
      at: e.occurredAt,
      atLocal: localTime(e.occurredAt, timeZone),
      by: actorLabelOf(e),
      text,
    });
  }
  return entries;
}

/** Pure: same jobs + window + opts in, same ShiftReport out. */
export function shiftReport(
  jobs: ShiftReportJobInput[],
  window: ShiftReportWindow,
  opts: ShiftReportOpts = {},
): ShiftReport {
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;

  const allEntries: ShiftReportEntry[] = [];
  const needsAttention: ShiftReportAttentionItem[] = [];
  const handover: ShiftReportHandoverEntry[] = [];
  const jobSnapshots: ShiftReportJobSnapshot[] = [];
  let jobsFinished = 0;

  for (const job of jobs) {
    const entries = buildEntries(job, window, timeZone);
    allEntries.push(...entries);
    const machineName = job.view.machine.name ?? job.notebookName;
    const lastTouch = entries[entries.length - 1] ?? null;
    // F15: attention/counts/finished/handover reflect state AS OF the
    // window's end, never the live log (which may have grown since).
    const asOf = viewAsOfWindowEnd(job, window);
    jobSnapshots.push({ jobId: job.jobId, jobIdShort: job.jobId.slice(0, 8), seq: asOf.seq });

    if (asOf.openSteps > 0) {
      needsAttention.push({
        notebookId: job.notebookId,
        notebookName: job.notebookName,
        jobId: job.jobId,
        jobTitle: job.view.title,
        machineName,
        reason: "open_steps",
        text: `${asOf.openSteps} step(s) still open`,
        by: lastTouch?.by ?? null,
        at: lastTouch?.at ?? null,
      });
    }
    if (asOf.openQuestions > 0) {
      needsAttention.push({
        notebookId: job.notebookId,
        notebookName: job.notebookName,
        jobId: job.jobId,
        jobTitle: job.view.title,
        machineName,
        reason: "open_questions",
        text: `${asOf.openQuestions} question(s) still open`,
        by: lastTouch?.by ?? null,
        at: lastTouch?.at ?? null,
      });
    }
    if (!asOf.finished) {
      needsAttention.push({
        notebookId: job.notebookId,
        notebookName: job.notebookName,
        jobId: job.jobId,
        jobTitle: job.view.title,
        machineName,
        reason: "not_finished",
        text: "job not finished",
        by: lastTouch?.by ?? null,
        at: lastTouch?.at ?? null,
      });
    } else {
      jobsFinished += 1;
    }
    for (const e of entries) {
      if (e.kind === "reading_corrected") {
        needsAttention.push({
          notebookId: job.notebookId,
          notebookName: job.notebookName,
          jobId: job.jobId,
          jobTitle: job.view.title,
          machineName,
          reason: "correction",
          text: e.text,
          by: e.by,
          at: e.at,
        });
      }
    }
    if (asOf.handover.current) {
      handover.push({
        notebookId: job.notebookId,
        notebookName: job.notebookName,
        jobId: job.jobId,
        jobTitle: job.view.title,
        machineName,
        text: asOf.handover.current.text,
        by: asOf.handover.current.by,
        at: asOf.handover.current.at,
      });
    }
  }

  allEntries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const groups = new Map<string, ShiftReportEntry[]>();
  for (const e of allEntries) {
    const key = e.by ?? "Unknown";
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  const byTechnician: ShiftReportTechnicianGroup[] = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([technician, entries]) => ({ technician, entries }));

  const counts: ShiftReportCounts = {
    jobsTouched: jobs.length,
    jobsFinished,
    jobsOpen: jobs.length - jobsFinished,
  };

  const emptyMessage = jobs.length === 0 ? "No jobs were touched during this shift." : null;

  const plainText = [
    emptyMessage ?? "",
    ...needsAttention.map((a) => a.text),
    ...allEntries.map((e) => e.text),
    ...handover.map((h) => h.text),
  ]
    .filter((s) => s.length > 0)
    .join("\n");

  return { window, needsAttention, byTechnician, handover, counts, jobSnapshots, emptyMessage, plainText };
}
