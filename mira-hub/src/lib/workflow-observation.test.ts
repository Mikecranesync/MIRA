import { describe, expect, it, vi } from "vitest";
import { WorkflowRun, runWorkflow, type WorkflowStore, type FinalizeInput } from "./workflow";
import { observation } from "./__tests__/workflow-fixture";

const quiet = { info() {}, warn() {}, error() {} };
function store() {
  const writes: FinalizeInput[] = [];
  const checkpoints: unknown[] = [];
  return {
    writes, checkpoints,
    create: async (row: { runId: string; retryCount: number }) => ({ runId: row.runId, alreadySucceeded: false, retryCount: row.retryCount }),
    finalize: async (value: FinalizeInput) => { writes.push(value); },
    checkpoint: async (value: unknown) => { checkpoints.push(value); },
  };
}

describe("WorkflowRun observations", () => {
  it("late metadata creation is finalized from the already completed domain result", async () => {
    vi.useFakeTimers();
    try {
      const sink = store(); let resolve!: (r: { runId: string; alreadySucceeded: boolean; retryCount: number }) => void;
      const obs = observation();
      sink.create = () => new Promise((r) => { resolve = r; });
      const work = runWorkflow({ workflowName: "manual_upload", observation: obs, observationTimeoutMs: 5, store: sink, logger: quiet }, async () => "accepted");
      await vi.advanceTimersByTimeAsync(100); expect(await work).toBe("accepted");
      resolve({ runId: obs.identity.attemptId, alreadySucceeded: false, retryCount: 0 });
      await vi.advanceTimersByTimeAsync(1);
      expect(sink.writes).toHaveLength(1); expect(sink.writes[0].status).toBe("ok");
    } finally { vi.useRealTimers(); }
  });
  it("contract steps retain partial failure without storing arbitrary artifacts", async () => {
    const sink = store();
    await runWorkflow({ workflowName: "manual_upload", observation: observation(), store: sink, logger: quiet }, async (run) => {
      run.recordStep("private question", "failed", { artifact: { text: "private source text" }, error: "private SQL" });
    });
    expect(sink.writes[0].status).toBe("degraded");
    expect(JSON.stringify(sink.writes)).not.toContain("private");
  });
  it("finalizes a timed-out INSERT that settles while domain work is still running", async () => {
    vi.useFakeTimers();
    try {
      const sink = store(); const obs = observation();
      let created!: (r: { runId: string; alreadySucceeded: boolean; retryCount: number }) => void;
      let complete!: () => void;
      sink.create = () => new Promise((r) => { created = r; });
      const domain = new Promise<void>((r) => { complete = r; });
      const work = runWorkflow({ workflowName: "manual_upload", observation: obs, observationTimeoutMs: 5, store: sink, logger: quiet }, async () => { await domain; return "accepted"; });
      await vi.advanceTimersByTimeAsync(100);
      created({ runId: obs.identity.attemptId, alreadySucceeded: false, retryCount: 0 });
      await vi.advanceTimersByTimeAsync(1);
      complete();
      expect(await work).toBe("accepted");
      expect(sink.writes).toHaveLength(1);
      expect(sink.writes[0].status).toBe("ok");
    } finally { vi.useRealTimers(); }
  });
  it("does not log private step labels or exceptions in observation mode", async () => {
    const warn = vi.fn();
    await runWorkflow({ workflowName: "manual_upload", observation: observation(), store: store(), logger: { ...quiet, warn } }, async (run) => {
      await run.step("private document name.pdf", () => { throw new Error("private SQL value"); }, { tolerate: true });
    });
    expect(warn.mock.calls.flat().join(" ")).not.toContain("private");
  });
  it("keeps a tolerated failure partial even when the caller marks its accepted result successful", async () => {
    const sink = store();
    const result = await runWorkflow({ workflowName: "manual_upload", observation: observation(), store: sink, logger: quiet }, async (run) => {
      await run.step("optional_stage", () => { throw new Error("declared fault"); }, { tolerate: true });
      run.setObservation({ ...observation(), state: "succeeded", recovery: { authority: "workspace_files", action: "none" } });
      return "accepted";
    });
    expect(result).toBe("accepted");
    expect(sink.writes[0].status).toBe("degraded");
    expect(JSON.parse(sink.writes[0].output!).workflow.state).toBe("partial");
  });
  it("a hung observation store cannot hold the domain operation indefinitely", async () => {
    vi.useFakeTimers();
    try {
      let accepted = false;
      const sink: WorkflowStore = { create: () => new Promise(() => {}), finalize: async () => {} };
      const work = runWorkflow({ workflowName: "manual_upload", observation: observation(), observationTimeoutMs: 5, store: sink, logger: quiet }, async () => { accepted = true; });
      await vi.advanceTimersByTimeAsync(100);
      expect(accepted).toBe(true);
      await work;
    } finally { vi.useRealTimers(); }
  });
  it("persists progress before a final failure without recording the private exception", async () => {
    const sink = store();
    await expect(runWorkflow({ workflowName: "manual_upload", observation: observation(), store: sink, logger: quiet }, async (run) => {
      await run.checkpoint(observation());
      throw new Error("private SQL / token / document text");
    })).rejects.toThrow("private SQL");
    expect(sink.checkpoints).toHaveLength(1);
    expect(sink.writes[0].status).toBe("failed");
    expect(JSON.stringify(sink.writes)).not.toContain("private SQL");
    expect(JSON.parse(sink.writes[0].output!).workflow.failure.code).toBe("operation_failed");
  });
  it("observation errors fail open without executing the domain body again", async () => {
    let executions = 0;
    const sink: WorkflowStore = { create: async () => { throw new Error("sink down"); }, finalize: async () => { throw new Error("sink down"); } };
    const result = await runWorkflow({ workflowName: "manual_upload", observation: observation(), store: sink, logger: quiet }, async (run) => {
      executions++;
      await run.checkpoint(observation());
      return "accepted";
    });
    expect(result).toBe("accepted");
    expect(executions).toBe(1);
  });
  it("waiting for another domain claimant is visible as running, not success", async () => {
    const sink = store();
    await runWorkflow({ workflowName: "manual_upload", observation: observation(), store: sink, logger: quiet }, async (run) => {
      run.setObservation({ ...observation(), state: "waiting" });
    });
    expect(sink.writes[0].status).toBe("running");
    expect(JSON.parse(sink.writes[0].output!).workflow.state).toBe("waiting");
  });
  it("serializes cancellation checkpoints ahead of finalization", async () => {
    const sink = store();
    const order: string[] = [];
    sink.checkpoint = async () => { await new Promise((r) => setTimeout(r, 5)); order.push("checkpoint"); };
    sink.finalize = async (value) => { order.push("final"); sink.writes.push(value); };
    await runWorkflow({ workflowName: "manual_upload", observation: observation(), store: sink, logger: quiet }, async (run) => {
      void run.checkpoint({ ...observation(), cancellation: { requested: true, scope: "client_wait", acknowledged: false } });
      run.setObservation({ ...observation(), state: "succeeded", recovery: { authority: "workspace_files", action: "none" }, cancellation: { requested: true, scope: "client_wait", acknowledged: false } });
    });
    expect(order).toEqual(["checkpoint", "final"]);
    expect(sink.writes[0].status).toBe("ok");
  });
  it("rejects cross-operation observations before they can reach the sink", async () => {
    const sink = store();
    const run = new WorkflowRun({ workflowName: "manual_upload", observation: observation(), store: sink, logger: quiet });
    expect(() => run.setObservation({ ...observation(), identity: { ...observation().identity, tenantId: "b1000000-0000-4000-8000-000000000001" } })).toThrow();
    expect(sink.checkpoints).toHaveLength(0);
  });
});
