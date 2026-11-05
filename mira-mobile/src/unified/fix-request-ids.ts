// Record-fix idempotency keys that survive an app reload (#4065).
//
// POST /api/equipment-notebooks/[id]/fixes requires a clientRequestId. The
// server stores it with the fix (migrations 097/098) and replays the stored row
// with 200 when the same key comes back with the same content, so a retry
// after a lost response cannot file a second append-only row. That only holds
// if the phone sends the SAME key again after a reload, so the pending key is
// written to device storage before the request goes out and forgotten once the
// save is settled (saved, or refused by the server).
//
// Pure logic over the injected KV store (the Preferences store in production,
// an in-memory store in tests). Storage is per device and uses the
// `flm.unified.` prefix, which the sign-out purge already removes.

import type { KvStore } from "../lib/offline-queue";

export const FIX_REQUEST_KEY = "flm.unified.fixreq.v1";
/** Pending keys kept on the device. Oldest are dropped first; the server row
 *  still exists, so dropping a key only means a later retry files afresh. */
export const FIX_REQUEST_CAP = 50;

export interface PersistentFixRequestIds {
  /** The id for this fix, minted once and persisted until it is settled. */
  idFor(notebookId: string, sourceTurnId: string, fix: string): Promise<string>;
  /** Forget the id once the save succeeded or the server refused it. */
  settle(notebookId: string, sourceTurnId: string, fix: string): Promise<void>;
}

type Pending = Record<string, string>;

const entryKey = (notebookId: string, sourceTurnId: string, fix: string) =>
  `${notebookId}\u0000${sourceTurnId}\u0000${fix}`;

/** Tolerant load: an absent, corrupt or unreadable value is an empty map. */
async function load(store: KvStore): Promise<Pending> {
  try {
    const raw = await store.get(FIX_REQUEST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Pending = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Best effort: a failed write degrades to an in-memory-equivalent key for
 *  this session, never to a failed save. */
async function save(store: KvStore, pending: Pending): Promise<void> {
  try {
    const keys = Object.keys(pending);
    const kept = keys.slice(Math.max(0, keys.length - FIX_REQUEST_CAP));
    const bounded: Pending = {};
    for (const k of kept) bounded[k] = pending[k]!;
    await store.set(FIX_REQUEST_KEY, JSON.stringify(bounded));
  } catch {
    // Storage is unavailable: the id still works for this request.
  }
}

export function createPersistentFixRequestIds(
  store: KvStore,
  newId: () => string = () => globalThis.crypto.randomUUID(),
): PersistentFixRequestIds {
  // Serialises read-modify-write so concurrent calls cannot lose an entry.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    idFor(notebookId, sourceTurnId, fix) {
      return serial(async () => {
        const k = entryKey(notebookId, sourceTurnId, fix);
        const pending = await load(store);
        const existing = pending[k];
        if (existing) return existing;
        const id = newId();
        // Re-insert so the entry is the newest for the cap.
        delete pending[k];
        pending[k] = id;
        await save(store, pending);
        return id;
      });
    },
    settle(notebookId, sourceTurnId, fix) {
      return serial(async () => {
        const k = entryKey(notebookId, sourceTurnId, fix);
        const pending = await load(store);
        if (!(k in pending)) return;
        delete pending[k];
        await save(store, pending);
      });
    },
  };
}
