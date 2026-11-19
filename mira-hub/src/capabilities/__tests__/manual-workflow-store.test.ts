import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  tenantId: "e1000000-0000-4000-8000-000000000001", notebookId: "e2000000-0000-4000-8000-000000000001",
  fileId: "e3000000-0000-4000-8000-000000000001", docId: "e4000000-0000-4000-8000-000000000001",
  turnId: "e5000000-0000-4000-8000-000000000001", requestId: "e6000000-0000-4000-8000-000000000001",
  fileAllowed: true, turnAllowed: true, state: "complete", stale: false, answer: false,
  outcomeRows: [] as { outcome: unknown }[], outcomeFails: false,
  query: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/workflow", () => ({ queryWorkflowObservation: async (sql: string, values: unknown[]) =>
  sql.includes("FROM workflow_runs") ? { rows: [] } : fixture.query(sql, values) }));
vi.mock("@/lib/uploads", () => ({ findDuplicateUpload: vi.fn(async () => null), getUpload: vi.fn(async () => ({ status: "parsed" })) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (_tenantId: string, fn: (c: { query: typeof fixture.query }) => unknown) => fn({ query: fixture.query }),
}));
import { inspectManualQuestion } from "../manual-workflow-store";

const input = () => ({ tenantId: fixture.tenantId, userId: "owner-a", notebookId: fixture.notebookId,
  fileId: fixture.fileId, clientRequestId: fixture.requestId, threadId: "wf01" });
const outcomeQueries = () => fixture.query.mock.calls.filter(([sql]) => sql.includes("FROM decision_traces"));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.fileAllowed = true; fixture.turnAllowed = true; fixture.state = "complete";
  fixture.stale = false; fixture.answer = false; fixture.outcomeRows = []; fixture.outcomeFails = false;
  fixture.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM equipment_notebooks n")) return { rows: fixture.fileAllowed ? [{
      file_id: fixture.fileId, content_sha256: "e".repeat(64), upload_id: fixture.docId,
      node_id: fixture.notebookId, observed_at: new Date("2026-11-19T09:00:00.000Z"), claim: "none",
      source_doc_id: fixture.docId, enabled_by_default: true, match_state: "user_confirmed", superseded_at: null,
    }] : [] };
    if (sql.includes("AS anchored")) return { rows: [{ total: 2, anchored: 2 }] };
    if (sql.includes("FROM equipment_notebook_turns")) return { rows: fixture.turnAllowed ? [{
      id: fixture.turnId, answer_status: fixture.answer ? "answered" : "error", client_request_state: fixture.state,
      stale: fixture.stale, completed_scope: true, pending_scope: true, answer_present: fixture.answer,
      evidence: fixture.answer ? [{ docId: fixture.docId, page: 2 }] : [],
    }] : [] };
    if (sql.includes("FROM decision_traces")) {
      if (fixture.outcomeFails) throw new Error("declared private recorder failure");
      return { rows: fixture.outcomeRows };
    }
    throw new Error("Unexpected fixture query");
  });
});

describe("manual workflow outcome evidence availability", () => {
  it("reports a visibility gap when a completed authorized turn has no closed outcome", async () => {
    const result = await inspectManualQuestion(input());
    expect(result?.visibility.gaps).toEqual(["turn_outcome_unavailable"]);
    expect(result?.workflow).toMatchObject({ state: "failed", failure: { code: "answer_failed" }, cancellation: { requested: false, acknowledged: false } });
  });
  it.each([null, "", "unknown_outcome", "toString", "__proto__", 42])("does not trust unusable outcome %s", async (outcome) => {
    fixture.outcomeRows = [{ outcome }];
    const result = await inspectManualQuestion(input());
    expect(result?.visibility.gaps).toEqual(["turn_outcome_unavailable"]);
    expect(result?.workflow.cancellation.acknowledged).toBe(false);
  });
  it("reports a single gap for a failed outcome query without leaking the exception", async () => {
    fixture.outcomeFails = true;
    const result = await inspectManualQuestion(input());
    expect(result?.visibility.gaps).toEqual(["turn_outcome_unavailable"]);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("acknowledges cancellation only through the authorized turn's closed outcome", async () => {
    fixture.outcomeRows = [{ outcome: "cancelled" }];
    const result = await inspectManualQuestion(input());
    expect(result?.visibility.gaps).toEqual([]);
    expect(result?.workflow).toMatchObject({ state: "cancelled", cancellation: { requested: true, scope: "execution", acknowledged: true } });
    expect(result?.workflow.definition).toEqual({ name: "manual_question", version: "1.0.3" });
    expect(outcomeQueries()[0][1]).toEqual([fixture.tenantId, fixture.notebookId, fixture.turnId, fixture.requestId]);
  });
  it.each(["answered", "refused", "abstained", "safety_stop", "error", "timeout", "superseded", "abandoned"])("recognizes %s without inferring cancellation or changing domain status", async (outcome) => {
    fixture.outcomeRows = [{ outcome }];
    const result = await inspectManualQuestion(input());
    expect(result?.visibility.gaps).toEqual([]);
    expect(result?.workflow.state).toBe("failed");
    expect(result?.workflow.cancellation.acknowledged).toBe(false);
  });
  it.each([false, true])("does not require a closed outcome for a pending turn (stale=%s)", async (stale) => {
    fixture.state = "pending"; fixture.stale = stale;
    const result = await inspectManualQuestion(input());
    expect(result?.visibility.gaps).toEqual([]);
    expect(result?.workflow.state).toBe(stale ? "interrupted" : "running");
    expect(outcomeQueries()).toHaveLength(0);
  });
  it("keeps persisted answer evidence successful despite missing lifecycle metadata", async () => {
    fixture.answer = true;
    const result = await inspectManualQuestion(input());
    expect(result?.workflow.state).toBe("succeeded"); expect(result?.stages.answerPersisted).toBe(true);
    expect(result?.visibility.gaps).toEqual(["turn_outcome_unavailable"]);
  });
  it("does not let a prior cancellation replace the canonical completed answer", async () => {
    fixture.answer = true; fixture.outcomeRows = [{ outcome: "cancelled" }];
    const result = await inspectManualQuestion(input());
    expect(result?.workflow.state).toBe("succeeded");
    expect(result?.stages.answerPersisted).toBe(true);
    expect(result?.workflow.cancellation.acknowledged).toBe(false);
    expect(result?.visibility.gaps).toEqual(["turn_outcome_unavailable"]);
  });
  it("clears the transient visibility gap on a later inspection with a valid outcome", async () => {
    expect((await inspectManualQuestion(input()))?.visibility.gaps).toEqual(["turn_outcome_unavailable"]);
    fixture.outcomeRows = [{ outcome: "error" }];
    expect((await inspectManualQuestion(input()))?.visibility.gaps).toEqual([]);
  });
  it("never looks up lifecycle evidence for an unrelated file or unauthorized turn", async () => {
    fixture.fileAllowed = false;
    expect(await inspectManualQuestion(input())).toBeNull(); expect(outcomeQueries()).toHaveLength(0);
    fixture.fileAllowed = true; fixture.turnAllowed = false;
    const result = await inspectManualQuestion(input());
    expect(result?.workflow.state).toBe("waiting"); expect(outcomeQueries()).toHaveLength(0);
  });
});
