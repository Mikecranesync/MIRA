"use client";
/**
 * The phone "Living Work Sheet" panel (TASK-S3). Pill + full-screen layer,
 * following the MachineObservations.tsx pattern: renders nothing while the
 * capability is off (404 `living_sheet_disabled`) or the notebook is
 * unresolvable; styling uses the shared --fl-* tokens only; tap targets
 * >=48px, base font >=17px (this task's own stricter rule), no sideways
 * scroll — everything here is a single column.
 *
 * Deviations from the spec, recorded here (and in the final report):
 *  - Prop is `receipt: NotebookSheetReceiptFrame | null` (hub-host owns the
 *    tee'd-stream state and passes the latest frame down), not an
 *    `onReceipt` callback registered by this component.
 *  - Writes are optimistic-QUEUED, not optimistic-APPLIED: the view shown
 *    is always the last server response (plus a "Saving…" badge) rather
 *    than a locally re-reduced projection. Re-implementing reduceSheet
 *    client-side was judged not worth the duplication risk for this slice.
 *  - Photos are NOT queued through the localStorage offline queue (a File's
 *    bytes can't be durably serialized into a KvStore entry without a real
 *    storage budget). A failed photo upload shows an inline "Retry" button
 *    instead of joining the queue/drain/badge system the other nine event
 *    kinds use.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { JobSheetBody, JobSheetItem, JobSheetTorque } from "@/capabilities/living-sheet/types";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";
import type { SheetReadingView, SheetStepView, SheetView } from "@/capabilities/living-sheet/reduce";
import type { NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";
import { fileUrl } from "./to-interaction";
import { LivingSheetPrint } from "./LivingSheetPrint";
import { LivingSheetShiftReport } from "./LivingSheetShiftReport";
import { JobSheetsLibrary } from "./JobSheetsLibrary";
import { LivingInstructionControls, PacketIntakeButton } from "./LivingInstructionControls";
import {
  apiGetJob,
  apiGetWorkOrderRequest,
  apiListJobSheetTemplates,
  apiListJobs,
  apiPostEvent,
  apiRequestWorkOrder,
  apiStartJob,
  apiUploadPhoto,
  attemptRequest,
  chosenRevisionOf,
  clearedFieldValue,
  COMMON_READING_UNITS,
  dropHeadOfSheetQueue,
  drainSheetQueue,
  enqueueSheetEvent,
  isDefinitiveRejection,
  loadSheetQueue,
  localStorageStore,
  lowRiskProposalIds,
  photoAttemptBelongsTo,
  stepConfirmBelongsTo,
  type StepConfirm,
  removeFromSheetQueue,
  saveBadge,
  startJobErrorMessage,
  stepNeedsConfirm,
  stepRequiringConfirmFor,
  type JobSheetSummary,
  type JobSummaryClient,
  type PhotoAttempt,
  type SaveBadgeState,
  type SheetEventPost,
  type SheetWriteEvent,
  type WorkOrderRequestClient,
  workOrderStatusText,
  workOrderRetryable,
} from "./living-sheet-client";

// Re-exported so existing tests importing stepNeedsConfirm from this module
// (not living-sheet-client.ts, where the single definition now lives —
// shared with lowRiskProposalIds/stepRequiringConfirmFor) keep working.
export { stepNeedsConfirm };

export type LivingSheetProps = {
  notebookId: string;
  technicianName: string | null;
  /** Fires whenever the open job changes (including to null on close), so
   *  hub-host can thread `livingSheetJobId` into chatBodyFor's rider while
   *  — and only while — this notebook's sheet is open. */
  onSheetOpenChange: (job: { notebookId: string; jobId: string } | null) => void;
  /** The latest sheet_receipt frame hub-host's tee'd stream parser saw, for
   *  ANY open job on ANY notebook — this component filters to its own. */
  receipt: NotebookSheetReceiptFrame | null;
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing — this repo's vitest has no jsdom)
// ---------------------------------------------------------------------------

/** null (gate not resolved yet) and false (disabled) both hide the pill. */
export function shouldShowPill(enabled: boolean | null): boolean {
  return enabled === true;
}

export function openItemsSummary(view: SheetView): { openSteps: number; openQuestions: number; hasOpen: boolean } {
  const { openSteps, openQuestions } = view;
  return { openSteps, openQuestions, hasOpen: openSteps > 0 || openQuestions > 0 };
}

/** Finishing is blocked while something is open UNLESS the technician has
 *  ticked "I know these are still open". Never phrased as fixed/safe. */
export function canFinishJob(hasOpenItems: boolean, acknowledged: boolean): boolean {
  return !hasOpenItems || acknowledged;
}

export function receiptBannerText(count: number): string {
  return `${count} suggestion${count === 1 ? "" : "s"} for the job sheet — Review`;
}

/** The actual 404-disabled gate: GET /sheets returns 404 only when the flag
 *  is off or the notebook doesn't exist (both mean "hide the whole panel").
 *  Any other status means the gate has resolved ON — a 500 or a network
 *  error still shows the pill, with its own error inside the panel, which
 *  is different from "the capability doesn't exist here". */
export function enabledFromListStatus(status: number): boolean {
  return status !== 404;
}

/** Accept/Skip must make a proposal disappear, or a second tap re-posts it
 *  with a new clientEventId the server can't dedupe. Filters the receipt's
 *  proposals down to the ones not yet accepted or skipped. */
export function visibleProposals(proposals: readonly SheetProposal[], handled: ReadonlySet<string>): SheetProposal[] {
  return proposals.filter((p) => !handled.has(p.proposalId));
}

/** R2-34: whether accepting `proposalId` should actually proceed (mint a
 *  write), given the ids already claimed — being processed OR already
 *  handled — for this receipt frame. Checked and the id claimed in the SAME
 *  synchronous step at the call site, so a second accept for an
 *  already-claimed id (double tap, or a duplicate re-render-bound call)
 *  does nothing instead of minting a second write for one proposal. */
export function shouldAcceptProposal(proposalId: string, claimed: ReadonlySet<string>): boolean {
  return !claimed.has(proposalId);
}

/** R2-05: whether an async response for `respondedJobId` may still be
 *  applied to the screen. False once the technician has navigated to a
 *  DIFFERENT job, or closed the sheet entirely, before the response
 *  arrived — template step ids are shared across jobs, so an unguarded
 *  late response can look perfectly valid for the wrong job. */
export function responseStillTargetsSelectedJob(respondedJobId: string, currentlySelectedJobId: string | null): boolean {
  return respondedJobId === currentlySelectedJobId;
}

/** R2-17: the on-screen warning while entries are still queued — printing
 *  now would silently omit them. Null (no banner) once nothing is queued. */
export function pendingPrintWarning(pendingCount: number): string | null {
  if (pendingCount <= 0) return null;
  const plural = pendingCount !== 1;
  return `${pendingCount} change${plural ? "s" : ""} not yet saved — ${plural ? "they" : "it"} will not appear on the print`;
}

// ---------------------------------------------------------------------------
// Styling — shared --fl-* tokens only, tap targets >=48px, base font >=17px
// ---------------------------------------------------------------------------

export type StepConfirmDetail = { what: string; value: string; pattern: string | null; threadLocker: string | null; source: string };

/** The template torque row a step refers to (by `what`, case-insensitive, or
 *  by id), or null when the step names none. Never invents a value. */
export function stepConfirmDetail(step: SheetStepView, torques: readonly JobSheetTorque[]): StepConfirmDetail | null {
  if (!step.torqueRef) return null;
  const ref = step.torqueRef.trim().toLowerCase();
  const t = torques.find((x) => x.id === step.torqueRef || x.what.trim().toLowerCase() === ref);
  if (!t) return null;
  return {
    what: t.what,
    value: t.value === null ? "not written on the job sheet" : `${t.value}${t.unit ? ` ${t.unit}` : ""}`,
    pattern: t.pattern,
    threadLocker: t.threadLocker,
    source: t.source ?? "no source — unverified",
  };
}

export type ConflictValues = { mine: string; theirs: string };

/** F22: the conflict panel must show what EACH side actually says, not just
 *  sequence numbers. "Mine" is the queued-but-unsent local write; "theirs"
 *  is the same field read back off the server's current view (when the
 *  event names one we can look up — otherwise a plain "current sheet"
 *  fallback, never a fabricated value). */
export function conflictValues(event: SheetWriteEvent, serverView: SheetView | null): ConflictValues {
  const theirsFallback = serverView ? `current sheet, seq ${serverView.seq}` : "unknown — the sheet could not be loaded";
  switch (event.kind) {
    case "step_marked": {
      const mine = `Step ${event.payload.done ? "marked done" : "marked not done"}${event.payload.note ? ` — ${event.payload.note}` : ""}`;
      const step = serverView?.steps.find((s) => s.id === event.payload.stepId);
      // R2-19: include the server's own note on the step, not just its
      // done/not-done state — a step conflict was silently omitting it.
      const theirs = step
        ? `Step is ${step.done ? `done (by ${step.doneBy ?? "a technician"})` : "not done"}${step.note ? ` — ${step.note}` : ""}`
        : theirsFallback;
      return { mine, theirs };
    }
    case "reading_recorded":
    case "reading_corrected": {
      const mine = `${event.payload.value} ${event.payload.unit}`;
      const reading = serverView?.readings.find((r) => r.id === event.payload.readingId);
      const theirs = reading ? `${reading.current.value} ${reading.current.unit} (by ${reading.current.by ?? "a technician"})` : theirsFallback;
      return { mine, theirs };
    }
    case "note_added":
      // A brand-new note has no prior identity on the server to look up —
      // this is the genuine "nothing specific to show" case, unlike
      // handover/answer below (R2-19 fixes those; this one legitimately
      // keeps the sequence-based fallback).
      return { mine: `${event.payload.noteKind === "question" ? "Question" : "Note"}: ${event.payload.text}`, theirs: theirsFallback };
    case "question_resolved": {
      // R2-19: show the server's actual current state of THIS question —
      // already answered (by whom), or still open — never a bare seq.
      const mine = `Answer: ${event.payload.resolution}`;
      const question = serverView?.questions.find((q) => q.id === event.payload.noteId);
      const theirs = question
        ? question.resolved
          ? `Already answered: ${question.resolution} (by ${question.resolvedBy ?? "a technician"})`
          : "Still open — no answer recorded yet"
        : theirsFallback;
      return { mine, theirs };
    }
    case "part_logged":
      return { mine: `${event.payload.item} (${event.payload.action})`, theirs: theirsFallback };
    case "handover_written": {
      // R2-19: show the server's actual current handover text, not a seq.
      const mine = event.payload.text;
      const current = serverView?.handover.current;
      const theirs = current ? `${current.text} (by ${current.by ?? "a technician"})` : theirsFallback;
      return { mine, theirs };
    }
    case "photo_attached":
      return { mine: "A photo", theirs: theirsFallback };
    case "job_finished":
      return { mine: "Finish job", theirs: theirsFallback };
    default:
      return { mine: "A change", theirs: theirsFallback };
  }
}

export const SHEET_PILL_STYLE: CSSProperties = {
  background: "var(--fl-surface)", color: "var(--fl-text)", border: "1px solid var(--fl-line)",
  borderRadius: "var(--fl-radius-pill, 999px)", padding: "10px 16px", fontSize: "var(--fl-fs-md, 17px)",
  minHeight: 48, cursor: "pointer",
};

const LAYER_STYLE: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 70, overflowY: "auto",
  background: "var(--fl-surface)", color: "var(--fl-text)", fontFamily: "var(--fl-font)",
  padding: "var(--fl-space-4, 16px)", fontSize: "17px", boxSizing: "border-box",
};

const SECTION_STYLE: CSSProperties = {
  border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", padding: "12px",
  marginBottom: 16, background: "var(--fl-surface)",
};

const FIELD_STYLE: CSSProperties = {
  display: "block", width: "100%", minHeight: 48, marginTop: 6, padding: "10px",
  border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)",
  color: "var(--fl-text)", fontSize: "17px", boxSizing: "border-box",
};

const BUTTON_STYLE: CSSProperties = {
  minHeight: 48, padding: "10px 18px", marginInlineEnd: 8, marginTop: 8, borderRadius: "var(--fl-radius)",
  border: "1px solid var(--fl-line)", background: "var(--fl-accent)", color: "var(--fl-surface)",
  cursor: "pointer", fontSize: "17px",
};

const GHOST_BUTTON_STYLE: CSSProperties = { ...BUTTON_STYLE, background: "var(--fl-surface)", color: "var(--fl-text)" };

const BADGE_STYLE: CSSProperties = {
  position: "sticky", top: 0, zIndex: 1, padding: "6px 10px", borderRadius: "var(--fl-radius)",
  background: "var(--fl-surface)", border: "1px solid var(--fl-line)", fontSize: "var(--fl-fs-sm, 15px)",
  color: "var(--fl-muted)", display: "inline-block",
};

const BANNER_STYLE: CSSProperties = {
  position: "fixed", insetInline: 12, top: "calc(env(safe-area-inset-top, 0px) + 8px)", zIndex: 65,
  background: "var(--fl-accent)", color: "var(--fl-surface)", borderRadius: "var(--fl-radius)",
  padding: "10px 14px", fontSize: "17px", minHeight: 48, cursor: "pointer", border: "none",
  textAlign: "left", display: "block", width: "calc(100% - 24px)",
};

// ---------------------------------------------------------------------------
// Small presentational pieces (pure props -> JSX, no hooks — easy to SSR-test)
// ---------------------------------------------------------------------------

// Exported (R2-13) so its source/drawing-reference line is directly
// SSR-testable (renderToStaticMarkup) without rendering the whole panel.
/** A replaced reading stays visible but is excluded in words, not only by
 *  strike-through (which screen readers and B/W copies can lose). */
export function SupersededReadingLine({ entry }: { entry: SheetReadingView["history"][number] }) {
  return (
    <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>
      Replaced — not used: <s>{entry.value} {entry.unit}</s> — {entry.by ?? "a technician"} ·{" "}
      {new Date(entry.at).toLocaleString()}
    </div>
  );
}

export function StepRow({ step, onToggle }: { step: SheetStepView; onToggle: (step: SheetStepView) => void }) {
  return (
    <li data-testid={`sheet-step-${step.id}`} style={{ marginBottom: 10, listStyle: "none" }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 48 }}>
        <input
          type="checkbox" checked={step.done} onChange={() => onToggle(step)}
          style={{ width: 24, height: 24, marginTop: 2 }}
        />
        <span>
          {step.text}
          {step.checkoff !== "none" && (
            <span style={{ color: "var(--fl-muted)", fontSize: "15px" }}> ({step.checkoff})</span>
          )}
          {/* R2-13: the step's source/drawing reference was omitted from
              execution entirely — never invented, shown only when present. */}
          {step.source && (
            <div style={{ color: "var(--fl-muted)", fontSize: "15px" }} data-testid={`sheet-step-source-${step.id}`}>
              Source: {step.source}
            </div>
          )}
          {step.done && (
            <div style={{ color: "var(--fl-muted)", fontSize: "15px" }}>
              done by {step.doneBy ?? "a technician"} · {new Date(step.doneAt ?? "").toLocaleString()}
            </div>
          )}
        </span>
      </label>
    </li>
  );
}

/** R2-13: a "Bring to the job" row, including the item's own annotation
 *  (`notes` — e.g. a job-sheet-import fixture's "Only if bent"), which
 *  execution was omitting entirely. Exported for direct SSR testing. */
export function BringToJobItemRow({ item }: { item: JobSheetItem }) {
  return (
    <li>
      {item.item}
      {item.spec ? ` — ${item.spec}` : ""}
      {item.qty ? ` x${item.qty}` : ""}
      {item.notes && (
        <div style={{ color: "var(--fl-muted)", fontSize: "15px" }} data-testid={`sheet-item-notes-${item.id}`}>
          {item.notes}
        </div>
      )}
    </li>
  );
}

/** R2-13: the template's return-to-service checks, entirely missing from
 *  execution. Null (renders nothing) when the template has none. */
export function ReturnToServiceSection({ checks }: { checks: readonly string[] }) {
  if (checks.length === 0) return null;
  return (
    <section style={SECTION_STYLE} data-testid="living-sheet-return-to-service">
      <h3 style={{ marginTop: 0 }}>Return-to-service checks</h3>
      <ul>
        {checks.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </section>
  );
}

/** R2-13: the template's own free-text notes, entirely missing from
 *  execution. Null (renders nothing) when there are none. */
export function TemplateNotesSection({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <section style={SECTION_STYLE} data-testid="living-sheet-template-notes">
      <h3 style={{ marginTop: 0 }}>Template notes</h3>
      <p>{text}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

type ConflictInfo = { event: SheetEventPost; serverView: SheetView | null };

export function LivingSheet({ notebookId, technicianName, onSheetOpenChange, receipt }: LivingSheetProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobSummaryClient[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [view, setView] = useState<SheetView | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [badge, setBadge] = useState<SaveBadgeState>({ saving: false, queued: 0, conflict: false });
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [lastRejection, setLastRejection] = useState<string | null>(null);
  // R2-04: every definitively-rejected write this session, with its payload
  // and reason — a rejection must never just vanish behind "Saved".
  const [notAccepted, setNotAccepted] = useState<Array<{ event: SheetEventPost; message: string }>>([]);
  const [handledProposalIds, setHandledProposalIds] = useState<ReadonlySet<string>>(new Set());
  // R2-34: ids claimed SYNCHRONOUSLY at the moment Accept is tapped — before
  // the async write even starts — so a second call for the same proposal
  // (double tap, or a duplicate re-render-bound handler call in the same
  // tick) never mints a second write. A ref, not state: state updates are
  // batched/deferred, which would let two same-tick calls both read the
  // stale "not yet claimed" value.
  const claimedProposalIdsRef = useRef<Set<string>>(new Set());
  // A second tap on the confirm dialog's "Mark done" before it closes must not post twice.
  const confirmInFlightRef = useRef(false);

  const [newTitle, setNewTitle] = useState("");
  const [templates, setTemplates] = useState<JobSheetSummary[] | null>(null);
  const [chosenJobSheetId, setChosenJobSheetId] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // R2-06: the WHOLE frozen Start request (id, occurredAt, title, template)
  // for the current attempt — reused byte-for-byte on retry until it
  // succeeds (cleared) or the technician edits the title (a new attempt).
  // Reusing only the id (the old F16 fix) was not enough: occurredAt was
  // still regenerated on every retry, which changed the server-side
  // idempotency fingerprint and made a lost-response retry look like a new,
  // conflicting request.
  const [pendingStartRequest, setPendingStartRequest] = useState<{
    title: string;
    templateRevisionId: string | null;
    template: JobSheetBody;
    clientEventId: string;
    occurredAt: string;
  } | null>(null);

  const [handoverText, setHandoverText] = useState("");
  const [finishAck, setFinishAck] = useState(false);
  // Explicit, technician-confirmed CMMS work-order request (never automatic).
  const [workOrder, setWorkOrder] = useState<WorkOrderRequestClient | null>(null);
  const [workOrderConfirm, setWorkOrderConfirm] = useState(false);
  const [workOrderBusy, setWorkOrderBusy] = useState(false);
  const [workOrderError, setWorkOrderError] = useState<string | null>(null);
  // F03: a step confirm can be opened either by ticking the checkbox
  // directly (receiptOrigin undefined) or by accepting a chat proposal for
  // a step that needs confirmation (receiptOrigin carries the proposal's id
  // and the receipt's origin seq — F07 — so "Mark done" posts against the
  // SAME baseSeq the proposal was made against, and the proposal is only
  // marked handled once the write actually lands).
  const [confirmStep, setConfirmStep] = useState<StepConfirm | null>(null);
  const [noteText, setNoteText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [readingWhat, setReadingWhat] = useState("");
  const [readingValue, setReadingValue] = useState("");
  const [readingUnit, setReadingUnit] = useState("");
  const [correctingReadingId, setCorrectingReadingId] = useState<string | null>(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [partItem, setPartItem] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // R2-07: the WHOLE frozen photo-upload attempt (the actual File, its
  // baseSeq, caption, and client id) — "Retry" replays this exact attempt
  // rather than forcing a new file-picker interaction, which could change
  // the bytes, and rather than re-reading the CURRENT view.seq, which may
  // have advanced since the first attempt and would turn a lost-response
  // retry into a false conflict.
  // Bound to the notebook + job it was taken for (Codex #5207 F5): a Retry
  // after switching jobs must never post this photo to the other job.
  const [pendingPhotoAttempt, setPendingPhotoAttempt] = useState<PhotoAttempt | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [shiftReportOpen, setShiftReportOpen] = useState(false);
  const [guidePrintMode, setGuidePrintMode] = useState(false);

  // StrictMode-safe (replayed effects must not leave this false permanently — #5091 pattern).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // R2-05: the job actually selected on screen RIGHT NOW, updated
  // synchronously by openJob/closeJob (never via an effect — an effect
  // would lag one render behind the very call that needs it). Every async
  // response checks this before touching view/badge/conflict state, so a
  // late response for a job the technician has since navigated away from
  // can never land on the wrong job's screen.
  const openJobIdRef = useRef<string | null>(null);

  // "sent only while a sheet is open" (TASK-S3) must also hold when this
  // notebook's sheet layer goes away entirely (a notebook switch remounts
  // this component under a fresh key) — hub-host must stop threading the
  // rider for a job that no longer has a live panel. A ref holds the latest
  // callback so the unmount effect fires exactly once without depending on
  // a prop that may be a fresh inline function every render.
  const onSheetOpenChangeRef = useRef(onSheetOpenChange);
  useEffect(() => {
    onSheetOpenChangeRef.current = onSheetOpenChange;
  }, [onSheetOpenChange]);
  useEffect(
    () => () => {
      onSheetOpenChangeRef.current(null);
    },
    [],
  );

  // A fresh receipt (different jobId/baseSeq) starts with nothing handled —
  // only accept/skip within the CURRENT frame.
  const receiptKey = receipt ? `${receipt.jobId}:${receipt.baseSeq}` : null;
  useEffect(() => {
    setHandledProposalIds(new Set());
    claimedProposalIdsRef.current = new Set();
  }, [receiptKey]);

  const scopeId = technicianName ?? notebookId;

  const loadJobs = useCallback(async () => {
    setJobsError(null);
    try {
      const res = await apiListJobs(notebookId);
      if (!enabledFromListStatus(res.status)) {
        if (mounted.current) setEnabled(false);
        return;
      }
      if (!res.ok) {
        if (mounted.current) {
          setEnabled(true);
          setJobsError("Jobs on this machine could not be loaded.");
        }
        return;
      }
      if (mounted.current) {
        setEnabled(true);
        setJobs(res.body.jobs ?? []);
      }
    } catch {
      if (mounted.current) {
        setEnabled(true);
        setJobsError("No reply from the server. Try again.");
      }
    }
  }, [notebookId]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const refreshBadge = useCallback(
    async (jobId: string) => {
      const q = await loadSheetQueue(localStorageStore, scopeId, jobId);
      // R2-05: a late read for a job that's no longer selected must not
      // touch the badge the technician is currently looking at.
      if (mounted.current && responseStillTargetsSelectedJob(jobId, openJobIdRef.current)) {
        setBadge((b) => ({ ...b, queued: q.length }));
      }
    },
    [scopeId],
  );

  const loadSheet = useCallback(
    async (jobId: string) => {
      if (!responseStillTargetsSelectedJob(jobId, openJobIdRef.current)) return;
      setViewError(null);
      try {
        const res = await apiGetJob(notebookId, jobId);
        if (!responseStillTargetsSelectedJob(jobId, openJobIdRef.current)) return;
        if (!res.ok) {
          if (mounted.current) setViewError("The job sheet could not be loaded.");
          return;
        }
        if (mounted.current) setView(res.body.view ?? null);
      } catch {
        if (mounted.current && responseStillTargetsSelectedJob(jobId, openJobIdRef.current)) {
          setViewError("No reply from the server.");
        }
      }
    },
    [notebookId],
  );

  const drain = useCallback(
    async (jobId: string) => {
      const stillSelected = () => responseStillTargetsSelectedJob(jobId, openJobIdRef.current);
      if (mounted.current && stillSelected()) setBadge((b) => ({ ...b, saving: true }));
      const result = await drainSheetQueue(localStorageStore, scopeId, jobId, async (ev) => {
        // The submit itself always proceeds, even for a job the technician
        // has since navigated away from — switching screens must never lose
        // a queued write. Only the SCREEN-facing state below is job-gated.
        const res = await apiPostEvent(notebookId, jobId, ev);
        if (res.ok) return { status: "ok" as const };
        if (res.status === 409 && res.body.error === "conflict") {
          if (mounted.current && stillSelected()) setConflict({ event: ev, serverView: res.body.view ?? null });
          return { status: "conflict" as const };
        }
        if (res.status >= 500 || res.status === 401) throw new Error(res.body.error ?? "server_error");
        const message = startJobErrorMessage(res.body.error, res.body.message);
        return { status: "rejected" as const, message };
      });
      if (!result) return;
      if (mounted.current && stillSelected()) {
        setBadge({ saving: false, queued: result.remaining, conflict: result.conflict, drainStuck: result.drainStuck });
        // R2-04: a non-409 rejection is surfaced with its payload and
        // reason, never silently discarded behind a generic toast.
        if (result.rejected.length > 0) {
          setLastRejection(result.rejected[result.rejected.length - 1]!.message);
          setNotAccepted((prev) => [...prev, ...result.rejected]);
        }
      }
      if (result.sent > 0 && stillSelected()) await loadSheet(jobId);
      return result;
    },
    [scopeId, notebookId, loadSheet],
  );

  const refreshWorkOrder = useCallback(
    async (jobId: string) => {
      try {
        const r = await apiGetWorkOrderRequest(notebookId, jobId);
        if (openJobIdRef.current !== jobId) return;
        if (r.ok) setWorkOrder(r.body.request);
      } catch {
        /* offline — keep the last known status */
      }
    },
    [notebookId],
  );

  const onRequestWorkOrder = useCallback(async () => {
    const jobId = openJobIdRef.current;
    if (!jobId) return;
    setWorkOrderBusy(true);
    setWorkOrderError(null);
    try {
      const r = await apiRequestWorkOrder(notebookId, jobId);
      if (!r.ok) {
        setWorkOrderError(r.body.message ?? "Could not request the work order. Try again.");
        return;
      }
      setWorkOrderConfirm(false);
      await refreshWorkOrder(jobId);
    } catch {
      setWorkOrderError("Not sent — no connection. Try again when you are back online; it will not create a second order.");
    } finally {
      setWorkOrderBusy(false);
    }
  }, [notebookId, refreshWorkOrder]);

  const openJob = useCallback(
    (jobId: string) => {
      openJobIdRef.current = jobId;
      setOpenJobId(jobId);
      setConflict(null);
      setFinishAck(false);
      setWorkOrder(null);
      setWorkOrderConfirm(false);
      setWorkOrderError(null);
      setPendingPhotoAttempt((a) => (photoAttemptBelongsTo(a, notebookId, jobId) ? a : null));
      setPhotoError(null);
      setConfirmStep(null);
      onSheetOpenChange({ notebookId, jobId });
      void loadSheet(jobId);
      void refreshBadge(jobId);
      void refreshWorkOrder(jobId);
    },
    [notebookId, onSheetOpenChange, loadSheet, refreshBadge, refreshWorkOrder],
  );

  const closeJob = useCallback(() => {
    openJobIdRef.current = null;
    setOpenJobId(null);
    setView(null);
    setConflict(null);
    setConfirmStep(null);
    onSheetOpenChange(null);
  }, [onSheetOpenChange]);

  const postEvent = useCallback(
    async (kind: SheetWriteEvent["kind"], payload: SheetWriteEvent["payload"], baseSeqOverride?: number): Promise<boolean> => {
      if (!openJobId || !view) return false;
      const event: SheetEventPost = {
        clientEventId: crypto.randomUUID(),
        // F07: a receipt-accepted write posts against the seq the proposal
        // was ORIGINALLY made against (baseSeqOverride), not whatever
        // view.seq has advanced to by the time the technician taps Accept —
        // otherwise an old proposal can silently supersede a newer value
        // instead of hitting the normal conflict path.
        baseSeq: baseSeqOverride ?? view.seq,
        kind,
        payload,
        occurredAt: new Date().toISOString(),
        workOrderId: null,
      };
      const { saved } = await enqueueSheetEvent(localStorageStore, scopeId, openJobId, event);
      if (!saved) {
        // F06: the write never reached storage (localStorage.setItem threw —
        // private window, quota). The caller must keep its form contents and
        // the badge must never read "Saved" or "Offline — N waiting" — both
        // imply the entry would survive a reload, and this one won't.
        if (mounted.current) setBadge((b) => ({ ...b, storageFailed: true }));
        return false;
      }
      if (mounted.current) setBadge((b) => ({ ...b, storageFailed: false }));
      await refreshBadge(openJobId);
      const result = await drain(openJobId);
      // R2-04: a non-409 rejection must never be reported as saved — check
      // whether THIS specific write (by clientEventId) ended up rejected
      // during the drain this call just triggered.
      if (result?.rejected.some((r) => r.event.clientEventId === event.clientEventId)) return false;
      return true;
    },
    [openJobId, view, scopeId, refreshBadge, drain],
  );

  // Drain on reconnect and every 15s while something is queued (spec's sync
  // rule). R2-20: once drainStuck is set, this phone's storage can't be
  // trusted to drain at all — stop retrying automatically (the technician
  // is told to reload) rather than hammering the server every 15s with a
  // write it can never durably remove from the queue.
  useEffect(() => {
    if (!openJobId || badge.drainStuck) return;
    const onOnline = () => void drain(openJobId);
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(() => {
      if (badge.queued > 0) void drain(openJobId);
    }, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
    };
  }, [openJobId, drain, badge.queued, badge.drainStuck]);

  const openTemplatePicker = useCallback(async () => {
    const list = await apiListJobSheetTemplates();
    if (mounted.current) setTemplates(list ?? []);
  }, []);

  const startJob = useCallback(async () => {
    // R2-06: attemptRequest freezes the WHOLE request on the first attempt
    // (not just the id) and replays it byte-for-byte on every retry — a
    // regenerated occurredAt (or a re-picked template) would otherwise
    // change the server-side idempotency fingerprint and turn a
    // lost-response retry into a false conflict.
    const request = attemptRequest(pendingStartRequest, () => {
      const title = newTitle.trim();
      const chosen = templates?.find((t) => t.jobSheetId === chosenJobSheetId) ?? null;
      const revision = chosen ? chosenRevisionOf(chosen).revision : null;
      const template: JobSheetBody = revision?.body ?? {
        title, machineLabel: null, component: null, jobType: null, estHours: null, crewSize: null,
        isolationPoints: null, cautions: null, returnToService: [], items: [], torques: [], steps: [],
        author: null, notes: null,
      };
      return {
        title,
        templateRevisionId: revision?.id ?? null,
        template,
        clientEventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
      };
    });
    if (!request.title) return;
    setStarting(true);
    setStartError(null);
    if (!pendingStartRequest) setPendingStartRequest(request);
    try {
      const res = await apiStartJob(notebookId, request);
      if (!res.ok || !res.body.jobId) {
        setStartError(startJobErrorMessage(res.body.error, res.body.message));
        // A definitive refusal created nothing: the next tap starts a fresh
        // attempt from the current inputs. Anything else keeps this SAME
        // attempt so a retry cannot create a duplicate.
        if (isDefinitiveRejection(res.status)) setPendingStartRequest(null);
        return;
      }
      setNewTitle("");
      setChosenJobSheetId("");
      setPendingStartRequest(null); // attempt succeeded — a future Start is a new attempt
      await loadJobs();
      openJob(res.body.jobId);
    } catch {
      setStartError("No reply from the server. Retry — it will not create a duplicate.");
      // keep pendingStartRequest pending — same reasoning as the rejection branch above
    } finally {
      setStarting(false);
    }
  }, [newTitle, templates, chosenJobSheetId, notebookId, loadJobs, openJob, pendingStartRequest]);

  const onToggleStep = useCallback(
    (step: SheetStepView) => {
      if (stepNeedsConfirm(step)) {
        const jobId = openJobIdRef.current;
        if (jobId) setConfirmStep({ notebookId, jobId, step });
        return;
      }
      void postEvent("step_marked", { stepId: step.id, done: !step.done, note: null });
    },
    [notebookId, postEvent],
  );

  const onConfirmMarkDone = useCallback(() => {
    if (confirmInFlightRef.current || !confirmStep) return;
    // Codex r2 F8: the dialog only posts to the job it was opened on; a
    // stale one (the technician switched jobs) is dropped, never sent.
    if (!stepConfirmBelongsTo(confirmStep, notebookId, openJobIdRef.current)) {
      setConfirmStep(null);
      return;
    }
    confirmInFlightRef.current = true;
    const { step, receiptOrigin: origin } = confirmStep;
    void (async () => {
      // F07: when this confirm was opened from a chat proposal, post against
      // the proposal's origin seq, and only mark the proposal handled once
      // the write actually lands.
      const ok = await postEvent("step_marked", { stepId: step.id, done: true, note: null }, origin?.baseSeq);
      if (ok && origin) setHandledProposalIds((prev) => new Set([...prev, origin.proposalId]));
    })().finally(() => { confirmInFlightRef.current = false; });
    setConfirmStep(null);
  }, [confirmStep, notebookId, postEvent]);

  // F06: each "add" handler only clears its own form once postEvent reports
  // the write actually reached storage — a swallowed localStorage failure
  // must never look like a successful submit from the technician's seat.
  // R2-02: every clear below uses `clearedFieldValue`, which only clears
  // when the save actually succeeded AND the field still holds EXACTLY the
  // snapshot taken before the (possibly slow) await — if the technician
  // kept typing while it was in flight, their newer text survives even
  // though the earlier save succeeded.
  const onAddNote = useCallback(async () => {
    const submitted = noteText;
    const text = submitted.trim();
    if (!text) return;
    const ok = await postEvent("note_added", { noteId: crypto.randomUUID(), text, noteKind: "note" });
    setNoteText((current) => clearedFieldValue(ok, submitted, current));
  }, [noteText, postEvent]);

  const onAddQuestion = useCallback(async () => {
    const submitted = questionText;
    const text = submitted.trim();
    if (!text) return;
    const ok = await postEvent("note_added", { noteId: crypto.randomUUID(), text, noteKind: "question" });
    setQuestionText((current) => clearedFieldValue(ok, submitted, current));
  }, [questionText, postEvent]);

  // R2-02: fire-and-forget → an awaited result the child (ResolveQuestion)
  // uses to decide whether it may clear its own answer text.
  const onResolveQuestion = useCallback(
    (noteId: string, resolution: string) => postEvent("question_resolved", { noteId, resolution }),
    [postEvent],
  );

  const onAddReading = useCallback(async () => {
    const what = readingWhat.trim();
    const unit = readingUnit.trim();
    const value = Number(readingValue);
    if (!what || !unit || !Number.isFinite(value)) return;
    const submittedValue = readingValue;
    const submittedWhat = readingWhat;
    const submittedUnit = readingUnit;
    const ok = await postEvent("reading_recorded", {
      readingId: crypto.randomUUID(), what, value, unit, source: { kind: "tech", ref: technicianName },
    });
    setReadingWhat((current) => clearedFieldValue(ok, submittedWhat, current));
    setReadingValue((current) => clearedFieldValue(ok, submittedValue, current));
    setReadingUnit((current) => clearedFieldValue(ok, submittedUnit, current));
  }, [readingWhat, readingValue, readingUnit, technicianName, postEvent]);

  // F21: records a reading_corrected event against the SAME readingId — the
  // reduced view already keeps every prior value in that reading's history
  // (reduce.ts), rendered struck-through with who/when below. This is the
  // "direct Correct control" the working sheet was missing.
  const onCorrectReading = useCallback(
    async (readingId: string, unit: string) => {
      const submitted = correctionValue;
      const value = Number(submitted);
      if (!Number.isFinite(value)) return;
      const ok = await postEvent("reading_corrected", { readingId, value, unit, reason: null });
      // React applies the updater synchronously (even though the re-render
      // is deferred), so `stillUnchanged` reflects the REAL current value
      // at clear-time, not the stale `correctionValue` this closure captured
      // back when onCorrectReading was created.
      let stillUnchanged = false;
      setCorrectionValue((current) => {
        stillUnchanged = current === submitted;
        return clearedFieldValue(ok, submitted, current);
      });
      // Only close the correction form if the value wasn't changed out from
      // under the in-flight save — otherwise leave it open with whatever
      // the technician has typed since.
      if (ok && stillUnchanged) setCorrectingReadingId(null);
    },
    [correctionValue, postEvent],
  );

  const onAddPart = useCallback(async () => {
    const submitted = partItem;
    const item = submitted.trim();
    if (!item) return;
    const ok = await postEvent("part_logged", { partEntryId: crypto.randomUUID(), item, action: "used", qty: null });
    setPartItem((current) => clearedFieldValue(ok, submitted, current));
  }, [partItem, postEvent]);

  const onSaveHandover = useCallback(() => {
    const text = handoverText.trim();
    if (!text) return;
    void postEvent("handover_written", { text });
  }, [handoverText, postEvent]);

  const onFinish = useCallback(() => {
    void postEvent("job_finished", { summary: null, openItemsAcknowledged: finishAck });
  }, [finishAck, postEvent]);

  // R2-07: replays the EXACT frozen attempt (same File bytes, same baseSeq,
  // same clientEventId) — never re-reads the current view.seq or asks for a
  // fresh file pick, either of which would change the server-side
  // idempotency fingerprint and turn a lost-response retry into a false
  // conflict.
  const uploadPhotoAttempt = useCallback(
    async (attempt: PhotoAttempt) => {
      if (!photoAttemptBelongsTo(attempt, notebookId, openJobIdRef.current)) return;
      setPhotoBusy(true);
      setPhotoError(null);
      const stillSelected = () => openJobIdRef.current === attempt.jobId;
      try {
        const res = await apiUploadPhoto(attempt.notebookId, attempt.jobId, attempt.file, {
          clientEventId: attempt.clientEventId,
          baseSeq: attempt.baseSeq,
          caption: attempt.caption,
        });
        if (!res.ok) {
          if (stillSelected()) setPhotoError(startJobErrorMessage(res.body.error, res.body.message));
          return; // keep pendingPhotoAttempt — Retry replays this EXACT attempt
        }
        setPendingPhotoAttempt((a) => (a?.clientEventId === attempt.clientEventId ? null : a)); // attempt succeeded
        if (stillSelected()) await loadSheet(attempt.jobId);
      } catch {
        if (stillSelected()) setPhotoError("No reply from the server. Retry — the photo was not saved.");
        // keep pendingPhotoAttempt pending — same reasoning as the rejection branch
      } finally {
        setPhotoBusy(false);
      }
    },
    [notebookId, loadSheet],
  );

  // Picking a photo is always a deliberate NEW attempt — fresh id, fresh
  // baseSeq, fresh bytes. Only onRetryPhoto below replays an existing one.
  const onUploadPhoto = useCallback(
    (file: File) => {
      const jobId = openJobIdRef.current;
      if (!view || !jobId) return;
      const attempt: PhotoAttempt = {
        notebookId,
        jobId,
        file,
        baseSeq: view.seq,
        clientEventId: crypto.randomUUID(),
        caption: null,
      };
      setPendingPhotoAttempt(attempt);
      void uploadPhotoAttempt(attempt);
    },
    [view, notebookId, uploadPhotoAttempt],
  );

  const onRetryPhoto = useCallback(() => {
    if (photoAttemptBelongsTo(pendingPhotoAttempt, notebookId, openJobIdRef.current)) {
      void uploadPhotoAttempt(pendingPhotoAttempt!);
    }
  }, [pendingPhotoAttempt, notebookId, uploadPhotoAttempt]);

  const onKeepTheirs = useCallback(async () => {
    if (!openJobId) return;
    await dropHeadOfSheetQueue(localStorageStore, scopeId, openJobId);
    setConflict(null);
    if (conflict?.serverView) setView(conflict.serverView);
    // Anything queued behind the dropped conflict is still waiting — without
    // this, those items sit until the 15s tick and the badge stays "conflict".
    await drain(openJobId);
  }, [openJobId, scopeId, conflict, drain]);

  const onUseMine = useCallback(async () => {
    if (!openJobId || !conflict) return;
    // R2-03: build and durably enqueue the REPLACEMENT first, by the
    // original entry's own clientEventId — never touch the original until
    // its replacement is confirmed to have actually persisted. Removing
    // "the head" first (the old approach) could delete the technician's
    // only durable correction if the replacement then failed to save, and
    // a second tap after that failure would drop a completely different
    // queued entry (whatever had since become the new head).
    const freshSeq = conflict.serverView?.seq ?? conflict.event.baseSeq;
    const retry: SheetEventPost = { ...conflict.event, clientEventId: crypto.randomUUID(), baseSeq: freshSeq };
    const { saved } = await enqueueSheetEvent(localStorageStore, scopeId, openJobId, retry);
    if (!saved) {
      // F06 on this path too: the replacement never reached storage, so
      // the original stays exactly where it is and the conflict panel
      // stays open — nothing is removed.
      if (mounted.current) setBadge((b) => ({ ...b, storageFailed: true }));
      return;
    }
    // Only now remove the ORIGINAL — by its own clientEventId, never "the
    // head" (which may have moved, or already be a different entry).
    await removeFromSheetQueue(localStorageStore, scopeId, openJobId, conflict.event.clientEventId);
    setConflict(null);
    if (conflict.serverView) setView(conflict.serverView);
    await drain(openJobId);
  }, [openJobId, scopeId, conflict, drain]);

  const onReceiptAccept = useCallback(
    (proposalId: string, event: SheetWriteEvent, originSeq: number) => {
      // R2-34: claim the proposal SYNCHRONOUSLY, before the async write
      // even starts — a second call for the same proposal (double tap, or
      // a duplicate re-render-bound call in the same tick) must see it as
      // already claimed and do nothing, rather than minting a second write.
      if (!shouldAcceptProposal(proposalId, claimedProposalIdsRef.current)) return;
      // F03: a step that still needs the torque/loctite/measurement confirm
      // opens the SAME dialog the checkbox path uses (value + source),
      // instead of posting "done" straight through. F07: the receipt's own
      // origin seq travels with it, so the eventual post — whether it goes
      // straight through below or via the confirm dialog's Mark done — uses
      // the seq the proposal was actually made against, not whatever
      // view.seq has advanced to by the time the technician taps Accept.
      // (Opening the confirm dialog does not itself claim the proposal —
      // nothing has been minted yet; the dialog's own "Mark done" claims it.)
      const stepNeedingConfirm = view ? stepRequiringConfirmFor(event, view.steps) : null;
      if (stepNeedingConfirm) {
        const jobId = openJobIdRef.current;
        if (jobId) {
          setConfirmStep({ notebookId, jobId, step: stepNeedingConfirm, receiptOrigin: { proposalId, baseSeq: originSeq } });
        }
        return;
      }
      claimedProposalIdsRef.current.add(proposalId);
      void (async () => {
        const ok = await postEvent(event.kind, event.payload, originSeq);
        if (ok) {
          setHandledProposalIds((prev) => new Set([...prev, proposalId]));
        } else {
          claimedProposalIdsRef.current.delete(proposalId); // failed — a retry tap must work
        }
      })();
    },
    [notebookId, postEvent, view],
  );

  const onReceiptSkip = useCallback((proposalId: string) => {
    setHandledProposalIds((prev) => new Set([...prev, proposalId]));
  }, []);

  if (enabled !== true) return null;

  const thisReceipt = receipt && openJobId && receipt.jobId === openJobId ? receipt : null;
  // The SSE frame types `proposals` as `unknown[]` (notebook-chat-types.ts has
  // no dependency on the living-sheet capability) — it is really
  // `SheetProposal[]` (propose.ts), which is what hub-host's tee branch fed it.
  const allProposals = (thisReceipt?.proposals ?? []) as unknown as SheetProposal[];
  const proposals = visibleProposals(allProposals, handledProposalIds);
  const lowRiskIds = lowRiskProposalIds(proposals, view?.steps ?? []);

  return (
    <>
      <button type="button" style={SHEET_PILL_STYLE} data-testid="living-sheet-pill" onClick={() => setOpen((v) => !v)}>
        Job sheet
      </button>

      {!open && proposals.length > 0 && (
        <button type="button" style={BANNER_STYLE} data-testid="living-sheet-receipt-banner" onClick={() => setOpen(true)}>
          {receiptBannerText(proposals.length)}
        </button>
      )}

      {open && (
        <section role="dialog" aria-label="Job sheet" style={LAYER_STYLE} data-testid="living-sheet-layer">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: "20px", margin: 0 }}>{openJobId ? view?.title ?? "Job sheet" : "Jobs on this machine"}</h2>
            <button type="button" style={GHOST_BUTTON_STYLE} onClick={() => setOpen(false)} data-testid="living-sheet-close">
              Close
            </button>
          </header>

          {!openJobId && (
            <div data-testid="living-sheet-job-list">
              <PacketIntakeButton key={notebookId} notebookId={notebookId} scopeId={scopeId} onImported={openJob} />
              {jobsError && <p role="alert">{jobsError}</p>}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button
                  type="button" style={GHOST_BUTTON_STYLE} onClick={() => setLibraryOpen(true)}
                  data-testid="living-sheet-open-job-sheets"
                >
                  Job sheets
                </button>
                <button
                  type="button" style={GHOST_BUTTON_STYLE} onClick={() => setShiftReportOpen(true)}
                  data-testid="living-sheet-open-shift-report"
                >
                  Shift report
                </button>
              </div>
              {libraryOpen && <JobSheetsLibrary onClose={() => setLibraryOpen(false)} />}
              {shiftReportOpen && <LivingSheetShiftReport onClose={() => setShiftReportOpen(false)} />}
              <ul style={{ listStyle: "none", paddingInlineStart: 0 }}>
                {(jobs ?? []).map((j) => (
                  <li key={j.jobId} style={{ marginBottom: 8 }}>
                    <button
                      type="button" style={{ ...GHOST_BUTTON_STYLE, width: "100%", textAlign: "left" }}
                      onClick={() => openJob(j.jobId)} data-testid={`living-sheet-job-${j.jobId}`}
                    >
                      {/* JobSummary has no open-steps count (seq is an event
                          counter, not a step tally) — this is a known gap,
                          not fixed here; see the S3 report's hazard ledger. */}
                      {j.title} — {j.finished ? "finished" : `${j.seq} update${j.seq === 1 ? "" : "s"}`}
                      <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>
                        started by {j.startedBy ?? "a technician"} · {new Date(j.startedAt).toLocaleString()}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              <section style={SECTION_STYLE}>
                <h3 style={{ marginTop: 0 }}>Start a job</h3>
                <label>
                  Title
                  <input style={FIELD_STYLE} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} data-testid="living-sheet-new-title" />
                </label>
                {templates === null ? (
                  <button type="button" style={GHOST_BUTTON_STYLE} onClick={openTemplatePicker} data-testid="living-sheet-template-pick">
                    Use a job sheet template
                  </button>
                ) : templates.length > 0 ? (
                  <label>
                    Job sheet template (optional)
                    <select style={FIELD_STYLE} value={chosenJobSheetId} onChange={(e) => setChosenJobSheetId(e.target.value)} data-testid="living-sheet-template-select">
                      <option value="">None</option>
                      {templates.map((t) => {
                        const { revision, isDraft } = chosenRevisionOf(t);
                        return (
                          <option key={t.jobSheetId} value={t.jobSheetId}>
                            {revision.body.title}
                            {isDraft ? " (DRAFT)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                ) : null}
                {startError && <p role="alert">{startError}</p>}
                <button type="button" style={BUTTON_STYLE} disabled={!newTitle.trim() || starting} onClick={startJob} data-testid="living-sheet-start">
                  {starting ? "Starting…" : "Start a job"}
                </button>
              </section>
            </div>
          )}

          {openJobId && view && (
            <div data-testid="living-sheet-sheet">
              <LivingInstructionControls key={`${notebookId}:${view.jobId}:${view.seq}`} notebookId={notebookId} scopeId={scopeId} view={view} pendingCount={badge.queued} onPrintMode={setGuidePrintMode} />
              <div style={{ marginBottom: 12 }}>
                <span style={BADGE_STYLE} data-testid="living-sheet-badge">{saveBadge(badge)}</span>
                {" "}
                <span style={{ fontSize: "15px", color: "var(--fl-muted)" }}>{view.machine.name ?? ""} · Job {view.jobId.slice(0, 8)}</span>
                <button type="button" style={GHOST_BUTTON_STYLE} onClick={closeJob} data-testid="living-sheet-back-to-jobs">Back to jobs</button>
              </div>

              {badge.queued > 0 && (
                <p style={{ fontSize: "15px", color: "var(--fl-muted)" }}>Keep this page open until you have signal again.</p>
              )}

              {lastRejection && (
                <p role="alert" data-testid="living-sheet-last-rejection">
                  {lastRejection}
                </p>
              )}

              {notAccepted.length > 0 && (
                <section style={SECTION_STYLE} data-testid="living-sheet-not-accepted">
                  <h3 style={{ marginTop: 0 }}>Not accepted</h3>
                  {notAccepted.map((r, i) => (
                    <p key={`${r.event.clientEventId}-${i}`} role="alert">
                      {conflictValues(r.event as SheetWriteEvent, null).mine} — {r.message}{" "}
                      <button
                        type="button" style={GHOST_BUTTON_STYLE}
                        onClick={() => setNotAccepted((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        Dismiss
                      </button>
                    </p>
                  ))}
                </section>
              )}

              {conflict && (() => {
                // F22: show BOTH competing values, not just sequence numbers,
                // before offering "Use mine".
                const { mine, theirs } = conflictValues(conflict.event as SheetWriteEvent, conflict.serverView);
                return (
                  <section style={{ ...SECTION_STYLE, borderColor: "var(--fl-accent)" }} data-testid="living-sheet-conflict">
                    <h3 style={{ marginTop: 0 }}>Someone else changed this sheet too</h3>
                    <p data-testid="living-sheet-conflict-theirs">Theirs: {theirs}</p>
                    <p data-testid="living-sheet-conflict-mine">Yours: {mine}</p>
                    <button type="button" style={GHOST_BUTTON_STYLE} onClick={onKeepTheirs} data-testid="living-sheet-keep-theirs">Keep theirs</button>
                    <button type="button" style={BUTTON_STYLE} onClick={onUseMine} data-testid="living-sheet-use-mine">Use mine</button>
                  </section>
                );
              })()}

              {proposals.length > 0 && (
                <section style={SECTION_STYLE} data-testid="living-sheet-receipt-card">
                  <h3 style={{ marginTop: 0 }}>MIRA suggests {proposals.length} change{proposals.length === 1 ? "" : "s"} to the sheet</h3>
                  {proposals.map((p) => (
                    <div key={p.proposalId} style={{ marginBottom: 10, borderTop: "1px solid var(--fl-line)", paddingTop: 8 }}>
                      <p style={{ margin: 0 }}>{p.reason}</p>
                      <p style={{ margin: 0, fontStyle: "italic", color: "var(--fl-muted)" }}>&ldquo;{p.quote}&rdquo;</p>
                      <button
                        type="button" style={BUTTON_STYLE}
                        onClick={() => onReceiptAccept(p.proposalId, p.event as SheetWriteEvent, thisReceipt?.baseSeq ?? view.seq)}
                      >
                        Accept
                      </button>
                      <button type="button" style={GHOST_BUTTON_STYLE} onClick={() => onReceiptSkip(p.proposalId)}>Skip</button>
                    </div>
                  ))}
                  {lowRiskIds.length > 0 && (
                    <button
                      type="button" style={BUTTON_STYLE}
                      onClick={() => {
                        for (const p of proposals) {
                          if (lowRiskIds.includes(p.proposalId)) {
                            onReceiptAccept(p.proposalId, p.event as SheetWriteEvent, thisReceipt?.baseSeq ?? view.seq);
                          }
                        }
                      }}
                    >
                      Accept all low-risk
                    </button>
                  )}
                </section>
              )}

              <section style={SECTION_STYLE} data-testid="living-sheet-safety">
                <h3 style={{ marginTop: 0 }}>Safety</h3>
                <p style={{ fontSize: "15px", color: "var(--fl-muted)" }}>From your site procedure — MIRA never fills this in.</p>
                <p>{view.template.isolationPoints || "Not written — follow your site's lockout procedure."}</p>
                {view.template.cautions && <p>{view.template.cautions}</p>}
              </section>

              <ReturnToServiceSection checks={view.template.returnToService} />
              <TemplateNotesSection text={view.template.notes} />

              {view.template.items.length > 0 && (
                <section style={SECTION_STYLE} data-testid="living-sheet-bring-to-job">
                  <h3 style={{ marginTop: 0 }}>Bring to the job</h3>
                  <ul>
                    {view.template.items.map((it) => (
                      <BringToJobItemRow key={it.id} item={it} />
                    ))}
                  </ul>
                </section>
              )}

              <section style={SECTION_STYLE} data-testid="living-sheet-steps">
                <h3 style={{ marginTop: 0 }}>Steps</h3>
                <ul style={{ paddingInlineStart: 0 }}>
                  {view.steps.map((s) => (
                    <StepRow key={s.id} step={s} onToggle={onToggleStep} />
                  ))}
                </ul>
                {confirmStep && stepConfirmBelongsTo(confirmStep, notebookId, openJobId) && (() => {
                  const detail = stepConfirmDetail(confirmStep.step, view.template.torques);
                  return (
                    <div role="dialog" aria-label="Check before marking done" style={SECTION_STYLE} data-testid="living-sheet-step-confirm">
                      <p style={{ marginTop: 0 }}><strong>{confirmStep.step.text}</strong></p>
                      {detail ? (
                        <>
                          <p style={{ margin: "4px 0" }}>Job sheet says: {detail.what} — {detail.value}</p>
                          {detail.pattern && <p style={{ margin: "4px 0" }}>Pattern: {detail.pattern}</p>}
                          {detail.threadLocker && <p style={{ margin: "4px 0" }}>Thread-locker: {detail.threadLocker}</p>}
                          <p style={{ margin: "4px 0", color: "var(--fl-muted)" }}>Source: {detail.source}</p>
                        </>
                      ) : (
                        <p style={{ margin: "4px 0", color: "var(--fl-muted)" }}>The job sheet has no value written for this step.</p>
                      )}
                      <button
                        type="button" style={BUTTON_STYLE} data-testid="living-sheet-step-confirm-done"
                        onClick={onConfirmMarkDone}
                      >
                        Mark done
                      </button>{" "}
                      <button type="button" style={GHOST_BUTTON_STYLE} onClick={() => setConfirmStep(null)}>Cancel</button>
                    </div>
                  );
                })()}
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-readings">
                <h3 style={{ marginTop: 0 }}>Readings</h3>
                {view.readings.map((r: SheetReadingView) => (
                  <div key={r.id} style={{ marginBottom: 8 }} data-testid={`living-sheet-reading-${r.id}`}>
                    <strong>{r.what}: {r.current.value} {r.current.unit}</strong>
                    <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>
                      by {r.current.by ?? "a technician"} · {new Date(r.current.at).toLocaleString()}
                    </div>
                    {/* F21: earlier values stay visible, struck through, with
                        who/when — never silently replaced. */}
                    {r.history
                      .filter((h) => h.superseded)
                      .map((h, i) => <SupersededReadingLine key={i} entry={h} />)}
                    {correctingReadingId === r.id ? (
                      <div style={{ marginTop: 4 }}>
                        <input
                          style={FIELD_STYLE} inputMode="decimal" value={correctionValue}
                          onChange={(e) => setCorrectionValue(e.target.value)}
                          data-testid={`living-sheet-correct-value-${r.id}`}
                        />
                        <button
                          type="button" style={BUTTON_STYLE} disabled={!correctionValue.trim()}
                          onClick={() => void onCorrectReading(r.id, r.current.unit)}
                          data-testid={`living-sheet-correct-save-${r.id}`}
                        >
                          Save correction
                        </button>{" "}
                        <button type="button" style={GHOST_BUTTON_STYLE} onClick={() => setCorrectingReadingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        type="button" style={GHOST_BUTTON_STYLE}
                        onClick={() => {
                          setCorrectingReadingId(r.id);
                          setCorrectionValue("");
                        }}
                        data-testid={`living-sheet-correct-${r.id}`}
                      >
                        Correct
                      </button>
                    )}
                  </div>
                ))}
                <label>
                  What
                  <input style={FIELD_STYLE} value={readingWhat} onChange={(e) => setReadingWhat(e.target.value)} />
                </label>
                <label>
                  Value
                  <input style={FIELD_STYLE} inputMode="decimal" value={readingValue} onChange={(e) => setReadingValue(e.target.value)} />
                </label>
                <label>
                  Unit
                  <select style={FIELD_STYLE} value={readingUnit} onChange={(e) => setReadingUnit(e.target.value)}>
                    <option value="">Choose…</option>
                    {COMMON_READING_UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </label>
                <button type="button" style={BUTTON_STYLE} disabled={!readingWhat.trim() || !readingUnit || !readingValue} onClick={onAddReading}>
                  Add reading
                </button>
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-notes">
                <h3 style={{ marginTop: 0 }}>Notes &amp; open questions</h3>
                {view.notes.map((n) => <p key={n.id}>{n.text}</p>)}
                {view.questions.map((q) => (
                  <div key={q.id} style={{ marginBottom: 8 }}>
                    <p style={{ margin: 0 }}>{q.text}</p>
                    {q.resolved ? (
                      <p style={{ margin: 0, color: "var(--fl-muted)" }}>Answered: {q.resolution}</p>
                    ) : (
                      <ResolveQuestion questionId={q.id} onResolve={onResolveQuestion} />
                    )}
                  </div>
                ))}
                <label>
                  Note
                  <input style={FIELD_STYLE} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                </label>
                <button type="button" style={GHOST_BUTTON_STYLE} disabled={!noteText.trim()} onClick={onAddNote}>Add note</button>
                <label>
                  Open question
                  <input style={FIELD_STYLE} value={questionText} onChange={(e) => setQuestionText(e.target.value)} />
                </label>
                <button type="button" style={GHOST_BUTTON_STYLE} disabled={!questionText.trim()} onClick={onAddQuestion}>Add question</button>
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-parts">
                <h3 style={{ marginTop: 0 }}>Parts used</h3>
                {view.parts.map((p) => <p key={p.id}>{p.item} ({p.action})</p>)}
                <label>
                  Part / item
                  <input style={FIELD_STYLE} value={partItem} onChange={(e) => setPartItem(e.target.value)} />
                </label>
                <button type="button" style={GHOST_BUTTON_STYLE} disabled={!partItem.trim()} onClick={onAddPart}>Add part</button>
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-photos">
                <h3 style={{ marginTop: 0 }}>Photos</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {view.photos.map((p) => (
                    <a key={p.id} href={fileUrl(p.fileId)} target="_blank" rel="noreferrer">
                      <img src={fileUrl(p.fileId)} alt={p.caption ?? "job photo"} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: "var(--fl-radius)" }} />
                    </a>
                  ))}
                </div>
                {photoError && (
                  <p role="alert">
                    {photoError}
                    {photoAttemptBelongsTo(pendingPhotoAttempt, notebookId, openJobId) && (
                      <>
                        {" "}
                        <button
                          type="button" style={GHOST_BUTTON_STYLE} onClick={onRetryPhoto} disabled={photoBusy}
                          data-testid="living-sheet-photo-retry"
                        >
                          Retry
                        </button>
                      </>
                    )}
                  </p>
                )}
                <label style={BUTTON_STYLE}>
                  {photoBusy ? "Uploading…" : "Take photo"}
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: "none" }} disabled={photoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) onUploadPhoto(f);
                    }}
                  />
                </label>
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-handover">
                <h3 style={{ marginTop: 0 }}>Handover</h3>
                {view.handover.current && <p>{view.handover.current.text}</p>}
                <textarea style={{ ...FIELD_STYLE, minHeight: 80 }} value={handoverText} onChange={(e) => setHandoverText(e.target.value)} />
                <button type="button" style={GHOST_BUTTON_STYLE} disabled={!handoverText.trim()} onClick={onSaveHandover}>Save</button>
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-finish">
                <h3 style={{ marginTop: 0 }}>Finish job</h3>
                {view.finished ? (
                  <p>Finished by {view.finished.by ?? "a technician"} · {new Date(view.finished.at).toLocaleString()}</p>
                ) : (
                  <>
                    <p>Open steps: {view.openSteps} · Open questions: {view.openQuestions}</p>
                    {openItemsSummary(view).hasOpen && (
                      <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48 }}>
                        <input type="checkbox" checked={finishAck} onChange={(e) => setFinishAck(e.target.checked)} style={{ width: 24, height: 24 }} />
                        I know these are still open
                      </label>
                    )}
                    <button
                      type="button" style={BUTTON_STYLE}
                      disabled={!canFinishJob(openItemsSummary(view).hasOpen, finishAck)}
                      onClick={onFinish} data-testid="living-sheet-finish-button"
                    >
                      Finish job
                    </button>
                  </>
                )}
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-work-order">
                <h3 style={{ marginTop: 0 }}>Work order in the CMMS</h3>
                {workOrder ? (
                  <>
                    <p data-testid="living-sheet-work-order-status">{workOrderStatusText(workOrder)}</p>
                    {workOrderRetryable(workOrder) && (
                      <button
                        type="button" style={BUTTON_STYLE} disabled={workOrderBusy}
                        onClick={() => void onRequestWorkOrder()} data-testid="living-sheet-work-order-retry"
                      >
                        Try again
                      </button>
                    )}
                    <button
                      type="button" style={GHOST_BUTTON_STYLE}
                      onClick={() => { if (openJobId) void refreshWorkOrder(openJobId); }}
                    >
                      Refresh status
                    </button>
                  </>
                ) : workOrderConfirm ? (
                  <>
                    <p>
                      This creates one work order in the CMMS with this sheet&apos;s steps, readings, open items and sources.
                      It does not mark the machine repaired, healthy or safe.
                    </p>
                    <button
                      type="button" style={BUTTON_STYLE} disabled={workOrderBusy}
                      onClick={() => void onRequestWorkOrder()} data-testid="living-sheet-work-order-confirm"
                    >
                      Yes, create it
                    </button>
                    <button type="button" style={GHOST_BUTTON_STYLE} disabled={workOrderBusy} onClick={() => setWorkOrderConfirm(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button" style={GHOST_BUTTON_STYLE}
                    onClick={() => setWorkOrderConfirm(true)} data-testid="living-sheet-work-order-button"
                  >
                    Create work order…
                  </button>
                )}
                {workOrderError && <p role="alert">{workOrderError}</p>}
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-print-section">
                <h3 style={{ marginTop: 0 }}>Print</h3>
                {pendingPrintWarning(badge.queued) && (
                  <p role="alert" data-testid="living-sheet-print-pending-warning">{pendingPrintWarning(badge.queued)}</p>
                )}
                <button
                  type="button" style={GHOST_BUTTON_STYLE} onClick={() => window.print()}
                  data-testid="living-sheet-print-button"
                >
                  Print / save PDF
                </button>
              </section>
              {/* R2-17: the printed page itself says how many queued changes it is missing. */}
              {!guidePrintMode && <LivingSheetPrint view={view} seq={view.seq} printedAt={new Date().toLocaleString()} pendingCount={badge.queued} />}

              {viewError && <p role="alert">{viewError}</p>}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ResolveQuestion({ questionId, onResolve }: { questionId: string; onResolve: (id: string, resolution: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div>
      <input style={FIELD_STYLE} placeholder="Answer" value={text} onChange={(e) => setText(e.target.value)} />
      <button
        type="button" style={GHOST_BUTTON_STYLE} disabled={!text.trim() || saving}
        onClick={() => {
          // R2-02: an answer is cleared ONLY once the save actually
          // succeeded AND the field still holds exactly what was
          // submitted — never on tap alone (the old behavior always
          // cleared immediately, discarding the answer on any failure).
          const submitted = text;
          const resolution = submitted.trim();
          if (!resolution) return;
          setSaving(true);
          void (async () => {
            const ok = await onResolve(questionId, resolution);
            setSaving(false);
            setText((current) => clearedFieldValue(ok, submitted, current));
          })();
        }}
      >
        {saving ? "Saving…" : "Save answer"}
      </button>
    </div>
  );
}
