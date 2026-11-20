import { withTenantContext } from "@/lib/tenant-context";
import { recoveryView, type RecoveryRow } from "./contract";

/** One owner-scoped claim, including pending claims deliberately absent from completed history.
 * Read-only: observing a claim must not take it over, extend its lease or touch notebook recency.
 */
async function readRecoveryRow(
  tenantId: string, notebookId: string, ownerUserId: string, threadId: string | null,
  requestId: string, signal?: AbortSignal, fullPayload = false,
) {
  return withTenantContext(tenantId, async (client) => {
    await client.query("SET LOCAL statement_timeout = '1500ms'");
    // Status polling never loads stored history or arbitrary request fields.
    // Recovery needs the original payload once, with a bound on that read.
    const payload = fullPayload
      ? "CASE WHEN octet_length(t.client_request_payload::text) <= 1048576 THEN t.client_request_payload ELSE NULL END"
      : `(CASE WHEN t.client_request_payload ? 'expectedEquipmentEntityId'
            THEN jsonb_build_object('expectedEquipmentEntityId', CASE
              WHEN jsonb_typeof(t.client_request_payload->'expectedEquipmentEntityId') IN ('string','null')
                AND octet_length((t.client_request_payload->'expectedEquipmentEntityId')::text) <= 514
              THEN t.client_request_payload->'expectedEquipmentEntityId' ELSE 'false'::jsonb END)
            ELSE '{}'::jsonb END)
          || jsonb_build_object(
            'componentSelection', jsonb_build_object(
              'componentId', CASE WHEN t.client_request_payload->'componentSelection'->'componentId' = 'null'::jsonb THEN 'null'::jsonb
                ELSE to_jsonb(left(t.client_request_payload->'componentSelection'->>'componentId', 512)) END,
              'selectionVersion', CASE WHEN jsonb_typeof(t.client_request_payload->'componentSelection'->'selectionVersion') IN ('number','null')
                THEN t.client_request_payload->'componentSelection'->'selectionVersion' ELSE 'false'::jsonb END),
            'visualEvidence', jsonb_build_object('fileId', left(t.client_request_payload->'visualEvidence'->>'fileId',512),
              'capturedAt', left(t.client_request_payload->'visualEvidence'->>'capturedAt',64)),
            'sourceDocIds', CASE WHEN jsonb_typeof(t.client_request_payload->'sourceDocIds') = 'array' THEN
              (SELECT coalesce(jsonb_agg(to_jsonb(left(item #>> '{}',512))), '[]'::jsonb)
                 FROM (SELECT value AS item FROM jsonb_array_elements(t.client_request_payload->'sourceDocIds')
                        WHERE jsonb_typeof(value)='string' LIMIT 100) bounded_ids)
              ELSE '[]'::jsonb END)`;
    const { rows } = await client.query<RecoveryRow>(
      `SELECT t.id::text, t.client_request_id::text, t.thread_id, t.question,
              t.client_request_state, t.answer_status, t.answer_text, t.evidence, t.equipment_entity_id,
              ${payload} AS client_request_payload, t.created_at,
              to_jsonb(t)->>'component_id' AS component_id,
              to_jsonb(t)->>'component_revision' AS component_revision,
              n.equipment_entity_id AS current_equipment_entity_id,
              coalesce(t.client_request_started_at < now() - interval '10 minutes', true) AS stale
         FROM equipment_notebook_turns t
         JOIN equipment_notebooks n ON n.id=t.notebook_id AND n.tenant_id=t.tenant_id
        WHERE t.tenant_id=$1::uuid AND t.notebook_id=$2::uuid
          AND t.owner_user_id=$3 AND t.thread_id IS NOT DISTINCT FROM $4::text
          AND t.client_request_id=$5::uuid
        LIMIT 1`,
      [tenantId, notebookId, ownerUserId, threadId, requestId],
    );
    return rows[0] ?? null;
  }, { signal, readOnly: true });
}

export async function readTurnRecovery(...args: Parameters<typeof readRecoveryRow>) {
  const row = await readRecoveryRow(...args);
  return row ? recoveryView(row) : null;
}

/** Server-only: resolve the exact original request, including its history and
 * attachment intent. The browser cannot replace any part of a recovered send. */
export async function readTurnRetry(...args: Parameters<typeof readRecoveryRow>) {
  const row = await readRecoveryRow(args[0], args[1], args[2], args[3], args[4], args[5], true);
  if (!row) return { error: "retry_request_not_found" as const, status: 404 };
  const view = recoveryView(row);
  if (view.state === "pending") return { error: "request_in_progress" as const, status: 409 };
  if (view.target.kind !== "known") return { error: "retry_target_unknown" as const, status: 409 };
  if (row.answer_status === "error" && !view.canRetry) return { error: "retry_request_unavailable" as const, status: 409 };
  const body = row.client_request_payload as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)
      || typeof body.clientRequestId !== "string" || body.clientRequestId.toLowerCase() !== row.client_request_id
      || typeof body.message !== "string" || body.message.trim() !== row.question
      || (body.threadId == null || body.threadId === "legacy" ? null : body.threadId) !== row.thread_id || "retryRequestId" in body) {
    return { error: "retry_request_unavailable" as const, status: 409 };
  }
  return { body, target: view.target, component: view.component };
}
