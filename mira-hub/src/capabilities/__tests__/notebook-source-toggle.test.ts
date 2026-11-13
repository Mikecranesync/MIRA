import { describe, expect, it, vi } from "vitest";
import { toggleSourceEnabled } from "../notebook-source-toggle";

/**
 * Codex r1 on #5476 (F2): the Sources sheet flipped the checkbox and sent the
 * PATCH, but never re-read the server's projection, so the label beside the
 * checkbox ("Not searchable: not turned on") stayed stale until a reload —
 * and a refused PATCH still looked like a success.
 */
function harness(patch: () => Promise<{ ok: boolean }>) {
  const calls: string[] = [];
  const deps = {
    setEnabled: vi.fn((v: boolean) => void calls.push(`set:${v}`)),
    patch: vi.fn(async (v: boolean) => {
      calls.push(`patch:${v}`);
      return patch();
    }),
    refresh: vi.fn(async () => void calls.push("refresh")),
  };
  return { calls, deps };
}

describe("toggleSourceEnabled", () => {
  it("enable: ticks optimistically, persists, then re-reads the server projection", async () => {
    const { calls, deps } = harness(async () => ({ ok: true }));
    expect(await toggleSourceEnabled(true, deps)).toBe(true);
    expect(calls).toEqual(["set:true", "patch:true", "refresh"]);
  });

  it("disable: same order, so the off warning appears without a reload", async () => {
    const { calls, deps } = harness(async () => ({ ok: true }));
    expect(await toggleSourceEnabled(false, deps)).toBe(true);
    expect(calls).toEqual(["set:false", "patch:false", "refresh"]);
  });

  it("a refused PATCH (non-2xx) puts the checkbox back and re-reads the server state", async () => {
    const { calls, deps } = harness(async () => ({ ok: false }));
    expect(await toggleSourceEnabled(true, deps)).toBe(false);
    expect(calls).toEqual(["set:true", "patch:true", "set:false", "refresh"]);
  });

  it("a network failure puts the checkbox back and does not throw", async () => {
    const { calls, deps } = harness(async () => {
      throw new Error("offline");
    });
    expect(await toggleSourceEnabled(false, deps)).toBe(false);
    expect(calls).toEqual(["set:false", "patch:false", "set:true", "refresh"]);
  });

  it("a failed refresh never undoes a persisted toggle", async () => {
    const { deps } = harness(async () => ({ ok: true }));
    deps.refresh.mockRejectedValueOnce(new Error("offline"));
    expect(await toggleSourceEnabled(true, deps)).toBe(true);
    expect(deps.setEnabled).toHaveBeenCalledTimes(1);
  });
});
