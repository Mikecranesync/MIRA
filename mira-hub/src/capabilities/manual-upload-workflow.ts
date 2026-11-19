/** Opt-in visibility around the existing upload handler; owns no claim, parse or retry. */
import { randomUUID } from "node:crypto";
import { runWorkflow, type WorkflowStore } from "@/lib/workflow";
import { WORKFLOW_CONTRACT, WORKFLOW_UUID, type WorkflowObservation } from "@/lib/workflow-contract";
import { WORKFLOW_VERSIONS } from "@/lib/workflow-versions";

export async function observeManualUpload(
  input: { tenantId: string; fileId: string; sha256: string; signal: AbortSignal },
  operation: () => Promise<Response>,
  store?: WorkflowStore,
): Promise<Response> {
  let observation: WorkflowObservation = {
    contract: WORKFLOW_CONTRACT,
    definition: { name: "manual_upload", version: WORKFLOW_VERSIONS.manual_upload },
    identity: { tenantId: input.tenantId, operationId: input.fileId, attemptId: randomUUID() },
    owner: { system: "workspace_files", id: input.fileId },
    stage: "extract_index", state: "running",
    evidence: [{ kind: "file", id: input.fileId, sha256: input.sha256 }],
    failure: null, retry: { eligible: false, afterMs: null },
    recovery: { authority: "workspace_files", action: "wait" },
    cancellation: { requested: input.signal.aborted, scope: "client_wait", acknowledged: false },
    observedAt: new Date().toISOString(),
  };
  return runWorkflow({ workflowName: "manual_upload", observation, store }, async (run) => {
    const stoppedWaiting = () => {
      if (observation.cancellation.requested) return;
      observation = { ...observation, cancellation: { requested: true, scope: "client_wait", acknowledged: false }, observedAt: new Date().toISOString() };
      void run.checkpoint(observation);
    };
    input.signal.addEventListener("abort", stoppedWaiting, { once: true });
    try {
      // Abort events are not replayed when they occurred during _begin().
      if (input.signal.aborted) stoppedWaiting();
      await run.checkpoint(observation);
      const response = await operation(); // exactly once; never replay on an observation failure
      let body: Record<string, unknown> = {};
      try { body = await response.clone().json(); } catch { /* original response remains authoritative */ }
      const indexed = body.indexed === true && typeof body.uploadId === "string" && WORKFLOW_UUID.test(body.uploadId);
      observation = { ...observation,
        state: indexed ? "succeeded" : body.indexing === true ? "waiting" : "failed",
        stage: indexed ? "indexed" : "extract_index",
        evidence: indexed ? [...observation.evidence, { kind: "document", id: body.uploadId as string }] : observation.evidence,
        // The same HTTP shape covers extraction and post-index final-link
        // failures. Only canonical inspection can establish a safe recovery.
        failure: indexed || body.indexing === true ? null : { code: "index_failed", retryable: false },
        retry: { eligible: false, afterMs: body.indexing === true ? 2000 : null },
        recovery: { authority: "workspace_files", action: body.indexing === true ? "wait" : "none" },
        observedAt: new Date().toISOString(),
      };
      run.setObservation(observation);
      response.headers.set("X-Mira-Workflow-Run-Id", observation.identity.attemptId);
      return response;
    } finally {
      input.signal.removeEventListener("abort", stoppedWaiting);
    }
  });
}
