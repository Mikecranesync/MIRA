// Record-fix idempotency keys that survive an app reload (#4065).
// The server dedupes a fix on clientRequestId (migrations 097/098) and replays
// the stored row with 200 on a retry. The phone must therefore keep the SAME
// id for the same fix across a reload, or a lost response plus a reload files a
// second append-only row. In-memory KV store; no Capacitor, no network.
import { describe, it, expect } from "vitest";
import {
  createPersistentFixRequestIds,
  FIX_REQUEST_KEY,
  FIX_REQUEST_CAP,
} from "../fix-request-ids";
import { purgeAllQueues, type KvStore } from "../../lib/offline-queue";

function memStore(): KvStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
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

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

const NB = "11111111-2222-4333-8444-555555555555";
const TURN = "0b7c1a2e-3f4d-4a5b-8c6d-7e8f90a1b2c3";

describe("record-fix request ids survive an app reload (#4065)", () => {
  it("a reload keeps the id of a fix whose response was lost, so the retry replays one row", async () => {
    const store = memStore();
    const before = createPersistentFixRequestIds(store, counterIds("a"));
    const first = await before.idFor(NB, TURN, "replaced the fuse");
    // The save reached the server; the response was lost; the app reloads and
    // builds a brand-new controller over the same device storage.
    const after = createPersistentFixRequestIds(store, counterIds("b"));
    expect(await after.idFor(NB, TURN, "replaced the fuse")).toBe(first);
  });

  it("the id is on disk before the caller sends the request (write-ahead)", async () => {
    const store = memStore();
    const ids = createPersistentFixRequestIds(store, counterIds());
    const id = await ids.idFor(NB, TURN, "replaced the fuse");
    expect(store.data[FIX_REQUEST_KEY]).toContain(id);
  });

  it("settling a saved fix forgets its id and removes it from storage", async () => {
    const store = memStore();
    const ids = createPersistentFixRequestIds(store, counterIds());
    const first = await ids.idFor(NB, TURN, "replaced the fuse");
    await ids.settle(NB, TURN, "replaced the fuse");
    expect(store.data[FIX_REQUEST_KEY]).not.toContain(first);
    expect(await ids.idFor(NB, TURN, "replaced the fuse")).not.toBe(first);
  });

  it("a different fix, notebook or answer gets its own id", async () => {
    const ids = createPersistentFixRequestIds(memStore(), counterIds());
    const a = await ids.idFor(NB, TURN, "replaced the fuse");
    expect(await ids.idFor(NB, TURN, "reset the overload")).not.toBe(a);
    expect(await ids.idFor(NB, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "replaced the fuse")).not.toBe(a);
    expect(await ids.idFor("99999999-9999-4999-8999-999999999999", TURN, "replaced the fuse")).not.toBe(a);
  });

  it("concurrent calls for the same fix share one id and one stored entry", async () => {
    const store = memStore();
    const ids = createPersistentFixRequestIds(store, counterIds());
    const [x, y] = await Promise.all([ids.idFor(NB, TURN, "f"), ids.idFor(NB, TURN, "f")]);
    expect(x).toBe(y);
    expect(JSON.parse(store.data[FIX_REQUEST_KEY]!)).toEqual({ [`${NB}\u0000${TURN}\u0000f`]: x });
  });

  it("a corrupt or unreadable store degrades to a fresh id and never throws", async () => {
    const corrupt = memStore();
    corrupt.data[FIX_REQUEST_KEY] = "{not json";
    const ids = createPersistentFixRequestIds(corrupt, counterIds("c"));
    expect(await ids.idFor(NB, TURN, "f")).toBe("c-1");

    const broken: KvStore = {
      get: async () => {
        throw new Error("preferences unavailable");
      },
      set: async () => {
        throw new Error("preferences unavailable");
      },
      remove: async () => {},
      keys: async () => [],
    };
    const ids2 = createPersistentFixRequestIds(broken, counterIds("d"));
    expect(await ids2.idFor(NB, TURN, "f")).toBe("d-1");
    await expect(ids2.settle(NB, TURN, "f")).resolves.toBeUndefined();
  });

  it("bounds the stored entries so abandoned fixes cannot grow the device store", async () => {
    const store = memStore();
    const ids = createPersistentFixRequestIds(store, counterIds());
    for (let i = 0; i < FIX_REQUEST_CAP + 10; i += 1) {
      await ids.idFor(NB, TURN, `fix ${i}`);
    }
    expect(Object.keys(JSON.parse(store.data[FIX_REQUEST_KEY]!))).toHaveLength(FIX_REQUEST_CAP);
  });

  it("sign-out purge removes the stored ids (fail-closed, like every other local queue)", async () => {
    const store = memStore();
    const ids = createPersistentFixRequestIds(store, counterIds());
    await ids.idFor(NB, TURN, "f");
    expect(FIX_REQUEST_KEY.startsWith("flm.unified.")).toBe(true);
    await purgeAllQueues(store);
    expect(store.data[FIX_REQUEST_KEY]).toBeUndefined();
  });
});
