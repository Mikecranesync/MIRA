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
import type { JobSheetBody } from "@/capabilities/living-sheet/types";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";
import type { SheetStepView, SheetView } from "@/capabilities/living-sheet/reduce";
import type { NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";
import { fileUrl } from "./to-interaction";
import {
  apiGetJob,
  apiListJobSheetTemplates,
  apiListJobs,
  apiPostEvent,
  apiStartJob,
  apiUploadPhoto,
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
  type JobSheetSummary,
  type JobSummaryClient,
  type SaveBadgeState,
  type SheetEventPost,
  type SheetWriteEvent,
} from "./living-sheet-client";

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

  const [handoverText, setHandoverText] = useState("");
  const [finishAck, setFinishAck] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [readingWhat, setReadingWhat] = useState("");
  const [readingValue, setReadingValue] = useState("");
  const [readingUnit, setReadingUnit] = useState("");
  const [partItem, setPartItem] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

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
    async (kind: SheetWriteEvent["kind"], payload: SheetWriteEvent["payload"]) => {
      if (!openJobId || !view) return;
      const event: SheetEventPost = {
        clientEventId: crypto.randomUUID(),
        baseSeq: view.seq,
        kind,
        payload,
        occurredAt: new Date().toISOString(),
        workOrderId: null,
      };
      await enqueueSheetEvent(localStorageStore, scopeId, openJobId, event);
      await refreshBadge(openJobId);
      await drain(openJobId);
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
        clientEventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
      });
      if (!res.ok || !res.body.jobId) {
        setStartError(startJobErrorMessage(res.body.error, res.body.message));
        return;
      }
      setNewTitle("");
      setChosenJobSheetId("");
      await loadJobs();
      openJob(res.body.jobId);
    } catch {
      setStartError("No reply from the server. Retry — it will not create a duplicate.");
    } finally {
      setStarting(false);
    }
  }, [newTitle, templates, chosenJobSheetId, notebookId, loadJobs, openJob]);

  const onToggleStep = useCallback(
    (step: SheetStepView) => {
      void postEvent("step_marked", { stepId: step.id, done: !step.done, note: null });
    },
    [postEvent],
  );

  const onAddNote = useCallback(() => {
    const text = noteText.trim();
    if (!text) return;
    void postEvent("note_added", { noteId: crypto.randomUUID(), text, noteKind: "note" });
    setNoteText("");
  }, [noteText, postEvent]);

  const onAddQuestion = useCallback(() => {
    const text = questionText.trim();
    if (!text) return;
    void postEvent("note_added", { noteId: crypto.randomUUID(), text, noteKind: "question" });
    setQuestionText("");
  }, [questionText, postEvent]);

  const onResolveQuestion = useCallback(
    (noteId: string, resolution: string) => {
      void postEvent("question_resolved", { noteId, resolution });
    },
    [postEvent],
  );

  const onAddReading = useCallback(() => {
    const what = readingWhat.trim();
    const unit = readingUnit.trim();
    const value = Number(readingValue);
    if (!what || !unit || !Number.isFinite(value)) return;
    void postEvent("reading_recorded", {
      readingId: crypto.randomUUID(), what, value, unit, source: { kind: "tech", ref: technicianName },
    });
    setReadingWhat("");
    setReadingValue("");
    setReadingUnit("");
  }, [readingWhat, readingValue, readingUnit, technicianName, postEvent]);

  const onAddPart = useCallback(() => {
    const item = partItem.trim();
    if (!item) return;
    void postEvent("part_logged", { partEntryId: crypto.randomUUID(), item, action: "used", qty: null });
    setPartItem("");
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
      try {
        const res = await apiUploadPhoto(notebookId, openJobId, file, { clientEventId: crypto.randomUUID(), baseSeq: view.seq });
        if (!res.ok) {
          setPhotoError(startJobErrorMessage(res.body.error, res.body.message));
          return;
        }
        await loadSheet(openJobId);
      } catch {
        setPhotoError("No reply from the server. Retry — the photo was not saved.");
      } finally {
        setPhotoBusy(false);
      }
    },
    [openJobId, view, notebookId, loadSheet],
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
    (proposalId: string, event: SheetWriteEvent) => {
      void postEvent(event.kind, event.payload);
      setHandledProposalIds((prev) => new Set([...prev, proposalId]));
    },
    [postEvent],
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
  const lowRiskIds = lowRiskProposalIds(proposals);

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

              {conflict && (
                <section style={{ ...SECTION_STYLE, borderColor: "var(--fl-accent)" }} data-testid="living-sheet-conflict">
                  <h3 style={{ marginTop: 0 }}>Someone else changed this sheet too</h3>
                  <p>Theirs: current sheet seq {conflict.serverView?.seq ?? "unknown"}.</p>
                  <p>Yours: a change still waiting to save.</p>
                  <button type="button" style={GHOST_BUTTON_STYLE} onClick={onKeepTheirs} data-testid="living-sheet-keep-theirs">Keep theirs</button>
                  <button type="button" style={BUTTON_STYLE} onClick={onUseMine} data-testid="living-sheet-use-mine">Use mine</button>
                </section>
              )}

              {proposals.length > 0 && (
                <section style={SECTION_STYLE} data-testid="living-sheet-receipt-card">
                  <h3 style={{ marginTop: 0 }}>MIRA suggests {proposals.length} change{proposals.length === 1 ? "" : "s"} to the sheet</h3>
                  {proposals.map((p) => (
                    <div key={p.proposalId} style={{ marginBottom: 10, borderTop: "1px solid var(--fl-line)", paddingTop: 8 }}>
                      <p style={{ margin: 0 }}>{p.reason}</p>
                      <p style={{ margin: 0, fontStyle: "italic", color: "var(--fl-muted)" }}>&ldquo;{p.quote}&rdquo;</p>
                      <button type="button" style={BUTTON_STYLE} onClick={() => onReceiptAccept(p.proposalId, p.event as SheetWriteEvent)}>Accept</button>
                      <button type="button" style={GHOST_BUTTON_STYLE} onClick={() => onReceiptSkip(p.proposalId)}>Skip</button>
                    </div>
                  ))}
                  {lowRiskIds.length > 0 && (
                    <button
                      type="button" style={BUTTON_STYLE}
                      onClick={() => {
                        for (const p of proposals) {
                          if (lowRiskIds.includes(p.proposalId)) onReceiptAccept(p.proposalId, p.event as SheetWriteEvent);
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
              </section>

              <section style={SECTION_STYLE} data-testid="living-sheet-readings">
                <h3 style={{ marginTop: 0 }}>Readings</h3>
                {view.readings.map((r) => (
                  <div key={r.id} style={{ marginBottom: 8 }}>
                    <strong>{r.what}: {r.current.value} {r.current.unit}</strong>
                    <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>
                      by {r.current.by ?? "a technician"} · {new Date(r.current.at).toLocaleString()}
                    </div>
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
