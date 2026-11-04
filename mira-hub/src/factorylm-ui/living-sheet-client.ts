/**
 * Living Work Sheet phone client (TASK-S3). Pure queue/badge/parser helpers
 * plus thin fetch wrappers over the S1/S2 routes under
 * /api/equipment-notebooks/[id]/sheets/**. No React here — LivingSheet.tsx
 * is the only consumer that touches the DOM.
 *
 * Offline queue is ported from mira-mobile/src/lib/offline-queue.ts (same
 * KvStore shape, same FIFO+dedupe+tolerant-load shape) — NOT the producer-
 * barrier machinery, which this task doesn't need (every write here already
 * goes through one job's queue, drained serially).
 *
 * next.config.ts has trailingSlash: true — every URL below ends in "/".
 */
import { API_BASE } from "@/lib/config";
import type { EventKind, JobSheetBody } from "@/capabilities/living-sheet/types";
import type { SheetStepView, SheetView } from "@/capabilities/living-sheet/reduce";
import type { SheetEvent } from "@/capabilities/living-sheet/types";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";
import type { NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";
import type { ImportLayout, ImportPreview } from "@/capabilities/living-sheet/job-sheet-import";
import type { ShiftReport, ShiftReportWindow } from "@/capabilities/living-sheet/shift-report";

// ---------------------------------------------------------------------------
// KV store (localStorage adapter — never touched at module scope; built
// lazily so importing this module in a no-DOM test/SSR context is safe)
// ---------------------------------------------------------------------------

export interface KvStore {
  get(key: string): Promise<string | null>;
  /** Returns whether the write actually persisted. F06: a swallowed
   *  `setItem` failure (private window, quota) must never look identical to
   *  a real save to the caller — the caller needs to know the write was
   *  lost so it can keep the form contents and refuse to say "Saved". */
  set(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** The one production adapter. Every access is try/catch'd: a private
 *  window, blocked site data, or SSR must never throw past this boundary. */
export const localStorageStore: KvStore = {
  async get(key) {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      if (typeof window === "undefined") return false;
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      /* private window / quota / blocked storage — the caller must see this */
      return false;
    }
  },
  async remove(key) {
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  async keys() {
    try {
      if (typeof window === "undefined") return [];
      const out: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Offline queue — one FIFO queue per (scope, jobId)
// ---------------------------------------------------------------------------

const QUEUE_PREFIX = "flm.sheetq.v1.";

/** `job_started` is only ever produced by startJob (S1 store) — the events
 *  route refuses it, and so does the queue: every queued write is an
 *  append to an already-open job. */
export type SheetWriteEvent = Exclude<SheetEvent, { kind: "job_started"; payload: unknown }>;

export type SheetEventPost = {
  clientEventId: string;
  baseSeq: number;
  kind: SheetWriteEvent["kind"];
  payload: SheetWriteEvent["payload"];
  occurredAt: string;
  workOrderId: string | null;
};

export type QueuedSheetEvent = {
  event: SheetEventPost;
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

/** Scoped by tenant/user id AND jobId — a sign-out purge sweeps every
 *  `flm.sheetq.v1.*` key regardless of job (purgeSheetQueues below). */
export function sheetQueueKey(scopeId: string, jobId: string): string {
  return `${QUEUE_PREFIX}${scopeId}.${jobId}`;
}

/** Tolerant load: corrupt/absent state is an empty queue, never a crash. */
export async function loadSheetQueue(store: KvStore, scopeId: string, jobId: string): Promise<QueuedSheetEvent[]> {
  try {
    const raw = await store.get(sheetQueueKey(scopeId, jobId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q): q is QueuedSheetEvent =>
        typeof q === "object" && q !== null && typeof (q as QueuedSheetEvent).event?.clientEventId === "string",
    );
  } catch {
    return [];
  }
}

/** Returns whether the write actually persisted (see KvStore.set). */
async function saveSheetQueue(store: KvStore, scopeId: string, jobId: string, q: QueuedSheetEvent[]): Promise<boolean> {
  return store.set(sheetQueueKey(scopeId, jobId), JSON.stringify(q));
}

/**
 * Every read-modify-write on a queue is serialized per (scopeId, jobId) key
 * through this in-memory promise chain. Without it, two calls that each
 * `await loadSheetQueue(...)` before either `saveSheetQueue(...)`s — two
 * concurrent `enqueueSheetEvent`s (e.g. "Accept all low-risk" firing N posts
 * in one tick), or an enqueue landing while `drainSheetQueue`'s `submit`
 * await is in flight — read the same stale snapshot and the last save wins,
 * silently dropping every write but one. The lock only wraps the read-
 * modify-write body, never a `fetch` (drain's `submit` call sits OUTSIDE
 * the locked section — see drainSheetQueue below), so a slow network call
 * never blocks an unrelated enqueue.
 */
const queueLocks = new Map<string, Promise<void>>();

async function withQueueLock<T>(scopeId: string, jobId: string, fn: () => Promise<T>): Promise<T> {
  const key = sheetQueueKey(scopeId, jobId);
  const prior = queueLocks.get(key) ?? Promise.resolve();
  let result!: T;
  let failure: unknown;
  let settled!: () => void;
  const gate = new Promise<void>((resolve) => {
    settled = resolve;
  });
  queueLocks.set(key, gate);
  await prior.catch(() => {
    /* a prior failed turn must not wedge the chain for everyone after it */
  });
  try {
    result = await fn();
  } catch (e) {
    failure = e;
  } finally {
    settled();
  }
  if (failure !== undefined) throw failure;
  return result;
}

export type EnqueueSheetEventResult = {
  queue: QueuedSheetEvent[];
  /** F06: false means the write never reached storage (e.g. localStorage's
   *  `setItem` threw — private window, quota). The caller must NOT treat
   *  this as a normal queued-offline state: the event only exists in this
   *  in-memory `queue` array, not durably, so it must keep the form
   *  contents and show a "not saved" state rather than "Saved" or
   *  "Offline — N waiting" (both imply the write survived a reload). */
  saved: boolean;
};

/** FIFO enqueue, deduped on clientEventId (re-queuing the same logical write
 *  is a no-op — the id IS the identity). Lock-protected: concurrent
 *  enqueues on the same job never clobber each other's write. */
export async function enqueueSheetEvent(
  store: KvStore,
  scopeId: string,
  jobId: string,
  event: SheetEventPost,
  nowIso?: string,
): Promise<EnqueueSheetEventResult> {
  return withQueueLock(scopeId, jobId, async () => {
    const q = await loadSheetQueue(store, scopeId, jobId);
    if (q.some((item) => item.event.clientEventId === event.clientEventId)) {
      return { queue: q, saved: true };
    }
    q.push({ event, queuedAt: nowIso ?? new Date().toISOString(), attempts: 0 });
    const saved = await saveSheetQueue(store, scopeId, jobId, q);
    return { queue: q, saved };
  });
}

export async function pendingSheetCount(store: KvStore, scopeId: string, jobId: string): Promise<number> {
  return (await loadSheetQueue(store, scopeId, jobId)).length;
}

/** Remove and return the queue's head item WITHOUT submitting it — the
 *  conflict sheet's "Keep theirs" (discard mine) drops it outright, and
 *  "Use mine" drops it then re-enqueues a fresh correction on the current
 *  seq (both at the call site, not in here — this helper only edits the
 *  queue). Null on an empty queue. Lock-protected like enqueueSheetEvent. */
export async function dropHeadOfSheetQueue(
  store: KvStore,
  scopeId: string,
  jobId: string,
): Promise<QueuedSheetEvent | null> {
  return withQueueLock(scopeId, jobId, async () => {
    const q = await loadSheetQueue(store, scopeId, jobId);
    if (q.length === 0) return null;
    const head = q.shift()!;
    await saveSheetQueue(store, scopeId, jobId, q);
    return head;
  });
}

/** Remove exactly the item with this clientEventId, re-reading first — used
 *  by drainSheetQueue so a save never overwrites an item some OTHER caller
 *  enqueued while this one's `submit` await was in flight. */
async function removeFromSheetQueue(store: KvStore, scopeId: string, jobId: string, clientEventId: string): Promise<void> {
  await withQueueLock(scopeId, jobId, async () => {
    const q = await loadSheetQueue(store, scopeId, jobId);
    await saveSheetQueue(store, scopeId, jobId, q.filter((i) => i.event.clientEventId !== clientEventId));
  });
}

/** Record an attempt/lastError on exactly this item without touching the
 *  rest of the (possibly since-grown) queue. */
async function markSheetQueueAttempt(
  store: KvStore,
  scopeId: string,
  jobId: string,
  clientEventId: string,
  lastError: string,
): Promise<void> {
  await withQueueLock(scopeId, jobId, async () => {
    const q = await loadSheetQueue(store, scopeId, jobId);
    const next = q.map((i) => (i.event.clientEventId === clientEventId ? { ...i, attempts: i.attempts + 1, lastError } : i));
    await saveSheetQueue(store, scopeId, jobId, next);
  });
}

export type SheetSubmitOutcome =
  | { status: "ok" }
  | { status: "conflict" }
  | { status: "rejected"; message: string };

export type SheetDrainResult = {
  sent: number;
  /** Server definitively rejected (4xx validation) — dropped, surfaced, never retried forever. */
  droppedRejected: number;
  remaining: number;
  /** A 409 conflict stopped the drain; the conflicting item (and everything
   *  behind it) stays queued until the technician resolves it. */
  conflict: boolean;
  /** A thrown error (network/5xx/401) stopped the drain; nothing behind the
   *  failed item could have done better, so it all stays queued. */
  networkStopped: boolean;
};

let sheetDrainInFlight = false;

/**
 * FIFO drain. Per item: submit → `ok` removes it and continues (a replayed
 * write counts as success since the server is idempotent on clientEventId);
 * `conflict` keeps the item and STOPS (the technician must resolve it before
 * anything behind it can land); a thrown error (network/5xx/401) keeps the
 * item and STOPS; `rejected` (definitive 4xx validation) drops the item and
 * continues. The queue is RE-READ at the top of every iteration and every
 * mutation targets the item's clientEventId (never a stale in-memory array
 * saved after the `submit` await) — so a write that lands on the same job
 * while a submit is in flight is never clobbered by this drain's own save.
 * Returns null if a drain is already in flight (one at a time).
 */
export async function drainSheetQueue(
  store: KvStore,
  scopeId: string,
  jobId: string,
  submit: (event: SheetEventPost) => Promise<SheetSubmitOutcome>,
): Promise<SheetDrainResult | null> {
  if (sheetDrainInFlight) return null;
  sheetDrainInFlight = true;
  try {
    const result: SheetDrainResult = { sent: 0, droppedRejected: 0, remaining: 0, conflict: false, networkStopped: false };
    for (;;) {
      const q = await loadSheetQueue(store, scopeId, jobId);
      if (q.length === 0) break;
      const item = q[0]!;
      let outcome: SheetSubmitOutcome;
      try {
        outcome = await submit(item.event);
      } catch (e) {
        await markSheetQueueAttempt(store, scopeId, jobId, item.event.clientEventId, e instanceof Error ? e.message : String(e));
        result.networkStopped = true;
        break;
      }
      if (outcome.status === "ok") {
        await removeFromSheetQueue(store, scopeId, jobId, item.event.clientEventId);
        result.sent++;
      } else if (outcome.status === "conflict") {
        await markSheetQueueAttempt(store, scopeId, jobId, item.event.clientEventId, "conflict");
        result.conflict = true;
        break;
      } else {
        await removeFromSheetQueue(store, scopeId, jobId, item.event.clientEventId);
        result.droppedRejected++;
      }
    }
    result.remaining = (await loadSheetQueue(store, scopeId, jobId)).length;
    return result;
  } finally {
    sheetDrainInFlight = false;
  }
}

/** Sign-out hygiene: remove every Living Work Sheet queue (all jobs, all
 *  tenants/users on this device). Returns how many keys were purged. */
export async function purgeSheetQueues(store: KvStore): Promise<number> {
  const keys = (await store.keys()).filter((k) => k.startsWith(QUEUE_PREFIX));
  for (const k of keys) await store.remove(k);
  return keys.length;
}

// ---------------------------------------------------------------------------
// Save badge
// ---------------------------------------------------------------------------

export type SaveBadgeState = {
  saving: boolean;
  queued: number;
  conflict: boolean;
  /** F06: a storage write (localStorage.setItem) threw. The entry only
   *  lives in memory — it must never be reported "Saved" or folded into
   *  the ordinary offline-queued count, both of which imply it would
   *  survive a reload. */
  storageFailed?: boolean;
};

/** Priority: conflict > saving > storageFailed > queued (offline) > saved. */
export function saveBadge(state: SaveBadgeState): string {
  if (state.conflict) return "Conflict – tap to sort out";
  if (state.saving) return "Saving…";
  if (state.storageFailed) return "Not saved on this phone — keep this screen open";
  if (state.queued > 0) return `Offline – ${state.queued} waiting`;
  return "Saved";
}

// ---------------------------------------------------------------------------
// Proposal helpers
// ---------------------------------------------------------------------------

/** Ticking ON a torque, thread-locker or measurement step first shows what
 *  the job sheet says (value, pattern, source). Un-ticking never asks. Lives
 *  here (not LivingSheet.tsx) so lowRiskProposalIds — which must exclude
 *  these from bulk accept — and the single-accept path share one
 *  definition; LivingSheet.tsx re-exports it for its existing tests. */
export function stepNeedsConfirm(step: SheetStepView): boolean {
  return !step.done && (step.checkoff === "torque" || step.checkoff === "loctite" || step.checkoff === "measurement");
}

/** F03/F07: the step a "mark step N done" proposal/event refers to, but
 *  ONLY when that step actually needs the torque/loctite/measurement
 *  confirm dialog — null otherwise (including for every non-step_marked
 *  kind, and for "mark not done"). Shared by lowRiskProposalIds (bulk
 *  accept must exclude these — they need their own tap) and the
 *  single-accept path in LivingSheet.tsx (which opens the confirm dialog
 *  showing value + source instead of posting directly). */
export function stepRequiringConfirmFor(
  event: Pick<SheetProposal["event"], "kind" | "payload">,
  steps: readonly SheetStepView[],
): SheetStepView | null {
  if (event.kind !== "step_marked") return null;
  const payload = event.payload as { stepId?: unknown; done?: unknown };
  if (payload.done !== true || typeof payload.stepId !== "string") return null;
  const step = steps.find((s) => s.id === payload.stepId);
  return step && stepNeedsConfirm(step) ? step : null;
}

/** "Accept all low-risk" accepts only risk:"low" — needs_tap always needs an
 *  individual tap, never swept in by the bulk action. F03: a step that
 *  needs the torque/loctite/measurement confirm is excluded even when the
 *  proposer marked it "low" risk — it needs its own tap either way. */
export function lowRiskProposalIds(proposals: readonly SheetProposal[], steps: readonly SheetStepView[] = []): string[] {
  return proposals
    .filter((p) => p.risk === "low")
    .filter((p) => stepRequiringConfirmFor(p.event, steps) === null)
    .map((p) => p.proposalId);
}

// ---------------------------------------------------------------------------
// sheet_receipt SSE frame parser — reads a tee'd branch of the chat stream
// ---------------------------------------------------------------------------

/**
 * Reads an SSE byte stream and calls `onReceipt` for every `sheet_receipt`
 * frame it finds. Advisory only: any parse error is swallowed so a bad frame
 * can never break the chat turn this stream is tee'd from. Drains the stream
 * fully (never leaves it half-read) so the tee'd original branch isn't stalled.
 */
export async function parseSheetReceipts(
  stream: ReadableStream<Uint8Array>,
  onReceipt: (frame: NotebookSheetReceiptFrame) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleSseChunk(raw, onReceipt);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleSseChunk(buffer, onReceipt);
  } catch {
    // Parsing is advisory — never throw out of this helper.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

function handleSseChunk(raw: string, onReceipt: (frame: NotebookSheetReceiptFrame) => void): void {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const json = trimmed.slice("data:".length).trim();
    if (json === "[DONE]" || json === "") continue;
    try {
      const parsed = JSON.parse(json) as { kind?: unknown };
      if (parsed && parsed.kind === "sheet_receipt") {
        onReceipt(parsed as NotebookSheetReceiptFrame);
      }
    } catch {
      // malformed frame — ignore, never throw.
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch wrappers — thin, typed, trailingSlash-correct
// ---------------------------------------------------------------------------

function sheetsBase(notebookId: string): string {
  return `${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sheets/`;
}

/**
 * `body` is always the parsed JSON (or `{}` on no/invalid body), on success
 * OR failure — unlike a plain success/error union, this keeps `view`/`seq`
 * reachable on a 409 conflict body (`{error:"conflict", seq, view}`), which
 * the conflict sheet needs for "theirs".
 */
export type ApiResult<T> = { ok: boolean; status: number; body: T & { error?: string; message?: string; field?: string } };

async function asApiResult<T>(res: Response): Promise<ApiResult<T>> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no/invalid JSON body */
  }
  return { ok: res.ok, status: res.status, body: (body ?? {}) as ApiResult<T>["body"] };
}

export type JobSummaryClient = {
  jobId: string;
  title: string;
  startedAt: string;
  startedBy: string | null;
  finished: boolean;
  seq: number;
};

export async function apiListJobs(notebookId: string): Promise<ApiResult<{ jobs: JobSummaryClient[] }>> {
  const res = await fetch(sheetsBase(notebookId), { credentials: "include" });
  return asApiResult(res);
}

export async function apiStartJob(
  notebookId: string,
  body: { title: string; templateRevisionId: string | null; template: JobSheetBody; clientEventId: string; occurredAt: string },
): Promise<ApiResult<{ jobId: string; view: SheetView; seq?: number; replayed?: boolean }>> {
  const res = await fetch(sheetsBase(notebookId), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return asApiResult(res);
}

export async function apiGetJob(
  notebookId: string,
  jobId: string,
  atSeq?: number,
): Promise<ApiResult<{ view: SheetView; seq: number; snapshot?: boolean }>> {
  const qs = atSeq !== undefined ? `?atSeq=${encodeURIComponent(String(atSeq))}` : "";
  const res = await fetch(`${sheetsBase(notebookId)}${encodeURIComponent(jobId)}/${qs}`, { credentials: "include" });
  return asApiResult(res);
}

export async function apiPostEvent(
  notebookId: string,
  jobId: string,
  event: SheetEventPost,
): Promise<ApiResult<{ event: unknown; seq?: number; view?: SheetView; replayed?: boolean }>> {
  const res = await fetch(`${sheetsBase(notebookId)}${encodeURIComponent(jobId)}/events/`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  return asApiResult(res);
}

export async function apiUploadPhoto(
  notebookId: string,
  jobId: string,
  file: File,
  meta: { clientEventId: string; baseSeq: number; caption?: string | null },
): Promise<ApiResult<{ event: unknown; seq?: number; view?: SheetView; replayed?: boolean }>> {
  const form = new FormData();
  form.set("file", file);
  form.set("clientEventId", meta.clientEventId);
  form.set("baseSeq", String(meta.baseSeq));
  if (meta.caption) form.set("caption", meta.caption);
  const res = await fetch(`${sheetsBase(notebookId)}${encodeURIComponent(jobId)}/photos/`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return asApiResult(res);
}

export type JobSheetRevision = {
  id: string;
  jobSheetId: string;
  revision: number;
  status: "draft" | "reviewed";
  body: JobSheetBody;
  createdBy: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type JobSheetSummary = {
  jobSheetId: string;
  latest: JobSheetRevision;
  latestReviewed: JobSheetRevision | null;
};

/**
 * GET /api/job-sheets — built in parallel (S4), not in this worktree. Per
 * the task's deviation note: hide the picker on 404 or ANY error, never
 * assume the route exists. Shape corrected by the coordinator once S4
 * landed its real contract (2026-11-03): `{ jobSheets: JobSheetSummary[] }`.
 */
export async function apiListJobSheetTemplates(): Promise<JobSheetSummary[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/job-sheets/`, { credentials: "include" });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { jobSheets?: unknown } | null;
    if (!body || !Array.isArray(body.jobSheets)) return null;
    return body.jobSheets as JobSheetSummary[];
  } catch {
    return null;
  }
}

/** Prefer the reviewed revision; fall back to the latest (draft) revision
 *  with a DRAFT badge. F23: if a NEWER draft exists after the latest
 *  reviewed revision, show that newer draft (still marked DRAFT) instead
 *  of silently continuing to show the older reviewed one with no way to
 *  review the new revision. Pure — the picker and the library both call
 *  this. */
export function chosenRevisionOf(sheet: JobSheetSummary): { revision: JobSheetRevision; isDraft: boolean } {
  if (sheet.latestReviewed && sheet.latest.revision <= sheet.latestReviewed.revision) {
    return { revision: sheet.latestReviewed, isDraft: false };
  }
  return { revision: sheet.latest, isDraft: true };
}

/** F16/F17(UI): one client id per "attempt" (starting a job, uploading a
 *  photo), reused across a retry until the attempt succeeds — so a lost
 *  response followed by a retry can never create a second job or a
 *  duplicate photo. `pending` is whatever the caller is holding in state
 *  from a prior, not-yet-succeeded attempt; `mintId` is injected so this is
 *  deterministic under test (production passes `crypto.randomUUID`). */
export function attemptClientEventId(pending: string | null, mintId: () => string): string {
  return pending ?? mintId();
}

/** Plain words for a start-job refusal, including S4's
 *  `template_revision_not_found` (the chosen revision was edited away or
 *  removed between picking it and starting). */
export function startJobErrorMessage(error: string | undefined, message: string | undefined): string {
  if (message) return message;
  switch (error) {
    case "template_revision_not_found":
      return "That job sheet changed or was removed. Pick another, or start without one.";
    case "asset_not_confirmed":
      return "Confirm which machine this is before starting a job.";
    case "asset_not_bound":
      return "Pick the machine for this notebook before starting a job.";
    case "request_id_conflict":
      return "That start was already used for a different job. Retry.";
    default:
      return "The job could not be started. Retry — it will not create a duplicate.";
  }
}

/** A small curated list for the reading-unit picker. validate.ts does not
 *  restrict units to this set (any non-empty text <=200 chars passes) — this
 *  is a UX convenience, matching propose.ts's canonical unit vocabulary. */
export const COMMON_READING_UNITS = [
  "ft-lb",
  "in-lb",
  "N·m",
  "°F",
  "°C",
  "A",
  "V",
  "psi",
  "bar",
  "rpm",
  "Hz",
  "mm",
  "in",
  "mil",
  "%",
  "Ω",
] as const;

// Re-exported so EventKind stays reachable from this module without a
// second import line at call sites that need it.
export type { EventKind };

// ---------------------------------------------------------------------------
// Shift report (S6) + job sheet library CRUD (S4 UI slice) — thin fetch
// wrappers over the already-built /api/living-sheet/shift-report and
// /api/job-sheets/** routes. Same ApiResult<T> shape as the rest of this
// file; callers read `.ok`/`.status`/`.body`.
// ---------------------------------------------------------------------------

/** GET /api/living-sheet/shift-report — defaults server-side to the last 12
 *  hours when `window` is omitted. */
export async function apiGetShiftReport(window?: ShiftReportWindow): Promise<ApiResult<{ report: ShiftReport }>> {
  const qs = window ? `?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}` : "";
  const res = await fetch(`${API_BASE}/api/living-sheet/shift-report/${qs}`, { credentials: "include" });
  return asApiResult(res);
}

/** POST /api/job-sheets/import/preview — parses pasted spreadsheet text.
 *  Writes nothing; the `ImportPreview` it returns is what the UI shows
 *  before any "Save as draft". */
export async function apiPreviewJobSheetImport(
  text: string,
  layout?: ImportLayout | "auto",
): Promise<ApiResult<ImportPreview>> {
  const res = await fetch(`${API_BASE}/api/job-sheets/import/preview/`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...(layout ? { layout } : {}) }),
  });
  return asApiResult(res);
}

/** POST /api/job-sheets — create a new job sheet (first revision, draft). */
export async function apiCreateJobSheet(
  body: JobSheetBody,
  clientRequestId: string,
): Promise<ApiResult<{ jobSheetId: string; revision: JobSheetRevision; replayed?: boolean }>> {
  const res = await fetch(`${API_BASE}/api/job-sheets/`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientRequestId, body }),
  });
  return asApiResult(res);
}

/** POST /api/job-sheets/[id]/review — marks a revision reviewed (writes a
 *  new revision row; never edits the source one). */
export async function apiReviewJobSheet(
  jobSheetId: string,
  revision: number,
  clientRequestId: string,
): Promise<ApiResult<{ revision: JobSheetRevision; replayed?: boolean }>> {
  const res = await fetch(`${API_BASE}/api/job-sheets/${encodeURIComponent(jobSheetId)}/review/`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientRequestId, revision }),
  });
  return asApiResult(res);
}
