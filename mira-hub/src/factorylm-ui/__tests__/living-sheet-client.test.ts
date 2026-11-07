/**
 * Red-first unit tests for the Living Work Sheet phone client (TASK-S3).
 * Pure queue/badge/parser logic only — no fetch, no DOM (vitest environment
 * is "node", no jsdom). An injected in-memory KvStore stands in for
 * localStorage so these tests never touch the real browser storage API.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attemptClientEventId,
  attemptRequest,
  chosenRevisionOf,
  clearedFieldValue,
  countAllSheetQueueEntries,
  drainSheetQueue,
  dropHeadOfSheetQueue,
  enqueueSheetEvent,
  loadSheetQueue,
  lowRiskProposalIds,
  parseSheetReceipts,
  purgeSheetQueues,
  removeFromSheetQueue,
  saveBadge,
  sheetQueueKey,
  signOutPurgeFailedPrompt,
  clearSheetDataForSignOut,
  signOutUnsyncedPrompt,
  startJobErrorMessage,
  stepNeedsConfirm,
  stepRequiringConfirmFor,
  type JobSheetRevision,
  type JobSheetSummary,
  type KvStore,
  type QueuedSheetEvent,
  type SheetEventPost,
  type SheetSubmitOutcome,
  workOrderStatusText,
  workOrderRetryable,
  photoAttemptBelongsTo,
  stepConfirmBelongsTo,
  isDefinitiveRejection,
  loadRejectedSheetEvents,
  dismissRejectedSheetEvent,
  recordRejectedSheetEvent,
  rejectedSheetKey,
  rejectedNoteText,
  recoveredFieldValue,
  localStorageStore,
} from "../living-sheet-client";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";
import type { SheetStepView } from "@/capabilities/living-sheet/reduce";
import type { NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";

function memoryStore(): KvStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    set: async (k, v) => {
      m.set(k, v);
      return true;
    },
    remove: async (k) => {
      m.delete(k);
      return true;
    },
    keys: async () => Array.from(m.keys()),
  };
}

/** F06: a store whose `set` always fails — the browser's localStorage
 *  throwing (private window, quota) is exactly this shape, just swallowed
 *  one layer down inside the real `localStorageStore` adapter. */
function failingStore(): KvStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    set: async () => false,
    remove: async (k) => {
      m.delete(k);
      return true;
    },
    keys: async () => Array.from(m.keys()),
  };
}

/** R2-20: a store whose `get`/`keys` work against a pre-seeded backing map
 *  but whose `set` ALWAYS fails — simulates the server having already
 *  decided an item (ok or rejected) while this phone's storage can no
 *  longer durably remove it from the queue. */
function stuckRemovalStore(seed: Record<string, QueuedSheetEvent[]>): KvStore {
  const m = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    set: async () => false,
    remove: async (k) => {
      m.delete(k);
      return true;
    },
    keys: async () => Array.from(m.keys()),
  };
}

function stepEvent(clientEventId: string, baseSeq = 1): SheetEventPost {
  return {
    clientEventId,
    baseSeq,
    kind: "step_marked",
    payload: { stepId: "s-1", done: true, note: null },
    occurredAt: "2026-11-03T00:00:00.000Z",
    workOrderId: null,
  };
}

describe("sheetQueueKey", () => {
  it("is scoped by tenant/user AND jobId", () => {
    expect(sheetQueueKey("tenant-1", "job-1")).toBe("flm.sheetq.v1.tenant-1.job-1");
    expect(sheetQueueKey("tenant-1", "job-2")).not.toBe(sheetQueueKey("tenant-1", "job-1"));
  });
});

describe("enqueueSheetEvent / loadSheetQueue", () => {
  it("is FIFO and dedupes on clientEventId", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("b"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a")); // re-queue, no-op
    const q = await loadSheetQueue(store, "t1", "j1");
    expect(q.map((i) => i.event.clientEventId)).toEqual(["a", "b"]);
  });

  it("tolerates corrupt stored JSON (returns empty, never throws)", async () => {
    const store = memoryStore();
    await store.set(sheetQueueKey("t1", "j1"), "{not json");
    await expect(loadSheetQueue(store, "t1", "j1")).resolves.toEqual([]);
  });
});

describe("enqueueSheetEvent — storage write failure (F06)", () => {
  it("reports saved:false when the underlying store write fails, instead of looking identical to a successful queue", async () => {
    const store = failingStore();
    const result = await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    expect(result.saved).toBe(false);
    // The caller (LivingSheet.tsx) must be told the write never persisted —
    // a reload would find the queue empty, which is exactly the lost-entry
    // bug this finding describes.
    expect(await loadSheetQueue(store, "t1", "j1")).toEqual([]);
  });

  it("reports saved:true on a normal (working) store", async () => {
    const store = memoryStore();
    const result = await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    expect(result.saved).toBe(true);
    expect(result.queue.map((i) => i.event.clientEventId)).toEqual(["a"]);
  });
});

describe("saveBadge — storage failure never reads as Saved (F06)", () => {
  it("storageFailed outranks the queued/saved states (but not conflict or saving)", () => {
    expect(saveBadge({ saving: false, queued: 0, conflict: false, storageFailed: true })).toBe(
      "Not saved on this phone — keep this screen open",
    );
    expect(saveBadge({ saving: false, queued: 3, conflict: false, storageFailed: true })).toBe(
      "Not saved on this phone — keep this screen open",
    );
    expect(saveBadge({ saving: true, queued: 0, conflict: false, storageFailed: true })).toBe("Saving…");
    expect(saveBadge({ saving: false, queued: 0, conflict: true, storageFailed: true })).toBe("Conflict – tap to sort out");
  });
});

describe("enqueueSheetEvent — concurrent calls must not clobber each other", () => {
  it("three concurrent enqueues on the same job all land (no lost write)", async () => {
    const store = memoryStore();
    await Promise.all([
      enqueueSheetEvent(store, "t1", "j1", stepEvent("a")),
      enqueueSheetEvent(store, "t1", "j1", stepEvent("b")),
      enqueueSheetEvent(store, "t1", "j1", stepEvent("c")),
    ]);
    const q = await loadSheetQueue(store, "t1", "j1");
    expect(q.map((i) => i.event.clientEventId).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("drainSheetQueue", () => {
  it("an enqueue that happens WHILE a submit is in flight is not lost by the drain's save (it re-reads before saving, so it goes on to drain the late item too, instead of overwriting it with a stale empty-minus-one snapshot)", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    const seen: string[] = [];
    const submit = vi.fn(async (ev: SheetEventPost): Promise<SheetSubmitOutcome> => {
      seen.push(ev.clientEventId);
      if (ev.clientEventId === "a") {
        // Something else enqueues DURING this in-flight submit.
        await enqueueSheetEvent(store, "t1", "j1", stepEvent("late"));
      }
      return { status: "ok" };
    });
    const result = await drainSheetQueue(store, "t1", "j1", submit);
    // Nothing lost: both "a" and the concurrently-enqueued "late" were seen
    // and drained — the OLD code's stale-snapshot save would have reset the
    // queue to [] after "a" alone, silently dropping "late" forever.
    expect(seen).toEqual(["a", "late"]);
    expect(result).toMatchObject({ sent: 2, remaining: 0 });
    expect(await loadSheetQueue(store, "t1", "j1")).toEqual([]);
  });
});

describe("drainSheetQueue — existing behavior", () => {
  it("drains in FIFO order, success removes and continues", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("b"));
    const seen: string[] = [];
    const submit = vi.fn(async (ev: SheetEventPost): Promise<SheetSubmitOutcome> => {
      seen.push(ev.clientEventId);
      return { status: "ok" };
    });
    const result = await drainSheetQueue(store, "t1", "j1", submit);
    expect(seen).toEqual(["a", "b"]);
    expect(result).toEqual({
      sent: 2,
      droppedRejected: 0,
      rejected: [],
      remaining: 0,
      conflict: false,
      networkStopped: false,
      drainStuck: false,
    });
    expect(await loadSheetQueue(store, "t1", "j1")).toEqual([]);
  });

  it("a conflict halts the drain and keeps the conflicting item plus everything behind it", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("b"));
    const submit = vi.fn(async (): Promise<SheetSubmitOutcome> => ({ status: "conflict" }));
    const result = await drainSheetQueue(store, "t1", "j1", submit);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result?.conflict).toBe(true);
    expect(result?.remaining).toBe(2);
  });

  it("a definitive rejection drops that item and continues to the next", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("b"));
    const submit = vi.fn(async (ev: SheetEventPost): Promise<SheetSubmitOutcome> =>
      ev.clientEventId === "a" ? { status: "rejected", message: "bad payload" } : { status: "ok" },
    );
    const result = await drainSheetQueue(store, "t1", "j1", submit);
    expect(result).toEqual({
      sent: 1,
      droppedRejected: 1,
      rejected: [{ event: stepEvent("a"), message: "bad payload" }],
      remaining: 0,
      conflict: false,
      networkStopped: false,
      drainStuck: false,
    });
  });

  it("a thrown network error stops the drain and keeps the item queued", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    const submit = vi.fn(async (): Promise<SheetSubmitOutcome> => {
      throw new Error("fetch failed");
    });
    const result = await drainSheetQueue(store, "t1", "j1", submit);
    expect(result?.networkStopped).toBe(true);
    expect(result?.remaining).toBe(1);
  });
});

describe("removeFromSheetQueue (R2-03) — removal is by id, never by position", () => {
  it("removes the named entry regardless of where it sits in the queue, leaving the rest intact", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("b"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("c"));
    const ok = await removeFromSheetQueue(store, "t1", "j1", "b");
    expect(ok).toBe(true);
    expect((await loadSheetQueue(store, "t1", "j1")).map((i) => i.event.clientEventId)).toEqual(["a", "c"]);
  });

  it("removing an id that isn't present is a no-op that still reports whatever the save returned", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    const ok = await removeFromSheetQueue(store, "t1", "j1", "nope");
    expect(ok).toBe(true);
    expect((await loadSheetQueue(store, "t1", "j1")).map((i) => i.event.clientEventId)).toEqual(["a"]);
  });

  it("reports false when the underlying store write fails (R2-20's building block)", async () => {
    const store = failingStore();
    const ok = await removeFromSheetQueue(store, "t1", "j1", "a");
    expect(ok).toBe(false);
  });
});

describe("drainSheetQueue — R2-20: a stuck removal stops the drain instead of looping", () => {
  it("an 'ok' outcome whose removal can't persist sets drainStuck and stops — submit is called exactly once, never retried in a loop", async () => {
    const queued: QueuedSheetEvent = { event: stepEvent("a"), queuedAt: "2026-11-03T00:00:00.000Z", attempts: 0 };
    const store = stuckRemovalStore({ [sheetQueueKey("t1", "j1")]: [queued] });
    const submit = vi.fn(async (): Promise<SheetSubmitOutcome> => ({ status: "ok" }));
    const result = await drainSheetQueue(store, "t1", "j1", submit);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result?.sent).toBe(1);
    expect(result?.drainStuck).toBe(true);
  });

  it("a definitive rejection whose removal can't persist ALSO sets drainStuck and stops — never resubmits the already-decided item", async () => {
    const queued: QueuedSheetEvent = { event: stepEvent("a"), queuedAt: "2026-11-03T00:00:00.000Z", attempts: 0 };
    const store = stuckRemovalStore({ [sheetQueueKey("t1", "j1")]: [queued] });
    const submit = vi.fn(async (): Promise<SheetSubmitOutcome> => ({ status: "rejected", message: "bad payload" }));
    const result = await drainSheetQueue(store, "t1", "j1", submit);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result?.droppedRejected).toBe(1);
    expect(result?.rejected).toEqual([{ event: queued.event, message: "bad payload" }]);
    expect(result?.drainStuck).toBe(true);
  });

  it("a healthy store never sets drainStuck", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    const result = await drainSheetQueue(store, "t1", "j1", async () => ({ status: "ok" }));
    expect(result?.drainStuck).toBe(false);
  });
});

describe("saveBadge — R2-20: drainStuck outranks storageFailed/queued but not conflict/saving", () => {
  it("priority is conflict > saving > drainStuck > storageFailed > queued > saved", () => {
    expect(saveBadge({ saving: false, queued: 0, conflict: false, drainStuck: true })).toBe(
      "Can't update this phone's storage — reload the page",
    );
    expect(saveBadge({ saving: false, queued: 5, conflict: false, drainStuck: true, storageFailed: true })).toBe(
      "Can't update this phone's storage — reload the page",
    );
    expect(saveBadge({ saving: true, queued: 0, conflict: false, drainStuck: true })).toBe("Saving…");
    expect(saveBadge({ saving: false, queued: 0, conflict: true, drainStuck: true })).toBe("Conflict – tap to sort out");
    expect(saveBadge({ saving: false, queued: 0, conflict: false, drainStuck: false })).toBe("Saved");
  });
});

describe("countAllSheetQueueEntries (R2-32)", () => {
  it("is 0 with nothing queued anywhere", async () => {
    const store = memoryStore();
    expect(await countAllSheetQueueEntries(store)).toBe(0);
  });

  it("counts one job's queue", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("b"));
    expect(await countAllSheetQueueEntries(store)).toBe(2);
  });

  it("sums across multiple jobs AND multiple tenants/users", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j2", stepEvent("b"));
    await enqueueSheetEvent(store, "t2", "j1", stepEvent("c"));
    expect(await countAllSheetQueueEntries(store)).toBe(3);
  });

  it("ignores unrelated keys", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await store.set("flm.unrelated.key", JSON.stringify([1, 2, 3]));
    expect(await countAllSheetQueueEntries(store)).toBe(1);
  });

  it("tolerates a corrupt queue entry — counts it as 0, never throws", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await store.set(sheetQueueKey("t1", "j2"), "{not json");
    await expect(countAllSheetQueueEntries(store)).resolves.toBe(1);
  });
});

describe("signOutUnsyncedPrompt (R2-32)", () => {
  it("is null when there is nothing unsynced — no prompt at all", () => {
    expect(signOutUnsyncedPrompt(0)).toBeNull();
  });
  it("is singular for exactly one change", () => {
    expect(signOutUnsyncedPrompt(1)).toBe("1 change not yet saved on this phone. Sign out anyway and lose them?");
  });
  it("is plural for more than one, including a negative count treated as none", () => {
    expect(signOutUnsyncedPrompt(2)).toBe("2 changes not yet saved on this phone. Sign out anyway and lose them?");
    expect(signOutUnsyncedPrompt(-1)).toBeNull();
  });
});

describe("clearedFieldValue (R2-02)", () => {
  it("the reviewer's example: a successful save of the exact submitted text clears the field", () => {
    expect(clearedFieldValue(true, "torque done", "torque done")).toBe("");
  });
  it("a successful save does NOT clear the field if the technician kept typing while it was in flight", () => {
    expect(clearedFieldValue(true, "torque done", "torque done, recheck tomorrow")).toBe("torque done, recheck tomorrow");
  });
  it("a failed save never clears the field, even if nothing changed", () => {
    expect(clearedFieldValue(false, "torque done", "torque done")).toBe("torque done");
  });
  it("a failed save with concurrent edits still keeps exactly what's there", () => {
    expect(clearedFieldValue(false, "torque done", "something else entirely")).toBe("something else entirely");
  });
  it("the field was already cleared by something else before the save resolved — stays empty either way", () => {
    expect(clearedFieldValue(true, "torque done", "")).toBe("");
    expect(clearedFieldValue(false, "torque done", "")).toBe("");
  });
});

describe("attemptRequest (R2-06/07) — a retry replays the WHOLE frozen request, not just an id", () => {
  it("mints a fresh request when there is no pending attempt", () => {
    const build = vi.fn(() => ({ clientEventId: "fresh", occurredAt: "now", baseSeq: 1 }));
    const req = attemptRequest(null, build);
    expect(req).toEqual({ clientEventId: "fresh", occurredAt: "now", baseSeq: 1 });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("reuses the exact SAME pending request object on retry — build is never called, so no field (occurredAt, baseSeq, file) can drift", () => {
    const pending = { clientEventId: "pending", occurredAt: "2026-11-01T00:00:00.000Z", baseSeq: 7 };
    const build = vi.fn(() => ({ clientEventId: "should-not-be-used", occurredAt: "later", baseSeq: 99 }));
    const req = attemptRequest(pending, build);
    expect(req).toBe(pending);
    expect(build).not.toHaveBeenCalled();
  });
});

describe("dropHeadOfSheetQueue", () => {
  it("removes and returns only the head item, leaving the rest in order", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("b"));
    const dropped = await dropHeadOfSheetQueue(store, "t1", "j1");
    expect(dropped?.event.clientEventId).toBe("a");
    const remaining = await loadSheetQueue(store, "t1", "j1");
    expect(remaining.map((i) => i.event.clientEventId)).toEqual(["b"]);
  });

  it("returns null on an empty queue", async () => {
    const store = memoryStore();
    expect(await dropHeadOfSheetQueue(store, "t1", "j1")).toBeNull();
  });
});

describe("purgeSheetQueues", () => {
  it("removes every sheet queue key and nothing else", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "j1", stepEvent("a"));
    await enqueueSheetEvent(store, "t1", "j2", stepEvent("b"));
    await store.set("flm.unrelated.key", "keep me");
    expect(await purgeSheetQueues(store)).toEqual({ purged: 2, remaining: 0 });
    expect(await loadSheetQueue(store, "t1", "j1")).toEqual([]);
    expect(await store.get("flm.unrelated.key")).toBe("keep me");
  });
});

describe("saveBadge", () => {
  it("priority is conflict > saving > queued > saved", () => {
    expect(saveBadge({ saving: false, queued: 0, conflict: true })).toBe("Conflict – tap to sort out");
    expect(saveBadge({ saving: true, queued: 3, conflict: false })).toBe("Saving…");
    expect(saveBadge({ saving: false, queued: 2, conflict: false })).toBe("Offline – 2 waiting");
    expect(saveBadge({ saving: false, queued: 0, conflict: false })).toBe("Saved");
  });
});

describe("lowRiskProposalIds", () => {
  it("accepts only low-risk proposals, never needs_tap", () => {
    const proposals: SheetProposal[] = [
      { proposalId: "p1", risk: "low", reason: "r", quote: "q", event: { kind: "note_added", payload: { noteId: "n1", text: "x", noteKind: "note" } } },
      { proposalId: "p2", risk: "needs_tap", reason: "r", quote: "q", event: { kind: "part_logged", payload: { partEntryId: "pe1", item: "x", action: "used", qty: null } } },
    ];
    expect(lowRiskProposalIds(proposals)).toEqual(["p1"]);
  });

  it("F03: excludes a low-risk 'step done' proposal when that step needs the torque/loctite/measurement confirm — it still needs its own tap", () => {
    const steps: SheetStepView[] = [
      { id: "s-torque", text: "Torque bearing caps", checkoff: "torque", torqueRef: "t1", source: null, done: false, doneBy: null, doneAt: null, note: null, history: [] },
      { id: "s-plain", text: "Clean the area", checkoff: "none", torqueRef: null, source: null, done: false, doneBy: null, doneAt: null, note: null, history: [] },
    ];
    const proposals: SheetProposal[] = [
      { proposalId: "p-torque", risk: "low", reason: "r", quote: "q", event: { kind: "step_marked", payload: { stepId: "s-torque", done: true, note: null } } },
      { proposalId: "p-plain", risk: "low", reason: "r", quote: "q", event: { kind: "step_marked", payload: { stepId: "s-plain", done: true, note: null } } },
    ];
    expect(lowRiskProposalIds(proposals, steps)).toEqual(["p-plain"]);
  });
});

describe("stepNeedsConfirm / stepRequiringConfirmFor (F03)", () => {
  function step(over: Partial<SheetStepView> = {}): SheetStepView {
    return {
      id: "s-1", text: "Torque bearing caps", checkoff: "torque", torqueRef: "t1", source: null,
      done: false, doneBy: null, doneAt: null, note: null, history: [],
      ...over,
    };
  }

  it("a 'step N done' event/proposal referring to a torque step needs confirm", () => {
    const steps = [step()];
    const event = { kind: "step_marked" as const, payload: { stepId: "s-1", done: true, note: null } };
    expect(stepRequiringConfirmFor(event, steps)).toEqual(steps[0]);
  });

  it("marking a step NOT done never needs confirm", () => {
    const steps = [step()];
    const event = { kind: "step_marked" as const, payload: { stepId: "s-1", done: false, note: null } };
    expect(stepRequiringConfirmFor(event, steps)).toBeNull();
  });

  it("a plain (checkoff:none) step never needs confirm", () => {
    const steps = [step({ checkoff: "none", torqueRef: null })];
    const event = { kind: "step_marked" as const, payload: { stepId: "s-1", done: true, note: null } };
    expect(stepRequiringConfirmFor(event, steps)).toBeNull();
  });

  it("non step_marked events never need confirm", () => {
    const steps = [step()];
    const event = { kind: "note_added" as const, payload: { noteId: "n1", text: "x", noteKind: "note" as const } };
    expect(stepRequiringConfirmFor(event, steps)).toBeNull();
  });

  it("a step already done never needs confirm again", () => {
    expect(stepNeedsConfirm(step({ done: true }))).toBe(false);
  });
});

describe("stepNeedsConfirm (R2-16) — PROPERTY: true iff the step carries a torque reference, regardless of its checkoff kind (and false once done)", () => {
  function step(over: Partial<SheetStepView> = {}): SheetStepView {
    return {
      id: "s-1", text: "x", checkoff: "none", torqueRef: null, source: null,
      done: false, doneBy: null, doneAt: null, note: null, history: [],
      ...over,
    };
  }

  it.each<[string, Partial<SheetStepView>, boolean]>([
    ["reviewer's example: checkoff:none with a torqueRef set still needs confirm", { checkoff: "none", torqueRef: "t1" }, true],
    ["checkoff:photo with a torqueRef set still needs confirm", { checkoff: "photo", torqueRef: "t1" }, true],
    ["checkoff:torque preserved even with no torqueRef set", { checkoff: "torque", torqueRef: null }, true],
    ["checkoff:loctite preserved even with no torqueRef set", { checkoff: "loctite", torqueRef: null }, true],
    ["checkoff:measurement preserved even with no torqueRef set", { checkoff: "measurement", torqueRef: null }, true],
    ["checkoff:none with torqueRef null never needs confirm", { checkoff: "none", torqueRef: null }, false],
    ["checkoff:none with torqueRef as an empty/whitespace string never needs confirm", { checkoff: "none", torqueRef: "   " }, false],
    ["a torque step already done never needs confirm again, even with torqueRef set", { checkoff: "torque", torqueRef: "t1", done: true }, false],
  ])("%s", (_label, over, expected) => {
    expect(stepNeedsConfirm(step(over))).toBe(expected);
  });
});

describe("attemptClientEventId (F16 start-job retry, F17 photo-upload retry)", () => {
  it("mints a fresh id when there is no pending attempt", () => {
    const id = attemptClientEventId(null, () => "fresh-id");
    expect(id).toBe("fresh-id");
  });

  it("reuses the pending id instead of minting a new one, so a retry never creates a duplicate", () => {
    const mint = vi.fn(() => "should-not-be-used");
    const id = attemptClientEventId("pending-id", mint);
    expect(id).toBe("pending-id");
    expect(mint).not.toHaveBeenCalled();
  });
});

function revision(over: Partial<JobSheetRevision> = {}): JobSheetRevision {
  return {
    id: "rev-1",
    jobSheetId: "js-1",
    revision: 1,
    status: "draft",
    body: {
      title: "Belt swap",
      machineLabel: null,
      component: null,
      jobType: "pm",
      estHours: null,
      crewSize: null,
      isolationPoints: null,
      cautions: null,
      returnToService: [],
      items: [],
      torques: [],
      steps: [],
      author: null,
      notes: null,
    },
    createdBy: "u1",
    createdAt: "2026-11-01T00:00:00.000Z",
    reviewedBy: null,
    reviewedAt: null,
    ...over,
  };
}

describe("chosenRevisionOf", () => {
  it("prefers latestReviewed when present, with isDraft false", () => {
    const reviewed = revision({ id: "rev-2", status: "reviewed", reviewedBy: "lead", reviewedAt: "2026-11-02T00:00:00.000Z" });
    const sheet: JobSheetSummary = { jobSheetId: "js-1", latest: revision({ id: "rev-3" }), latestReviewed: reviewed };
    expect(chosenRevisionOf(sheet)).toEqual({ revision: reviewed, isDraft: false });
  });

  it("falls back to latest (draft) when there is no reviewed revision", () => {
    const draft = revision();
    const sheet: JobSheetSummary = { jobSheetId: "js-1", latest: draft, latestReviewed: null };
    expect(chosenRevisionOf(sheet)).toEqual({ revision: draft, isDraft: true });
  });

  it("F23: a newer draft revision after an older reviewed one is shown (as draft), not the stale reviewed revision", () => {
    const reviewed = revision({ id: "rev-2", revision: 2, status: "reviewed", reviewedBy: "lead", reviewedAt: "2026-11-02T00:00:00.000Z" });
    const newerDraft = revision({ id: "rev-3", revision: 3, status: "draft" });
    const sheet: JobSheetSummary = { jobSheetId: "js-1", latest: newerDraft, latestReviewed: reviewed };
    expect(chosenRevisionOf(sheet)).toEqual({ revision: newerDraft, isDraft: true });
  });
});

describe("startJobErrorMessage", () => {
  it("maps template_revision_not_found to plain words", () => {
    expect(startJobErrorMessage("template_revision_not_found", undefined)).toBe(
      "That job sheet changed or was removed. Pick another, or start without one.",
    );
  });

  it("prefers the server message when present", () => {
    expect(startJobErrorMessage("anything", "server says so")).toBe("server says so");
  });
});

describe("parseSheetReceipts", () => {
  it("extracts sheet_receipt frames from an SSE stream, ignoring other frame kinds", async () => {
    const receipt: NotebookSheetReceiptFrame = { kind: "sheet_receipt", jobId: "job-1", baseSeq: 3, proposals: [] };
    const sse =
      `data: ${JSON.stringify({ kind: "content", content: "hi" })}\n\n` +
      `data: ${JSON.stringify(receipt)}\n\n` +
      `data: [DONE]\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    const seen: NotebookSheetReceiptFrame[] = [];
    await parseSheetReceipts(stream, (f) => seen.push(f));
    expect(seen).toEqual([receipt]);
  });

  it("works on a tee'd branch exactly like hub-host's send() feeds it, while the OTHER branch still reads the same bytes untouched", async () => {
    const receipt: NotebookSheetReceiptFrame = { kind: "sheet_receipt", jobId: "job-1", baseSeq: 3, proposals: [] };
    const sse =
      `data: ${JSON.stringify({ kind: "content", content: "hi" })}\n\n` +
      `data: ${JSON.stringify(receipt)}\n\n` +
      `data: [DONE]\n\n`;
    const original = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    const [forChat, forReceipt] = original.tee();

    // The "chat" branch is read exactly like readNotebookStream would — plain
    // bytes, unaffected by the receipt parser running on the other branch.
    const chatReader = forChat.getReader();
    let chatText = "";
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await chatReader.read();
      if (done) break;
      chatText += decoder.decode(value);
    }

    const seen: NotebookSheetReceiptFrame[] = [];
    await parseSheetReceipts(forReceipt, (f) => seen.push(f));

    expect(chatText).toBe(sse);
    expect(seen).toEqual([receipt]);
  });

  it("never throws on a malformed frame", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {not json\n\ndata: [DONE]\n\n"));
        controller.close();
      },
    });
    const seen: NotebookSheetReceiptFrame[] = [];
    await expect(parseSheetReceipts(stream, (f) => seen.push(f))).resolves.toBeUndefined();
    expect(seen).toEqual([]);
  });
});

describe("workOrderStatusText", () => {
  const base = { eventId: "e", requestedAt: "t0", externalRef: null, attempts: 0, updatedAt: "t1" };
  it("only says 'created' after the CMMS read the order back", () => {
    for (const state of ["queued", "leased", "accepted_pending_verification", "retryable_failure", "outcome_unknown"]) {
      expect(workOrderStatusText({ ...base, state })).not.toMatch(/created in the CMMS/);
    }
    expect(workOrderStatusText({ ...base, state: "verified_by_readback", externalRef: "812" })).toBe(
      "Work order #812 created in the CMMS.",
    );
  });
  it("policy-off and unknown failures are explicit, never silent", () => {
    expect(workOrderStatusText({ ...base, state: "saved" })).toMatch(/turned off/);
    expect(workOrderStatusText({ ...base, state: "blocked_policy" })).toMatch(/turned off/);
    expect(workOrderStatusText({ ...base, state: "permission_denied" })).toMatch(/refused/);
    expect(workOrderStatusText({ ...base, state: "permanent_failure" })).toMatch(/Could not create/);
    expect(workOrderStatusText({ ...base, state: "outcome_unknown" })).toMatch(/not create a second order/);
  });
  it("a licence-limit refusal names the real cause and is the only refusal offered a retry", () => {
    const limit = { ...base, state: "permission_denied", blockedBy: "cmms_licence_limit" };
    expect(workOrderStatusText(limit)).toMatch(/limit of open work orders/);
    expect(workOrderStatusText(limit)).not.toMatch(/\(permission\)/);
    expect(workOrderRetryable(limit)).toBe(true);
    // Controls: an access refusal keeps its message and gets no retry; the
    // code alone on another state is not a refusal.
    const access = { ...base, state: "permission_denied", blockedBy: null };
    expect(workOrderStatusText(access)).toMatch(/\(permission\)/);
    expect(workOrderRetryable(access)).toBe(false);
    expect(workOrderRetryable({ ...base, state: "queued", blockedBy: "cmms_licence_limit" })).toBe(false);
  });
});

describe("photoAttemptBelongsTo — a photo retry stays on the job it was taken for (Codex #5207 F5)", () => {
  const a = { notebookId: "nb-1", jobId: "job-a" };
  it("the same notebook and job may retry", () => {
    expect(photoAttemptBelongsTo(a, "nb-1", "job-a")).toBe(true);
  });
  it("another job on the same notebook may not", () => {
    expect(photoAttemptBelongsTo(a, "nb-1", "job-b")).toBe(false);
  });
  it("another notebook may not, even with the same job id", () => {
    expect(photoAttemptBelongsTo(a, "nb-2", "job-a")).toBe(false);
  });
  it("no job open, or no attempt, may not", () => {
    expect(photoAttemptBelongsTo(a, "nb-1", null)).toBe(false);
    expect(photoAttemptBelongsTo(null, "nb-1", "job-a")).toBe(false);
  });
});

describe("isDefinitiveRejection — when a refused start may be rebuilt (Codex #5207 F6)", () => {
  it("a 4xx refusal is definitive", () => {
    for (const s of [400, 401, 403, 404, 422]) expect(isDefinitiveRejection(s)).toBe(true);
  });
  it("a timeout, rate limit or server error is not — the exact attempt is kept for replay", () => {
    for (const s of [408, 409, 429, 500, 502, 503, 504]) expect(isDefinitiveRejection(s)).toBe(false);
  });
});

describe("stepConfirmBelongsTo — Mark done posts only to the job the dialog was opened on (Codex #5207 r2 F8)", () => {
  // Two jobs built from the same job sheet share step ids, so the step id
  // alone cannot tell them apart — the dialog's own job binding must.
  const step = { id: "s-torque", text: "Torque the coupling bolts", done: false } as SheetStepView;
  const confirm = { notebookId: "nb-1", jobId: "job-a", step };

  it("the dialog opened on job A may post while job A is still open", () => {
    expect(stepConfirmBelongsTo(confirm, "nb-1", "job-a")).toBe(true);
  });
  it("after switching to job B (same step id) the dialog must not post to B", () => {
    expect(stepConfirmBelongsTo(confirm, "nb-1", "job-b")).toBe(false);
  });
  it("after the sheet is closed nothing is posted", () => {
    expect(stepConfirmBelongsTo(confirm, "nb-1", null)).toBe(false);
  });
  it("a different notebook with the same job id is not the same job", () => {
    expect(stepConfirmBelongsTo(confirm, "nb-2", "job-a")).toBe(false);
  });
  it("no open dialog never posts", () => {
    expect(stepConfirmBelongsTo(null, "nb-1", "job-a")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #5212: a definitively rejected offline note must survive navigation and
// reload, stay scoped to its author, notebook and job, and leave with sign-out.
// ---------------------------------------------------------------------------

function noteEvent(clientEventId: string, text: string): SheetEventPost {
  return {
    clientEventId,
    baseSeq: 1,
    kind: "note_added",
    payload: { noteId: `note-${clientEventId}`, text, noteKind: "note" },
    occurredAt: "2026-11-07T00:00:00.000Z",
    workOrderId: null,
  } as unknown as SheetEventPost;
}

/** Fails `set` only for keys starting with `prefix` (the rejected store), so
 *  the queue itself stays writable and only the rejection record is at risk. */
function failingPrefixStore(prefix: string, seed: Record<string, string> = {}): KvStore {
  const m = new Map<string, string>(Object.entries(seed));
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    set: async (k, v) => {
      if (k.startsWith(prefix)) return false;
      m.set(k, v);
      return true;
    },
    remove: async (k) => {
      m.delete(k);
      return true;
    },
    keys: async () => Array.from(m.keys()),
  };
}

describe("#5212 — a definitively rejected offline note (existing API only)", () => {
  it("the note text is still in device storage after the drain resolves a job_finished rejection", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "Replaced belt, check tension later"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    const everything = await Promise.all((await store.keys())!.map((k) => store.get(k)));
    expect(everything.join("\n")).toContain("Replaced belt, check tension later");
  });
});

describe("#5212 — rejected offline note survives navigation and reload", () => {
  it("queue on job A, replay in flight, technician moves to job B, server rejects job_finished; reopen A after a simulated reload and both the note text and the rejection are there", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "Replaced belt, check tension later"));

    // Replay is in flight for job A.
    let resolveSubmit!: (o: SheetSubmitOutcome) => void;
    const inFlight = new Promise<SheetSubmitOutcome>((r) => (resolveSubmit = r));
    const drain = drainSheetQueue(store, "t1", "jobA", () => inFlight, "nb-1");

    // Technician navigates to job B meanwhile; unrelated work on B is queued.
    await enqueueSheetEvent(store, "t1", "jobB", noteEvent("b-1", "Unrelated note on B"));

    // Server now definitively rejects A's write.
    resolveSubmit({ status: "rejected", message: "job_finished" });
    await drain;

    // Simulated reload: fresh module state (locks, drain guard), same storage.
    vi.resetModules();
    const fresh = await import("../living-sheet-client");

    const listA = await fresh.loadRejectedSheetEvents(store, "t1", "nb-1", "jobA");
    expect(listA.map((r) => r.event.clientEventId)).toEqual(["n-1"]);
    expect(listA[0]!.message).toBe("job_finished");
    expect(rejectedNoteText(listA[0]!.event)).toEqual({ kind: "note", text: "Replaced belt, check tension later" });
    expect(await fresh.loadSheetQueue(store, "t1", "jobA")).toEqual([]);

    // Job B shows none of job A's rejection.
    expect(await fresh.loadRejectedSheetEvents(store, "t1", "nb-1", "jobB")).toEqual([]);
  });

  it("dismiss removes only the named rejection and leaves the others", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "first"));
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "second"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toHaveLength(2);
    expect(await dismissRejectedSheetEvent(store, "t1", "nb-1", "jobA", "n-1")).toBe(true);
    const left = await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA");
    expect(left.map((r) => r.event.clientEventId)).toEqual(["n-2"]);
    expect(await dismissRejectedSheetEvent(store, "t1", "nb-1", "jobA", "n-2")).toBe(true);
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toEqual([]);
  });

  it("recover exposes the text to put back in the field, and never overwrites a draft already being typed", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "Replaced belt"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    const [rec] = await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA");
    expect(rejectedNoteText(rec!.event)?.text).toBe("Replaced belt");
    expect(recoveredFieldValue("", "Replaced belt")).toBe("Replaced belt");
    expect(recoveredFieldValue("   ", "Replaced belt")).toBe("Replaced belt");
    expect(recoveredFieldValue("half typed", "Replaced belt")).toBe("half typed Replaced belt");
    // Recover does not delete the record: it stays until the technician dismisses it.
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toHaveLength(1);
  });

  it("a different tenant/user on the same device, or a different notebook, never sees the rejection", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "private note"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    expect(await loadRejectedSheetEvents(store, "t2", "nb-1", "jobA")).toEqual([]);
    expect(await loadRejectedSheetEvents(store, "t1", "nb-2", "jobA")).toEqual([]);
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toHaveLength(1);
  });

  it("a retry of the same write (same clientEventId) creates exactly one rejected entry", async () => {
    const store = memoryStore();
    const rejected = async (): Promise<SheetSubmitOutcome> => ({ status: "rejected", message: "job_finished" });
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "once"));
    await drainSheetQueue(store, "t1", "jobA", rejected, "nb-1");
    // Crash-replay: the same logical write is queued again under the same id.
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "once"));
    await drainSheetQueue(store, "t1", "jobA", rejected, "nb-1");
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toHaveLength(1);
  });

  it("sign-out counts a kept rejection as unsaved and the purge removes it with the pending queue", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "rejected words"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toHaveLength(1);
    expect(await loadSheetQueue(store, "t1", "jobA")).toEqual([]);
    // Only the rejection is left: the prompt must still warn about it.
    expect(await countAllSheetQueueEntries(store)).toBe(1);
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "still pending"));
    expect(await countAllSheetQueueEntries(store)).toBe(2);
    await purgeSheetQueues(store);
    expect(await countAllSheetQueueEntries(store)).toBe(0);
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toEqual([]);
    const left = await Promise.all((await store.keys())!.map((k) => store.get(k)));
    expect(left.join("\n")).not.toContain("rejected words");
  });

  it("sign-out purge leaves unrelated device storage alone", async () => {
    const store = memoryStore();
    await store.set("flm.other.v1.x", "keep");
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "gone"));
    await purgeSheetQueues(store);
    expect(await store.get("flm.other.v1.x")).toBe("keep");
  });

  it("corrupt rejected storage loads as empty and never throws", async () => {
    const store = memoryStore();
    await store.set(rejectedSheetKey("t1", "nb-1", "jobA"), "{not json");
    await expect(loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).resolves.toEqual([]);
  });

  it("if the rejection cannot be persisted, the queued item is kept and the drain stops (drainStuck), never dropped", async () => {
    const seeded = memoryStore();
    await enqueueSheetEvent(seeded, "t1", "jobA", noteEvent("n-1", "must not vanish"));
    const seedRaw = (await seeded.get(sheetQueueKey("t1", "jobA")))!;
    const store = failingPrefixStore("flm.sheetrej.v1.", { [sheetQueueKey("t1", "jobA")]: seedRaw });
    const submit = vi.fn(async (): Promise<SheetSubmitOutcome> => ({ status: "rejected", message: "job_finished" }));
    const result = await drainSheetQueue(store, "t1", "jobA", submit, "nb-1");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result?.drainStuck).toBe(true);
    expect((await loadSheetQueue(store, "t1", "jobA")).map((i) => i.event.clientEventId)).toEqual(["n-1"]);
  });

  it("unavailable storage: loading and dismissing never throw", async () => {
    const broken: KvStore = {
      get: async () => {
        throw new Error("denied");
      },
      set: async () => {
        throw new Error("denied");
      },
      remove: async () => {
        throw new Error("denied");
      },
      keys: async () => null, // unavailable storage cannot be listed
    };
    await expect(loadRejectedSheetEvents(broken, "t1", "nb-1", "jobA")).resolves.toEqual([]);
    await expect(dismissRejectedSheetEvent(broken, "t1", "nb-1", "jobA", "n-1")).resolves.toBe(false);
    await expect(
      recordRejectedSheetEvent(broken, "t1", "nb-1", "jobA", {
        event: noteEvent("n-1", "x"),
        message: "job_finished",
        rejectedAt: "2026-11-07T00:00:00.000Z",
      }),
    ).resolves.toBe(false);
  });

  // Codex #5276 F1: the production adapter swallows a removeItem failure, so
  // a remove that resolves but leaves the key must never count as removed.
  function stickyRemoveStore(stickyPrefix: string): KvStore {
    const m = new Map<string, string>();
    return {
      get: async (k) => (m.has(k) ? m.get(k)! : null),
      set: async (k, v) => {
        m.set(k, v);
        return true;
      },
      remove: async (k) => {
        if (!k.startsWith(stickyPrefix)) m.delete(k);
        return !m.has(k);
      },
      keys: async () => Array.from(m.keys()),
    };
  }

  it("dismiss reports failure when a silently failed remove leaves the last rejection on the phone", async () => {
    const store = stickyRemoveStore("flm.sheetrej.v1.");
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "still here"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toHaveLength(1);
    expect(await dismissRejectedSheetEvent(store, "t1", "nb-1", "jobA", "n-1")).toBe(false);
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toHaveLength(1);
  });

  it("dismiss of the last rejection succeeds when the remove really happens (control)", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "gone"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    expect(await dismissRejectedSheetEvent(store, "t1", "nb-1", "jobA", "n-1")).toBe(true);
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toEqual([]);
  });

  it("purge reports keys a silently failed remove left behind, and a throwing remove", async () => {
    const store = stickyRemoveStore("flm.sheetrej.v1.");
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "rejected words"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    await enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "pending"));
    const { remaining } = await purgeSheetQueues(store);
    expect(remaining).toBe(1);
    expect(await loadSheetQueue(store, "t1", "jobB")).toEqual([]);
    expect(await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).toHaveLength(1);

    const throwing = memoryStore();
    await enqueueSheetEvent(throwing, "t1", "jobA", noteEvent("n-3", "x"));
    throwing.remove = async () => {
      throw new Error("denied");
    };
    expect(await purgeSheetQueues(throwing)).toEqual({ purged: 0, remaining: 1 });
  });

  it("sign-out warns only when the purge left sheet items on the phone", () => {
    expect(signOutPurgeFailedPrompt(0)).toBeNull();
    expect(signOutPurgeFailedPrompt(1)).toBe(
      "Could not clear 1 saved sheet item from this phone. Sign out anyway and leave it here?",
    );
    expect(signOutPurgeFailedPrompt(3)).toBe(
      "Could not clear 3 saved sheet items from this phone. Sign out anyway and leave them here?",
    );
  });

  it("sign-out stops when the purge left sheet text and the technician cancels", async () => {
    const store = stickyRemoveStore("flm.sheetrej.v1.");
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "rejected words"));
    await drainSheetQueue(store, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    const asked: string[] = [];
    const confirm = (m: string) => {
      asked.push(m);
      return asked.length === 1; // OK to discard unsynced, then Cancel on "could not clear"
    };
    const purging = vi.fn();
    expect(await clearSheetDataForSignOut(store, confirm, purging)).toBe(false);
    expect(purging).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toBe(signOutPurgeFailedPrompt(1));
  });

  it("sign-out goes ahead with no second prompt when the purge cleared everything (control)", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "pending"));
    const asked: string[] = [];
    expect(await clearSheetDataForSignOut(store, (m) => (asked.push(m), true))).toBe(true);
    expect(asked).toHaveLength(1);
    expect(await countAllSheetQueueEntries(store)).toBe(0);
  });

  it("sign-out Cancel on the unsynced prompt keeps everything and never purges", async () => {
    const store = memoryStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "pending"));
    const purging = vi.fn();
    expect(await clearSheetDataForSignOut(store, () => false, purging)).toBe(false);
    expect(purging).not.toHaveBeenCalled();
    expect(await countAllSheetQueueEntries(store)).toBe(1);
  });

  it("only note and question kinds carry recoverable text", () => {
    expect(rejectedNoteText(noteEvent("n-1", "hello"))).toEqual({ kind: "note", text: "hello" });
    expect(rejectedNoteText(stepEvent("s-1"))).toBeNull();
    expect(rejectedNoteText(noteEvent("n-2", "   "))).toBeNull();
  });
});

// Codex #5276 round 2: the production adapter must never turn blocked storage
// into "gone" or "empty". This fake keeps its data when blocked, exactly like
// a browser whose site-data access is denied after the note was written.
describe("#5212 production adapter under blocked storage", () => {
  function fakeLocalStorage() {
    const m = new Map<string, string>();
    const gate = { blocked: false, dropRemoves: false };
    const check = () => {
      if (gate.blocked) throw new DOMException("denied", "SecurityError");
    };
    const ls = {
      getItem: (k: string) => (check(), m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => (check(), void m.set(k, v)),
      removeItem: (k: string) => {
        check();
        if (!gate.dropRemoves) m.delete(k);
      },
      key: (i: number) => (check(), Array.from(m.keys())[i] ?? null),
      get length() {
        check();
        return m.size;
      },
    };
    vi.stubGlobal("window", { localStorage: ls });
    return { m, gate };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedRejected(): Promise<void> {
    await enqueueSheetEvent(localStorageStore, "t1", "jobA", noteEvent("n-1", "technician words"));
    await drainSheetQueue(localStorageStore, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    expect(await loadRejectedSheetEvents(localStorageStore, "t1", "nb-1", "jobA")).toHaveLength(1);
  }

  it("blocked storage: Dismiss reports failure and the note stays on the phone", async () => {
    const { m, gate } = fakeLocalStorage();
    await seedRejected();
    gate.blocked = true;
    expect(await dismissRejectedSheetEvent(localStorageStore, "t1", "nb-1", "jobA", "n-1")).toBe(false);
    expect(Array.from(m.values()).join("\n")).toContain("technician words");
  });

  it("blocked storage: sign-out warns that the phone could not be checked, and Cancel stops it", async () => {
    const { m, gate } = fakeLocalStorage();
    await seedRejected();
    gate.blocked = true;
    const asked: string[] = [];
    const proceed = await clearSheetDataForSignOut(localStorageStore, (msg) => (asked.push(msg), false));
    expect(proceed).toBe(false);
    expect(asked).toEqual([signOutPurgeFailedPrompt(null)]);
    expect(signOutPurgeFailedPrompt(null)).toBe(
      "Could not check this phone for saved sheet items, so some may still be here. Sign out anyway?",
    );
    expect(Array.from(m.values()).join("\n")).toContain("technician words");
  });

  it("a removal the browser ignores without an error is not reported as removed", async () => {
    const { gate } = fakeLocalStorage();
    await seedRejected();
    gate.dropRemoves = true;
    expect(await dismissRejectedSheetEvent(localStorageStore, "t1", "nb-1", "jobA", "n-1")).toBe(false);
    expect(await purgeSheetQueues(localStorageStore)).toEqual({ purged: 0, remaining: 2 });
  });

  it("a failed read never makes Dismiss delete the other kept notes for the job", async () => {
    const { m } = fakeLocalStorage();
    await enqueueSheetEvent(localStorageStore, "t1", "jobA", noteEvent("n-1", "first words"));
    await enqueueSheetEvent(localStorageStore, "t1", "jobA", noteEvent("n-2", "second words"));
    await drainSheetQueue(localStorageStore, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    expect(await loadRejectedSheetEvents(localStorageStore, "t1", "nb-1", "jobA")).toHaveLength(2);
    const ls = (globalThis as unknown as { window: { localStorage: { getItem: (k: string) => string | null } } }).window.localStorage;
    ls.getItem = () => {
      throw new DOMException("denied", "SecurityError");
    };
    expect(await dismissRejectedSheetEvent(localStorageStore, "t1", "nb-1", "jobA", "n-1")).toBe(false);
    const stored = Array.from(m.values()).join("\n");
    expect(stored).toContain("first words");
    expect(stored).toContain("second words");
  });

  it("a removal that throws is reported as not removed by Dismiss and the purge", async () => {
    const { m } = fakeLocalStorage();
    await seedRejected();
    const ls = (globalThis as unknown as { window: { localStorage: { removeItem: (k: string) => void } } }).window.localStorage;
    ls.removeItem = () => {
      throw new DOMException("denied", "SecurityError");
    };
    expect(await dismissRejectedSheetEvent(localStorageStore, "t1", "nb-1", "jobA", "n-1")).toBe(false);
    expect(await purgeSheetQueues(localStorageStore)).toEqual({ purged: 0, remaining: 2 });
    expect(Array.from(m.values()).join("\n")).toContain("technician words");
  });

  function blockReads(): void {
    const ls = (globalThis as unknown as { window: { localStorage: { getItem: (k: string) => string | null } } }).window.localStorage;
    ls.getItem = () => {
      throw new DOMException("denied", "SecurityError");
    };
  }

  it("a failed read never lets recording a rejection overwrite the kept notes", async () => {
    const { m } = fakeLocalStorage();
    await enqueueSheetEvent(localStorageStore, "t1", "jobA", noteEvent("n-1", "first words"));
    await enqueueSheetEvent(localStorageStore, "t1", "jobA", noteEvent("n-2", "second words"));
    await drainSheetQueue(localStorageStore, "t1", "jobA", async () => ({ status: "rejected", message: "job_finished" }), "nb-1");
    blockReads();
    const ok = await recordRejectedSheetEvent(localStorageStore, "t1", "nb-1", "jobA", {
      event: noteEvent("n-3", "third words"),
      message: "job_finished",
      rejectedAt: "2026-11-07T00:00:00.000Z",
    });
    expect(ok).toBe(false);
    const stored = m.get(rejectedSheetKey("t1", "nb-1", "jobA"))!;
    expect(stored).toContain("first words");
    expect(stored).toContain("second words");
  });

  it("a failed read never lets the queue writers overwrite queued notes", async () => {
    const { m } = fakeLocalStorage();
    await enqueueSheetEvent(localStorageStore, "t1", "jobA", noteEvent("n-1", "queued words"));
    blockReads();
    expect((await enqueueSheetEvent(localStorageStore, "t1", "jobA", noteEvent("n-2", "more words"))).saved).toBe(false);
    expect(await removeFromSheetQueue(localStorageStore, "t1", "jobA", "n-9")).toBe(false);
    expect(await dropHeadOfSheetQueue(localStorageStore, "t1", "jobA")).toBeNull();
    expect(m.get(sheetQueueKey("t1", "jobA"))).toContain("queued words");
  });

  it("an empty read on a key storage lists as absent is trusted, so a first write still works (control)", async () => {
    const { m } = fakeLocalStorage();
    await seedRejected();
    expect((await enqueueSheetEvent(localStorageStore, "t1", "jobB", noteEvent("n-5", "fresh"))).saved).toBe(true);
    expect(m.get(sheetQueueKey("t1", "jobB"))).toContain("fresh");
  });

  it("a read that fails mid-drain never lets the attempt counter wipe the queue", async () => {
    const m = new Map<string, string>();
    let reads = 0;
    const store: KvStore = {
      get: async (k) => {
        reads++;
        if (reads > 1) throw new Error("denied");
        return m.has(k) ? m.get(k)! : null;
      },
      set: async (k, v) => (m.set(k, v), true),
      remove: async (k) => (m.delete(k), true),
      keys: async () => Array.from(m.keys()),
    };
    m.set(sheetQueueKey("t1", "jobA"), JSON.stringify([{ event: noteEvent("n-1", "kept words"), queuedAt: "2026-11-07T00:00:00.000Z", attempts: 0 }]));
    const result = await drainSheetQueue(store, "t1", "jobA", async () => {
      throw new Error("offline");
    });
    expect(result?.networkStopped).toBe(true);
    expect(m.get(sheetQueueKey("t1", "jobA"))).toContain("kept words");
  });

  it("dismissing a row that is not in a readable list leaves storage alone and succeeds (control)", async () => {
    const { m } = fakeLocalStorage();
    await seedRejected();
    expect(await dismissRejectedSheetEvent(localStorageStore, "t1", "nb-1", "jobA", "not-stored")).toBe(true);
    expect(Array.from(m.values()).join("\n")).toContain("technician words");
  });

  it("working storage: Dismiss clears the note and sign-out purges with only the unsynced prompt (control)", async () => {
    const { m } = fakeLocalStorage();
    await seedRejected();
    expect(await dismissRejectedSheetEvent(localStorageStore, "t1", "nb-1", "jobA", "n-1")).toBe(true);
    await seedRejected();
    const asked: string[] = [];
    expect(await clearSheetDataForSignOut(localStorageStore, (msg) => (asked.push(msg), true))).toBe(true);
    expect(asked).toHaveLength(1);
    expect(Array.from(m.values()).join("\n")).not.toContain("technician words");
  });
});
