/**
 * Mobile notebook-delete flow semantics + the cross-app contract.
 *
 * mira-mobile and mira-hub are separate bundles, so src/lib/notebook-delete.ts
 * is duplicated rather than imported. Duplication silently drifts, so this
 * asserts the mobile copy behaves identically to the documented Hub contract —
 * if someone changes one side only, this fails.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createSubmitGuard,
  deleteFailureMessage,
  removeNotebookFromList,
} from "../notebook-delete";

describe("deleteFailureMessage (mobile copy)", () => {
  it("matches the Hub contract for every mapped status", () => {
    expect(deleteFailureMessage(404)).toBe("That notebook no longer exists.");
    expect(deleteFailureMessage(401)).toBe("You are not signed in, or this notebook isn't yours.");
    expect(deleteFailureMessage(403)).toBe("You are not signed in, or this notebook isn't yours.");
    expect(deleteFailureMessage(409)).toBe(
      "This notebook is still referenced by another record.",
    );
    expect(deleteFailureMessage(500)).toBe("Delete failed. Check your connection and try again.");
  });

  it("treats an unknown/offline status as retryable rather than fatal", () => {
    // A phone loses signal mid-tap constantly; that must not read as "gone".
    expect(deleteFailureMessage(0)).toMatch(/try again/i);
    expect(deleteFailureMessage(0)).not.toMatch(/no longer exists/i);
  });

  it("never leaks a raw status code into technician-facing copy", () => {
    for (const s of [400, 404, 409, 500, 503]) {
      expect(deleteFailureMessage(s)).not.toMatch(/\d{3}/);
    }
  });
});

describe("removeNotebookFromList (mobile copy)", () => {
  it("drops the deleted notebook and keeps the rest", () => {
    const list = [{ id: "keep-1" }, { id: "gone" }, { id: "keep-2" }];
    expect(removeNotebookFromList(list, "gone")).toEqual([{ id: "keep-1" }, { id: "keep-2" }]);
  });

  it("returns a new array and does not mutate the input", () => {
    const list = [{ id: "a" }, { id: "b" }];
    const out = removeNotebookFromList(list, "a");
    expect(out).not.toBe(list);
    expect(list).toHaveLength(2);
  });

  it("removes only the requested notebook even with similar ids", () => {
    const list = [{ id: "abc" }, { id: "abcd" }, { id: "ab" }];
    expect(removeNotebookFromList(list, "abc")).toEqual([{ id: "abcd" }, { id: "ab" }]);
  });
});

describe("createSubmitGuard (mobile copy) — double-tap", () => {
  it("swallows the second tap while the first delete is in flight", async () => {
    const guard = createSubmitGuard();
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "deleted";
    });
    const [first, second] = await Promise.all([guard.run(fn), guard.run(fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(first).toBe("deleted");
    expect(second).toBeUndefined();
  });

  it("reports busy while in flight and idle afterwards", async () => {
    const guard = createSubmitGuard();
    expect(guard.busy).toBe(false);
    const p = guard.run(async () => {
      expect(guard.busy).toBe(true);
      return 1;
    });
    await p;
    expect(guard.busy).toBe(false);
  });

  it("stays retryable after a network failure", async () => {
    const guard = createSubmitGuard();
    const fn = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(guard.run(fn)).rejects.toThrow("offline");
    await expect(guard.run(fn)).rejects.toThrow("offline");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
