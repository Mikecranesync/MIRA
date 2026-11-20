import { afterEach, describe, expect, it, vi } from "vitest";
import { recoveryView } from "@/capabilities/turn-recovery/contract";
import { draftAfterSendFailed, followTurnRecovery, readRecoveryPointer, recoveryMatchesTarget, recoveryPointerKey } from "./turn-recovery-client";

const pointer = { notebookId: "notebook", threadId: "thread", requestId: "request", question: "What fuse?" };
const row = { id: "turn", client_request_id: "request", thread_id: "thread", question: "What fuse?", client_request_state: "pending", stale: false,
  answer_status: "error", equipment_entity_id: "A", current_equipment_entity_id: "A", client_request_payload: {}, created_at: "now" };
afterEach(() => vi.useRealTimers());

describe("request recovery transport", () => {
  it("F2 follows a late terminal commit without submitting or another user action", async () => {
    vi.useFakeTimers();
    const pending = recoveryView(row), complete = recoveryView({ ...row, client_request_state: "complete" });
    const read = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(complete);
    const observe = vi.fn(), terminal = vi.fn();
    const stop = followTurnRecovery(pointer, { read, observe, terminal });
    await vi.advanceTimersByTimeAsync(0);
    expect(observe).toHaveBeenLastCalledWith(pending);
    expect(terminal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(terminal).toHaveBeenCalledExactlyOnceWith(complete);
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });

  it("aborts an outstanding read and discards its late response on navigation/signout", async () => {
    vi.useFakeTimers();
    let resolve!: (v: ReturnType<typeof recoveryView>) => void;
    const read = vi.fn((_p, signal: AbortSignal) => new Promise<ReturnType<typeof recoveryView>>(r => { resolve = r; expect(signal.aborted).toBe(false); }));
    const observe = vi.fn(), terminal = vi.fn();
    const stop = followTurnRecovery(pointer, { read, observe, terminal });
    stop();
    expect(read.mock.calls[0]![1].aborted).toBe(true);
    resolve(recoveryView({ ...row, client_request_state: "complete" }));
    await vi.advanceTimersByTimeAsync(10000);
    expect(observe).not.toHaveBeenCalled();
    expect(terminal).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps following when a terminal status precedes a successful history refresh", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(recoveryView({ ...row, client_request_state: "complete" }));
    const terminal = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    followTurnRecovery(pointer, { read, terminal, observe: vi.fn() });
    await vi.advanceTimersByTimeAsync(4000);
    expect(terminal).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rechecks a temporarily absent claim, and bounds unavailable-request following", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(null), unavailable = vi.fn();
    followTurnRecovery(pointer, { read, observe: vi.fn(), terminal: vi.fn(), unavailable, maxWaitMs: 4000 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it("shows an expired lease for explicit Retry and stops automatic following", async () => {
    vi.useFakeTimers();
    const value = recoveryView({ ...row, stale: true }), observe = vi.fn();
    const read = vi.fn().mockResolvedValue(value);
    followTurnRecovery(pointer, { read, observe, terminal: vi.fn() });
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(value);
  });
});

describe("draft and target isolation", () => {
  it.each(["unrelated draft", "What fuse?", ""])("F4 transcript Retry preserves draft %j on refusal/error", draft => {
    expect(draftAfterSendFailed("retry", draft, "What fuse?")).toBeNull();
  });
  it("restores a consumed composer draft and preserves newer typing", () => {
    expect(draftAfterSendFailed("composer", "", "What fuse?")).toBe("What fuse?");
    expect(draftAfterSendFailed("composer", "New question", "What fuse?")).toBeNull();
  });
  it("uses actor/notebook/thread-scoped pointers and handles unavailable storage", () => {
    expect(recoveryPointerKey("owner-A", "n", "t")).not.toBe(recoveryPointerKey("owner-B", "n", "t"));
    expect(readRecoveryPointer({ getItem: () => JSON.stringify(pointer) }, "key")).toEqual(pointer);
    expect(readRecoveryPointer({ getItem: () => { throw new Error("denied"); } }, "key")).toBeNull();
  });
  it("holds changed/unknown machines and components; allows an explicitly unbound original", () => {
    const value = recoveryView({ ...row, stale: true });
    expect(recoveryMatchesTarget(value, "A", null)).toBe(true);
    expect(recoveryMatchesTarget(value, "B", null)).toBe(false);
    expect(recoveryMatchesTarget(value, "A", undefined)).toBe(false);
    const unbound = recoveryView({ ...row, stale: true, equipment_entity_id: null, client_request_payload: { expectedEquipmentEntityId: null } });
    expect(recoveryMatchesTarget(unbound, null, null)).toBe(true);
    expect(recoveryMatchesTarget(unbound, "B", null)).toBe(false);
  });
});
