import { describe, expect, it } from "vitest";
import { equipmentExpectation, matchesEquipmentExpectation, recoveryView } from "./contract";

describe("equipment-bound recovery", () => {
  it("distinguishes a missing legacy snapshot from an explicitly unbound machine", () => {
    expect(equipmentExpectation({})).toEqual({ kind: "absent" });
    expect(equipmentExpectation({ expectedEquipmentEntityId: null })).toEqual({ kind: "known", equipmentEntityId: null });
    expect(matchesEquipmentExpectation({ kind: "known", equipmentEntityId: null }, "machine-B")).toBe(false);
  });

  it("compares opaque machine identities exactly, never by labels or normalized UUIDs", () => {
    const expected = equipmentExpectation({ expectedEquipmentEntityId: "Machine-A" });
    expect(matchesEquipmentExpectation(expected, "Machine-A")).toBe(true);
    expect(matchesEquipmentExpectation(expected, "machine-a")).toBe(false);
    expect(matchesEquipmentExpectation(expected, "Machine-B")).toBe(false);
  });

  it.each(["", " A", 1, {}, [], "x".repeat(513)])("refuses malformed target snapshots: %j", (value) => {
    expect(equipmentExpectation({ expectedEquipmentEntityId: value })).toEqual({ kind: "invalid" });
  });

  const row = {
    id: "turn-1", client_request_id: "request-1", question: "What fuse?", thread_id: "thread-1",
    client_request_state: "pending", stale: false, answer_status: "error", equipment_entity_id: null,
    current_equipment_entity_id: "machine-A", created_at: new Date("2026-11-20T00:00:00Z"),
    client_request_payload: { expectedEquipmentEntityId: "machine-A", sourceDocIds: ["doc-1"],
      visualEvidence: { fileId: "photo-A", capturedAt: "original" }, secret: "must not echo", history: ["must not echo"] },
  };

  it("keeps a question visible while pending, then reports the terminal commit without another POST", () => {
    expect(recoveryView(row)).toMatchObject({ state: "pending", question: "What fuse?", pollAfterMs: 2000 });
    expect(recoveryView({ ...row, client_request_state: "complete" })).toMatchObject({ state: "complete", pollAfterMs: null });
    expect(recoveryView({ ...row, stale: true })).toMatchObject({ state: "interrupted", pollAfterMs: null });
  });

  it("retains the original photo and target while excluding claim tokens and arbitrary payload fields", () => {
    const stored = { ...row, client_request_claim_token: "private-token" };
    const view = recoveryView(stored);
    expect(view).toMatchObject({ target: { kind: "known", equipmentEntityId: "machine-A" }, visualEvidence: { fileId: "photo-A", capturedAt: "original" } });
    expect(JSON.stringify(view)).not.toMatch(/private-token|must not echo|secret|history/);
  });

  it("does not invent original context from the notebook's new binding", () => {
    expect(recoveryView({ ...row, client_request_payload: {} }).target).toEqual({ kind: "absent" });
    expect(recoveryView({ ...row, client_request_payload: {}, equipment_entity_id: "machine-old" }).target)
      .toEqual({ kind: "known", equipmentEntityId: "machine-old" });
  });

  it.each(["accepted-A", null])("uses the accepted server binding %s for a legacy request without a client precondition", equipmentEntityId => {
    const view = recoveryView({ ...row, stale: true, client_request_payload: {}, accepted_context_known: true,
      accepted_target_known: true, original_equipment_entity_id: equipmentEntityId });
    expect(view.target).toEqual({ kind: "known", equipmentEntityId });
    expect(view.canRetry).toBe(true);
  });

  it("carries the recorded component revision and original selection precondition, never a current replacement", () => {
    const view = recoveryView({ ...row, component_id: "component-A", component_revision: "2",
      client_request_payload: { ...row.client_request_payload, componentSelection: { componentId: "component-A", selectionVersion: 4 } } });
    expect(view.component).toEqual({ componentId: "component-A", revision: 2 });
    expect(view.componentSelection).toEqual({ threadId: "thread-1", componentId: "component-A", selectionVersion: 4 });
  });

  it("holds a component retry whose original revision was never established", () => {
    const failed = { ...row, stale: true, client_request_payload: { ...row.client_request_payload,
      componentSelection: { componentId: "component-A", selectionVersion: 4 } } };
    expect(recoveryView(failed).canRetry).toBe(false);
    expect(recoveryView({ ...failed, component_id: "component-A", component_revision: 2 }).canRetry).toBe(false);
    expect(recoveryView({ ...failed, component_id: "component-A", component_revision: 2, accepted_context_known: true }).canRetry).toBe(true);
  });
});
