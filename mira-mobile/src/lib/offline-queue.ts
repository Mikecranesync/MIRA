// Offline work-order mutation queue (ADR-0034 Phase 4).
//
// Rides the client_key idempotency seam (PR #3223): a create that fails on
// transport is persisted tenant-keyed and drained later through the SAME
// createWorkOrder call with the SAME client_key — so a drain that races a
// half-landed original is a safe replay, never a duplicate.
//
// Pure logic over an injected KV store (unit-tested); the Preferences-backed
// store is the one production adapter. Queue keys are tenant-scoped and the
// sign-out path purges every queue on the device (fail-closed: local data
// never outlives the session that created it).

import { Preferences } from "@capacitor/preferences";
import { ApiError } from "../api/client";
import type { CreateWorkOrderInput } from "../api/resources";

const PREFIX = "flm.woqueue.v1.";

export function queueKey(tenantId: string): string {
  return PREFIX + tenantId;
}

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const preferencesStore: KvStore = {
  get: async (key) => (await Preferences.get({ key })).value,
  set: async (key, value) => Preferences.set({ key, value }),
  remove: async (key) => Preferences.remove({ key }),
  keys: async () => (await Preferences.keys()).keys,
};

export interface QueuedCreate {
  input: CreateWorkOrderInput;
  queued_at: string; // ISO
  attempts: number;
  last_error?: string;
}

/** Tolerant load: corrupt/absent state is an empty queue, never a crash. */
export async function loadQueue(store: KvStore, tenantId: string): Promise<QueuedCreate[]> {
  try {
    const raw = await store.get(queueKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q): q is QueuedCreate =>
        typeof q === "object" &&
        q !== null &&
        typeof (q as QueuedCreate).input?.client_key === "string",
    );
  } catch {
    return [];
  }
}

async function saveQueue(store: KvStore, tenantId: string, q: QueuedCreate[]): Promise<void> {
  await store.set(queueKey(tenantId), JSON.stringify(q));
}

/** FIFO enqueue, deduped on client_key (re-queuing the same logical create is
 *  a no-op — the key IS the identity). Returns the resulting queue. */
export async function enqueueCreate(
  store: KvStore,
  tenantId: string,
  input: CreateWorkOrderInput,
  nowIso?: string,
): Promise<QueuedCreate[]> {
  const q = await loadQueue(store, tenantId);
  if (!q.some((item) => item.input.client_key === input.client_key)) {
    q.push({ input, queued_at: nowIso ?? new Date().toISOString(), attempts: 0 });
    await saveQueue(store, tenantId, q);
  }
  return q;
}

export async function pendingCount(store: KvStore, tenantId: string): Promise<number> {
  return (await loadQueue(store, tenantId)).length;
}

export interface DrainResult {
  sent: number;
  /** Items the server definitively rejected (4xx validation etc.) — removed
   *  from the queue; surfaced to the user, never retried forever. */
  rejected: { input: CreateWorkOrderInput; error: string }[];
  remaining: number;
  /** True when the drain stopped early (still offline / server down / session
   *  expired) — remaining items stay queued for the next drain. */
  stopped: boolean;
}

let drainInFlight = false;

/** FIFO drain. Per item: submit → remove on success (a replayed create counts
 *  as success); network/server/auth failure → keep the item and STOP (nothing
 *  behind it can do better); any other ApiError → definitive rejection: drop
 *  the item, record the error, continue. State is persisted after every item
 *  so a crash mid-drain loses nothing (and replays are safe by key anyway).
 *  Returns null if a drain is already in flight. */
export async function drainQueue(
  store: KvStore,
  tenantId: string,
  submit: (input: CreateWorkOrderInput) => Promise<unknown>,
): Promise<DrainResult | null> {
  if (drainInFlight) return null;
  drainInFlight = true;
  try {
    const q = await loadQueue(store, tenantId);
    const result: DrainResult = { sent: 0, rejected: [], remaining: 0, stopped: false };
    while (q.length > 0) {
      const item = q[0];
      try {
        await submit(item.input);
        q.shift();
        result.sent++;
      } catch (e) {
        const kind = e instanceof ApiError ? e.kind : "network";
        if (kind === "network" || kind === "server" || kind === "auth") {
          item.attempts++;
          item.last_error = e instanceof Error ? e.message : String(e);
          result.stopped = true;
          await saveQueue(store, tenantId, q);
          break;
        }
        q.shift();
        result.rejected.push({
          input: item.input,
          error: e instanceof ApiError ? e.userMessage : String(e),
        });
      }
      await saveQueue(store, tenantId, q);
    }
    result.remaining = q.length;
    return result;
  } finally {
    drainInFlight = false;
  }
}

/** All device-local data namespaces that must not outlive a session. */
const PURGE_PREFIXES = [PREFIX, "flm.studio.v1."];

/** Sign-out hygiene: remove every offline queue AND cached Studio artifact on
 *  the device (all tenants). Returns how many keys were purged. */
export async function purgeAllQueues(store: KvStore): Promise<number> {
  const keys = (await store.keys()).filter((k) =>
    PURGE_PREFIXES.some((p) => k.startsWith(p)),
  );
  for (const k of keys) await store.remove(k);
  return keys.length;
}
