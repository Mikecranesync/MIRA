import type { WorkflowObservation } from "../workflow-contract";
const id = "a1000000-0000-4000-8000-000000000001";
export const observation = (): WorkflowObservation => ({
  contract: "mira.workflow.v1", definition: { name: "manual_upload", version: "1.0.0" },
  identity: { tenantId: id, operationId: id, attemptId: id }, owner: { system: "workspace_files", id },
  stage: "extract_index", state: "running", evidence: [{ kind: "file", id, sha256: "a".repeat(64) }], failure: null,
  retry: { eligible: false, afterMs: null }, recovery: { authority: "workspace_files", action: "wait" },
  cancellation: { requested: false, scope: "client_wait", acknowledged: false }, observedAt: "2026-11-19T05:00:00.000Z",
});
