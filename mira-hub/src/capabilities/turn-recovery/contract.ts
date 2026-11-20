/** Recovery projects the existing turn claim; it never executes or authorizes a retry. */
export type EquipmentExpectation =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "known"; equipmentEntityId: string | null };

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function equipmentExpectation(payload: unknown): EquipmentExpectation {
  const body = record(payload);
  if (!Object.hasOwn(body, "expectedEquipmentEntityId")) return { kind: "absent" };
  const id = body.expectedEquipmentEntityId;
  if (id === null || (typeof id === "string" && id.length > 0 && id.length <= 512 && id.trim() === id)) {
    return { kind: "known", equipmentEntityId: id };
  }
  return { kind: "invalid" };
}

/** Legacy ordinary sends may omit the precondition. Recovery callers require a known target. */
export function matchesEquipmentExpectation(expected: EquipmentExpectation, actual: string | null): boolean {
  return expected.kind === "absent" || (expected.kind === "known" && expected.equipmentEntityId === actual);
}

export type RecoveryRow = {
  id: string; client_request_id: string; thread_id: string | null; question: string;
  client_request_state: string; stale: boolean; answer_status: string;
  equipment_entity_id: string | null; current_equipment_entity_id: string | null;
  client_request_payload: unknown; created_at: Date | string;
};

export function recoveryView(row: RecoveryRow) {
  const body = record(row.client_request_payload);
  const state = row.client_request_state === "complete" ? "complete" : row.stale ? "interrupted" : "pending";
  const expected = equipmentExpectation(body);
  // A server-recorded historical binding is stronger than an optional client snapshot.
  const target: EquipmentExpectation = row.equipment_entity_id !== null
    ? { kind: "known", equipmentEntityId: row.equipment_entity_id } : expected;
  const visual = record(body.visualEvidence);
  return {
    requestId: row.client_request_id, turnId: row.id, threadId: row.thread_id ?? "legacy",
    question: row.question, state, answerStatus: state === "complete" ? row.answer_status : null,
    target, currentEquipmentEntityId: row.current_equipment_entity_id,
    sourceDocIds: Array.isArray(body.sourceDocIds) ? body.sourceDocIds.filter((id): id is string => typeof id === "string").slice(0, 100) : [],
    visualEvidence: typeof visual.fileId === "string" ? {
      fileId: visual.fileId,
      ...(typeof visual.capturedAt === "string" ? { capturedAt: visual.capturedAt } : {}),
    } : null,
    pollAfterMs: state === "pending" ? 2000 : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export type TurnRecovery = ReturnType<typeof recoveryView>;
