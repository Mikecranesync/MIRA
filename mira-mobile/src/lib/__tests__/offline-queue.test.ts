// Offline WO queue — pure-logic regression net (Phase 4). In-memory KV store;
// no Capacitor, no network. The queue's contract: FIFO, deduped on client_key,
// keep-and-stop on retryable failures, drop-and-report on definitive 4xx,
// tenant-scoped keys, purge-all on sign-out.
import { beforeEach, describe, it, expect } from "vitest";
import {
  beginSessionLocalPurge,
  enqueueCreate,
  loadQueue,
  drainQueue,
  drainQueueForSessionPurge,
  purgeAllQueues,
  pendingCount,
  queueKey,
  hasActiveWorkOrderQueueProducers,
  resumeSessionLocalWrites,
  waitForSessionLocalProducers,
  waitForWorkOrderQueueProducers,
  withSessionLocalProducer,
  withWorkOrderQueueProducer,
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

beforeEach(() => {
  resumeSessionLocalWrites();
});

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
    expect(r!.rejected[0].error).toBeInstanceOf(ApiError);
    expect(r!.rejected[0].error.kind).toBe("client");
    expect(await pendingCount(s, T)).toBe(0);
  });
  it("can retain a definitive rejection for sign-out confirmation", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("bad"));
    await enqueueCreate(s, T, wo("later"));
    const submitted: string[] = [];
    const r = await drainQueue(
      s,
      T,
      async (i) => {
        submitted.push(i.client_key);
        throw new ApiError("client", 422, "validation failed");
      },
      { retainRejected: true },
    );
    expect(r).toMatchObject({ sent: 0, remaining: 2, stopped: true });
    expect(r!.rejected).toHaveLength(1);
    expect(submitted).toEqual(["bad"]);
    expect((await loadQueue(s, T)).map((i) => i.input.client_key)).toEqual(["bad", "later"]);
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
  it("removes all session data while preserving device-scoped OTA trust", async () => {
    const s = memStore({
      "flm.cookiejar.v1": "keepme",
      "flm.studio.v1.unsaved": "tenant artifact",
      "flm.chatui.v1": "unified",
      "flm.unified.notebook.v1": "prior-tenant-notebook",
      "flm.ota.channel": "canary",
      "flm.ota.pointerHighWater.v1.canary": "signed device trust",
    });
    await enqueueCreate(s, T, wo("k1"));
    await enqueueCreate(s, "tenant-b", wo("k2"));
    const n = await purgeAllQueues(s);
    expect(n).toBe(5);
    expect(s.data).toEqual({
      "flm.cookiejar.v1": "keepme",
      "flm.ota.channel": "canary",
      "flm.ota.pointerHighWater.v1.canary": "signed device trust",
    });
  });

  it("waits for an admitted local producer before the final purge", async () => {
    const s = memStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const producer = withSessionLocalProducer(async () => {
      await gate;
      await s.set("flm.studio.v1.delayed", "old tenant artifact");
    });

    beginSessionLocalPurge();
    let settled = false;
    const waiting = waitForSessionLocalProducers().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await producer;
    await waiting;
    await purgeAllQueues(s);
    expect(s.data).toEqual({});
  });

  it("does not admit a new local producer after sign-out starts", async () => {
    beginSessionLocalPurge();
    let invoked = false;
    const result = await withSessionLocalProducer(async () => {
      invoked = true;
      return "written";
    });

    expect(result).toBeUndefined();
    expect(invoked).toBe(false);
  });

  it("does not admit a new work-order producer after sign-out starts", async () => {
    beginSessionLocalPurge();
    let invoked = false;
    const admitted = await withWorkOrderQueueProducer(async () => {
      invoked = true;
    });

    expect(admitted).toBe(false);
    expect(invoked).toBe(false);
    expect(hasActiveWorkOrderQueueProducers()).toBe(false);
  });

  it("does not admit an ordinary queue drain after sign-out starts", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("queued"));
    beginSessionLocalPurge();
    const submit = async () => undefined;

    const result = await drainQueue(s, T, submit);

    expect(result).toBeNull();
    expect(await pendingCount(s, T)).toBe(1);
  });

  it("counts an admitted ordinary drain until its queue write settles", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("queued"));
    let rejectSubmit!: (error: unknown) => void;
    const submitted = new Promise<never>((_resolve, reject) => {
      rejectSubmit = reject;
    });
    const draining = drainQueue(s, T, () => submitted);
    await Promise.resolve();

    beginSessionLocalPurge();
    let barrierSettled = false;
    const barrier = waitForWorkOrderQueueProducers().then(() => {
      barrierSettled = true;
    });
    await Promise.resolve();
    expect(barrierSettled).toBe(false);

    rejectSubmit(new ApiError("network", null, "offline"));
    await draining;
    await barrier;
    expect(barrierSettled).toBe(true);
  });

  it("allows only the sign-out-owned drain after admission closes", async () => {
    const s = memStore();
    await enqueueCreate(s, T, wo("queued"));
    beginSessionLocalPurge();
    let submitted = 0;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const draining = drainQueueForSessionPurge(s, T, async () => {
      submitted++;
      signalStarted();
      await gate;
    });
    await started;
    expect(hasActiveWorkOrderQueueProducers()).toBe(true);
    release();
    const result = await draining;

    expect(result?.sent).toBe(1);
    expect(submitted).toBe(1);
    expect(await pendingCount(s, T)).toBe(0);
    expect(hasActiveWorkOrderQueueProducers()).toBe(false);
  });

  it("refuses the sign-out-owned drain unless admission is closed and settled", async () => {
    const openStore = memStore();
    await enqueueCreate(openStore, T, wo("open"));
    expect(await drainQueueForSessionPurge(openStore, T, async () => undefined)).toBeNull();
    expect(await pendingCount(openStore, T)).toBe(1);

    const settlingStore = memStore();
    await enqueueCreate(settlingStore, T, wo("settling"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const producer = withWorkOrderQueueProducer(() => gate);
    beginSessionLocalPurge();

    expect(
      await drainQueueForSessionPurge(settlingStore, T, async () => undefined),
    ).toBeNull();
    expect(await pendingCount(settlingStore, T)).toBe(1);

    release();
    await producer;
  });

  it("exposes unresolved work-order producers to OTA busy probes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const producer = withWorkOrderQueueProducer(() => gate);

    expect(hasActiveWorkOrderQueueProducers()).toBe(true);
    release();
    await producer;
    expect(hasActiveWorkOrderQueueProducers()).toBe(false);
  });
});
