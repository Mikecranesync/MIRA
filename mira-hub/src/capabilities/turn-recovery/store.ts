import { withTenantContext } from "@/lib/tenant-context";
import { recoveryView, type RecoveryRow } from "./contract";

/** One owner-scoped claim, including pending claims deliberately absent from completed history.
 * Read-only: observing a claim must not take it over, extend its lease or touch notebook recency.
 */
export async function readTurnRecovery(
  tenantId: string, notebookId: string, ownerUserId: string, threadId: string | null,
  requestId: string, signal?: AbortSignal,
) {
  return withTenantContext(tenantId, async (client) => {
    await client.query("SET LOCAL statement_timeout = '1500ms'");
    const { rows } = await client.query<RecoveryRow>(
      `SELECT t.id::text, t.client_request_id::text, t.thread_id, t.question,
              t.client_request_state, t.answer_status, t.equipment_entity_id,
              t.client_request_payload, t.created_at,
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
    return rows[0] ? recoveryView(rows[0]) : null;
  }, { signal, readOnly: true });
}
