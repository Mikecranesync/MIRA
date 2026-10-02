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
