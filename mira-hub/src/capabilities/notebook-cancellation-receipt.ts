/** Server-owned completion evidence, stored by recordTurn's existing fenced write.
 * It contains references only and is never a citation or a safety decision.
 */
import { WORKFLOW_UUID } from "@/lib/workflow-contract";

const KIND = "notebook_turn_cancelled";
type Receipt = { kind: typeof KIND; version: 1; attemptId: string; clientRequestId: string };
const keys = ["kind", "version", "attemptId", "clientRequestId"];

export function cancellationReceiptEvidence(attemptId: string, clientRequestId: string | null): Receipt[] {
  // Missing metadata cannot prevent the existing stop record from persisting.
  if (!clientRequestId || !WORKFLOW_UUID.test(attemptId) || !WORKFLOW_UUID.test(clientRequestId)) return [];
  return [{ kind: KIND, version: 1, attemptId: attemptId.toLowerCase(), clientRequestId: clientRequestId.toLowerCase() }];
}

export function currentCancellationReceipt(evidence: readonly unknown[], clientRequestId: string): Receipt | null {
  const receipts = evidence.filter((e): e is Record<string, unknown> =>
    e !== null && typeof e === "object" && !Array.isArray(e) && (e as Record<string, unknown>).kind === KIND);
  if (receipts.length !== 1 || !WORKFLOW_UUID.test(clientRequestId)) return null;
  const r = receipts[0];
  if (Object.keys(r).length !== keys.length || !keys.every((k) => Object.hasOwn(r, k)) || r.version !== 1 ||
    typeof r.attemptId !== "string" || !WORKFLOW_UUID.test(r.attemptId) ||
    typeof r.clientRequestId !== "string" || !WORKFLOW_UUID.test(r.clientRequestId) ||
    r.clientRequestId.toLowerCase() !== clientRequestId.toLowerCase()) return null;
  return { kind: KIND, version: 1, attemptId: r.attemptId.toLowerCase(), clientRequestId: r.clientRequestId.toLowerCase() };
}
