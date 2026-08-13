// Offline WO queue — pure-logic regression net (Phase 4). In-memory KV store;
// no Capacitor, no network. The queue's contract: FIFO, deduped on client_key,
// keep-and-stop on retryable failures, drop-and-report on definitive 4xx,
// tenant-scoped keys, purge-all on sign-out.
import { describe, it, expect } from "vitest";
import {
  enqueueCreate,
  loadQueue,
  drainQueue,
  purgeAllQueues,
  pendingCount,
  queueKey,
  type KvStore,
} from "../offline-queue";
import { ApiError } from "../../api/client";
import type { CreateWorkOrderInput } from "../../api/resources";

function memStore(seed: Record<string, string> = {}): KvStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
    remove: async (k) => {
      delete data[k];
    },
    keys: async () => Object.keys(data),
  };
}

function wo(key: string, desc = "conveyor jammed"): CreateWorkOrderInput {
  return { equipment_id: "eq-1", description: desc, client_key: key };
}

const T = "tenant-a";

describe("enqueueCreate", () => {
  it("appends FIFO and persists", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("k1"), "2026-08-13T00:00:00Z");
    await enqueueCreate(s, T, wo("k2"), "2026-08-13T00:01:00Z");
    const q = await loadQueue(s, T);
    expect(q.map((i) => i.input.client_key)).toEqual(["k1", "k2"]);
    expect(q[0].queued_at).toBe("2026-08-13T00:00:00Z");
    expect(await pendingCount(s, T)).toBe(2);
  });
  it("dedupes on client_key — same logical create enqueued twice is one item", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("k1"));
    await enqueueCreate(s, T, wo("k1", "retyped description"));
    expect(await pendingCount(s, T)).toBe(1);
  });
  it("tenant queues are isolated", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("k1"));
    await enqueueCreate(s, "tenant-b", wo("k2"));
    expect(await pendingCount(s, T)).toBe(1);
    expect(await pendingCount(s, "tenant-b")).toBe(1);
  });
});

describe("loadQueue tolerance", () => {
  it("corrupt JSON / wrong shape / missing key ⇒ empty queue, no crash", async () => {
    expect(await loadQueue(memStore({ [queueKey(T)]: "{not json" }), T)).toEqual([]);
    expect(await loadQueue(memStore({ [queueKey(T)]: '{"a":1}' }), T)).toEqual([]);
    expect(await loadQueue(memStore(), T)).toEqual([]);
  });
  it("filters entries without a client_key instead of choking on them", async () => {
    const s = memStore({
      [queueKey(T)]: JSON.stringify([
        { input: wo("k1"), queued_at: "x", attempts: 0 },
        { junk: true },
      ]),
    });
    expect((await loadQueue(s, T)).map((i) => i.input.client_key)).toEqual(["k1"]);
  });
});

describe("drainQueue", () => {
  it("sends all in FIFO order and empties the queue", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("k1"));
    await enqueueCreate(s, T, wo("k2"));
    const sent: string[] = [];
    const r = await drainQueue(s, T, async (i) => {
      sent.push(i.client_key);
    });
    expect(r).toMatchObject({ sent: 2, remaining: 0, stopped: false });
    expect(sent).toEqual(["k1", "k2"]);
    expect(await pendingCount(s, T)).toBe(0);
  });
  it("network failure keeps the item, increments attempts, and STOPS", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("k1"));
    await enqueueCreate(s, T, wo("k2"));
    const r = await drainQueue(s, T, async () => {
      throw new ApiError("network", null, "offline");
    });
    expect(r).toMatchObject({ sent: 0, remaining: 2, stopped: true });
    const q = await loadQueue(s, T);
    expect(q[0].attempts).toBe(1);
    expect(q[0].last_error).toContain("offline");
  });
  it("auth/server failures also keep-and-stop (retry after recovery)", async () => {
    for (const kind of ["auth", "server"] as const) {
      const s = memStore();
      await enqueueCreate(s, T, wo("k1"));
      const r = await drainQueue(s, T, async () => {
        throw new ApiError(kind, kind === "auth" ? 401 : 500, "x");
      });
      expect(r).toMatchObject({ sent: 0, remaining: 1, stopped: true });
    }
  });
  it("definitive 4xx drops the item, records it, and continues to the next", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("bad"));
    await enqueueCreate(s, T, wo("good"));
    const r = await drainQueue(s, T, async (i) => {
      if (i.client_key === "bad") throw new ApiError("client", 422, "validation failed");
    });
    expect(r).toMatchObject({ sent: 1, remaining: 0, stopped: false });
    expect(r!.rejected).toHaveLength(1);
    expect(r!.rejected[0].input.client_key).toBe("bad");
    expect(await pendingCount(s, T)).toBe(0);
  });
  it("non-ApiError throw is treated as transport (keep-and-stop)", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("k1"));
    const r = await drainQueue(s, T, async () => {
      throw new Error("socket hang up");
    });
    expect(r).toMatchObject({ sent: 0, remaining: 1, stopped: true });
  });
  it("refuses overlapping drains (returns null while one is in flight)", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("k1"));
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const first = drainQueue(s, T, async () => gate);
    const second = await drainQueue(s, T, async () => {});
    expect(second).toBeNull();
    release();
    expect(await first).toMatchObject({ sent: 1 });
  });
});

describe("purgeAllQueues (sign-out hygiene)", () => {
  it("removes every flm.woqueue key across tenants and ONLY those", async () => {
    const s = memStore({ "flm.cookiejar.v1": "keepme" });
    await enqueueCreate(s, T, wo("k1"));
    await enqueueCreate(s, "tenant-b", wo("k2"));
    const n = await purgeAllQueues(s);
    expect(n).toBe(2);
    expect(Object.keys(s.data)).toEqual(["flm.cookiejar.v1"]);
  });
});
