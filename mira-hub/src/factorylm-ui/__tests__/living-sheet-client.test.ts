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
  releaseSheetSignOutBarrier,
  SIGN_OUT_STILL_SENDING_PROMPT,
  SIGN_OUT_OTHER_TABS_PROMPT,
  SIGN_OUT_PENDING_MAX_MS,
} from "../living-sheet-client";
import { validateAppendEventInput } from "@/capabilities/living-sheet/validate";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";
import type { SheetStepView } from "@/capabilities/living-sheet/reduce";
import type { NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";

// A completed sign-out keeps the device-wide barrier (the page is leaving);
// tests share the module, so lift it between tests.
afterEach(() => {
  releaseSheetSignOutBarrier();
});

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
    // Blocked storage also refuses the sign-out marker (Codex #5276 r6), so
    // that warning comes first; accepting it reaches the could-not-check one.
    const proceed = await clearSheetDataForSignOut(
      localStorageStore,
      (msg) => (asked.push(msg), msg === SIGN_OUT_OTHER_TABS_PROMPT),
    );
    expect(proceed).toBe(false);
    expect(asked).toEqual([SIGN_OUT_OTHER_TABS_PROMPT, signOutPurgeFailedPrompt(null)]);
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

// Codex #5276 round 3: sign-out must not race a replay already talking to the
// server, or a late rejection writes the technician's words back after the purge.
describe("#5212 sign-out vs an in-flight replay", () => {
  function sheetKeys(m: Map<string, string>): string[] {
    return Array.from(m.keys()).filter((k) => k.startsWith("flm.sheetq") || k.startsWith("flm.sheetrej"));
  }
  function mapStore(): { store: KvStore; m: Map<string, string> } {
    const m = new Map<string, string>();
    const store: KvStore = {
      get: async (k) => (m.has(k) ? m.get(k)! : null),
      set: async (k, v) => (m.set(k, v), true),
      remove: async (k) => (m.delete(k), true),
      keys: async () => Array.from(m.keys()),
    };
    return { store, m };
  }
  function heldRejection(): { submit: () => Promise<SheetSubmitOutcome>; release: () => void; hit: Promise<void> } {
    let release = (): void => {};
    let hitResolve = (): void => {};
    const hit = new Promise<void>((r) => (hitResolve = r));
    const gate = new Promise<void>((r) => (release = r));
    const submit = async (): Promise<SheetSubmitOutcome> => {
      hitResolve();
      await gate;
      return { status: "rejected", message: "job_finished" };
    };
    return { submit, release, hit };
  }

  it("a rejection that arrives during sign-out is not left on the phone", async () => {
    const { store, m } = mapStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "private technician words"));
    const held = heldRejection();
    const drain = drainSheetQueue(store, "t1", "jobA", held.submit, "nb-1");
    await held.hit;
    const asked: string[] = [];
    const signOut = clearSheetDataForSignOut(store, (msg) => (asked.push(msg), true));
    await new Promise((r) => setTimeout(r, 20));
    held.release();
    expect(await signOut).toBe(true);
    await drain;
    expect(asked).not.toContain(SIGN_OUT_STILL_SENDING_PROMPT);
    expect(sheetKeys(m)).toEqual([]);
    expect(Array.from(m.values()).join("\n")).not.toContain("private technician words");
  });

  it("while sign-out is clearing, a new note is refused rather than written after the purge", async () => {
    const { store, m } = mapStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "first"));
    const held = heldRejection();
    const drain = drainSheetQueue(store, "t1", "jobA", held.submit, "nb-1");
    await held.hit;
    const signOut = clearSheetDataForSignOut(store, () => true);
    await new Promise((r) => setTimeout(r, 20));
    expect((await enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "late words"))).saved).toBe(false);
    held.release();
    expect(await signOut).toBe(true);
    await drain;
    expect(sheetKeys(m)).toEqual([]);
  });

  it("after sign-out no new replay starts", async () => {
    const { store, m } = mapStore();
    expect(await clearSheetDataForSignOut(store, () => true)).toBe(true);
    m.set(sheetQueueKey("t1", "jobA"), JSON.stringify([{ event: noteEvent("n-1", "x"), queuedAt: "2026-11-07T00:00:00.000Z", attempts: 0 }]));
    const submit = vi.fn(async (): Promise<SheetSubmitOutcome> => ({ status: "ok" }));
    expect(await drainSheetQueue(store, "t1", "jobA", submit, "nb-1")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("a replay that does not finish in time is named, and Cancel lets work continue", async () => {
    const { store } = mapStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "slow words"));
    const held = heldRejection();
    const drain = drainSheetQueue(store, "t1", "jobA", held.submit, "nb-1");
    await held.hit;
    const asked: string[] = [];
    const proceed = await clearSheetDataForSignOut(store, (msg) => (asked.push(msg), asked.length === 1), undefined, 20);
    expect(proceed).toBe(false);
    expect(asked[asked.length - 1]).toBe(SIGN_OUT_STILL_SENDING_PROMPT);
    held.release();
    await drain;
    expect((await enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "after cancel"))).saved).toBe(true);
    // Cancel lifted the sign-out block: a replay can start again.
    expect(await drainSheetQueue(store, "t1", "jobB", async () => ({ status: "ok" }), "nb-1")).not.toBeNull();
  });

  // Codex #5276 round 4: Cancel on the "still being sent" warning must not
  // have deleted the only copy of that note.
  for (const outcome of ["network error", "conflict"] as const) {
    it(`Cancel on the still-sending warning keeps the note queued (${outcome})`, async () => {
      const { store } = mapStore();
      await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "unanswered words"));
      let release = (): void => {};
      const gate = new Promise<void>((r) => (release = r));
      let hitResolve = (): void => {};
      const hit = new Promise<void>((r) => (hitResolve = r));
      const drain = drainSheetQueue(store, "t1", "jobA", async (): Promise<SheetSubmitOutcome> => {
        hitResolve();
        await gate;
        if (outcome === "conflict") return { status: "conflict" };
        throw new Error("offline");
      }, "nb-1");
      await hit;
      const asked: string[] = [];
      const proceed = await clearSheetDataForSignOut(store, (msg) => (asked.push(msg), asked.length === 1), undefined, 20);
      expect(proceed).toBe(false);
      expect(asked).toEqual([signOutUnsyncedPrompt(1), SIGN_OUT_STILL_SENDING_PROMPT]);
      release();
      await drain;
      expect((await loadSheetQueue(store, "t1", "jobA")).map((i) => i.event.clientEventId)).toEqual(["n-1"]);
    });
  }

  it("accepting the still-sending warning clears the phone (control)", async () => {
    const { store, m } = mapStore();
    await enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "accepted words"));
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    let hitResolve = (): void => {};
    const hit = new Promise<void>((r) => (hitResolve = r));
    const drain = drainSheetQueue(store, "t1", "jobA", async (): Promise<SheetSubmitOutcome> => {
      hitResolve();
      await gate;
      throw new Error("offline");
    }, "nb-1");
    await hit;
    expect(await clearSheetDataForSignOut(store, () => true, undefined, 20)).toBe(true);
    expect(sheetKeys(m)).toEqual([]);
    release();
    await drain;
  });
});

// Codex #5276 round 5: tabs share device storage but not module state. Each
// tab is a fresh import of the client module over the same store.
describe("#5212 sign-out across tabs", () => {
  type Client = typeof import("../living-sheet-client");
  async function openTab(): Promise<Client> {
    vi.resetModules();
    const mod = await import("../living-sheet-client");
    await new Promise((r) => setTimeout(r, 2)); // this tab loaded strictly before anything that follows
    return mod;
  }
  afterEach(() => vi.unstubAllGlobals());
  function sharedStore(): { store: KvStore; m: Map<string, string> } {
    const m = new Map<string, string>();
    // A tab reads the sign-out count from device storage as it loads: point that at this store.
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => m.get(k) ?? null } });
    return {
      m,
      store: {
        get: async (k) => (m.has(k) ? m.get(k)! : null),
        set: async (k, v) => (m.set(k, v), true),
        remove: async (k) => (m.delete(k), true),
        keys: async () => Array.from(m.keys()),
      },
    };
  }
  const sheetText = (m: Map<string, string>) =>
    Array.from(m.entries())
      .filter(([k]) => k.startsWith("flm.sheetq") || k.startsWith("flm.sheetrej"))
      .map(([, v]) => v)
      .join("\n");

  it("a rejection that lands in another tab after sign-out is not written back", async () => {
    const { store, m } = sharedStore();
    const tabA = await openTab();
    const tabB = await openTab();
    await tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "tab A words"));
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    let hitResolve = (): void => {};
    const hit = new Promise<void>((r) => (hitResolve = r));
    const drain = tabA.drainSheetQueue(store, "t1", "jobA", async () => {
      hitResolve();
      await gate;
      return { status: "rejected", message: "job_finished" };
    }, "nb-1");
    await hit;
    expect(await tabB.clearSheetDataForSignOut(store, () => true)).toBe(true);
    release();
    await drain;
    expect(sheetText(m)).not.toContain("tab A words");
    expect((await tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "after sign-out"))).saved).toBe(false);
    expect(sheetText(m)).toBe("");
  });

  it("a full phone that refuses the marker: sign-out retries after the purge frees space, and the late rejection stays out", async () => {
    const { store: base, m } = sharedStore();
    let full = false;
    const store: KvStore = {
      ...base,
      set: async (k, v) => (full ? false : base.set(k, v)),
      remove: async (k) => ((full = false), base.remove(k)),
    };
    const tabA = await openTab();
    const tabB = await openTab();
    await tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "tab A words"));
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    let hitResolve = (): void => {};
    const hit = new Promise<void>((r) => (hitResolve = r));
    const drain = tabA.drainSheetQueue(store, "t1", "jobA", async () => {
      hitResolve();
      await gate;
      return { status: "rejected", message: "job_finished" };
    }, "nb-1");
    await hit;
    full = true; // the marker write is refused; the purge's removal frees space
    const asked: string[] = [];
    expect(await tabB.clearSheetDataForSignOut(store, (msg) => (asked.push(msg), true))).toBe(true);
    expect(m.has("flm.sheetsignout.v1")).toBe(true);
    expect(asked).not.toContain(SIGN_OUT_OTHER_TABS_PROMPT);
    release();
    await drain;
    expect(sheetText(m)).not.toContain("tab A words");
  });

  it("a note another tab saves after the first purge, before the marker lands, is swept too", async () => {
    const { store: base, m } = sharedStore();
    const tabA = await openTab();
    const tabB = await openTab();
    let full = false;
    const store: KvStore = {
      ...base,
      set: async (k, v) => (full ? false : base.set(k, v)),
      remove: async (k) => {
        const freed = full;
        full = false;
        const ok = await base.remove(k);
        // Storage just freed up: tab A saves before sign-out retries its marker.
        if (freed) await tabA.enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "slipped in"));
        return ok;
      },
    };
    await tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "queued"));
    full = true;
    expect(await tabB.clearSheetDataForSignOut(store, () => true)).toBe(true);
    expect(m.has("flm.sheetsignout.v1")).toBe(true);
    expect(sheetText(m)).toBe("");
  });

  it("a marker that never saves: sign-out says other tabs are not blocked, and Cancel keeps the technician signed in", async () => {
    const { store: base, m } = sharedStore();
    const store: KvStore = { ...base, set: async (k, v) => (k === "flm.sheetsignout.v1" ? false : base.set(k, v)) };
    const tabB = await openTab();
    const asked: string[] = [];
    expect(await tabB.clearSheetDataForSignOut(store, (msg) => (asked.push(msg), false))).toBe(false);
    expect(asked).toEqual([SIGN_OUT_OTHER_TABS_PROMPT]);
    expect(SIGN_OUT_OTHER_TABS_PROMPT).toBe(
      "This phone could not stop other open FactoryLM tabs from saving sheet items, so one may be saved here again after you sign out. Close other FactoryLM tabs first. Sign out anyway?",
    );
    expect(m.has("flm.sheetsignout.v1")).toBe(false);
    expect(await tabB.clearSheetDataForSignOut(store, () => true)).toBe(true); // OK signs out
  });

  it("a write that checked the marker just before sign-out recorded it is ordered by the cross-tab lock, so the purge still removes it", async () => {
    fakeWebLocks();
    try {
      const { store: base, m } = sharedStore();
      // A readable earlier count, so the write's marker check is one plain read
      // and only the cross-tab lock can order it before the purge.
      m.set("flm.sheetsignout.v1", "3");
      let release = (): void => {};
      const gate = new Promise<void>((r) => (release = r));
      let hitResolve = (): void => {};
      const hit = new Promise<void>((r) => (hitResolve = r));
      let firstMarkerRead = true;
      const store: KvStore = {
        ...base,
        get: async (k) => {
          const v = await base.get(k); // the value as of the read, before any wait
          if (k === "flm.sheetsignout.v1" && firstMarkerRead) {
            firstMarkerRead = false;
            hitResolve();
            await gate;
          }
          return v;
        },
      };
      const tabA = await openTab();
      const tabB = await openTab();
      const write = tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "racing words"));
      await hit; // tab A read "no sign-out since I opened" and is about to write
      const signOut = tabB.clearSheetDataForSignOut(store, () => true);
      await new Promise((r) => setTimeout(r, 5));
      release();
      await write;
      expect(await signOut).toBe(true);
      expect(sheetText(m)).not.toContain("racing words");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /** A per-name lock manager standing in for the browser's Web Locks. */
  function fakeWebLocks() {
    const tails = new Map<string, Promise<unknown>>();
    const request = (name: string, fn: () => Promise<unknown>) => {
      const run = (tails.get(name) ?? Promise.resolve()).then(fn);
      tails.set(name, run.catch(() => undefined));
      return run;
    };
    vi.stubGlobal("navigator", { locks: { request } });
  }

  for (const first of ["dismiss", "record"] as const) {
    it(`Dismiss in one tab and a new rejection in another never lose or resurrect a note (${first} reads first)`, async () => {
      fakeWebLocks();
      try {
        const { store: base, m } = sharedStore();
        const tabA = await openTab();
        const tabB = await openTab();
        const key = rejectedSheetKey("t1", "nb-1", "jobA");
        const rejected = (id: string, text: string) => ({ event: noteEvent(id, text), message: "job_finished", rejectedAt: "2026-11-07T00:00:00.000Z" });
        expect(await tabA.recordRejectedSheetEvent(base, "t1", "nb-1", "jobA", rejected("n-old", "old words"))).toBe(true);
        let release = (): void => {};
        const gate = new Promise<void>((r) => (release = r));
        let hitResolve = (): void => {};
        const hit = new Promise<void>((r) => (hitResolve = r));
        let armed = true;
        const store: KvStore = {
          ...base,
          get: async (k) => {
            const v = await base.get(k); // the list as of this read
            if (k === key && armed) {
              armed = false;
              hitResolve();
              await gate; // hold the first tab between its read and its write
            }
            return v;
          },
        };
        const dismiss = () => tabA.dismissRejectedSheetEvent(store, "t1", "nb-1", "jobA", "n-old");
        const record = () => tabB.recordRejectedSheetEvent(store, "t1", "nb-1", "jobA", rejected("n-new", "new words"));
        const one = first === "dismiss" ? dismiss() : record();
        await hit;
        const two = first === "dismiss" ? record() : dismiss();
        await new Promise((r) => setTimeout(r, 5));
        release();
        expect(await Promise.all([one, two])).toEqual([true, true]);
        const ids = (await tabA.loadRejectedSheetEvents(base, "t1", "nb-1", "jobA")).map((r) => r.event.clientEventId);
        expect(ids).toEqual(["n-new"]);
        expect(m.get(key)).toContain("new words");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  }

  it("Cancel of one sign-out leaves another tab's newer, completed sign-out in force", async () => {
    fakeWebLocks();
    try {
      const { store, m } = sharedStore();
      const tabA = await openTab();
      const tabB = await openTab();
      const tabC = await openTab();
      // Tab A has a replay in flight, so its sign-out waits on it and then asks.
      await tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "tab A words"));
      let releaseA = (): void => {};
      const gateA = new Promise<void>((r) => (releaseA = r));
      let hitA = (): void => {};
      const inFlightA = new Promise<void>((r) => (hitA = r));
      const drainA = tabA.drainSheetQueue(store, "t1", "jobA", async () => {
        hitA();
        await gateA;
        return { status: "rejected", message: "job_finished" }; // a late rejection, after both sign-outs
      }, "nb-1");
      await inFlightA;
      const signOutA = tabA.clearSheetDataForSignOut(store, (msg) => msg !== SIGN_OUT_STILL_SENDING_PROMPT, undefined, 40);
      await new Promise((r) => setTimeout(r, 5)); // A has recorded its marker and is waiting
      expect(m.get("flm.sheetsignout.v1")).toContain("pending"); // A's sign-out is in progress
      expect(await tabB.clearSheetDataForSignOut(store, () => true)).toBe(true); // B signs out completely
      expect(await signOutA).toBe(false); // A's technician pressed Cancel on the still-sending question
      // B's finished sign-out is what remains: a plain time, nothing pending.
      expect(Number.isFinite(Number(m.get("flm.sheetsignout.v1")))).toBe(true);
      releaseA();
      await drainA;
      expect((await tabC.enqueueSheetEvent(store, "t1", "jobC", noteEvent("n-3", "late words"))).saved).toBe(false);
      expect(sheetText(m)).not.toContain("late words");
      expect(sheetText(m)).not.toContain("tab A words");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a sign-out that starts while another tab's Cancel is restoring the marker keeps its own marker", async () => {
    fakeWebLocks();
    try {
      const { store: base, m } = sharedStore();
      m.set("flm.sheetrej.v1.x", "keep"); // a key the purge cannot remove, so tab A is asked and cancels
      let holdNextMarkerRead = false;
      let release = (): void => {};
      const gate = new Promise<void>((r) => (release = r));
      let hitResolve = (): void => {};
      const hit = new Promise<void>((r) => (hitResolve = r));
      const store: KvStore = {
        ...base,
        remove: async (k) => (k === "flm.sheetrej.v1.x" ? false : base.remove(k)),
        get: async (k) => {
          const v = await base.get(k);
          if (k === "flm.sheetsignout.v1" && holdNextMarkerRead) {
            holdNextMarkerRead = false;
            hitResolve();
            await gate; // tab A's Cancel has read its own marker and is about to undo it
          }
          return v;
        },
      };
      const tabA = await openTab();
      const tabB = await openTab();
      const signOutA = tabA.clearSheetDataForSignOut(store, (msg) => {
        if (msg !== signOutPurgeFailedPrompt(1)) return true;
        holdNextMarkerRead = true;
        return false;
      });
      await hit;
      await new Promise((r) => setTimeout(r, 2));
      const signOutB = tabB.clearSheetDataForSignOut(store, () => true);
      await new Promise((r) => setTimeout(r, 5));
      release();
      expect(await signOutA).toBe(false);
      expect(await signOutB).toBe(true);
      expect(m.has("flm.sheetsignout.v1")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a marker the store reports saved but that does not read back counts as not saved", async () => {
    const { store: base } = sharedStore();
    const store: KvStore = { ...base, set: async (k, v) => (k === "flm.sheetsignout.v1" ? true : base.set(k, v)) };
    const tab = await openTab();
    const asked: string[] = [];
    expect(await tab.clearSheetDataForSignOut(store, (msg) => (asked.push(msg), false))).toBe(false);
    expect(asked).toEqual([SIGN_OUT_OTHER_TABS_PROMPT]);
  });

  /** A replay held in flight (the server answers job_finished when released). */
  async function replayInFlight(tab: Client, store: KvStore, job: string) {
    await tab.enqueueSheetEvent(store, "t1", job, noteEvent(`n-${job}`, `${job} words`));
    let releaseA = (): void => {};
    const gateA = new Promise<void>((r) => (releaseA = r));
    let hitA = (): void => {};
    const inFlight = new Promise<void>((r) => (hitA = r));
    const drain = tab.drainSheetQueue(store, "t1", job, async () => {
      hitA();
      await gateA;
      return { status: "rejected", message: "job_finished" };
    }, "nb-1");
    await inFlight;
    return { drain, releaseA };
  }

  /** Tab A starts a sign-out that waits on its own in-flight replay; call
   *  `releaseA` to let that replay answer (a late job_finished rejection). */
  async function signOutWaitingOnReplay(tab: Client, store: KvStore, confirm: (msg: string) => boolean, waitMs = 40, job = "jobA") {
    const replay = await replayInFlight(tab, store, job);
    const signOut = tab.clearSheetDataForSignOut(store, confirm, undefined, waitMs);
    await new Promise((r) => setTimeout(r, 5));
    return { signOut, ...replay };
  }

  it("two sign-outs in the same millisecond: Cancel of one leaves the other's finished sign-out in force", async () => {
    fakeWebLocks();
    try {
      const { store, m } = sharedStore();
      const tabA = await openTab();
      const tabB = await openTab();
      const tabC = await openTab();
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000); // every clock read is the same instant
      try {
        const a = await signOutWaitingOnReplay(tabA, store, (msg) => msg !== SIGN_OUT_STILL_SENDING_PROMPT);
        expect(await tabB.clearSheetDataForSignOut(store, () => true)).toBe(true);
        expect(await a.signOut).toBe(false); // Cancel in A
        a.releaseA();
        await a.drain;
      } finally {
        now.mockRestore();
      }
      expect((await tabC.enqueueSheetEvent(store, "t1", "jobC", noteEvent("n-3", "late words"))).saved).toBe(false);
      expect(sheetText(m)).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a note another tab tries to queue while sign-out is counting is refused, never purged unwarned", async () => {
    fakeWebLocks();
    try {
      const { store: base, m } = sharedStore();
      // A readable earlier count: the marker check never needs to list storage,
      // so the first listing is always the count, whatever order sign-out runs in.
      m.set("flm.sheetsignout.v1", "3");
      let release = (): void => {};
      const gate = new Promise<void>((r) => (release = r));
      let hitResolve = (): void => {};
      const hit = new Promise<void>((r) => (hitResolve = r));
      let firstKeys = true;
      const store: KvStore = {
        ...base,
        keys: async () => {
          const snapshot = await base.keys(); // the count's view of the phone
          if (firstKeys) {
            firstKeys = false;
            hitResolve();
            await gate;
          }
          return snapshot;
        },
      };
      const tabA = await openTab();
      const tabB = await openTab();
      const asked: string[] = [];
      const signOut = tabA.clearSheetDataForSignOut(store, (msg) => (asked.push(msg), true));
      await hit; // the count has looked at an empty phone
      const late = await tabB.enqueueSheetEvent(base, "t1", "jobB", noteEvent("n-2", "typed during sign-out"));
      release();
      expect(await signOut).toBe(true);
      // Either the technician was warned about it or tab B was told it did not save; here it is refused.
      expect(late.saved).toBe(false);
      expect(asked).toEqual([]);
      expect(sheetText(m)).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Cancel of one in-progress sign-out leaves another in-progress sign-out blocking every tab", async () => {
    const { store } = sharedStore();
    const tabA = await openTab();
    const tabB = await openTab();
    const replayA = await replayInFlight(tabA, store, "jobA");
    const replayB = await replayInFlight(tabB, store, "jobB");
    const a = { signOut: tabA.clearSheetDataForSignOut(store, (msg) => msg !== SIGN_OUT_STILL_SENDING_PROMPT, undefined, 40), ...replayA };
    const b = { signOut: tabB.clearSheetDataForSignOut(store, () => true, undefined, 400), ...replayB };
    await new Promise((r) => setTimeout(r, 5));
    const opened = await openTab(); // loaded after both sign-outs began
    expect(await a.signOut).toBe(false); // A cancels while B is still in progress
    expect((await opened.enqueueSheetEvent(store, "t1", "jobD", noteEvent("n-4", "during B"))).saved).toBe(false);
    a.releaseA();
    b.releaseA();
    await Promise.all([a.drain, b.drain]);
    expect(await b.signOut).toBe(true);
  });

  it("a page opened while another tab's sign-out is in progress cannot save until it ends (Cancel)", async () => {
    const { store } = sharedStore();
    const tabA = await openTab();
    const a = await signOutWaitingOnReplay(tabA, store, (msg) => msg !== SIGN_OUT_STILL_SENDING_PROMPT);
    const opened = await openTab(); // loaded after A's sign-out began
    expect((await opened.enqueueSheetEvent(store, "t1", "jobD", noteEvent("n-4", "mid sign-out"))).saved).toBe(false);
    expect(await a.signOut).toBe(false); // A cancels
    a.releaseA();
    await a.drain;
    expect((await opened.enqueueSheetEvent(store, "t1", "jobD", noteEvent("n-5", "after cancel"))).saved).toBe(true);
  });

  it("a page opened while another tab's sign-out is in progress stays blocked after that sign-out finishes", async () => {
    const { store, m } = sharedStore();
    const tabA = await openTab();
    const a = await signOutWaitingOnReplay(tabA, store, () => true, 1000);
    await new Promise((r) => setTimeout(r, 2)); // a later millisecond than A's start
    const opened = await openTab(); // loaded after A's sign-out began
    expect((await opened.enqueueSheetEvent(store, "t1", "jobD", noteEvent("n-4", "mid sign-out"))).saved).toBe(false);
    a.releaseA();
    await a.drain;
    expect(await a.signOut).toBe(true);
    expect((await opened.enqueueSheetEvent(store, "t1", "jobD", noteEvent("n-5", "after sign-out"))).saved).toBe(false);
    expect(sheetText(m)).toBe("");
    await new Promise((r) => setTimeout(r, 2));
    const fresh = await openTab(); // a new session after the finish (control)
    expect((await fresh.enqueueSheetEvent(store, "t1", "jobE", noteEvent("n-6", "new session"))).saved).toBe(true);
  });

  it("a sign-out question left open past the time limit counts and asks again before clearing", async () => {
    const { store, m } = sharedStore();
    const tabA = await openTab();
    const tabB = await openTab();
    const asked: string[] = [];
    let unsyncedAnswers = 0;
    let markerDuringSecondWarning: string | undefined;
    const a = await signOutWaitingOnReplay(
      tabA,
      store,
      (msg) => {
        asked.push(msg);
        if (!msg.includes("not yet saved")) return true;
        if (++unsyncedAnswers === 1) return true; // OK the first warning
        markerDuringSecondWarning = m.get("flm.sheetsignout.v1");
        return false; // Cancel the second
      },
      1000,
    );
    const later = Date.now() + SIGN_OUT_PENDING_MAX_MS + 1000;
    const now = vi.spyOn(Date, "now").mockReturnValue(later); // the question stayed open past the limit
    try {
      const late = await tabB.enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "typed after the limit"));
      expect(late.saved).toBe(true); // precondition: the lapsed block let tab B save
      a.releaseA();
      await a.drain;
      expect(await a.signOut).toBe(false);
    } finally {
      now.mockRestore();
    }
    expect(asked.filter((msg) => msg.includes("not yet saved"))).toHaveLength(2);
    // While the second warning is open the block is renewed, so other tabs are held again.
    expect(Object.values(JSON.parse(markerDuringSecondWarning ?? "{}").pending ?? {})).toEqual([later]);
    expect(sheetText(m)).toContain("typed after the limit");
  });

  it("a question after the purge left open past the time limit sweeps and asks again before finishing", async () => {
    const { store: base, m } = sharedStore();
    const store: KvStore = { ...base, remove: async (k) => (k.includes("jobS") ? false : base.remove(k)) };
    const tabA = await openTab();
    const tabB = await openTab();
    await tabA.enqueueSheetEvent(store, "t1", "jobS", noteEvent("n-1", "stuck words"));
    await tabB.enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "typed during the question"));
    const [lateKey, lateValue] = [...m.entries()].find(([k]) => k.includes("jobB"))!;
    m.delete(lateKey);
    const asked: string[] = [];
    let now: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const signedOut = await tabA.clearSheetDataForSignOut(store, (msg) => {
        asked.push(msg);
        if (msg.startsWith("Could not clear")) {
          // The question stays open past the limit, and tab B saves meanwhile.
          now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + SIGN_OUT_PENDING_MAX_MS + 1000);
          m.set(lateKey, lateValue);
          return true;
        }
        return asked.filter((x) => x.includes("not yet saved")).length === 1; // OK the first warning, Cancel a second
      });
      expect(signedOut).toBe(false);
    } finally {
      now?.mockRestore();
    }
    expect(asked.filter((msg) => msg.includes("not yet saved"))).toHaveLength(2);
    expect(sheetText(m)).toContain("typed during the question");
  });

  it("an in-progress sign-out left by a closed tab stops blocking after the time limit (control)", async () => {
    const { store, m } = sharedStore();
    const stale = Date.now() - SIGN_OUT_PENDING_MAX_MS - 1000;
    m.set("flm.sheetsignout.v1", JSON.stringify({ done: null, pending: { gone: stale } }));
    const tab = await openTab();
    expect((await tab.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "saved"))).saved).toBe(true);
    const fresh = Date.now() - 1000;
    m.set("flm.sheetsignout.v1", JSON.stringify({ done: null, pending: { live: fresh } }));
    expect((await tab.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "blocked"))).saved).toBe(false);
  });

  it("Cancel on the first unsaved-items question lets every tab save again", async () => {
    const { store, m } = sharedStore();
    const tabA = await openTab();
    const tabB = await openTab();
    await tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "pending"));
    expect(await tabA.clearSheetDataForSignOut(store, () => false)).toBe(false);
    expect(m.has("flm.sheetsignout.v1")).toBe(false);
    expect((await tabB.enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "still works"))).saved).toBe(true);
    expect(sheetText(m)).toContain("pending");
  });

  it("a sign-out that cannot record its finish asks before going ahead", async () => {
    const { store: base } = sharedStore();
    let markerWrites = 0;
    const store: KvStore = { ...base, set: async (k, v) => (k === "flm.sheetsignout.v1" && ++markerWrites > 1 ? false : base.set(k, v)) };
    const tab = await openTab();
    const asked: string[] = [];
    expect(await tab.clearSheetDataForSignOut(store, (msg) => (asked.push(msg), false))).toBe(false);
    expect(asked).toEqual([SIGN_OUT_OTHER_TABS_PROMPT]);
  });

  /** A store whose finish write (a plain count) is saved, but whose next read
   *  of the marker fails, so the finish cannot be verified. Later reads work. */
  function finishSavedButUnverified(base: KvStore): KvStore {
    let failNextMarkerRead = false;
    return {
      ...base,
      set: async (k, v) => {
        const ok = await base.set(k, v);
        if (k === "flm.sheetsignout.v1" && !v.includes("pending")) failNextMarkerRead = true;
        return ok;
      },
      get: async (k) => {
        if (k === "flm.sheetsignout.v1" && failNextMarkerRead) {
          failNextMarkerRead = false;
          return null;
        }
        return base.get(k);
      },
    };
  }

  it("Cancel after a finish that saved but did not read back takes its count back, so every tab can save", async () => {
    const { store: base, m } = sharedStore();
    const store = finishSavedButUnverified(base);
    const tabA = await openTab();
    const tabB = await openTab();
    const asked: string[] = [];
    expect(await tabA.clearSheetDataForSignOut(store, (msg) => (asked.push(msg), false))).toBe(false);
    expect(asked).toEqual([SIGN_OUT_OTHER_TABS_PROMPT]);
    expect(m.has("flm.sheetsignout.v1")).toBe(false); // the count is back where it was
    expect((await tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "still signed in"))).saved).toBe(true);
    expect((await tabB.enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "other tab"))).saved).toBe(true);
  });

  it("that Cancel never lowers a count another sign-out raised meanwhile (control)", async () => {
    const { store: base, m } = sharedStore();
    const store = finishSavedButUnverified(base);
    const tabA = await openTab();
    const tabB = await openTab();
    const signedOut = await tabA.clearSheetDataForSignOut(store, () => {
      m.set("flm.sheetsignout.v1", "2"); // another tab finished its sign-out while the question was open
      return false;
    });
    expect(signedOut).toBe(false);
    expect(m.get("flm.sheetsignout.v1")).toBe("2");
    expect((await tabB.enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "after the other sign-out"))).saved).toBe(false);
  });

  it("a sign-out marker that cannot be read blocks every sheet write", async () => {
    const { store: base, m } = sharedStore();
    const tab = await openTab();
    let unreadable = true;
    const store: KvStore = {
      ...base,
      get: async (k) => {
        if (k === "flm.sheetsignout.v1" && unreadable) throw new Error("blocked");
        return base.get(k);
      },
    };
    m.set("flm.sheetsignout.v1", JSON.stringify({ gen: 0, pending: { live: Date.now() } }));
    expect((await tab.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "during sign-out"))).saved).toBe(false);
    m.delete("flm.sheetsignout.v1");
    unreadable = false;
    expect((await tab.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "readable again"))).saved).toBe(true); // control
    expect(sheetText(m)).not.toContain("during sign-out");
  });

  it("a sign-out marker that cannot be read is never rewritten from an empty read", async () => {
    const { store: base, m } = sharedStore();
    m.set("flm.sheetsignout.v1", "5");
    const tab = await openTab();
    const store: KvStore = {
      ...base,
      get: async (k) => {
        if (k === "flm.sheetsignout.v1") throw new Error("blocked");
        return base.get(k);
      },
    };
    expect(await tab.clearSheetDataForSignOut(store, (msg) => msg !== SIGN_OUT_OTHER_TABS_PROMPT)).toBe(false);
    expect(m.get("flm.sheetsignout.v1")).toBe("5");
  });

  it("each finished sign-out raises the stored count by one and never lowers it", async () => {
    const { store, m } = sharedStore();
    m.set("flm.sheetsignout.v1", "5");
    const tab = await openTab();
    expect(await tab.clearSheetDataForSignOut(store, () => true)).toBe(true);
    expect(m.get("flm.sheetsignout.v1")).toBe("6");
  });

  it("in one frozen millisecond: a tab opened after the finish can save, a tab opened before it cannot", async () => {
    const { store, m } = sharedStore();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000); // every clock read is the same instant
    try {
      const tabA = await openTab();
      const before = await openTab();
      expect(await tabA.clearSheetDataForSignOut(store, () => true)).toBe(true);
      const after = await openTab();
      expect((await after.enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "new session"))).saved).toBe(true);
      expect((await before.enqueueSheetEvent(store, "t1", "jobC", noteEvent("n-3", "old session"))).saved).toBe(false);
    } finally {
      now.mockRestore();
    }
    expect(sheetText(m)).toContain("new session");
    expect(sheetText(m)).not.toContain("old session");
  });

  it("in one frozen millisecond: a tab opened during a sign-out stays blocked after it finishes", async () => {
    const { store, m } = sharedStore();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    try {
      const tabA = await openTab();
      const a = await signOutWaitingOnReplay(tabA, store, () => true, 1000);
      const opened = await openTab(); // loaded mid-sign-out, same millisecond as the finish
      a.releaseA();
      await a.drain;
      expect(await a.signOut).toBe(true);
      expect((await opened.enqueueSheetEvent(store, "t1", "jobD", noteEvent("n-4", "mid sign-out"))).saved).toBe(false);
    } finally {
      now.mockRestore();
    }
    expect(sheetText(m)).toBe("");
  });

  it("a tab opened after the sign-out can save (control)", async () => {
    const { store, m } = sharedStore();
    const tabB = await openTab();
    expect(await tabB.clearSheetDataForSignOut(store, () => true)).toBe(true);
    await new Promise((r) => setTimeout(r, 2));
    const fresh = await openTab();
    expect((await fresh.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "new session"))).saved).toBe(true);
    expect(sheetText(m)).toContain("new session");
  });

  it("Cancel puts the earlier sign-out marker back, so other tabs can save again", async () => {
    const { store, m } = sharedStore();
    m.set("flm.sheetsignout.v1", "1");
    const tabA = await openTab();
    const tabB = await openTab();
    await tabA.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "pending"));
    expect(await tabB.clearSheetDataForSignOut(store, () => false)).toBe(false); // Cancel on the unsynced prompt: nothing changes
    expect(m.get("flm.sheetsignout.v1")).toBe("1");
    m.set("flm.sheetrej.v1.x", "keep"); // a key the purge cannot remove keeps the left-behind prompt up
    const sticky: KvStore = { ...store, remove: async (k) => (k === "flm.sheetrej.v1.x" ? false : (m.delete(k), true)) };
    const asked: string[] = [];
    expect(await tabB.clearSheetDataForSignOut(sticky, (msg) => (asked.push(msg), asked.length === 1))).toBe(false);
    expect(m.get("flm.sheetsignout.v1")).toBe("1");
    expect((await tabA.enqueueSheetEvent(store, "t1", "jobB", noteEvent("n-2", "after cancel"))).saved).toBe(true);
  });

  // #5292: a marker that reads back as something this client never writes
  // blocks every write and is never read as "no sign-out".
  const MALFORMED_MARKERS = [
    "{", "false", "true", "null", "[1]", "1e400", "-1", "2.5",
    '{"gen":"5"}', '{"gen":-1}', '{"gen":1.5}', '{"gen":null}',
    '{"pending":[1]}', '{"pending":null}', '{"pending":{"other-tab":"soon"}}',
    '{"gen":5,"epoch":5}', '{"gen":5,"epoch":""}', '{"gen":5,"epoch":null}',
    // #5308: an object with no count is not a marker this client writes.
    '{"epoch":"e-1","pending":{}}', '{"pending":{}}', "{}",
    '{"done":"5","pending":{}}', '{"done":-1,"pending":{}}',
  ];
  it.each(MALFORMED_MARKERS)("#5292: a stored marker %s blocks a valid note and is left as it was", async (raw) => {
    const { store, m } = sharedStore();
    m.set("flm.sheetsignout.v1", raw);
    const tab = await openTab();
    expect((await tab.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "while corrupt"))).saved).toBe(false);
    expect(m.get("flm.sheetsignout.v1")).toBe(raw);
    expect(sheetText(m)).toBe("");
  });

  it.each([
    ["absent", null],
    ["a legacy count", "5"],
    ["a structured marker with no live sign-out", '{"gen":5,"pending":{}}'],
    ["a repaired marker with an epoch", '{"gen":5,"pending":{},"epoch":"e-1"}'],
    ["an older structured marker without a count", JSON.stringify({ done: null, pending: { gone: Date.now() - 2 * SIGN_OUT_PENDING_MAX_MS } })],
  ])("#5292 control: %s lets a tab loaded after it save", async (_label, raw) => {
    const { store, m } = sharedStore();
    if (raw !== null) m.set("flm.sheetsignout.v1", raw);
    const tab = await openTab();
    expect((await tab.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "normal note"))).saved).toBe(true);
    expect(sheetText(m)).toContain("normal note");
  });

  // Codex #5297 r1: starting a sign-out now repairs the marker so its own
  // barrier is recorded; Cancel leaves the repaired marker, never the old one.
  it("#5292: Cancel after a corrupt marker keeps every earlier tab blocked and never warns that other tabs can still save", async () => {
    const { store, m } = sharedStore();
    const tab = await openTab();
    expect((await tab.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "unsynced"))).saved).toBe(true);
    m.set("flm.sheetsignout.v1", "{");
    const loadedWhileCorrupt = await openTab();
    const asked: string[] = [];
    expect(await tab.clearSheetDataForSignOut(store, (msg) => (asked.push(msg), false))).toBe(false);
    expect(asked).not.toContain(SIGN_OUT_OTHER_TABS_PROMPT);
    expect(asked).toHaveLength(1); // only the unsynced-work question
    expect(sheetText(m)).toContain("unsynced");
    expect((await tab.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "earlier tab"))).saved).toBe(false);
    expect((await loadedWhileCorrupt.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-3", "corrupt-time tab"))).saved).toBe(false);
    const fresh = await openTab();
    expect((await fresh.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-4", "fresh tab"))).saved).toBe(true);
  });

  it("#5292: a tab opened while the marker was corrupt stays blocked even if something else later clears it", async () => {
    const { store, m } = sharedStore();
    m.set("flm.sheetsignout.v1", "{");
    const loadedWhileCorrupt = await openTab();
    m.delete("flm.sheetsignout.v1"); // e.g. an older page or a storage cleanup, not this client's repair
    expect((await loadedWhileCorrupt.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "missed sign-outs"))).saved).toBe(false);
    const fresh = await openTab();
    expect((await fresh.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "fresh tab"))).saved).toBe(true);
    expect(sheetText(m)).not.toContain("missed sign-outs");
  });

  it("#5292: a finished sign-out repairs a corrupt marker so every tab loaded before it stays blocked", async () => {
    const { store, m } = sharedStore();
    m.set("flm.sheetsignout.v1", "7");
    const loadedAt7 = await openTab();
    m.set("flm.sheetsignout.v1", "{");
    const loadedWhileCorrupt = await openTab();
    const signer = await openTab();
    const asked: string[] = [];
    expect(await signer.clearSheetDataForSignOut(store, (msg) => (asked.push(msg), true))).toBe(true);
    expect(asked).not.toContain(SIGN_OUT_OTHER_TABS_PROMPT);
    const repaired = JSON.parse(m.get("flm.sheetsignout.v1") ?? "null") as { gen: number; epoch: string };
    expect(typeof repaired.epoch === "string" && repaired.epoch.length > 0).toBe(true);
    expect(Number.isSafeInteger(repaired.gen) && repaired.gen > 7).toBe(true);
    expect((await loadedAt7.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "old session A"))).saved).toBe(false);
    expect((await loadedWhileCorrupt.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "old session B"))).saved).toBe(false);
    await new Promise((r) => setTimeout(r, 2));
    const fresh = await openTab();
    expect((await fresh.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-3", "new session"))).saved).toBe(true);
    expect(sheetText(m)).toContain("new session");
    expect(sheetText(m)).not.toContain("old session");
  });

  /** A store over `base` whose first `keys()` (the sign-out count) returns its
   *  snapshot only after `release()`: the sign-out is paused after counting. */
  function pausedAfterCount(base: KvStore) {
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    let counted = (): void => {};
    const atCount = new Promise<void>((r) => (counted = r));
    let first = true;
    const store: KvStore = {
      ...base,
      keys: async () => {
        const snapshot = await base.keys();
        if (first) {
          first = false;
          counted();
          await gate;
        }
        return snapshot;
      },
    };
    return { store, atCount, release };
  }

  it("Codex #5297 r1 F1: a second sign-out's repair never lets a new tab save while the first is still signing out", async () => {
    fakeWebLocks();
    const { store, m } = sharedStore();
    m.set("flm.sheetsignout.v1", "{");
    const tabA = await openTab();
    const tabB = await openTab();
    const paused = pausedAfterCount(store);
    const asked: string[] = [];
    const signOutA = tabA.clearSheetDataForSignOut(paused.store, (msg) => (asked.push(msg), true));
    await paused.atCount;
    expect(await tabB.clearSheetDataForSignOut(store, () => true)).toBe(true);
    await new Promise((r) => setTimeout(r, 2));
    const tabC = await openTab();
    const saved = (await tabC.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-c", "tab C words"))).saved;
    paused.release();
    await signOutA;
    // Either C could not save while A was signing out, or A asked before deleting it.
    expect(saved === false || asked.some((q) => q.includes("1"))).toBe(true);
    expect(saved).toBe(false);
  });

  it("Codex #5297 r1 F1: a sign-out whose own barrier was lost counts and asks again before purging", async () => {
    fakeWebLocks();
    const { store, m } = sharedStore();
    m.set("flm.sheetsignout.v1", "3"); // present, so the first keys() call is B's count
    const tabB = await openTab();
    const paused = pausedAfterCount(store);
    const asked: string[] = [];
    const signOutB = tabB.clearSheetDataForSignOut(paused.store, (msg) => (asked.push(msg), false));
    await paused.atCount; // B's barrier is in the marker and nothing was unsynced
    m.set("flm.sheetsignout.v1", "{"); // the marker is damaged, losing B's barrier
    m.set(sheetQueueKey("t9", "jobZ"), JSON.stringify([{ event: noteEvent("n-z", "seed"), queuedAt: "2026-11-08T00:00:00.000Z", attempts: 0 }]));
    const tabA = await openTab(); // A has something to ask about, so it can cancel
    expect(await tabA.clearSheetDataForSignOut(store, () => false)).toBe(false); // A repairs, then cancels
    await new Promise((r) => setTimeout(r, 2));
    const tabC = await openTab();
    expect((await tabC.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-c", "tab C words"))).saved).toBe(true);
    paused.release();
    expect(await signOutB).toBe(false); // B counted C's note again and the technician kept it
    expect(asked).toHaveLength(1);
    expect(sheetText(m)).toContain("tab C words");
  });

  for (const clock of ["moved back a minute", "frozen in one millisecond"] as const) {
    it(`Codex #5297 r1 F2: a second repair still ends a session loaded after the first (clock ${clock})`, async () => {
      const { store, m } = sharedStore();
      const t0 = Date.now();
      const now = vi.spyOn(Date, "now").mockReturnValue(t0);
      try {
        m.set("flm.sheetsignout.v1", "{");
        const signer = await openTab();
        expect(await signer.clearSheetDataForSignOut(store, () => true)).toBe(true);
        const loadedAfterFirst = await openTab();
        m.set("flm.sheetsignout.v1", "{");
        if (clock === "moved back a minute") now.mockReturnValue(t0 - 60_000);
        const signer2 = await openTab();
        expect(await signer2.clearSheetDataForSignOut(store, () => true)).toBe(true);
        expect((await loadedAfterFirst.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-1", "old session"))).saved).toBe(false);
        const fresh = await openTab();
        expect((await fresh.enqueueSheetEvent(store, "t1", "jobA", noteEvent("n-2", "new session"))).saved).toBe(true);
        expect(sheetText(m)).not.toContain("old session");
      } finally {
        now.mockRestore();
      }
    });
  }
});

// Codex #5276 round 5 LOW: valid JSON with a malformed event must load as
// nothing, never reach the panel's renderers.
describe("#5212 malformed stored records", () => {
  it("rejection and queue records without a renderable event are dropped on load", async () => {
    const store = memoryStore();
    const good = { event: noteEvent("n-ok", "fine"), message: "job_finished", rejectedAt: "2026-11-07T00:00:00.000Z" };
    const bad = [
      { event: { clientEventId: "no-payload", kind: "note_added" }, message: "job_finished" },
      { event: { clientEventId: "null-payload", kind: "note_added", payload: null }, message: "job_finished" },
      { event: { clientEventId: "no-kind", payload: { text: "x" } }, message: "job_finished" },
      { event: noteEvent("bad-message", "x"), message: 42 },
    ];
    await store.set(rejectedSheetKey("t1", "nb-1", "jobA"), JSON.stringify([...bad, good]));
    expect((await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).map((r) => r.event.clientEventId)).toEqual(["n-ok"]);
    const queued = [
      { event: { clientEventId: "q-no-payload", kind: "note_added" }, queuedAt: "2026-11-07T00:00:00.000Z", attempts: 0 },
      { event: noteEvent("q-ok", "fine"), queuedAt: "2026-11-07T00:00:00.000Z", attempts: 0 },
    ];
    await store.set(sheetQueueKey("t1", "jobA"), JSON.stringify(queued));
    expect((await loadSheetQueue(store, "t1", "jobA")).map((q) => q.event.clientEventId)).toEqual(["q-ok"]);
  });

  // Codex #5276 r6: one well-formed payload per event kind the client can write.
  const VALID_PAYLOADS: Record<string, Record<string, unknown>> = {
    step_marked: { stepId: "s1", done: true, note: null },
    reading_recorded: { readingId: "00000000-0000-4000-9000-000000000001", what: "Motor amps", value: 4.2, unit: "A", source: { kind: "tech", ref: null } },
    reading_corrected: { readingId: "00000000-0000-4000-9000-000000000001", value: 4.4, unit: "A", reason: null, source: { kind: "manual", ref: "p12" } },
    note_added: { noteId: "00000000-0000-4000-9000-000000000002", text: "words", noteKind: "note" },
    question_resolved: { noteId: "00000000-0000-4000-9000-000000000002", resolution: "answered" },
    part_logged: { partEntryId: "00000000-0000-4000-9000-000000000003", item: "belt", action: "replaced", qty: 1 },
    photo_attached: { photoId: "00000000-0000-4000-9000-000000000004", fileId: "00000000-0000-4000-9000-000000000005", caption: null },
    handover_written: { text: "handover words" },
    job_finished: { summary: null, openItemsAcknowledged: true },
  };
  const storedEvent = (i: number, kind: string, payload: unknown) => ({
    clientEventId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    baseSeq: 1,
    kind,
    payload,
    occurredAt: "2026-11-07T00:00:00.000Z",
    workOrderId: null,
  });
  async function keptAfterLoad(events: unknown[]): Promise<string[]> {
    const store = memoryStore();
    const records = events.map((event) => ({ event, message: "job_finished", rejectedAt: "2026-11-07T00:00:00.000Z" }));
    await store.set(rejectedSheetKey("t1", "nb-1", "jobA"), JSON.stringify(records));
    const queued = events.map((event) => ({ event, queuedAt: "2026-11-07T00:00:00.000Z", attempts: 0 }));
    await store.set(sheetQueueKey("t1", "jobA"), JSON.stringify(queued));
    const rejected = (await loadRejectedSheetEvents(store, "t1", "nb-1", "jobA")).map((r) => r.event.clientEventId);
    expect((await loadSheetQueue(store, "t1", "jobA")).map((q) => q.event.clientEventId)).toEqual(rejected);
    return rejected;
  }

  it("a well-formed stored event of every kind is kept (control: the server accepts each one too)", async () => {
    const events = Object.entries(VALID_PAYLOADS).map(([kind, payload], i) => storedEvent(i, kind, payload));
    const olderCorrection = { ...VALID_PAYLOADS.reading_corrected }; // recorded before R2-14 added `source`
    delete olderCorrection.source;
    events.push(storedEvent(events.length, "reading_corrected", olderCorrection));
    for (const e of events) expect(validateAppendEventInput(e, { now: new Date("2026-11-08T00:00:00Z") }).ok).toBe(true);
    expect(await keptAfterLoad(events)).toEqual(events.map((e) => e.clientEventId));
  });

  it("a stored event with any wrongly typed payload field, or an unknown kind, is dropped on load", async () => {
    const bad: unknown[] = [];
    let i = 0;
    for (const [kind, payload] of Object.entries(VALID_PAYLOADS)) {
      for (const field of Object.keys(payload)) {
        bad.push(storedEvent(i++, kind, { ...payload, [field]: { not: "renderable" } }));
        // reading_corrected.source is optional (older events lack it), so only its wrong type is bad.
        const optional = kind === "reading_corrected" && field === "source";
        if (payload[field] !== null && !optional) bad.push(storedEvent(i++, kind, { ...payload, [field]: undefined }));
      }
    }
    bad.push(storedEvent(i++, "job_started", { title: "x" }));
    bad.push(storedEvent(i++, "toString", {}));
    bad.push(storedEvent(i++, "note_added", { ...VALID_PAYLOADS.note_added, noteKind: "shout" }));
    bad.push(storedEvent(i++, "part_logged", { ...VALID_PAYLOADS.part_logged, action: "stolen" }));
    expect(bad.length).toBeGreaterThan(40);
    expect(await keptAfterLoad(bad)).toEqual([]);
  });
});

