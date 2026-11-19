/** Opt-in visibility around the existing upload handler; owns no claim, parse or retry. */
import { randomUUID } from "node:crypto";
import { queryWorkflowObservation, runWorkflow, type WorkflowStore } from "@/lib/workflow";
import { WORKFLOW_CONTRACT, WORKFLOW_UUID, type WorkflowObservation } from "@/lib/workflow-contract";
import { WORKFLOW_VERSIONS } from "@/lib/workflow-versions";
import { hasManualIndex } from "./manual-question-workflow";

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
      const documentId = body.indexed === true && typeof body.uploadId === "string" && WORKFLOW_UUID.test(body.uploadId) ? body.uploadId : null;
      let verification: "verified" | "unusable" | "unknown" = "unknown";
      if (documentId) {
        try {
          // A replayed pointer is not materialized index evidence. This read
          // uses the existing optional-metadata resource bounds and owns no retry.
          const { rows } = await queryWorkflowObservation(
            `SELECT u.status,
              (SELECT count(*)::int FROM knowledge_entries k WHERE k.tenant_id = $1::uuid
                AND k.doc_id = $2::uuid AND k.is_private = true) AS total,
              (SELECT count(*)::int FROM knowledge_entries k WHERE k.tenant_id = $1::uuid
                AND k.doc_id = $2::uuid AND k.is_private = true AND COALESCE(k.page_start, k.source_page) > 0) AS anchored
             FROM namespace_direct_uploads f LEFT JOIN hub_uploads u ON u.id = f.upload_id AND u.tenant_id = $1::text
             WHERE f.tenant_id = $1::uuid AND f.id = $3::uuid AND f.upload_id = $2::uuid`,
            [input.tenantId, documentId, input.fileId],
          );
          if (rows[0]) verification = hasManualIndex(rows[0].status, Number(rows[0].total), Number(rows[0].anchored)) ? "verified" : "unusable";
        } catch { /* An unavailable read cannot certify completion or affect HTTP behavior. */ }
      }
      const indexed = verification === "verified";
      observation = { ...observation,
        state: indexed ? "succeeded" : body.indexing === true ? "waiting" : documentId && verification === "unknown" ? "partial" : "failed",
        stage: indexed ? "indexed" : "extract_index",
        evidence: documentId ? [...observation.evidence, { kind: "document", id: documentId }] : observation.evidence,
        // The same HTTP shape covers extraction and post-index final-link
        // failures. Only canonical inspection can establish a safe recovery.
        failure: indexed || body.indexing === true || (documentId && verification === "unknown") ? null : { code: "index_failed", retryable: false },
        retry: { eligible: false, afterMs: body.indexing === true ? 2000 : null },
        recovery: { authority: "workspace_files", action: body.indexing === true ? "wait" : "none" },
        observedAt: new Date().toISOString(),
      };
      run.setObservation(observation);
      try { response.headers.set("X-Mira-Workflow-Run-Id", observation.identity.attemptId); } catch { /* immutable response headers remain authoritative */ }
      return response;
    } finally {
      input.signal.removeEventListener("abort", stoppedWaiting);
    }
  });
}
