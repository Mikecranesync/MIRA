/** Pure projection, not an execution state machine. Canonical records decide every fact. */
import { deriveReadiness } from "@/lib/document-readiness";
import { WORKFLOW_CONTRACT, parseWorkflowObservation, type WorkflowObservation } from "@/lib/workflow-contract";
import { WORKFLOW_VERSIONS } from "@/lib/workflow-versions";

export interface ManualWorkflowFacts {
  tenantId: string; notebookId: string; fileId: string; sha256: string | null;
  linkedDocId: string | null; documentId: string | null; uploadStatus: string | null;
  /** Existing node upload can adopt a completed orphan index only for PDFs. */
  canAdoptOrphan: boolean;
  claim: "none" | "live" | "stale"; chunkCount: number; anchoredChunkCount: number;
  source: { enabled: boolean; matchState: string; superseded: boolean } | null;
  turn: { id: string; state: "pending" | "complete"; status: string; stale: boolean; usesDocument: boolean;
    answerPresent: boolean; safetyStopped: boolean; cancelled: boolean; citations: { docId: string; page: number | null }[] } | null;
  observedAt: string; uploadObservation: WorkflowObservation | null; visibilityGaps: string[];
}

export function projectManualQuestion(f: ManualWorkflowFacts) {
  const attached = Boolean(f.source?.enabled && !f.source.superseded && ["verified", "user_confirmed"].includes(f.source.matchState));
  const readiness = deriveReadiness({ bytesDurable: true, chunkCount: f.chunkCount,
    hasPageAnchors: f.anchoredChunkCount > 0, scopeValidated: attached,
    originalResolvable: f.linkedDocId !== null, parseFailed: f.uploadStatus === "failed" });
  const workflow: WorkflowObservation = {
    contract: WORKFLOW_CONTRACT, definition: { name: "manual_question", version: WORKFLOW_VERSIONS.manual_question },
    identity: { tenantId: f.tenantId, operationId: f.fileId, attemptId: f.turn?.id ?? f.uploadObservation?.identity.attemptId ?? f.fileId },
    owner: { system: "workspace_files", id: f.fileId }, stage: "extract_index", state: "partial",
    evidence: [{ kind: "file", id: f.fileId, ...(f.sha256 ? { sha256: f.sha256 } : {}) }, { kind: "notebook", id: f.notebookId }],
    failure: null, retry: { eligible: true, afterMs: null }, recovery: { authority: "workspace_files", action: "upload_again" },
    cancellation: { requested: false, scope: "client_wait", acknowledged: false }, observedAt: f.observedAt,
  };
  if (f.documentId) workflow.evidence.push({ kind: "document", id: f.documentId });
  if (f.turn) {
    const t = f.turn;
    workflow.owner = { system: "equipment_notebook_turns", id: t.id };
    workflow.evidence.push({ kind: "turn", id: t.id });
    workflow.stage = "question";
    workflow.recovery = { authority: "equipment_notebook_turns", action: "repeat_question" };
    workflow.retry.eligible = attached;
    if (!t.usesDocument) {
      workflow.failure = { code: "request_source_mismatch", retryable: false }; workflow.retry.eligible = false;
    } else if (t.state === "pending") {
      workflow.state = t.stale ? "interrupted" : "running";
      workflow.failure = t.stale ? { code: "claim_expired", retryable: attached } : null;
      if (!t.stale) { workflow.retry = { eligible: false, afterMs: 2000 }; workflow.recovery.action = "wait"; }
    } else if (t.safetyStopped || t.status === "insufficient_evidence") {
      workflow.state = "refused"; workflow.retry.eligible = false; workflow.recovery.action = "none";
    } else if (t.cancelled && t.status === "error") {
      workflow.state = "cancelled";
      workflow.cancellation = { requested: true, scope: "execution", acknowledged: true };
    } else if (t.status !== "answered" || !t.answerPresent) {
      workflow.state = "failed"; workflow.failure = { code: "answer_failed", retryable: attached };
    } else if (!t.citations.some((c) => c.docId === f.documentId)) {
      workflow.state = "partial"; workflow.failure = { code: "answer_not_grounded", retryable: false }; workflow.retry.eligible = false;
    } else {
      // Historical replay is independent of subsequently changed source membership.
      workflow.state = "succeeded"; workflow.stage = "answer_persisted";
      workflow.retry.eligible = false; workflow.recovery.action = "none";
      for (const c of t.citations.filter((c) => c.docId === f.documentId).slice(0, 32)) {
        workflow.evidence.push({ kind: "document", id: c.docId, ...(c.page !== null ? { page: c.page } : {}) });
      }
    }
  } else if (f.claim === "live" && !f.linkedDocId) {
    workflow.state = "running"; workflow.retry = { eligible: false, afterMs: 2000 }; workflow.recovery.action = "wait";
  } else if (f.linkedDocId && f.chunkCount === 0) {
    // Same-byte upload returns this existing pointer before any extraction.
    workflow.state = "failed"; workflow.failure = { code: "index_failed", retryable: false };
    workflow.retry.eligible = false; workflow.recovery.action = "none";
  } else if (f.claim === "stale" || (f.documentId && !f.linkedDocId)) {
    const recoverable = !f.documentId || f.canAdoptOrphan;
    workflow.state = "interrupted"; workflow.failure = { code: "claim_expired", retryable: recoverable };
    workflow.retry.eligible = recoverable;
    if (!recoverable) workflow.recovery.action = "none";
  } else if (f.uploadStatus === "failed" ||
      (!f.linkedDocId && f.uploadObservation?.state === "failed")) {
    workflow.state = "failed"; workflow.failure = { code: "index_failed", retryable: true };
  } else if (f.linkedDocId && f.chunkCount > 0 && f.anchoredChunkCount > 0) {
    workflow.state = "waiting"; workflow.stage = attached ? "question" : "source_attachment";
    workflow.owner = { system: "equipment_notebook_sources", id: f.notebookId };
    workflow.retry.eligible = !attached;
    workflow.recovery = { authority: "equipment_notebook_sources", action: attached ? "none" : "attach_source" };
    if (f.source && !attached) {
      workflow.state = "refused"; workflow.failure = { code: "source_rejected", retryable: false };
      workflow.retry.eligible = false; workflow.recovery.action = "review_source";
    }
  }
  return { workflow: parseWorkflowObservation(workflow), readiness,
    stages: { stored: true, extracted: f.chunkCount > 0, indexed: f.anchoredChunkCount > 0,
      attached, answerPersisted: workflow.state === "succeeded" },
    visibility: { uploadRecorded: f.uploadObservation !== null, gaps: f.visibilityGaps },
    uploadObservation: f.uploadObservation,
  };
}
