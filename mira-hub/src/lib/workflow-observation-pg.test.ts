import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ pool: {
  options: { max: 5 }, totalCount: 0, idleCount: 0, waitingCount: 0, connect: vi.fn(), query: vi.fn(),
} }));
vi.mock("./db", () => ({ default: fixture.pool }));
import { runWorkflow } from "./workflow";
import { observation } from "./__tests__/workflow-fixture";

const quiet = { info() {}, warn() {}, error() {} };
const run = (fn = vi.fn(async () => "accepted")) => runWorkflow({ workflowName: "manual_upload", observation: observation(), logger: quiet }, fn);
beforeEach(() => { vi.clearAllMocks(); fixture.pool.totalCount = 0; fixture.pool.idleCount = 0; fixture.pool.waitingCount = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("observation-only shared-pool bounds", () => {
  it("keeps the admission gate until a late connection is destroyed, without replaying work", async () => {
    vi.useFakeTimers();
    let connected!: (value: unknown) => void;
    fixture.pool.connect.mockImplementationOnce(() => new Promise((resolve) => { connected = resolve; }));
    const body = vi.fn(async () => "accepted"); const first = run(body);
    await vi.advanceTimersByTimeAsync(800); expect(await first).toBe("accepted");
    expect(await run(body)).toBe("accepted"); expect(fixture.pool.connect).toHaveBeenCalledTimes(1);
    const client = { release: vi.fn(), query: vi.fn() };
    connected(client); await vi.advanceTimersByTimeAsync(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(client.query).not.toHaveBeenCalled(); expect(body).toHaveBeenCalledTimes(2);
  });
  it("destroys a stuck borrowed connection when the total metadata deadline expires", async () => {
    vi.useFakeTimers();
    let rejected!: (error: Error) => void;
    const client = { query: vi.fn(() => new Promise((_, reject) => { rejected = reject; })),
      release: vi.fn(() => { rejected(new Error("declared connection destruction")); }) };
    fixture.pool.connect.mockResolvedValueOnce(client);
    const body = vi.fn(async () => "accepted"); const result = run(body);
    await vi.advanceTimersByTimeAsync(800);
    expect(await result).toBe("accepted"); expect(body).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it.each(["queued_domain", "last_slot"])("does not borrow a connection under %s pressure", async (pressure) => {
    if (pressure === "queued_domain") fixture.pool.waitingCount = 1;
    else fixture.pool.totalCount = 4;
    const body = vi.fn(async () => "accepted");
    expect(await run(body)).toBe("accepted"); expect(body).toHaveBeenCalledOnce();
    expect(fixture.pool.connect).not.toHaveBeenCalled(); expect(fixture.pool.query).not.toHaveBeenCalled();
  });
});
