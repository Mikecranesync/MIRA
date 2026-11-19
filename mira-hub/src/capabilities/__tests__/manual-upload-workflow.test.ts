import { beforeEach, describe, expect, it, vi } from "vitest";
const verification = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workflow", async (original) => ({ ...await original<typeof import("@/lib/workflow")>(), queryWorkflowObservation: verification }));
import { observeManualUpload } from "../manual-upload-workflow";
import type { FinalizeInput, WorkflowStore } from "@/lib/workflow";

const tenantId = "b1000000-0000-4000-8000-000000000001";
const fileId = "b2000000-0000-4000-8000-000000000001";
const docId = "b3000000-0000-4000-8000-000000000001";
function sink() {
  const finals: FinalizeInput[] = []; const progress: FinalizeInput[] = [];
  return { finals, progress, create: async (r: { runId: string }) => ({ runId: r.runId, alreadySucceeded: false, retryCount: 0 }),
    finalize: async (r: FinalizeInput) => { finals.push(r); }, checkpoint: async (r: FinalizeInput) => { progress.push(r); } };
}
const input = (signal = new AbortController().signal) => ({ tenantId, fileId, sha256: "b".repeat(64), signal });
const latest = (s: ReturnType<typeof sink>) => JSON.parse(s.finals.at(-1)!.output!).workflow;
beforeEach(() => { verification.mockReset(); verification.mockResolvedValue({ rows: [{ status: "parsed", total: 3, anchored: 2 }] }); });

describe("manual upload observation adapter", () => {
  it.each(["missing", "empty", "unanchored", "failed", "cancelled", "read_error"])("cannot certify a replay from %s index evidence", async (condition) => {
    const s = sink();
    if (condition === "read_error") verification.mockRejectedValue(new Error("private query failure"));
    else verification.mockResolvedValue({ rows: condition === "missing" ? [] : [{
      status: ["failed", "cancelled"].includes(condition) ? condition : "parsed",
      total: condition === "empty" ? 0 : 3, anchored: ["empty", "unanchored"].includes(condition) ? 0 : 2,
    }] });
    const response = Response.json({ indexed: true, duplicate: true, uploadId: docId });
    const body = vi.fn(async () => response);
    expect(await observeManualUpload(input(), body, s)).toBe(response); expect(body).toHaveBeenCalledOnce();
    expect(latest(s).state).not.toBe("succeeded"); expect(latest(s).stage).not.toBe("indexed");
    expect(latest(s).retry.eligible).toBe(false); expect(latest(s).recovery.action).toBe("none");
    expect(JSON.stringify(s.finals)).not.toContain("private");
    expect(verification.mock.calls[0][1]).toEqual([tenantId, docId, fileId]);
  });
  it("does not replace an authoritative response when its headers are immutable", async () => {
    const response = Response.error(); const body = vi.fn(async () => response);
    expect(await observeManualUpload(input(), body, sink())).toBe(response); expect(body).toHaveBeenCalledOnce();
  });
  it.each([[201, false], [200, true]])("preserves a %s indexed response and domain replay result", async (status, duplicate) => {
    const s = sink(); let calls = 0;
    const response = Response.json({ ok: true, indexed: true, uploadId: docId, fileId, duplicate, filename: "private.pdf" }, { status });
    const result = await observeManualUpload(input(), async () => { calls++; return response; }, s);
    expect(result).toBe(response); expect(calls).toBe(1);
    expect(latest(s).state).toBe("succeeded");
    expect(latest(s).definition).toEqual({ name: "manual_upload", version: "1.0.5" });
    expect(latest(s).evidence).toContainEqual({ kind: "document", id: docId });
    expect(JSON.stringify([...s.finals, ...s.progress])).not.toContain("private.pdf");
    expect(result.headers.get("X-Mira-Workflow-Run-Id")).toBe(latest(s).identity.attemptId);
  });
  it("records another claimant as waiting and never labels 202 indexing successful", async () => {
    const s = sink();
    await observeManualUpload(input(), async () => Response.json({ ok: true, indexed: false, indexing: true, fileId }, { status: 202 }), s);
    expect(latest(s).state).toBe("waiting"); expect(s.finals[0].status).toBe("running");
  });
  it("retains an opaque indexing failure without assuming which recovery is safe", async () => {
    const s = sink();
    await observeManualUpload(input(), async () => Response.json({ ok: true, indexed: false, warning: "private exception", fileId }, { status: 201 }), s);
    expect(latest(s).state).toBe("failed"); expect(latest(s).recovery.action).toBe("none");
    expect(latest(s).retry.eligible).toBe(false);
    expect(JSON.stringify(s.finals)).not.toContain("private exception");
  });
  it("a stop during extraction records cancelled waiting while preserving accepted results", async () => {
    const s = sink(); const abort = new AbortController();
    await observeManualUpload(input(abort.signal), async () => {
      abort.abort(); await Promise.resolve();
      return Response.json({ ok: true, indexed: true, uploadId: docId, fileId });
    }, s);
    expect(s.progress.some((r) => JSON.parse(r.output!).workflow.cancellation.requested)).toBe(true);
    expect(latest(s)).toMatchObject({ state: "succeeded", cancellation: { requested: true, scope: "client_wait", acknowledged: false } });
  });
  it("retains a cancellation already requested before recorder creation", async () => {
    const s = sink(); const abort = new AbortController(); abort.abort();
    let calls = 0;
    await observeManualUpload(input(abort.signal), async () => { calls++; return Response.json({ indexed: true, uploadId: docId }); }, s);
    expect(calls).toBe(1);
    expect(latest(s)).toMatchObject({ state: "succeeded", cancellation: { requested: true, scope: "client_wait", acknowledged: false } });
  });
  it.each(["resolves", "rejects"])("records an abort while recorder creation is pending and then %s", async (outcome) => {
    const s = sink(); const abort = new AbortController();
    let release!: () => void;
    const response = Response.json({ indexed: true, uploadId: docId });
    const operation = vi.fn(async () => response);
    const store: WorkflowStore = { ...s, create: (r) => new Promise((resolve, reject) => {
      release = () => outcome === "resolves"
        ? resolve({ runId: r.runId, alreadySucceeded: false, retryCount: 0 })
        : reject(new Error("declared recorder failure"));
    }) };
    const pending = observeManualUpload(input(abort.signal), operation, store);
    abort.abort(); release();
    expect(await pending).toBe(response);
    expect(operation).toHaveBeenCalledTimes(1);
    if (outcome === "resolves") {
      expect(latest(s).cancellation).toEqual({ requested: true, scope: "client_wait", acknowledged: false });
    } else {
      // No durable observation can be asserted when row creation failed.
      expect(s.finals).toHaveLength(0); expect(s.progress).toHaveLength(0);
    }
  });
  it("retains the stop when metadata creation times out and later completes", async () => {
    vi.useFakeTimers();
    try {
      const s = sink(); const abort = new AbortController(); let release!: () => void;
      const store: WorkflowStore = { ...s, create: (r) => new Promise((resolve) => {
        release = () => resolve({ runId: r.runId, alreadySucceeded: false, retryCount: 0 });
      }) };
      const operation = vi.fn(async () => Response.json({ indexed: true, uploadId: docId }));
      const pending = observeManualUpload(input(abort.signal), operation, store);
      abort.abort(); await vi.advanceTimersByTimeAsync(2000); await pending;
      expect(operation).toHaveBeenCalledTimes(1);
      expect(s.finals).toHaveLength(0);
      release(); await vi.advanceTimersByTimeAsync(1);
      expect(latest(s)).toMatchObject({ state: "succeeded", cancellation: { requested: true, scope: "client_wait", acknowledged: false } });
    } finally { vi.useRealTimers(); }
  });
  it("removes the stop listener once the domain operation finishes", async () => {
    const s = sink(); const abort = new AbortController();
    await observeManualUpload(input(abort.signal), async () => Response.json({ indexed: true, uploadId: docId }), s);
    const count = s.progress.length;
    abort.abort(); await Promise.resolve();
    expect(s.progress).toHaveLength(count);
    expect(latest(s).cancellation.requested).toBe(false);
  });
  it("recorder failure never retries, discards, or changes an accepted domain response", async () => {
    let calls = 0; const unavailable: WorkflowStore = { create: async () => { throw new Error("down"); }, finalize: async () => { throw new Error("down"); } };
    const response = Response.json({ indexed: true, uploadId: docId });
    expect(await observeManualUpload(input(), async () => { calls++; return response; }, unavailable)).toBe(response);
    expect(calls).toBe(1);
  });
});
