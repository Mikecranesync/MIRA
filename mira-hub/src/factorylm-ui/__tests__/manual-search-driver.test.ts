// Codex round 2 (#4195 F6/F8/F9) — the Hub's timer-scheduling driver around
// the shared, pure `manual-search-follow.ts` state machine. mira-hub has no
// jsdom/@testing-library/react (vitest.config.ts: environment "node"), so
// this driver is extracted framework-free specifically so it is directly
// unit-testable with vitest's fake timers — no React mount, no new test
// dependency. See the module's own header for why.
//
// Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/manual-search-driver
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualSearchDriver } from "../manual-search-driver";

const NB = "nb-1";
const RUNNING = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" };
const SETTLED = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" };
const RUNNING_G2 = { manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" };
const SETTLED_G2 = { manufacturer: "Rockwell", model: "1756-L71", running: false, message: "Found it (G2).", startedAt: "gen-2" };

/** A controllable, externally-resolvable (or rejectable) promise — for
 *  holding a `fetchStatus` read open past a reseed, so its continuation
 *  arrives AFTER the tracked state has already moved on to a newer
 *  generation. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createManualSearchDriver — hydration follows a running search to completion (F6)", () => {
  it("seeds from a running status, schedules a re-check, and renders the settled outcome once it resolves", async () => {
    const states: unknown[] = [];
    const fetchStatus = vi.fn().mockResolvedValue(SETTLED);
    const onRefreshSources = vi.fn();
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: (s) => states.push(s), onRefreshSources });

    driver.seed(NB, RUNNING);
    expect(driver.current()?.phase).toBe("following");
    expect(fetchStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchStatus).toHaveBeenCalledWith(NB);
    expect(driver.current()?.phase).toBe("resolved");
    expect(driver.current()?.status).toEqual(SETTLED);
    expect(onRefreshSources).toHaveBeenCalledTimes(1);
  });

  it("an idle Hub (no send, no navigation) still updates once the search settles", async () => {
    const onStateChange = vi.fn();
    const fetchStatus = vi.fn().mockResolvedValueOnce(RUNNING).mockResolvedValueOnce(SETTLED);
    const driver = createManualSearchDriver({ fetchStatus, onStateChange, onRefreshSources: vi.fn() });
    driver.seed(NB, RUNNING);
    await vi.advanceTimersByTimeAsync(4000); // still running
    expect(driver.current()?.phase).toBe("following");
    await vi.advanceTimersByTimeAsync(4000); // settles
    expect(driver.current()?.phase).toBe("resolved");
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ phase: "resolved" }));
  });
});

describe("createManualSearchDriver — a confirmation that starts a search is followed (F4)", () => {
  it("seeds from the optimistic post-confirm status the same way as hydration", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(SETTLED);
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });
    driver.seed(NB, { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true });
    expect(driver.current()?.phase).toBe("following");
    await vi.advanceTimersByTimeAsync(4000);
    expect(driver.current()?.phase).toBe("resolved");
  });

  it("seeding twice for the SAME notebook while already tracking is a no-op (does not restart the budget)", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(RUNNING);
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });
    driver.seed(NB, RUNNING);
    await vi.advanceTimersByTimeAsync(4000);
    const attemptsAfterOneTick = driver.current()?.attempts;
    driver.seed(NB, RUNNING); // e.g. a second confirm click, or a duplicate hydration call
    expect(driver.current()?.attempts).toBe(attemptsAfterOneTick);
  });
});

describe("createManualSearchDriver — the fixed attempt budget (F8) and inconclusive reads (F9)", () => {
  it("does not reset the budget on repeated running responses and stops scheduling once unresolved", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(RUNNING);
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });
    driver.seed(NB, RUNNING);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(4000);
    expect(driver.current()?.phase).toBe("unresolved");
    expect(fetchStatus).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchStatus).toHaveBeenCalledTimes(5); // no further scheduling
  });

  it("a rejected fetch counts as one inconclusive attempt and keeps following, recovering on a later settle", async () => {
    const fetchStatus = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(SETTLED);
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });
    driver.seed(NB, RUNNING);
    await vi.advanceTimersByTimeAsync(4000);
    expect(driver.current()?.phase).toBe("following");
    expect(driver.current()?.attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(driver.current()?.phase).toBe("resolved");
  });
});

describe("createManualSearchDriver — reset() stops the timer and drops state (notebook change)", () => {
  it("cancels a pending timer so the stale notebook's fetch never fires", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(RUNNING);
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });
    driver.seed(NB, RUNNING);
    driver.reset();
    expect(driver.current()).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchStatus).not.toHaveBeenCalled();
  });
});

describe("createManualSearchDriver — Codex round 3 F6: a later authoritative reseed is never permanently masked", () => {
  it("a settled candidate, then confirm/promotion for the SAME generation replaces the message (no second timer, same driver)", () => {
    const onStateChange = vi.fn();
    const onRefreshSources = vi.fn();
    const driver = createManualSearchDriver({ fetchStatus: vi.fn(), onStateChange, onRefreshSources });

    // Hydration: a candidate search already settled, not yet confirmed.
    driver.seed(NB, { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found a candidate.", startedAt: "gen-1" });
    expect(driver.current()?.phase).toBe("resolved");
    expect(driver.current()?.status.message).toBe("Found a candidate.");

    // Confirm promotes it — SAME generation (gen-1), a new message.
    driver.seed(NB, { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Confirmed — ready to answer from.", startedAt: "gen-1" });
    expect(driver.current()?.status.message).toBe("Confirmed — ready to answer from.");
    expect(onRefreshSources).toHaveBeenCalledTimes(1); // the promotion itself, not the hydration
  });

  it("a second, different search in the SAME notebook starts polling after the first one already resolved", async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: false, message: "Found it.", startedAt: "gen-2" });
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });

    // First search (gen-1) already resolved.
    driver.seed(NB, { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    expect(driver.current()?.phase).toBe("resolved");

    // A technician confirms a DIFFERENT identity in the SAME notebook — a new generation starts running.
    driver.seed(NB, { manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" });
    expect(driver.current()?.phase).toBe("following"); // F6: this used to stay stuck on gen-1's resolved state
    expect(driver.current()?.key).toContain("gen-2");

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchStatus).toHaveBeenCalledWith(NB); // the SECOND search is actually polled, not silently ignored
    expect(driver.current()?.phase).toBe("resolved");
  });

  it("a second, different search in the SAME notebook starts polling even after the first one EXHAUSTED its budget", async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });
    driver.seed(NB, { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(4000);
    expect(driver.current()?.phase).toBe("unresolved");

    fetchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: false, message: "Found it.", startedAt: "gen-2" });
    driver.seed(NB, { manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" });
    expect(driver.current()?.phase).toBe("following");
    await vi.advanceTimersByTimeAsync(4000);
    expect(driver.current()?.phase).toBe("resolved");
    expect(driver.current()?.status.message).toBe("Found it.");
  });
});

describe("createManualSearchDriver — Codex round 7 F21: an obsolete in-flight poll must never clobber a newer generation", () => {
  it("a G1 poll that is ALREADY IN FLIGHT when seed(G2) runs is discarded on arrival, and G2's own timer keeps polling", async () => {
    let call = 0;
    const g1Read = deferred<typeof RUNNING | null>();
    const fetchStatus = vi.fn(() => {
      call += 1;
      if (call === 1) return g1Read.promise; // G1's tick — held open.
      return Promise.resolve(SETTLED_G2); // G2's own, later tick.
    });
    const onStateChange = vi.fn();
    const driver = createManualSearchDriver({ fetchStatus, onStateChange, onRefreshSources: vi.fn() });

    driver.seed(NB, RUNNING);
    await vi.advanceTimersByTimeAsync(4000); // G1's tick fires; fetchStatus call #1 is now in flight.
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    // A confirmation/refresh seeds a SECOND, different generation for the
    // SAME notebook while G1's read is still outstanding.
    driver.seed(NB, RUNNING_G2);
    const stateAfterSeedG2 = driver.current();
    expect(stateAfterSeedG2?.phase).toBe("following");
    expect(stateAfterSeedG2?.key).toContain("gen-2");

    // G1's now-obsolete read resolves with a SETTLED g1 snapshot.
    g1Read.resolve({ ...RUNNING, running: false, startedAt: "gen-1" } as never);
    await vi.advanceTimersByTimeAsync(0); // flush the stale .then()

    // The notebook-id check alone would have let this through (same
    // notebook); only the epoch guard discards it. G2's tracked state must
    // be untouched — the SAME object, not a replacement built from G1's data.
    expect(driver.current()).toBe(stateAfterSeedG2);
    expect(driver.current()?.phase).toBe("following");
    expect(driver.current()?.key).toContain("gen-2");

    // And G2's OWN freshly scheduled timer is unaffected — it fires on
    // schedule and resolves normally.
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(driver.current()?.phase).toBe("resolved");
    expect(driver.current()?.status).toEqual(SETTLED_G2);
  });

  it("the same discard applies after reset() + a fresh seed() of the SAME notebook id", async () => {
    let call = 0;
    const g1Read = deferred<typeof RUNNING | null>();
    const fetchStatus = vi.fn(() => {
      call += 1;
      if (call === 1) return g1Read.promise;
      return Promise.resolve(SETTLED_G2);
    });
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });

    driver.seed(NB, RUNNING);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    // Notebook change away and back — `reset()` then a fresh `seed()` for
    // the EXACT SAME notebook id, so the `trackedNotebookId !== notebookId`
    // check by itself cannot distinguish the new generation from the old.
    driver.reset();
    driver.seed(NB, RUNNING_G2);
    const stateAfterReseed = driver.current();
    expect(stateAfterReseed?.key).toContain("gen-2");

    g1Read.resolve({ ...RUNNING, running: false, startedAt: "gen-1" } as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(driver.current()).toBe(stateAfterReseed);
    expect(driver.current()?.key).toContain("gen-2");

    await vi.advanceTimersByTimeAsync(4000);
    expect(driver.current()?.phase).toBe("resolved");
    expect(driver.current()?.status).toEqual(SETTLED_G2);
  });

  it("a G1 poll that REJECTS after seed(G2) is discarded the same way — no stale-error advance onto G2", async () => {
    let call = 0;
    const g1Read = deferred<never>();
    const fetchStatus = vi.fn(() => {
      call += 1;
      if (call === 1) return g1Read.promise;
      return Promise.resolve(SETTLED_G2);
    });
    const driver = createManualSearchDriver({ fetchStatus, onStateChange: vi.fn(), onRefreshSources: vi.fn() });

    driver.seed(NB, RUNNING);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    driver.seed(NB, RUNNING_G2);
    const stateAfterSeedG2 = driver.current();

    g1Read.reject(new Error("network"));
    await vi.advanceTimersByTimeAsync(0);

    expect(driver.current()).toBe(stateAfterSeedG2);
    expect(driver.current()?.phase).toBe("following");
    expect(driver.current()?.key).toContain("gen-2");

    await vi.advanceTimersByTimeAsync(4000);
    expect(driver.current()?.phase).toBe("resolved");
    expect(driver.current()?.status).toEqual(SETTLED_G2);
  });
});
