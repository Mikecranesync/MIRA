import { describe, expect, it } from "vitest";
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

describe("manual upload observation adapter", () => {
  it.each([[201, false], [200, true]])("preserves a %s indexed response and domain replay result", async (status, duplicate) => {
    const s = sink(); let calls = 0;
    const response = Response.json({ ok: true, indexed: true, uploadId: docId, fileId, duplicate, filename: "private.pdf" }, { status });
    const result = await observeManualUpload(input(), async () => { calls++; return response; }, s);
    expect(result).toBe(response); expect(calls).toBe(1);
    expect(latest(s).state).toBe("succeeded");
    expect(latest(s).evidence).toContainEqual({ kind: "document", id: docId });
    expect(JSON.stringify([...s.finals, ...s.progress])).not.toContain("private.pdf");
    expect(result.headers.get("X-Mira-Workflow-Run-Id")).toBe(latest(s).identity.attemptId);
  });
  it("records another claimant as waiting and never labels 202 indexing successful", async () => {
    const s = sink();
    await observeManualUpload(input(), async () => Response.json({ ok: true, indexed: false, indexing: true, fileId }, { status: 202 }), s);
    expect(latest(s).state).toBe("waiting"); expect(s.finals[0].status).toBe("running");
  });
  it("kept bytes plus extraction failure expose a domain-owned retry", async () => {
    const s = sink();
    await observeManualUpload(input(), async () => Response.json({ ok: true, indexed: false, warning: "private exception", fileId }, { status: 201 }), s);
    expect(latest(s).state).toBe("failed"); expect(latest(s).recovery.action).toBe("upload_again");
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
  it("recorder failure never retries, discards, or changes an accepted domain response", async () => {
    let calls = 0; const unavailable: WorkflowStore = { create: async () => { throw new Error("down"); }, finalize: async () => { throw new Error("down"); } };
    const response = Response.json({ indexed: true, uploadId: docId });
    expect(await observeManualUpload(input(), async () => { calls++; return response; }, unavailable)).toBe(response);
    expect(calls).toBe(1);
  });
});
