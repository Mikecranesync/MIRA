/**
 * Tenant-facing delivery status for a set of fix records (#5020) — "did my
 * recorded fix make it into the work order?" Reads under `withTenantContext`
 * (RLS), never the raw pool: this is a read a technician's own session can
 * trigger, so tenant isolation must be enforced by Postgres, not by trusting
 * every call site to filter correctly.
 *
 * A fix record with an event but no delivery row (policy disabled, no CMMS
 * connected, etc.) is reported as `"saved"` — the fix itself was recorded
 * successfully; it simply never queued for CMMS delivery. That is a
 * distinct, calmer answer than any `DeliveryState`, which is why the return
 * type is `DeliveryState | "saved"` rather than just `DeliveryState`.
 */
import { withTenantContext } from "@/lib/tenant-context";
import type { DeliveryState } from "@/lib/cmms/write-contract";
import { subjectRefForFix } from "./types";

export type FixRecordDeliveryStatus = {
  eventId: string;
  state: DeliveryState | "saved";
  externalRef: string | null;
  attempts: number;
  updatedAt: string;
};

export async function deliveryStatusForFixRecords(
  tenantId: string,
  fixRecordIds: string[],
): Promise<Map<string, FixRecordDeliveryStatus>> {
  const result = new Map<string, FixRecordDeliveryStatus>();
  if (fixRecordIds.length === 0) return result;

  const refToId = new Map(fixRecordIds.map((id) => [subjectRefForFix(id), id]));
  const subjectRefs = [...refToId.keys()];

  return withTenantContext(tenantId, async (c) => {
    const res = await c.query<{
      subject_ref: string;
      event_id: string;
      recorded_at: string;
      state: DeliveryState | null;
      external_ref: string | null;
      attempts: number | null;
      updated_at: string | null;
    }>(
      `SELECT e.subject_ref AS subject_ref,
              e.event_id::text AS event_id,
              e.recorded_at::text AS recorded_at,
              d.state, d.external_ref, d.attempts, d.updated_at::text AS updated_at
         FROM notebook_domain_events e
         LEFT JOIN LATERAL (
           SELECT state, external_ref, attempts, updated_at
             FROM notebook_event_deliveries
            WHERE event_id = e.event_id
            ORDER BY created_at DESC
            LIMIT 1
         ) d ON true
        WHERE e.tenant_id = $1::uuid
          AND e.event_type = 'fix_recorded'
          AND e.subject_ref = ANY($2::text[])`,
      [tenantId, subjectRefs],
    );

    for (const row of res.rows) {
      const fixRecordId = refToId.get(row.subject_ref);
      if (!fixRecordId) continue;
      result.set(fixRecordId, {
        eventId: row.event_id,
        state: row.state ?? "saved",
        externalRef: row.external_ref,
        attempts: row.attempts ?? 0,
        updatedAt: row.updated_at ?? row.recorded_at,
      });
    }
    return result;
  });
}
