import { describe, expect, it } from "vitest";
import { parseWorkflowObservation, workflowRunStatus } from "./workflow-contract";
import { observation } from "./__tests__/workflow-fixture";

const id = "a1000000-0000-4000-8000-000000000001";

describe("shared workflow observation contract", () => {
  it("round-trips a bounded reference-only observation", () => {
    expect(parseWorkflowObservation(observation())).toEqual(observation());
  });
  it.each(["tenantId", "operationId", "attemptId"])("rejects malformed %s", (field) => {
    const value = observation();
    Object.assign(value.identity, { [field]: "not-an-id" });
    expect(() => parseWorkflowObservation(value)).toThrow();
  });
  it.each([
    (v: Record<string, unknown>) => { v.question = "private question"; },
    (v: Record<string, unknown>) => { v.owner = { system: "workspace_files", id, claimToken: id }; },
    (v: Record<string, unknown>) => { v.evidence = [{ kind: "file", id, filename: "private.pdf" }]; },
    (v: Record<string, unknown>) => { v.failure = { code: "index_failed", retryable: true, message: "secret" }; },
  ])("rejects content, credentials and arbitrary exception fields", (mutate) => {
    const value = structuredClone(observation()) as unknown as Record<string, unknown>;
    mutate(value);
    expect(() => parseWorkflowObservation(value)).toThrow();
  });
  it("rejects unbounded evidence", () => {
    expect(() => parseWorkflowObservation({ ...observation(), evidence: Array(65).fill({ kind: "file", id }) })).toThrow();
  });
  it("rejects a fictional execution cancellation", () => {
    expect(() => parseWorkflowObservation({ ...observation(), state: "cancelled" })).toThrow();
  });
  it("allows successful accepted work after a client stops waiting", () => {
    const value = { ...observation(), state: "succeeded", recovery: { authority: "workspace_files", action: "none" }, cancellation: { requested: true, scope: "client_wait", acknowledged: false } };
    expect(parseWorkflowObservation(value).state).toBe("succeeded");
  });
  it("rejects success carrying a failure or a retry instruction", () => {
    expect(() => parseWorkflowObservation({ ...observation(), state: "succeeded", failure: { code: "index_failed", retryable: true } })).toThrow();
  });
  it("rejects unclassified failure and impossible timestamps", () => {
    expect(() => parseWorkflowObservation({ ...observation(), state: "failed" })).toThrow();
    expect(() => parseWorkflowObservation({ ...observation(), observedAt: "2026-02-30T05:00:00.000Z" })).toThrow();
  });
  it.each([
    ["running", "running"], ["waiting", "running"], ["succeeded", "ok"],
    ["partial", "degraded"], ["refused", "degraded"], ["cancelled", "degraded"],
    ["failed", "failed"], ["interrupted", "failed"],
  ] as const)("projects %s into migration 044's %s without changing its enum", (state, stored) => {
    expect(workflowRunStatus(state)).toBe(stored);
  });
});
