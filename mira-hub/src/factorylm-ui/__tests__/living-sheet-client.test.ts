/**
 * Red-first unit tests for the Living Work Sheet phone client (TASK-S3).
 * Pure queue/badge/parser logic only — no fetch, no DOM (vitest environment
 * is "node", no jsdom). An injected in-memory KvStore stands in for
 * localStorage so these tests never touch the real browser storage API.
 */
import { describe, expect, it, vi } from "vitest";
import {
  chosenRevisionOf,
  drainSheetQueue,
  dropHeadOfSheetQueue,
  enqueueSheetEvent,
  loadSheetQueue,
  lowRiskProposalIds,
  parseSheetReceipts,
  purgeSheetQueues,
  saveBadge,
  sheetQueueKey,
  startJobErrorMessage,
  type JobSheetRevision,
  type JobSheetSummary,
  type KvStore,
  type SheetEventPost,
  type SheetSubmitOutcome,
} from "../living-sheet-client";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";
import type { NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";

function memoryStore(): KvStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
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

describe("drainSheetQueue", () => {
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
    expect(result).toEqual({ sent: 2, droppedRejected: 0, remaining: 0, conflict: false, networkStopped: false });
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
    expect(result).toEqual({ sent: 1, droppedRejected: 1, remaining: 0, conflict: false, networkStopped: false });
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
    const removed = await purgeSheetQueues(store);
    expect(removed).toBe(2);
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
