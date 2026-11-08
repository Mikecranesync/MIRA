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
import { NOTE_KINDS, PART_ACTIONS, type ReadingSource } from "@/capabilities/living-sheet/types";
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
  /** Returns whether the key is verifiably gone. Codex #5276: a removal that
   *  failed, or that could not be checked, must never look like a deletion. */
  remove(key: string): Promise<boolean>;
  /** null = storage could not be listed (blocked access), never "empty". */
  keys(): Promise<string[] | null>;
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
      if (typeof window === "undefined") return false;
      window.localStorage.removeItem(key);
      return window.localStorage.getItem(key) === null;
    } catch {
      /* blocked storage: the key may still be on the phone */
      return false;
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
      /* blocked storage: unknown, not empty */
      return null;
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

/** Codex #5276 r5/r6: a stored event the panel can render without throwing —
 *  the conflict and Not-accepted views read `payload` fields directly, so
 *  every field must have the type the event kind declares (types.ts). */
type FieldCheck = (v: unknown) => boolean;
const str: FieldCheck = (v) => typeof v === "string";
const strOrNull: FieldCheck = (v) => v === null || typeof v === "string";
const num: FieldCheck = (v) => typeof v === "number" && Number.isFinite(v);
const numOrNull: FieldCheck = (v) => v === null || num(v);
const bool: FieldCheck = (v) => typeof v === "boolean";
const oneOf =
  (allowed: readonly string[]): FieldCheck =>
  (v) => typeof v === "string" && allowed.includes(v);
const source: FieldCheck = (v) =>
  typeof v === "object" && v !== null && oneOf(["tech", "manual"])((v as ReadingSource).kind) && strOrNull((v as ReadingSource).ref);
const optionalSource: FieldCheck = (v) => v === undefined || v === null || source(v);

const STORED_PAYLOAD_FIELDS: Record<SheetEventPost["kind"], Record<string, FieldCheck>> = {
  step_marked: { stepId: str, done: bool, note: strOrNull },
  reading_recorded: { readingId: str, what: str, value: num, unit: str, source },
  reading_corrected: { readingId: str, value: num, unit: str, reason: strOrNull, source: optionalSource },
  note_added: { noteId: str, text: str, noteKind: oneOf(NOTE_KINDS) },
  question_resolved: { noteId: str, resolution: str },
  part_logged: { partEntryId: str, item: str, action: oneOf(PART_ACTIONS), qty: numOrNull },
  photo_attached: { photoId: str, fileId: str, caption: strOrNull },
  handover_written: { text: str },
  job_finished: { summary: strOrNull, openItemsAcknowledged: bool },
};

function isStoredSheetEvent(e: unknown): e is SheetEventPost {
  if (typeof e !== "object" || e === null) return false;
  const ev = e as Partial<SheetEventPost>;
  if (typeof ev.clientEventId !== "string" || typeof ev.kind !== "string") return false;
  const fields = Object.hasOwn(STORED_PAYLOAD_FIELDS, ev.kind) ? STORED_PAYLOAD_FIELDS[ev.kind] : undefined;
  if (!fields || typeof ev.payload !== "object" || ev.payload === null) return false;
  const payload = ev.payload as Record<string, unknown>;
  return Object.entries(fields).every(([field, check]) => check(payload[field]));
}

function parseSheetQueue(raw: string | null): QueuedSheetEvent[] {
  try {
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q): q is QueuedSheetEvent => typeof q === "object" && q !== null && isStoredSheetEvent((q as QueuedSheetEvent).event),
    );
  } catch {
    return [];
  }
}

async function tolerantGet(store: KvStore, key: string): Promise<string | null> {
  try {
    return await store.get(key);
  } catch {
    return null;
  }
}

/** Codex #5276: the read in front of an overwrite or delete. `get` stays
 *  tolerant for read-only loads, so an empty read here is trusted only when
 *  storage lists the key as absent; otherwise this returns null (unreadable)
 *  and the caller must not write, so a failed read can never wipe what is
 *  stored. */
async function readBeforeWrite(store: KvStore, key: string): Promise<{ raw: string | null } | null> {
  const raw = await tolerantGet(store, key);
  if (raw !== null) return { raw };
  try {
    const keys = await store.keys();
    return keys !== null && !keys.includes(key) ? { raw: null } : null;
  } catch {
    return null;
  }
}

/** Tolerant load: corrupt/absent state is an empty queue, never a crash. */
export async function loadSheetQueue(store: KvStore, scopeId: string, jobId: string): Promise<QueuedSheetEvent[]> {
  return parseSheetQueue(await tolerantGet(store, sheetQueueKey(scopeId, jobId)));
}

/** The queue as read before a write; null when it could not be read. */
async function loadSheetQueueForWrite(store: KvStore, scopeId: string, jobId: string): Promise<QueuedSheetEvent[] | null> {
  const read = await readBeforeWrite(store, sheetQueueKey(scopeId, jobId));
  return read && parseSheetQueue(read.raw);
}

/** Returns whether the write actually persisted (see KvStore.set). */
async function saveSheetQueue(store: KvStore, scopeId: string, jobId: string, q: QueuedSheetEvent[]): Promise<boolean> {
  return sheetSet(store, sheetQueueKey(scopeId, jobId), JSON.stringify(q));
}

/** Codex #5276 r5: sign-out in ANY tab writes this (outside the sheet
 *  prefixes, so the purge keeps it). Tabs share device storage but not
 *  module state, so this is the cross-tab half of the sign-out barrier. */
export const SIGN_OUT_MARKER_KEY = "flm.sheetsignout.v1";
/** Codex #5276 r11: how many sign-outs had finished when this page loaded,
 *  read synchronously from device storage as the module loads. A sign-out that
 *  finishes later ended this tab's session. A count, not a clock time, so a tab
 *  opened in the same millisecond as a finish is still ordered exactly.
 *  #5292: null when the marker was corrupt at load, which blocks this tab's
 *  writes until it reloads, since it cannot know which sign-outs it missed. */
const TAB_LOADED = loadedSignOutMarker();
function loadedSignOutMarker(): SignOutMarker | null {
  try {
    const ls = typeof window === "undefined" ? undefined : window.localStorage;
    return ls ? parseSignOutMarker(ls.getItem(SIGN_OUT_MARKER_KEY)) : { gen: 0, pending: {} };
  } catch {
    return { gen: 0, pending: {} };
  }
}

/** Every Living Sheet write goes through here. A tab loaded before the latest
 *  sign-out writes nothing, so a late reply cannot restore purged text, and no
 *  tab writes while a sign-out is in progress anywhere. */
async function sheetSet(store: KvStore, key: string, value: string): Promise<boolean> {
  return withSheetWriteLock(async () => {
    // Codex #5276 r12 audit: a marker that cannot be read blocks the write,
    // never lets it through as "no sign-out". #5292: neither does one that
    // reads back as something other than a marker this client wrote.
    const marker = await readBeforeWrite(store, SIGN_OUT_MARKER_KEY);
    const parsed = marker === null ? null : parseSignOutMarker(marker.raw);
    if (parsed === null || signOutBlocksWrites(parsed)) return false;
    return store.set(key, value);
  });
}

/** Codex #5276 r9/r11: the marker records how many sign-outs have finished
 *  (`gen`) and the in-progress ones (`pending`, one unique id each). Ownership
 *  is the id, never a clock value, so two sign-outs in the same millisecond
 *  never share it, and Cancel only ever removes its own id. Stored as a plain
 *  number when nothing is pending. */
type SignOutMarker = { gen: number; pending: Record<string, number>; epoch?: string };

/** An in-progress sign-out left behind by a closed or crashed tab stops
 *  blocking writes after this long. */
export const SIGN_OUT_PENDING_MAX_MS = 10 * 60 * 1000;

/** #5292: null when the stored text is readable but is not a marker this
 *  client writes (bad JSON, a non-object, a bad count or lease). It blocks
 *  writes and is replaced only by a finished sign-out, never read as empty. */
function parseSignOutMarker(raw: string | null): SignOutMarker | null {
  const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (raw === null || raw.trim() === "") return { gen: 0, pending: {} };
  if (Number.isFinite(Number(raw))) return isCount(Number(raw)) ? { gen: Number(raw), pending: {} } : null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { gen, pending, epoch } = parsed as { gen?: unknown; pending?: unknown; epoch?: unknown };
  if (gen !== undefined && !isCount(gen)) return null;
  if (epoch !== undefined && (typeof epoch !== "string" || epoch === "")) return null;
  if (pending !== undefined && (typeof pending !== "object" || pending === null || Array.isArray(pending))) return null;
  const leases: Record<string, number> = {};
  for (const [id, at] of Object.entries(pending ?? {})) {
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    leases[id] = at;
  }
  return epoch === undefined ? { gen: gen ?? 0, pending: leases } : { gen: gen ?? 0, pending: leases, epoch };
}

function serializeSignOutMarker(m: SignOutMarker): string | null {
  // An epoch, once written, is never dropped: losing it would let a tab loaded
  // before the repair match the marker again.
  if (Object.keys(m.pending).length > 0 || m.epoch !== undefined) return JSON.stringify(m);
  return m.gen === 0 ? null : String(m.gen);
}

function signOutBlocksWrites(m: SignOutMarker, now = Date.now()): boolean {
  if (TAB_LOADED === null || m.epoch !== TAB_LOADED.epoch || m.gen > TAB_LOADED.gen) return true;
  return Object.values(m.pending).some((at) => now - at < SIGN_OUT_PENDING_MAX_MS);
}

/** Codex #5276 r6: the browser's cross-tab lock (Web Locks) orders each
 *  check-then-write against the sign-out marker, so no write that missed the
 *  marker can land after the purge that follows it. Without Web Locks (tests,
 *  very old browsers) the write runs unlocked, as before. */
const SHEET_WRITE_LOCK = "flm.sheetwrite.v1";
function withSheetWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  return locks ? (locks.request(SHEET_WRITE_LOCK, fn) as Promise<T>) : fn();
}

/** Read-modify-write of the marker under the cross-tab write lock. It counts
 *  only once the stored marker reads back with `holds` true (Codex #5276 r6).
 *  #5292: a stored marker that is not ours is replaced before the change, with
 *  a new random epoch. Every tab loaded before the repair holds another epoch
 *  (or none), so it stays blocked whatever the count or the clock says (Codex
 *  #5297 r1 F2). The count restarts from the clock only for an older version
 *  of this page still open in another tab, which compares counts alone. */
function updateSignOutMarker(
  store: KvStore,
  change: (m: SignOutMarker) => void,
  holds: (m: SignOutMarker) => boolean,
): Promise<boolean> {
  return withSheetWriteLock(async () => {
    // A failed read never stands in for "no marker": rewriting from it could
    // lower the count or drop another tab's in-progress sign-out.
    const current = await readBeforeWrite(store, SIGN_OUT_MARKER_KEY);
    if (current === null) return false;
    const m = parseSignOutMarker(current.raw) ?? { gen: Math.max(Date.now(), 1), pending: {}, epoch: newSignOutId() };
    change(m);
    const next = serializeSignOutMarker(m);
    const written = next === null ? await store.remove(SIGN_OUT_MARKER_KEY) : await store.set(SIGN_OUT_MARKER_KEY, next);
    const stored = parseSignOutMarker(await tolerantGet(store, SIGN_OUT_MARKER_KEY));
    return written && stored !== null && holds(stored);
  });
}

function newSignOutId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  return withKeyLock(sheetQueueKey(scopeId, jobId), fn);
}

/** The same serialization, keyed by any storage key (the rejected store
 *  #5212 uses its own key, so it needs the lock without a queue key). */
async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
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
    result = await withCrossTabKeyLock(key, fn);
  } catch (e) {
    failure = e;
  } finally {
    settled();
  }
  if (failure !== undefined) throw failure;
  return result;
}

/** Codex #5276 r7: the chain above is per tab, but every tab shares device
 *  storage, so the whole read-modify-write on a key also holds the browser's
 *  cross-tab lock for that key. Otherwise a Dismiss in one tab can act on a
 *  stale list and delete a rejection another tab just recorded. Lock order is
 *  always this key lock, then SHEET_WRITE_LOCK inside sheetSet; sign-out takes
 *  only SHEET_WRITE_LOCK, so the two can never wait on each other in a cycle.
 *  Without Web Locks (tests, browsers older than Chrome 69 / Safari 15.4 /
 *  Firefox 96) the per-tab chain is all there is, as before. */
function withCrossTabKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  return locks ? (locks.request(`flm.sheetkey.v1:${key}`, fn) as Promise<T>) : fn();
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
    const q = await loadSheetQueueForWrite(store, scopeId, jobId);
    if (q === null) return { queue: [], saved: false };
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
 *  enqueued while this one's `submit` await was in flight. Exported (R2-03)
 *  so a caller that already knows the exact entry to drop (e.g. the conflict
 *  panel's "Use mine", which must remove the ORIGINAL only after its
 *  replacement is durably enqueued) can remove it by id rather than
 *  reaching for `dropHeadOfSheetQueue`, whose "head" may no longer be that
 *  entry. Returns whether the removal actually persisted (R2-20: a failed
 *  underlying store write must never look like a successful removal — the
 *  caller needs to know the item is still really in storage). */
export async function removeFromSheetQueue(store: KvStore, scopeId: string, jobId: string, clientEventId: string): Promise<boolean> {
  return withQueueLock(scopeId, jobId, async () => {
    const q = await loadSheetQueueForWrite(store, scopeId, jobId);
    if (q === null) return false;
    return saveSheetQueue(store, scopeId, jobId, q.filter((i) => i.event.clientEventId !== clientEventId));
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
    const q = await loadSheetQueueForWrite(store, scopeId, jobId);
    if (q === null) return;
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
  /** R2-04: every item the server definitively rejected this drain, WITH its
   *  payload and the reason — a rejection must never look like "saved"
   *  (postEvent checks this list for its own clientEventId), and the
   *  technician must be able to see what was not accepted and why, not just
   *  a generic toast that discards the content. */
  rejected: Array<{ event: SheetEventPost; message: string }>;
  remaining: number;
  /** A 409 conflict stopped the drain; the conflicting item (and everything
   *  behind it) stays queued until the technician resolves it. */
  conflict: boolean;
  /** A thrown error (network/5xx/401) stopped the drain; nothing behind the
   *  failed item could have done better, so it all stays queued. */
  networkStopped: boolean;
  /** R2-20: the server already accepted (or definitively rejected) an item,
   *  but the local queue could not be updated to drop it (the underlying
   *  store write failed). Resubmitting it again would just replay the same
   *  already-decided write forever without ever making progress, so the
   *  drain STOPS instead — the caller must show a distinct "can't update
   *  this phone's storage" state, never loop. */
  drainStuck: boolean;
};

let sheetDrainInFlight = false;
/** Resolves when the in-flight drain (if any) has finished. */
let sheetDrainSettled: Promise<void> = Promise.resolve();
/** Codex #5276 r3: set while sign-out clears the phone, so no new replay
 *  starts (writes are refused by SIGN_OUT_MARKER_KEY, in every tab). */
let sheetSignOutBarrier = false;

/** Lift the sign-out barrier. Cancel is handled inside clearSheetDataForSignOut;
 *  a completed sign-out keeps the barrier because the page is leaving, and a
 *  reload starts with it lifted. Exported for test isolation. */
export function releaseSheetSignOutBarrier(): void {
  sheetSignOutBarrier = false;
}

/** How long sign-out waits for a replay already talking to the server. */
const SIGN_OUT_DRAIN_WAIT_MS = 5000;

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
  notebookId = "",
): Promise<SheetDrainResult | null> {
  if (sheetDrainInFlight || sheetSignOutBarrier) return null;
  sheetDrainInFlight = true;
  let settle = (): void => {};
  sheetDrainSettled = new Promise<void>((r) => (settle = r));
  try {
    const result: SheetDrainResult = { sent: 0, droppedRejected: 0, rejected: [], remaining: 0, conflict: false, networkStopped: false, drainStuck: false };
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
        const removed = await removeFromSheetQueue(store, scopeId, jobId, item.event.clientEventId);
        result.sent++;
        if (!removed) {
          // R2-20: the write landed, but we could not durably drop it from
          // the queue — looping would just resubmit this same already-
          // accepted item forever (the server's idempotency on
          // clientEventId prevents a duplicate write, but never terminates
          // the client's retry). Stop now.
          result.drainStuck = true;
          break;
        }
      } else if (outcome.status === "conflict") {
        await markSheetQueueAttempt(store, scopeId, jobId, item.event.clientEventId, "conflict");
        result.conflict = true;
        break;
      } else {
        // #5212: persist the rejection BEFORE the queue entry is dropped. The
        // rejected note is the only copy of the technician's words; if the
        // record cannot be written, the entry stays queued and the drain stops.
        const persisted = await recordRejectedSheetEvent(store, scopeId, notebookId, jobId, {
          event: item.event,
          message: outcome.message,
          rejectedAt: new Date().toISOString(),
        });
        result.droppedRejected++;
        result.rejected.push({ event: item.event, message: outcome.message });
        if (!persisted) {
          result.drainStuck = true;
          break;
        }
        const removed = await removeFromSheetQueue(store, scopeId, jobId, item.event.clientEventId);
        if (!removed) {
          result.drainStuck = true;
          break;
        }
      }
    }
    result.remaining = (await loadSheetQueue(store, scopeId, jobId)).length;
    return result;
  } finally {
    sheetDrainInFlight = false;
    settle();
  }
}

// ---------------------------------------------------------------------------
// Rejected store (#5212). A definitively rejected write (e.g. `job_finished`)
// is the only copy of the technician's words, so it is kept per
// scope (tenant/user) + notebook + job until the technician dismisses it.
// It survives navigation and reload, but not sign-out: like a pending queue it
// is local-only work, so the sign-out prompt counts it and the purge removes it.
// ---------------------------------------------------------------------------

const REJECTED_PREFIX = "flm.sheetrej.v1.";

export type RejectedSheetEvent = {
  event: SheetEventPost;
  message: string;
  rejectedAt: string;
};

export function rejectedSheetKey(scopeId: string, notebookId: string, jobId: string): string {
  return `${REJECTED_PREFIX}${scopeId}.${notebookId}.${jobId}`;
}

async function readRejectedList(store: KvStore, key: string): Promise<RejectedSheetEvent[]> {
  return parseRejectedList(await tolerantGet(store, key));
}

/** The kept rejections as read before a write; null when they could not be read. */
async function readRejectedListForWrite(store: KvStore, key: string): Promise<RejectedSheetEvent[] | null> {
  const read = await readBeforeWrite(store, key);
  return read && parseRejectedList(read.raw);
}

function parseRejectedList(raw: string | null): RejectedSheetEvent[] {
  try {
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RejectedSheetEvent =>
        typeof r === "object" &&
        r !== null &&
        isStoredSheetEvent((r as RejectedSheetEvent).event) &&
        typeof (r as RejectedSheetEvent).message === "string",
    );
  } catch {
    return [];
  }
}

/** Tolerant load: corrupt or unavailable storage is an empty list, never a throw. */
export async function loadRejectedSheetEvents(
  store: KvStore,
  scopeId: string,
  notebookId: string,
  jobId: string,
): Promise<RejectedSheetEvent[]> {
  return readRejectedList(store, rejectedSheetKey(scopeId, notebookId, jobId));
}

/** Persist one rejection. Deduped on clientEventId: a replay or retry of the
 *  same write never creates a second entry. Returns whether it is durable. */
export async function recordRejectedSheetEvent(
  store: KvStore,
  scopeId: string,
  notebookId: string,
  jobId: string,
  entry: RejectedSheetEvent,
): Promise<boolean> {
  const key = rejectedSheetKey(scopeId, notebookId, jobId);
  return withKeyLock(key, async () => {
    try {
      const list = await readRejectedListForWrite(store, key);
      if (list === null) return false;
      if (list.some((r) => r.event.clientEventId === entry.event.clientEventId)) return true;
      list.push(entry);
      return await sheetSet(store, key, JSON.stringify(list));
    } catch {
      return false;
    }
  });
}

/** Dismiss: remove one rejected entry by its clientEventId. */
export async function dismissRejectedSheetEvent(
  store: KvStore,
  scopeId: string,
  notebookId: string,
  jobId: string,
  clientEventId: string,
): Promise<boolean> {
  const key = rejectedSheetKey(scopeId, notebookId, jobId);
  return withKeyLock(key, async () => {
    try {
      const list = await readRejectedListForWrite(store, key);
      // Never delete blind: an unreadable list keeps the row; a readable one
      // without this entry means it is not on the phone.
      if (list === null) return false;
      if (!list.some((r) => r.event.clientEventId === clientEventId)) return true;
      const next = list.filter((r) => r.event.clientEventId !== clientEventId);
      if (next.length === 0) {
        // The row may only go once the text is verifiably gone from the phone.
        return await store.remove(key);
      }
      return await sheetSet(store, key, JSON.stringify(next));
    } catch {
      return false;
    }
  });
}

/** Union of two lists keyed by clientEventId; `first` wins on duplicates. */
export function mergeRejectedSheetEvents<T extends { event: SheetEventPost }>(first: T[], second: T[]): T[] {
  const seen = new Set(first.map((r) => r.event.clientEventId));
  return [...first, ...second.filter((r) => !seen.has(r.event.clientEventId))];
}

/** Recover: the note/question text of a rejected write, or null for kinds
 *  that carry no free text (the screen offers Dismiss only for those). */
export function rejectedNoteText(event: SheetEventPost): { kind: "note" | "question"; text: string } | null {
  if (event.kind !== "note_added") return null;
  const payload = event.payload as { text?: unknown; noteKind?: unknown };
  if (typeof payload.text !== "string" || payload.text.trim() === "") return null;
  return { kind: payload.noteKind === "question" ? "question" : "note", text: payload.text };
}

/** Put recovered text back into an input without overwriting a draft the
 *  technician is already typing. */
export function recoveredFieldValue(current: string, text: string): string {
  return current.trim() === "" ? text : `${current} ${text}`;
}

/** Local-only Living Work Sheet keys: pending queues and kept rejections (#5212). */
function isLocalSheetKey(k: string): boolean {
  return k.startsWith(QUEUE_PREFIX) || k.startsWith(REJECTED_PREFIX);
}

/** Sign-out hygiene: remove every Living Work Sheet queue and kept rejection
 *  (all jobs, all tenants/users on this device). `remaining` counts keys not
 *  verifiably removed, or is null when storage could not be listed at all, so
 *  sign-out never claims a purge that did not happen. */
export async function purgeSheetQueues(store: KvStore): Promise<{ purged: number; remaining: number | null }> {
  const all = await store.keys();
  if (all === null) return { purged: 0, remaining: null };
  const keys = all.filter(isLocalSheetKey);
  let remaining = 0;
  for (const k of keys) {
    try {
      if (!(await store.remove(k))) remaining++;
    } catch {
      remaining++;
    }
  }
  return { purged: keys.length - remaining, remaining };
}

/** #5212: the sign-out text when the purge could not clear everything (null
 *  `remaining` = storage could not be checked), or null when nothing is left. */
export function signOutPurgeFailedPrompt(remaining: number | null): string | null {
  if (remaining === null) {
    return "Could not check this phone for saved sheet items, so some may still be here. Sign out anyway?";
  }
  if (remaining <= 0) return null;
  return `Could not clear ${remaining} saved sheet item${remaining === 1 ? "" : "s"} from this phone. Sign out anyway and leave ${remaining === 1 ? "it" : "them"} here?`;
}

/** The sheet half of sign-out. R2-32: ask before discarding anything unsynced
 *  (Cancel keeps it, no purge). #5212: a purge that left sheet text on the
 *  phone says so, and Cancel then keeps the technician signed in. Returns
 *  whether sign-out should go ahead; `onPurgeStart` fires only if it purges. */
export async function clearSheetDataForSignOut(
  store: KvStore,
  confirm: (message: string) => boolean,
  onPurgeStart?: () => void,
  drainWaitMs = SIGN_OUT_DRAIN_WAIT_MS,
): Promise<boolean> {
  // Codex #5276 r3: stop new replays and enqueues, then let a replay already
  // talking to the server finish, so its result cannot land after the purge.
  sheetSignOutBarrier = true;
  // Codex #5276 r5/r9: every tab stops writing BEFORE the count, so the
  // warning covers everything the purge will remove. Cancel removes only this
  // sign-out's own id; a finished sign-out from another tab stays in force.
  const id = newSignOutId();
  // Codex #5276 r10: the in-progress entry is a lease stamped with its last
  // renewal. A question left open past SIGN_OUT_PENDING_MAX_MS lets other tabs
  // write again (window.confirm freezes this tab, so nothing can renew it
  // meanwhile), so sign-out renews and starts over from the count.
  let leaseAt = 0;
  const begin = async () => {
    const at = Date.now();
    const ok = await updateSignOutMarker(store, (m) => void (m.pending[id] = at), (m) => m.pending[id] === at);
    if (ok) leaseAt = at;
    return ok;
  };
  const lapsed = () => Date.now() - leaseAt >= SIGN_OUT_PENDING_MAX_MS;
  // Codex #5297 r1 F1: another tab's repair of a corrupt marker drops this
  // sign-out's entry, and a tab opened after it can save again.
  const lost = async () => {
    const read = await readBeforeWrite(store, SIGN_OUT_MARKER_KEY);
    return read === null || parseSignOutMarker(read.raw)?.pending[id] !== leaseAt;
  };
  let markerInstalled = await begin();
  const cancel = async (): Promise<false> => {
    sheetSignOutBarrier = false;
    await updateSignOutMarker(store, (m) => void delete m.pending[id], (m) => !(id in m.pending));
    return false;
  };
  for (;;) {
    const prompt = signOutUnsyncedPrompt(await countAllSheetQueueEntries(store));
    if (prompt && !confirm(prompt)) return cancel();
    onPurgeStart?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      sheetDrainSettled.then(() => true),
      new Promise<boolean>((r) => (timer = setTimeout(() => r(false), drainWaitMs))),
    ]);
    clearTimeout(timer);
    // Codex #5276 r4: ask BEFORE purging when a replay is still sending. The
    // queue holds the only copy of that note until the server answers, so
    // Cancel must leave storage untouched.
    if (!drained && !confirm(SIGN_OUT_STILL_SENDING_PROMPT)) return cancel();
    if (markerInstalled && (lapsed() || (await lost()))) {
      markerInstalled = await begin();
      continue; // the warning may be out of date: count and ask again
    }
    let { remaining } = await purgeSheetQueues(store);
    if (!markerInstalled) {
      // Codex #5276 r6: a full phone can refuse the marker. The purge freed
      // space, so try again, then sweep whatever another tab saved meanwhile.
      markerInstalled = await begin();
      if (markerInstalled) ({ remaining } = await purgeSheetQueues(store));
    }
    if (!markerInstalled && !confirm(SIGN_OUT_OTHER_TABS_PROMPT)) return cancel();
    const leftBehind = signOutPurgeFailedPrompt(remaining);
    // A signed-out page keeps the barrier; Cancel keeps the technician working.
    if (leftBehind && !confirm(leftBehind)) return cancel();
    if (!(markerInstalled && lapsed())) break;
    markerInstalled = await begin(); // another tab may have saved after the purge
  }
  // Done: raise the finished count under the lock, so every tab loaded before
  // now (including one opened mid-sign-out, Codex #5276 r10) stays blocked.
  // The count only goes up, so an older finish cannot undo a newer one.
  let finishedGen = 0;
  let priorGen = 0;
  const finished = await updateSignOutMarker(
    store,
    (m) => {
      delete m.pending[id];
      priorGen = m.gen;
      finishedGen = m.gen + 1;
      m.gen = finishedGen;
    },
    (m) => m.gen >= finishedGen && !(id in m.pending),
  );
  if (markerInstalled && !finished && !confirm(SIGN_OUT_OTHER_TABS_PROMPT)) {
    // Codex #5276 r12: the finish may have been saved without reading back.
    // Cancel takes back this sign-out's own count, but only while it is still
    // the stored one: counts rise one at a time under the lock, so that value
    // is this sign-out's alone, and a later sign-out's count is never lowered.
    if (finishedGen > 0) {
      await updateSignOutMarker(store, (m) => void (m.gen === finishedGen && (m.gen = priorGen)), (m) => m.gen !== finishedGen);
    }
    return cancel();
  }
  return true;
}

/** Sign-out could not record its marker, so other open tabs are not blocked. */
export const SIGN_OUT_OTHER_TABS_PROMPT =
  "This phone could not stop other open FactoryLM tabs from saving sheet items, so one may be saved here again after you sign out. Close other FactoryLM tabs first. Sign out anyway?";

/** Sign-out could not wait out a replay that is still talking to the server. */
export const SIGN_OUT_STILL_SENDING_PROMPT =
  "A sheet item is still being sent and may not reach the server. Signing out removes it from this phone. Sign out anyway?";

/** R2-32: total queued entries across EVERY Living Work Sheet queue on this
 *  device (any job, any tenant/user), plus kept rejections (#5212) — exactly
 *  what `purgeSheetQueues` is about to discard. Sign-out must ask before
 *  losing these, not after.
 *  Tolerant like `loadSheetQueue`: a corrupt entry counts as 0, never throws. */
export async function countAllSheetQueueEntries(store: KvStore): Promise<number> {
  // Unlistable storage counts as 0 here; the purge then reports it as unknown.
  const keys = ((await store.keys()) ?? []).filter(isLocalSheetKey);
  let total = 0;
  for (const k of keys) {
    const raw = await store.get(k);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) total += parsed.length;
    } catch {
      /* corrupt — counts as 0, same tolerance as loadSheetQueue */
    }
  }
  return total;
}

/** R2-32: the sign-out confirmation text, or null when there is nothing
 *  unsynced to lose (no prompt at all in that case — unchanged behavior). */
export function signOutUnsyncedPrompt(pendingCount: number): string | null {
  if (pendingCount <= 0) return null;
  return `${pendingCount} change${pendingCount === 1 ? "" : "s"} not yet saved on this phone. Sign out anyway and lose them?`;
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
  /** R2-20: the server already decided an item (accepted or rejected), but
   *  the local queue could not be updated to drop it — drain stopped
   *  rather than loop. Distinct from `storageFailed` (which is about a NEW
   *  write never reaching storage): this phone's storage can no longer be
   *  trusted to drain at all, which is worse than any single queued item. */
  drainStuck?: boolean;
};

/** Priority: conflict > saving > drainStuck > storageFailed > queued (offline) > saved. */
export function saveBadge(state: SaveBadgeState): string {
  if (state.conflict) return "Conflict – tap to sort out";
  if (state.saving) return "Saving…";
  if (state.drainStuck) return "Can't update this phone's storage — reload the page";
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
 *  definition; LivingSheet.tsx re-exports it for its existing tests.
 *
 *  R2-16: a step that carries a torque reference (`torqueRef`) needs this
 *  confirm REGARDLESS of its `checkoff` — validate.ts permits
 *  `checkoff:"none"` with a torqueRef set, and that combination must still
 *  require confirmation (the guarantee is "steps that carry a torque",
 *  not "steps whose checkoff happens to say torque/loctite/measurement"). */
export function stepNeedsConfirm(step: SheetStepView): boolean {
  if (step.done) return false;
  const hasTorqueReference = step.torqueRef !== null && step.torqueRef.trim() !== "";
  return hasTorqueReference || step.checkoff === "torque" || step.checkoff === "loctite" || step.checkoff === "measurement";
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

/** GET .../work-order — the job's technician-confirmed CMMS work-order
 *  request, as `deliveryStatusForWorkOrderRequest` reports it. */
export type WorkOrderRequestClient = {
  eventId: string;
  requestedAt: string;
  state: string;
  externalRef: string | null;
  attempts: number;
  updatedAt: string;
  /** "cmms_licence_limit" when the CMMS refused because its licence caps open work orders. */
  blockedBy?: string | null;
};

/** A refusal a technician can fix by asking again once an admin frees room. */
export function workOrderRetryable(request: WorkOrderRequestClient): boolean {
  return request.state === "permission_denied" && request.blockedBy === "cmms_licence_limit";
}

export async function apiGetWorkOrderRequest(
  notebookId: string,
  jobId: string,
): Promise<ApiResult<{ request: WorkOrderRequestClient | null }>> {
  const res = await fetch(`${sheetsBase(notebookId)}${encodeURIComponent(jobId)}/work-order/`, { credentials: "include" });
  return asApiResult(res);
}

/** POST .../work-order — only ever called from the explicit "Yes, create it"
 *  confirmation. Safe to retry: the server returns the first request. */
export async function apiRequestWorkOrder(
  notebookId: string,
  jobId: string,
): Promise<ApiResult<{ eventId: string; replayed: boolean; delivery: { deliveryId: string | null; state?: string; reason?: string } }>> {
  const res = await fetch(`${sheetsBase(notebookId)}${encodeURIComponent(jobId)}/work-order/`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
  return asApiResult(res);
}

/** Plain-language status of a work-order request. Never claims the order
 *  exists until the CMMS read it back (`verified_by_readback`). */
export function workOrderStatusText(request: WorkOrderRequestClient): string {
  switch (request.state) {
    case "verified_by_readback":
      return request.externalRef
        ? `Work order #${request.externalRef} created in the CMMS.`
        : "Work order created in the CMMS.";
    case "queued":
    case "leased":
      return "Requested — waiting to be sent to the CMMS.";
    case "accepted_pending_verification":
      return "Sent — waiting for the CMMS to confirm the work order exists.";
    case "retryable_failure":
    case "outcome_unknown":
      return "Not confirmed yet — the CMMS did not answer. It will retry automatically; it will not create a second order.";
    case "permission_denied":
      if (workOrderRetryable(request)) {
        return "Not created — the CMMS is at its limit of open work orders for its licence. Ask your admin to close finished orders or add a licence, then try again. Trying again will not create a second order.";
      }
      return "The CMMS refused this request (permission). Ask your admin to check the CMMS connection.";
    case "blocked_policy":
    case "saved":
      return "Saved on this sheet only — sending work orders to the CMMS is turned off for this site.";
    default:
      return "Could not create the work order in the CMMS. Ask your admin to check it.";
  }
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

/** R2-06/07: generalizes attemptClientEventId to the WHOLE request, not
 *  just its id. A server-side idempotency fingerprint across the complete
 *  payload (id, occurredAt, body) means regenerating even one OTHER field
 *  on retry — a fresh `occurredAt`, a re-read `baseSeq`, a re-picked file —
 *  makes a retry of an already-committed-but-lost-response attempt look
 *  like a NEW, conflicting request even though the id matches. `pending` is
 *  the frozen request from a prior, not-yet-succeeded attempt (reused
 *  byte-for-byte); `build` mints a fresh one only when there is none. */
export function attemptRequest<T>(pending: T | null, build: () => T): T {
  return pending ?? build();
}

/** R2-02: whether a form field should clear after its write resolved —
 *  ONLY when the save actually succeeded AND the field still holds EXACTLY
 *  what was submitted. If the technician kept typing while the write was
 *  in flight, their newer text must survive even though the earlier save
 *  succeeded (clearing it would silently discard what they just typed). */
export function clearedFieldValue(saveSucceeded: boolean, submittedValue: string, currentValue: string): string {
  return saveSucceeded && currentValue === submittedValue ? "" : currentValue;
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

/** One frozen photo-upload attempt, bound to the notebook + job it was
 *  taken for. Retry replays it byte-for-byte, and only on that same job. */
export type PhotoAttempt = {
  notebookId: string;
  jobId: string;
  file: File;
  baseSeq: number;
  clientEventId: string;
  caption: string | null;
};

/** Whether a pending attempt may be retried from the sheet now on screen. */
export function photoAttemptBelongsTo(
  attempt: Pick<PhotoAttempt, "notebookId" | "jobId"> | null,
  notebookId: string,
  openJobId: string | null,
): boolean {
  return attempt !== null && openJobId !== null && attempt.notebookId === notebookId && attempt.jobId === openJobId;
}

/** A "check before marking done" dialog, bound to the job it was opened on.
 *  Step ids repeat across jobs built from the same job sheet, so the dialog
 *  must never post its step to whatever job happens to be open later. */
export type StepConfirm = {
  notebookId: string;
  jobId: string;
  step: SheetStepView;
  receiptOrigin?: { proposalId: string; baseSeq: number };
};

export function stepConfirmBelongsTo(
  confirm: Pick<StepConfirm, "notebookId" | "jobId"> | null,
  notebookId: string,
  openJobId: string | null,
): boolean {
  return photoAttemptBelongsTo(confirm, notebookId, openJobId);
}

/** The server answered and refused the request outright, so nothing was
 *  created: the next tap may build a fresh attempt from the technician's
 *  current inputs instead of resending the rejected one (Codex #5207 F6).
 *  Excluded, so the frozen attempt is kept for an exact replay: 408 / 429 /
 *  5xx / no reply (it may have been created), and 409 — on the start route
 *  that is either "machine not confirmed" (the same request succeeds once it
 *  is) or "this request id already exists with a different body", where a
 *  fresh id could create a duplicate job. */
export function isDefinitiveRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}
