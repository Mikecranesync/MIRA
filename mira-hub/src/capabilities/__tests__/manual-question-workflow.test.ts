import { describe, expect, it } from "vitest";
import { projectManualQuestion, type ManualWorkflowFacts } from "../manual-question-workflow";
import { observation } from "@/lib/__tests__/workflow-fixture";

const fileId = "c1000000-0000-4000-8000-000000000001";
const notebookId = "c2000000-0000-4000-8000-000000000001";
const docId = "c3000000-0000-4000-8000-000000000001";
const turnId = "c4000000-0000-4000-8000-000000000001";
const facts = (): ManualWorkflowFacts => ({
  tenantId: "c0000000-0000-4000-8000-000000000001", fileId, notebookId, sha256: "c".repeat(64),
  linkedDocId: docId, documentId: docId, uploadStatus: "parsed", claim: "none", chunkCount: 3, anchoredChunkCount: 3,
  canAdoptOrphan: true,
  canExtract: true,
  source: { enabled: true, matchState: "user_confirmed", superseded: false }, turn: null,
  observedAt: "2026-11-19T05:00:00.000Z", uploadObservation: null, visibilityGaps: [],
});
const turn = () => ({ id: turnId, state: "complete" as const, status: "answered", stale: false, usesDocument: true,
  answerPresent: true, safetyStopped: false, cancelled: false, citations: [{ docId, page: 2 }] });

describe("manual-to-question domain projection", () => {
  it("requires a persisted answer with evidence from this document to declare success", () => {
    expect(projectManualQuestion({ ...facts(), turn: turn() }).workflow).toMatchObject({ state: "succeeded", stage: "answer_persisted" });
    expect(projectManualQuestion(facts()).workflow).toMatchObject({ state: "waiting", stage: "question" });
  });
  it("does not count an answered turn citing only another document", () => {
    const result = projectManualQuestion({ ...facts(), turn: { ...turn(), citations: [{ docId: fileId, page: 2 }] } });
    expect(result.workflow.state).toBe("partial"); expect(result.workflow.failure?.code).toBe("answer_not_grounded");
  });
  it("does not associate another request's source scope with this workflow", () => {
    expect(projectManualQuestion({ ...facts(), turn: { ...turn(), usesDocument: false } }).workflow.failure?.code).toBe("request_source_mismatch");
  });
  it("reports missing attachment separately from indexed text", () => {
    const result = projectManualQuestion({ ...facts(), source: null });
    expect(result.workflow).toMatchObject({ state: "waiting", stage: "source_attachment", recovery: { action: "attach_source" } });
    expect(result.readiness.canChat).toBe(false);
  });
  it("a live file claim remains running; a stale one offers only domain recovery", () => {
    const base = { ...facts(), linkedDocId: null, documentId: null, chunkCount: 0, anchoredChunkCount: 0, source: null };
    expect(projectManualQuestion({ ...base, claim: "live" }).workflow).toMatchObject({ state: "running", retry: { eligible: false } });
    expect(projectManualQuestion({ ...base, claim: "stale" }).workflow).toMatchObject({ state: "interrupted", recovery: { action: "upload_again", authority: "workspace_files" } });
  });
  it("a completed index with a lost canonical finalization is recoverable, not ready", () => {
    const result = projectManualQuestion({ ...facts(), linkedDocId: null });
    expect(result.workflow).toMatchObject({ state: "interrupted", recovery: { action: "upload_again" } });
    expect(result.readiness.canChat).toBe(false);
  });
  it("declines orphan adoption when the existing executor cannot adopt that format", () => {
    const result = projectManualQuestion({ ...facts(), linkedDocId: null, canAdoptOrphan: false });
    expect(result.workflow).toMatchObject({ state: "interrupted", retry: { eligible: false }, recovery: { action: "none" } });
    expect(result.workflow.failure?.retryable).toBe(false);
  });
  it("does not trust parsed status or an observation success when chunks are missing", () => {
    const result = projectManualQuestion({ ...facts(), chunkCount: 0, anchoredChunkCount: 0 });
    expect(result.workflow.state).toBe("failed"); expect(result.readiness.canChat).toBe(false);
    expect(result.workflow.retry.eligible).toBe(false);
    expect(result.workflow.failure?.retryable).toBe(false);
    expect(result.workflow.recovery.action).toBe("none");
  });
  it("does not recommend adoption of a retained orphan whose chunks are missing", () => {
    expect(projectManualQuestion({ ...facts(), linkedDocId: null, chunkCount: 0, anchoredChunkCount: 0 }).workflow)
      .toMatchObject({ state: "failed", retry: { eligible: false }, recovery: { action: "none" } });
  });
  it("does not let a stale failed observation override a completed canonical index", () => {
    const uploadObservation = { ...observation(), state: "failed" as const,
      failure: { code: "index_failed" as const, retryable: true } };
    const result = projectManualQuestion({ ...facts(), uploadObservation });
    expect(result.workflow).toMatchObject({ state: "waiting", stage: "question", failure: null });
    expect(result.uploadObservation?.state).toBe("failed");
  });
  it("will not present unanchored text as ready", () => {
    expect(projectManualQuestion({ ...facts(), anchoredChunkCount: 0 }).readiness.canChat).toBe(false);
  });
  it.each(["none", "live", "stale"] as const)("never recommends reconstruction through a retained pointer (%s claim)", (claim) => {
    for (const bad of [{ chunkCount: 0, anchoredChunkCount: 0 }, { anchoredChunkCount: 0 }, { uploadStatus: "failed" }, { uploadStatus: "cancelled" }]) {
      const result = projectManualQuestion({ ...facts(), ...bad, claim });
      expect(result.workflow).toMatchObject({ state: "failed", retry: { eligible: false }, recovery: { action: "none" } });
      expect(result.readiness.canChat).toBe(false);
    }
  });
  it("does not offer manual extraction for a stored, unsupported file", () => {
    const result = projectManualQuestion({ ...facts(), documentId: null, linkedDocId: null, uploadStatus: null,
      canExtract: false, chunkCount: 0, anchoredChunkCount: 0, source: null });
    expect(result.workflow).toMatchObject({ retry: { eligible: false }, recovery: { action: "none" } });
  });
  it.each(["rejected", "candidate"])("does not promote a %s source", (matchState) => {
    const result = projectManualQuestion({ ...facts(), source: { enabled: true, matchState, superseded: false } });
    expect(result.workflow.state).toBe("refused"); expect(result.readiness.canChat).toBe(false);
  });
  it("replays historical success independently of mutable current source approval", () => {
    expect(projectManualQuestion({ ...facts(), source: null, turn: turn() }).workflow.state).toBe("succeeded");
  });
  it("exposes pending/stale question claims without claiming to run them", () => {
    const pending = { ...turn(), state: "pending" as const };
    expect(projectManualQuestion({ ...facts(), turn: pending }).workflow.state).toBe("running");
    expect(projectManualQuestion({ ...facts(), turn: { ...pending, stale: true } }).workflow).toMatchObject({ state: "interrupted", recovery: { action: "repeat_question" } });
  });
  it("keeps a safety stop terminal and ineligible for automatic replay", () => {
    const result = projectManualQuestion({ ...facts(), turn: { ...turn(), status: "error", safetyStopped: true } });
    expect(result.workflow).toMatchObject({ state: "refused", retry: { eligible: false } });
  });
  it("distinguishes acknowledged notebook stop from inference failure", () => {
    const stopped = projectManualQuestion({ ...facts(), turn: { ...turn(), status: "error", cancelled: true } });
    expect(stopped.workflow).toMatchObject({ state: "cancelled", cancellation: { requested: true, scope: "execution", acknowledged: true } });
    expect(projectManualQuestion({ ...facts(), turn: { ...turn(), status: "error", answerPresent: false } }).workflow.state).toBe("failed");
  });
  it("does not let an old cancellation erase a persisted retry answer", () => {
    const result = projectManualQuestion({ ...facts(), turn: { ...turn(), cancelled: true } });
    expect(result.workflow.state).toBe("succeeded");
    expect(result.stages.answerPersisted).toBe(true);
    expect(result.workflow.cancellation.acknowledged).toBe(false);
  });
});
