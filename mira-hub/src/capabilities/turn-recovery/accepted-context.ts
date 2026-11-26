import type { EquipmentNotebook } from "@/lib/equipment-notebooks";
import type { ChatHistoryTurn } from "@/lib/notebook-query";
import type { ManualIdentity } from "@/capabilities/notebook-manual-identity";
import type { ThreadSelection } from "@/capabilities/bench-components/store";
import type { VisualEvidenceRow } from "@/lib/visual-evidence-context";

const text = (value: unknown) => typeof value === "string" ? value.trim() || null : null;
export function notebookIdentitySnapshot(nb: Partial<EquipmentNotebook> | null | undefined) {
  return { version: 1 as const, manufacturer: text(nb?.manufacturer), model: text(nb?.model),
    catalogNumber: text(nb?.catalogNumber), serialNumber: text(nb?.serialNumber),
    equipmentType: text(nb?.equipmentType), identityStatus: text(nb?.identityStatus) };
}
export function sameNotebookIdentity(expected: unknown, current: Partial<EquipmentNotebook> | null | undefined): boolean {
  return record(expected) && expected.version === 1
    && JSON.stringify(notebookIdentitySnapshot(expected)) === JSON.stringify(notebookIdentitySnapshot(current));
}
export function sameManualIdentity(a: ManualIdentity, b: ManualIdentity): boolean {
  const canonical = (v: ManualIdentity) => [text(v.identity.manufacturer), text(v.identity.model), text(v.catalogNumber), text(v.identityStatus)];
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function sameVisualObservation(a: VisualEvidenceRow | null, b: VisualEvidenceRow | null): boolean {
  const canonical = (v: VisualEvidenceRow | null) => v === null ? null : [v.observationId, v.sessionId, v.fileId, v.photoHash,
    v.text, v.obsKind, v.trust, v.confidence, v.observedAt, (v.hazards ?? []).map(h => [h.code, h.confidence])];
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export type AcceptedTurnContext = {
  version: 1;
  target: { equipmentEntityId: string | null; notebookIdentity: ReturnType<typeof notebookIdentitySnapshot>; manualIdentity: ManualIdentity };
  component: { componentId: string; revision: number; selection: ThreadSelection } | null;
  history: ChatHistoryTurn[];
  selectionTurnIds: string[] | null;
  subjectQueries: string[];
  subjectOutOfReach: boolean;
  priorLookRows: VisualEvidenceRow[];
  currentLookRow: VisualEvidenceRow | null;
  priorLookFileIds: string[];
  priorReportContext: { content: string; turnIds: string[]; truncated: boolean; coverage: "available" | "unavailable" | "not_requested" };
};

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every(x => typeof x === "string");
/** Only read from a server envelope. Never interpret a client payload field as authority. */
export function acceptedTurnContext(value: unknown): AcceptedTurnContext | null {
  if (!record(value) || value.version !== 1 || !record(value.target)
      || !record(value.target.notebookIdentity) || value.target.notebookIdentity.version !== 1
      || !record(value.target.manualIdentity) || !record(value.target.manualIdentity.identity)
      || !(value.target.equipmentEntityId === null || typeof value.target.equipmentEntityId === "string")
      || !Array.isArray(value.history) || value.history.length > 50
      || !value.history.every(t => record(t) && ["user", "assistant"].includes(String(t.role)) && typeof t.content === "string")
      || !(value.selectionTurnIds === null || strings(value.selectionTurnIds, 50))
      || !strings(value.subjectQueries, 1000) || typeof value.subjectOutOfReach !== "boolean"
      || !Array.isArray(value.priorLookRows) || value.priorLookRows.length > 2
      || !value.priorLookRows.every(r => record(r) && typeof r.text === "string" && (r.fileId === null || typeof r.fileId === "string"))
      || !(value.currentLookRow === null || (record(value.currentLookRow) && typeof value.currentLookRow.text === "string" && typeof value.currentLookRow.fileId === "string"))
      || !strings(value.priorLookFileIds, 2)
      || !record(value.priorReportContext) || typeof value.priorReportContext.content !== "string"
      || !strings(value.priorReportContext.turnIds, 25) || typeof value.priorReportContext.truncated !== "boolean"
      || !["available", "unavailable", "not_requested"].includes(String(value.priorReportContext.coverage))
      || !(value.component === null || (record(value.component) && typeof value.component.componentId === "string"
        && Number.isSafeInteger(value.component.revision) && Number(value.component.revision) > 0
        && record(value.component.selection) && Number.isSafeInteger(value.component.selection.version)))) return null;
  if (JSON.stringify(value).length > 524288) return null;
  return value as AcceptedTurnContext;
}

/** A valid legacy request always has a top-level message. The envelope never
 * does, and new client bodies are always wrapped once. This domain separation
 * also prevents a legacy caller's arbitrary extra fields from minting context. */
export function turnRequestEnvelope(payload: unknown): { request: unknown; acceptedContext: AcceptedTurnContext | null } {
  if (record(payload) && !Object.hasOwn(payload, "message") && payload.format === "notebook-turn/v1" && Object.hasOwn(payload, "request")) {
    return { request: payload.request, acceptedContext: acceptedTurnContext(payload.acceptedContext) };
  }
  return { request: payload, acceptedContext: null };
}
export const wrapTurnRequest = (request: unknown) => ({ format: "notebook-turn/v1", request, acceptedContext: null });
/** SQL counterpart of the domain-separated envelope, for exact idempotency comparisons. */
export const requestPayloadSql = (column: string) => `(CASE WHEN NOT (${column} ? 'message')
  AND ${column}->>'format' = 'notebook-turn/v1' AND ${column} ? 'request'
  THEN ${column}->'request' ELSE ${column} END)`;
