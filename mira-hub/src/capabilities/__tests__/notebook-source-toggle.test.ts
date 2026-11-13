import { describe, expect, it, vi } from "vitest";
import { persistedEnabled, toggleSourceEnabled } from "../notebook-source-toggle";

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
    refresh: vi.fn(async (): Promise<boolean | undefined> => {
      calls.push("refresh");
      return undefined;
    }),
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

  /**
   * Codex r2 on #5476 (F2): a PATCH that COMMITS but whose response is lost
   * used to leave the checkbox rolled back while the refreshed row said the
   * source was on — checkbox, label and chat scope disagreed until a reload.
   * The refresh is the authority: the checkbox takes the server's value.
   */
  it("enable committed but the response was lost: the checkbox ends ON, from the server", async () => {
    const { calls, deps } = harness(async () => {
      throw new Error("connection reset after commit");
    });
    deps.refresh.mockImplementationOnce(async () => {
      calls.push("refresh");
      return true;
    });
    expect(await toggleSourceEnabled(true, deps)).toBe(true);
    expect(calls).toEqual(["set:true", "patch:true", "set:false", "refresh", "set:true"]);
  });

  it("disable committed but the response was lost: the checkbox ends OFF, from the server", async () => {
    const { calls, deps } = harness(async () => {
      throw new Error("connection reset after commit");
    });
    deps.refresh.mockImplementationOnce(async () => {
      calls.push("refresh");
      return false;
    });
    expect(await toggleSourceEnabled(false, deps)).toBe(true);
    expect(calls).toEqual(["set:false", "patch:false", "set:true", "refresh", "set:false"]);
  });

  it("a 2xx the server did not actually keep: the checkbox follows the server, and it reports not persisted", async () => {
    const { calls, deps } = harness(async () => ({ ok: true }));
    deps.refresh.mockImplementationOnce(async () => {
      calls.push("refresh");
      return false;
    });
    expect(await toggleSourceEnabled(true, deps)).toBe(false);
    expect(calls).toEqual(["set:true", "patch:true", "refresh", "set:false"]);
  });

  it("a newer toggle on the same source is never overwritten by this one's undo or its refresh", async () => {
    const { calls, deps } = harness(async () => {
      throw new Error("offline");
    });
    deps.refresh.mockImplementationOnce(async () => {
      calls.push("refresh");
      return true;
    });
    await toggleSourceEnabled(true, { ...deps, isLatest: () => false });
    expect(calls).toEqual(["set:true", "patch:true", "refresh"]);
  });

  it("a refresh that cannot say (source gone from the list) leaves the checkbox alone", async () => {
    const { calls, deps } = harness(async () => ({ ok: true }));
    expect(await toggleSourceEnabled(true, deps)).toBe(true);
    expect(calls).toEqual(["set:true", "patch:true", "refresh"]);
  });
});

describe("persistedEnabled", () => {
  const list = [
    { docId: "a", enabledByDefault: true, matchState: "matched" },
    { docId: "b", enabledByDefault: false, matchState: "matched" },
    { docId: "c", enabledByDefault: true, matchState: "rejected" },
  ];
  it("reads the server's on/off for the source", () => {
    expect(persistedEnabled(list, "a")).toBe(true);
    expect(persistedEnabled(list, "b")).toBe(false);
  });
  it("a rejected source is never on", () => expect(persistedEnabled(list, "c")).toBe(false));
  it("cannot say for a source that is not listed", () => expect(persistedEnabled(list, "zz")).toBeUndefined());
});
