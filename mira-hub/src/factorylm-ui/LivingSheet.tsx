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
import type { JobSheetBody, JobSheetTorque } from "@/capabilities/living-sheet/types";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";
import type { SheetReadingView, SheetStepView, SheetView } from "@/capabilities/living-sheet/reduce";
import type { NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";
import { fileUrl } from "./to-interaction";
import { LivingSheetPrint } from "./LivingSheetPrint";
import { LivingSheetShiftReport } from "./LivingSheetShiftReport";
import { JobSheetsLibrary } from "./JobSheetsLibrary";
import {
  apiGetJob,
  apiListJobSheetTemplates,
  apiListJobs,
  apiPostEvent,
  apiStartJob,
  apiUploadPhoto,
  attemptClientEventId,
  chosenRevisionOf,
  COMMON_READING_UNITS,
  dropHeadOfSheetQueue,
  drainSheetQueue,
  enqueueSheetEvent,
  loadSheetQueue,
  localStorageStore,
  lowRiskProposalIds,
  saveBadge,
  startJobErrorMessage,
  stepNeedsConfirm,
  stepRequiringConfirmFor,
  type JobSheetSummary,
  type JobSummaryClient,
  type SaveBadgeState,
  type SheetEventPost,
  type SheetWriteEvent,
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
      const theirs = step ? `Step is ${step.done ? `done (by ${step.doneBy ?? "a technician"})` : "not done"}` : theirsFallback;
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
      return { mine: `${event.payload.noteKind === "question" ? "Question" : "Note"}: ${event.payload.text}`, theirs: theirsFallback };
    case "question_resolved":
      return { mine: `Answer: ${event.payload.resolution}`, theirs: theirsFallback };
    case "part_logged":
      return { mine: `${event.payload.item} (${event.payload.action})`, theirs: theirsFallback };
    case "handover_written":
      return { mine: event.payload.text, theirs: theirsFallback };
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

function StepRow({ step, onToggle }: { step: SheetStepView; onToggle: (step: SheetStepView) => void }) {
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
  const [handledProposalIds, setHandledProposalIds] = useState<ReadonlySet<string>>(new Set());

  const [newTitle, setNewTitle] = useState("");
  const [templates, setTemplates] = useState<JobSheetSummary[] | null>(null);
  const [chosenJobSheetId, setChosenJobSheetId] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // F16: one client id per Start attempt, reused across retries until it
  // succeeds (cleared) or the technician edits the title (a new attempt).
  const [startClientEventId, setStartClientEventId] = useState<string | null>(null);

  const [handoverText, setHandoverText] = useState("");
  const [finishAck, setFinishAck] = useState(false);
  // F03: a step confirm can be opened either by ticking the checkbox
  // directly (receiptOrigin undefined) or by accepting a chat proposal for
  // a step that needs confirmation (receiptOrigin carries the proposal's id
  // and the receipt's origin seq — F07 — so "Mark done" posts against the
  // SAME baseSeq the proposal was made against, and the proposal is only
  // marked handled once the write actually lands).
  const [confirmStep, setConfirmStep] = useState<{ step: SheetStepView; receiptOrigin?: { proposalId: string; baseSeq: number } } | null>(null);
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
  // F17 (UI): one client id per photo-upload attempt, reused on retry.
  const [photoClientEventId, setPhotoClientEventId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [shiftReportOpen, setShiftReportOpen] = useState(false);

  // StrictMode-safe (replayed effects must not leave this false permanently — #5091 pattern).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
      if (mounted.current) setBadge((b) => ({ ...b, queued: q.length }));
    },
    [scopeId],
  );

  const loadSheet = useCallback(
    async (jobId: string) => {
      setViewError(null);
      try {
        const res = await apiGetJob(notebookId, jobId);
        if (!res.ok) {
          if (mounted.current) setViewError("The job sheet could not be loaded.");
          return;
        }
        if (mounted.current) setView(res.body.view ?? null);
      } catch {
        if (mounted.current) setViewError("No reply from the server.");
      }
    },
    [notebookId],
  );

  const drain = useCallback(
    async (jobId: string) => {
      if (mounted.current) setBadge((b) => ({ ...b, saving: true }));
      const result = await drainSheetQueue(localStorageStore, scopeId, jobId, async (ev) => {
        const res = await apiPostEvent(notebookId, jobId, ev);
        if (res.ok) return { status: "ok" as const };
        if (res.status === 409 && res.body.error === "conflict") {
          if (mounted.current) setConflict({ event: ev, serverView: res.body.view ?? null });
          return { status: "conflict" as const };
        }
        if (res.status >= 500 || res.status === 401) throw new Error(res.body.error ?? "server_error");
        const message = startJobErrorMessage(res.body.error, res.body.message);
        if (mounted.current) setLastRejection(message);
        return { status: "rejected" as const, message };
      });
      if (!result) return;
      if (mounted.current) setBadge({ saving: false, queued: result.remaining, conflict: result.conflict });
      if (result.sent > 0) await loadSheet(jobId);
    },
    [scopeId, notebookId, loadSheet],
  );

  const openJob = useCallback(
    (jobId: string) => {
      setOpenJobId(jobId);
      setConflict(null);
      setFinishAck(false);
      onSheetOpenChange({ notebookId, jobId });
      void loadSheet(jobId);
      void refreshBadge(jobId);
    },
    [notebookId, onSheetOpenChange, loadSheet, refreshBadge],
  );

  const closeJob = useCallback(() => {
    setOpenJobId(null);
    setView(null);
    setConflict(null);
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
      await drain(openJobId);
      return true;
    },
    [openJobId, view, scopeId, refreshBadge, drain],
  );

  // Drain on reconnect and every 15s while something is queued (spec's sync rule).
  useEffect(() => {
    if (!openJobId) return;
    const onOnline = () => void drain(openJobId);
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(() => {
      if (badge.queued > 0) void drain(openJobId);
    }, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
    };
  }, [openJobId, drain, badge.queued]);

  const openTemplatePicker = useCallback(async () => {
    const list = await apiListJobSheetTemplates();
    if (mounted.current) setTemplates(list ?? []);
  }, []);

  const startJob = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setStarting(true);
    setStartError(null);
    // F16: reuse the pending attempt's client id on retry — minted exactly
    // once per attempt, never per tap — so a lost response followed by a
    // retry can never create a second job.
    const clientEventId = attemptClientEventId(startClientEventId, () => crypto.randomUUID());
    if (clientEventId !== startClientEventId) setStartClientEventId(clientEventId);
    try {
      const chosen = templates?.find((t) => t.jobSheetId === chosenJobSheetId) ?? null;
      const revision = chosen ? chosenRevisionOf(chosen).revision : null;
      const template: JobSheetBody = revision?.body ?? {
        title, machineLabel: null, component: null, jobType: null, estHours: null, crewSize: null,
        isolationPoints: null, cautions: null, returnToService: [], items: [], torques: [], steps: [],
        author: null, notes: null,
      };
      const res = await apiStartJob(notebookId, {
        title,
        templateRevisionId: revision?.id ?? null,
        template,
        clientEventId,
        occurredAt: new Date().toISOString(),
      });
      if (!res.ok || !res.body.jobId) {
        setStartError(startJobErrorMessage(res.body.error, res.body.message));
        return; // keep startClientEventId pending — the next tap retries this SAME attempt
      }
      setNewTitle("");
      setChosenJobSheetId("");
      setStartClientEventId(null); // attempt succeeded — a future Start is a new attempt
      await loadJobs();
      openJob(res.body.jobId);
    } catch {
      setStartError("No reply from the server. Retry — it will not create a duplicate.");
      // keep startClientEventId pending — same reasoning as the rejection branch above
    } finally {
      setStarting(false);
    }
  }, [newTitle, templates, chosenJobSheetId, notebookId, loadJobs, openJob, startClientEventId]);

  const onToggleStep = useCallback(
    (step: SheetStepView) => {
      if (stepNeedsConfirm(step)) {
        setConfirmStep({ step });
        return;
      }
      void postEvent("step_marked", { stepId: step.id, done: !step.done, note: null });
    },
    [postEvent],
  );

  // F06: each "add" handler only clears its own form once postEvent reports
  // the write actually reached storage — a swallowed localStorage failure
  // must never look like a successful submit from the technician's seat.
  const onAddNote = useCallback(async () => {
    const text = noteText.trim();
    if (!text) return;
    const ok = await postEvent("note_added", { noteId: crypto.randomUUID(), text, noteKind: "note" });
    if (ok) setNoteText("");
  }, [noteText, postEvent]);

  const onAddQuestion = useCallback(async () => {
    const text = questionText.trim();
    if (!text) return;
    const ok = await postEvent("note_added", { noteId: crypto.randomUUID(), text, noteKind: "question" });
    if (ok) setQuestionText("");
  }, [questionText, postEvent]);

  const onResolveQuestion = useCallback(
    (noteId: string, resolution: string) => {
      void postEvent("question_resolved", { noteId, resolution });
    },
    [postEvent],
  );

  const onAddReading = useCallback(async () => {
    const what = readingWhat.trim();
    const unit = readingUnit.trim();
    const value = Number(readingValue);
    if (!what || !unit || !Number.isFinite(value)) return;
    const ok = await postEvent("reading_recorded", {
      readingId: crypto.randomUUID(), what, value, unit, source: { kind: "tech", ref: technicianName },
    });
    if (ok) {
      setReadingWhat("");
      setReadingValue("");
      setReadingUnit("");
    }
  }, [readingWhat, readingValue, readingUnit, technicianName, postEvent]);

  // F21: records a reading_corrected event against the SAME readingId — the
  // reduced view already keeps every prior value in that reading's history
  // (reduce.ts), rendered struck-through with who/when below. This is the
  // "direct Correct control" the working sheet was missing.
  const onCorrectReading = useCallback(
    async (readingId: string, unit: string) => {
      const value = Number(correctionValue);
      if (!Number.isFinite(value)) return;
      const ok = await postEvent("reading_corrected", { readingId, value, unit, reason: null });
      if (ok) {
        setCorrectingReadingId(null);
        setCorrectionValue("");
      }
    },
    [correctionValue, postEvent],
  );

  const onAddPart = useCallback(async () => {
    const item = partItem.trim();
    if (!item) return;
    const ok = await postEvent("part_logged", { partEntryId: crypto.randomUUID(), item, action: "used", qty: null });
    if (ok) setPartItem("");
  }, [partItem, postEvent]);

  const onSaveHandover = useCallback(() => {
    const text = handoverText.trim();
    if (!text) return;
    void postEvent("handover_written", { text });
  }, [handoverText, postEvent]);

  const onFinish = useCallback(() => {
    void postEvent("job_finished", { summary: null, openItemsAcknowledged: finishAck });
  }, [finishAck, postEvent]);

  const onUploadPhoto = useCallback(
    async (file: File) => {
      if (!openJobId || !view) return;
      setPhotoBusy(true);
      setPhotoError(null);
      // F17 (UI): reuse the pending attempt's client id on retry — minted
      // once per attempt, so a lost successful response followed by a retry
      // cannot append a duplicate photo.
      const clientEventId = attemptClientEventId(photoClientEventId, () => crypto.randomUUID());
      if (clientEventId !== photoClientEventId) setPhotoClientEventId(clientEventId);
      try {
        const res = await apiUploadPhoto(notebookId, openJobId, file, { clientEventId, baseSeq: view.seq });
        if (!res.ok) {
          setPhotoError(startJobErrorMessage(res.body.error, res.body.message));
          return; // keep photoClientEventId pending for the retry
        }
        setPhotoClientEventId(null); // attempt succeeded
        await loadSheet(openJobId);
      } catch {
        setPhotoError("No reply from the server. Retry — the photo was not saved.");
        // keep photoClientEventId pending — same reasoning as the rejection branch
      } finally {
        setPhotoBusy(false);
      }
    },
    [openJobId, view, notebookId, loadSheet, photoClientEventId],
  );

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
    const dropped = await dropHeadOfSheetQueue(localStorageStore, scopeId, openJobId);
    if (dropped) {
      const freshSeq = conflict.serverView?.seq ?? dropped.event.baseSeq;
      const retry: SheetEventPost = { ...dropped.event, clientEventId: crypto.randomUUID(), baseSeq: freshSeq };
      await enqueueSheetEvent(localStorageStore, scopeId, openJobId, retry);
    }
    setConflict(null);
    if (conflict.serverView) setView(conflict.serverView);
    await drain(openJobId);
  }, [openJobId, scopeId, conflict, drain]);

  const onReceiptAccept = useCallback(
    (proposalId: string, event: SheetWriteEvent, originSeq: number) => {
      // F03: a step that still needs the torque/loctite/measurement confirm
      // opens the SAME dialog the checkbox path uses (value + source),
      // instead of posting "done" straight through. F07: the receipt's own
      // origin seq travels with it, so the eventual post — whether it goes
      // straight through below or via the confirm dialog's Mark done — uses
      // the seq the proposal was actually made against, not whatever
      // view.seq has advanced to by the time the technician taps Accept.
      const stepNeedingConfirm = view ? stepRequiringConfirmFor(event, view.steps) : null;
      if (stepNeedingConfirm) {
        setConfirmStep({ step: stepNeedingConfirm, receiptOrigin: { proposalId, baseSeq: originSeq } });
        return;
      }
      void (async () => {
        const ok = await postEvent(event.kind, event.payload, originSeq);
        if (ok) setHandledProposalIds((prev) => new Set([...prev, proposalId]));
      })();
    },
    [postEvent, view],
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

              {view.template.items.length > 0 && (
                <section style={SECTION_STYLE} data-testid="living-sheet-bring-to-job">
                  <h3 style={{ marginTop: 0 }}>Bring to the job</h3>
                  <ul>
                    {view.template.items.map((it) => (
                      <li key={it.id}>
                        {it.item}{it.spec ? ` — ${it.spec}` : ""}{it.qty ? ` x${it.qty}` : ""}
                      </li>
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
                {confirmStep && (() => {
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
                        onClick={() => {
                          const origin = confirmStep.receiptOrigin;
                          void (async () => {
                            // F07: when this confirm was opened from a chat
                            // proposal, post against the proposal's origin
                            // seq, and only mark the proposal handled once
                            // the write actually lands.
                            const ok = await postEvent(
                              "step_marked",
                              { stepId: confirmStep.step.id, done: true, note: null },
                              origin?.baseSeq,
                            );
                            if (ok && origin) setHandledProposalIds((prev) => new Set([...prev, origin.proposalId]));
                          })();
                          setConfirmStep(null);
                        }}
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
                      .map((h, i) => (
                        <div key={i} style={{ fontSize: "15px", color: "var(--fl-muted)" }}>
                          <s>{h.value} {h.unit}</s> — {h.by ?? "a technician"} · {new Date(h.at).toLocaleString()}
                        </div>
                      ))}
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
                {photoError && <p role="alert">{photoError}</p>}
                <label style={BUTTON_STYLE}>
                  {photoBusy ? "Uploading…" : "Take photo"}
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: "none" }} disabled={photoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void onUploadPhoto(f);
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

              <section style={SECTION_STYLE} data-testid="living-sheet-print-section">
                <h3 style={{ marginTop: 0 }}>Print</h3>
                <button
                  type="button" style={GHOST_BUTTON_STYLE} onClick={() => window.print()}
                  data-testid="living-sheet-print-button"
                >
                  Print / save PDF
                </button>
              </section>
              <LivingSheetPrint view={view} seq={view.seq} printedAt={new Date().toLocaleString()} />

              {viewError && <p role="alert">{viewError}</p>}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ResolveQuestion({ questionId, onResolve }: { questionId: string; onResolve: (id: string, resolution: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div>
      <input style={FIELD_STYLE} placeholder="Answer" value={text} onChange={(e) => setText(e.target.value)} />
      <button
        type="button" style={GHOST_BUTTON_STYLE} disabled={!text.trim()}
        onClick={() => {
          onResolve(questionId, text.trim());
          setText("");
        }}
      >
        Save answer
      </button>
    </div>
  );
}
