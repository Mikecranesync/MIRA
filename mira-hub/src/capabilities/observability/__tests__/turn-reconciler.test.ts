/**
 * The reconciler RUNNER. `reconcileStaleTurns` is proven against real Postgres
 * in turn-ingress.integration.test.ts; what is tested here is the thing that
 * makes it happen at all — because a sweeper with no caller sweeps nothing, and
 * that was the state this module shipped in first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/db", () => ({ default: { query: (...a: unknown[]) => query(...a) } }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (_t: string, fn: (c: unknown) => unknown) => fn({ query }),
}));

describe("the stale-turn reconciler runs on a schedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    query.mockReset();
    query.mockResolvedValue({ rowCount: 0, rows: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sweeps on the interval and stops when told to", async () => {
    const { startTurnReconciler } = await import("../turn-lifecycle");
    const stop = startTurnReconciler({ intervalMs: 1000, staleAfterMs: 60_000 });

    expect(query).not.toHaveBeenCalled(); // nothing on registration
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(query).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("does not overlap itself when a sweep runs longer than the interval", async () => {
    let release: (v: unknown) => void = () => {};
    query.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const { startTurnReconciler } = await import("../turn-lifecycle");
    const stop = startTurnReconciler({ intervalMs: 1000, staleAfterMs: 60_000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(1);
    // three more ticks while the first sweep is still in flight
    await vi.advanceTimersByTimeAsync(3000);
    expect(query).toHaveBeenCalledTimes(1);

    release({ rowCount: 0, rows: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(2);
    stop();
  });

  it("survives a failing sweep — a reconciler that throws would crash the server it measures", async () => {
    query.mockRejectedValue(new Error("connection terminated"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startTurnReconciler } = await import("../turn-lifecycle");
    const stop = startTurnReconciler({ intervalMs: 1000, staleAfterMs: 60_000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(err).toHaveBeenCalled();
    // and it keeps going rather than wedging after one failure
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(2);
    stop();
  });

  it("is off unless explicitly enabled", async () => {
    const { turnReconcilerEnabled } = await import("../config");
    const prev = process.env.MIRA_TURN_RECONCILER;
    delete process.env.MIRA_TURN_RECONCILER;
    expect(turnReconcilerEnabled()).toBe(false);
    process.env.MIRA_TURN_RECONCILER = "1";
    expect(turnReconcilerEnabled()).toBe(true);
    if (prev === undefined) delete process.env.MIRA_TURN_RECONCILER;
    else process.env.MIRA_TURN_RECONCILER = prev;
  });

  it("refuses a stale window short enough to sweep a live turn", async () => {
    const { turnReconcilerStaleMs } = await import("../config");
    const prev = process.env.MIRA_TURN_RECONCILER_STALE_MIN;
    process.env.MIRA_TURN_RECONCILER_STALE_MIN = "1"; // below the floor
    expect(turnReconcilerStaleMs()).toBe(15 * 60_000);
    process.env.MIRA_TURN_RECONCILER_STALE_MIN = "30";
    expect(turnReconcilerStaleMs()).toBe(30 * 60_000);
    if (prev === undefined) delete process.env.MIRA_TURN_RECONCILER_STALE_MIN;
    else process.env.MIRA_TURN_RECONCILER_STALE_MIN = prev;
  });
});
