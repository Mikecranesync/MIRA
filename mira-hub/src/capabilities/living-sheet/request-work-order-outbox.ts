/**
 * TASK-OUTBOX-CREATE-WO — technician-confirmed "request an Atlas work order"
 * -> the SAME transactional outbox `finish-outbox.ts` (job_finished) and
 * fix records use (src/capabilities/cmms-dispatch/**, migrations 111/112 +
 * 114's widening of `notebook_domain_events_event_type_check` /
 * `notebook_event_deliveries_operation_check`). No second delivery system:
 * the dispatcher (dispatcher.ts) already claims, delivers, and verifies
 * `notebook_domain_events` rows by branching on `operation` — this file only
 * has to put ONE row there per job sheet.
 *
 * Mirrors `finish-outbox.ts::enqueueJobFinishedEvent`'s structure exactly
 * (shared aggregate lock + sequence allocation via `cmms-dispatch/enqueue.ts`,
 * same `ON CONFLICT ... DO NOTHING` idempotency on
 * `(tenant_id, event_type, subject_ref)` keyed by
 * `subjectRefForWorkOrderRequested(jobId)` — one event per job sheet, so a
 * double tap or a retried POST finds the existing event instead of creating
 * a second one — and the same replay-finds-its-own-delivery handling. Unlike
 * `job_finished`, the delivery's `operation` is `create_work_order` (114),
 * and the policy gate is its OWN switch, `workOrderRequested.enabled`
 * (`cmms-dispatch/types.ts`) — never `fixRecorded.enabled` — because
 * creating a NEW order is a materially different action from appending a
 * note to an existing one.
 *
 * The description body is rendered ONCE, here, via
 * `buildWorkOrderDescription(view)` and stored verbatim in the event
 * payload — exactly like `jobFinishedNote(view)` is computed once and stored
 * in `payload.summary` — so a later dispatcher tick delivers the sheet
 * snapshot as it stood at request time, not whatever the sheet has become
 * by then. The idempotency marker is NOT embedded here: the write provider
 * (Atlas and the mock) prepends `WorkOrderRequest.marker` to
 * `WorkOrderRequest.description` itself, exactly like `WorkLogNote.text` /
 * `renderWorkLogText` — see `work-order-description.ts`'s file header.
 */
import type { PoolClient } from "pg";
import { CMMS_LICENCE_LIMIT } from "@/lib/cmms/write-contract";
import type { SheetView } from "./reduce";
import { buildWorkOrderDescription } from "./work-order-description";
import {
  aggregateKeyFor,
  lockAggregate,
  loadTenantWritePolicy,
  nextAggregateSequence,
  POLICY_VERSION,
  subjectRefForWorkOrderRequested,
  type DomainEventRow,
  type EnqueueResult,
} from "@/capabilities/cmms-dispatch";

/** Hub-native default priority for a technician-requested work order — same
 *  literal `work-orders/route.ts` falls back to for an unspecified priority.
 *  The Atlas write provider converts Hub-shaped priority to Atlas's
 *  uppercase enum (`priorityHubToAtlas`, same mapper `lib/atlas/sync.ts`
 *  uses) at write time, same as every other Hub->Atlas write — this payload
 *  stays Hub-shaped, never provider-specific. */
const DEFAULT_PRIORITY = "medium";

export type EnqueueWorkOrderRequestedInput = {
  tenantId: string;
  notebookId: string;
  jobId: string;
  view: SheetView;
  actorUserId: string | null;
  occurredAt: string;
};

/**
 * Enqueue one `work_order_requested` domain event (+ its `create_work_order`
 * delivery row, when policy allows it). Runs INSIDE the caller's
 * transaction (never BEGIN/COMMIT itself) — the new API route action calls
 * this in the same transaction it uses to read/validate the sheet, so a
 * crash between validating and enqueueing can never leave half a request
 * behind.
 */
export async function enqueueWorkOrderRequestedEvent(
  c: PoolClient,
  input: EnqueueWorkOrderRequestedInput,
): Promise<EnqueueResult> {
  const aggregateKey = aggregateKeyFor(input.notebookId);
  const subjectRef = subjectRefForWorkOrderRequested(input.jobId);

  // (a) Serialize sequence allocation for this notebook's aggregate — shared
  // with every other event type on the same notebook.
  await lockAggregate(c, aggregateKey);

  // (b) Next sequence for this aggregate, under the advisory lock from (a).
  const sequence = await nextAggregateSequence(c, aggregateKey);

  const description = buildWorkOrderDescription(input.view);
  const payload = {
    jobId: input.jobId,
    title: input.view.title,
    description,
    priority: DEFAULT_PRIORITY,
  };

  // (c) Insert, deduplicated on (tenant_id, event_type, subject_ref). A
  // conflict means a prior call already created the canonical event for
  // this job's work-order request — fetch it instead of creating a second
  // one (this is what makes a double tap / retried POST a no-op).
  const insertRes = await c.query<DomainEventRow>(
    `INSERT INTO notebook_domain_events (
        tenant_id, notebook_id, turn_id, thread_id, equipment_entity_id, asset_uns_path,
        aggregate_key, sequence, event_type, occurred_at, actor_user_id,
        origin_system, information_status, correlation_id, causation_id,
        policy_version, subject_ref, payload
      )
      VALUES (
        $1::uuid, $2::uuid, NULL, NULL, $3, NULL,
        $4, $5::bigint, 'work_order_requested', $6::timestamptz, $7,
        'mira_hub', 'technician_reported', gen_random_uuid(), NULL,
        $8, $9, $10::jsonb
      )
      ON CONFLICT ON CONSTRAINT notebook_domain_events_subject_uniq DO NOTHING
      RETURNING *`,
    [
      input.tenantId,
      input.notebookId,
      input.view.machine.entityId,
      aggregateKey,
      sequence,
      input.occurredAt,
      input.actorUserId,
      POLICY_VERSION,
      subjectRef,
      JSON.stringify(payload),
    ],
  );

  let eventRow: DomainEventRow;
  let replayed = false;
  if (insertRes.rows.length > 0) {
    eventRow = insertRes.rows[0]!;
  } else {
    replayed = true;
    const existing = await c.query<DomainEventRow>(
      `SELECT * FROM notebook_domain_events
        WHERE tenant_id = $1::uuid AND event_type = 'work_order_requested' AND subject_ref = $2`,
      [input.tenantId, subjectRef],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) {
      // notebook_domain_events is append-only (no DELETE grant) — a
      // conflict with no row behind it should be unreachable. Fail loud
      // rather than silently invent a second event.
      throw new Error(`enqueueWorkOrderRequestedEvent: conflict on ${subjectRef} but no existing row found`);
    }
    eventRow = existingRow;

    // On replay, the event's existing delivery (if any) is authoritative —
    // this is the double-tap / retry case: one event, one delivery, one
    // eventual create, no matter how many times the technician taps.
    const existingDelivery = await c.query<{ delivery_id: string; state: string; last_error: string | null }>(
      `SELECT delivery_id::text AS delivery_id, state, last_error FROM notebook_event_deliveries
        WHERE event_id = $1::uuid ORDER BY created_at LIMIT 1`,
      [eventRow.event_id],
    );
    if (existingDelivery.rows.length > 0) {
      const prior = existingDelivery.rows[0]!;
      // The one recovery a re-tap performs: a create the CMMS refused for its
      // licence cap on open orders (a 4xx before acting, so nothing exists)
      // goes back to `queued` (if the cap still holds, the next tick is refused
      // again: one attempt per tap). Same delivery,
      // same dedupe key, and the provider's read-back-before-create still
      // runs, so this can never yield a second order. Every other state —
      // including an access refusal — stays exactly as it was.
      if (prior.state === "permission_denied" && prior.last_error === CMMS_LICENCE_LIMIT) {
        await c.query(
          `UPDATE notebook_event_deliveries
              SET state = 'queued', next_attempt_at = now(), updated_at = now()
            WHERE delivery_id = $1::uuid AND state = 'permission_denied' AND last_error = $2`,
          [prior.delivery_id, CMMS_LICENCE_LIMIT],
        );
      }
      return {
        eventId: eventRow.event_id,
        sequence: Number(eventRow.sequence),
        replayed: true,
        delivery: { deliveryId: existingDelivery.rows[0]!.delivery_id, state: "queued" },
      };
    }
    // No delivery was ever created for this event (e.g. policy was disabled
    // at the original enqueue time) — fall through, which may create one
    // now under the CURRENT policy.
  }

  // (d) Policy gate + delivery, keyed on the EVENT's own id so a concurrent
  // double-attempt at creating the FIRST delivery for this event collides on
  // notebook_event_deliveries_dedupe_uniq and is resolved by lookup — never
  // a second delivery row. Gate is `workOrderRequested.enabled` — its OWN
  // switch, never `fixRecorded.enabled` (see file header).
  const config = await loadTenantWritePolicy(c, input.tenantId);

  if (!config) {
    return { eventId: eventRow.event_id, sequence: Number(eventRow.sequence), replayed, delivery: { deliveryId: null, reason: "no_connection" } };
  }
  if (!config.enabled) {
    return { eventId: eventRow.event_id, sequence: Number(eventRow.sequence), replayed, delivery: { deliveryId: null, reason: "connection_disabled" } };
  }
  if (!config.policy.workOrderRequested.enabled) {
    return { eventId: eventRow.event_id, sequence: Number(eventRow.sequence), replayed, delivery: { deliveryId: null, reason: "policy_disabled" } };
  }

  const dedupeKey = `${input.tenantId}|${config.provider}|${eventRow.event_id}|create_work_order`;
  const insertDelivery = await c.query<{ delivery_id: string }>(
    `INSERT INTO notebook_event_deliveries (
        tenant_id, event_id, aggregate_key, destination, connection_key, operation, dedupe_key, state
      )
      VALUES ($1::uuid, $2::uuid, $3, 'cmms', $4, 'create_work_order', $5, 'queued')
      ON CONFLICT ON CONSTRAINT notebook_event_deliveries_dedupe_uniq DO NOTHING
      RETURNING delivery_id::text AS delivery_id`,
    [input.tenantId, eventRow.event_id, aggregateKey, config.provider, dedupeKey],
  );

  let deliveryId: string;
  if (insertDelivery.rows.length > 0) {
    deliveryId = insertDelivery.rows[0]!.delivery_id;
  } else {
    const existingDelivery = await c.query<{ delivery_id: string }>(
      `SELECT delivery_id::text AS delivery_id FROM notebook_event_deliveries WHERE dedupe_key = $1`,
      [dedupeKey],
    );
    const existingDeliveryRow = existingDelivery.rows[0];
    if (!existingDeliveryRow) {
      throw new Error(`enqueueWorkOrderRequestedEvent: conflict on delivery ${dedupeKey} but no existing row found`);
    }
    deliveryId = existingDeliveryRow.delivery_id;
  }

  return {
    eventId: eventRow.event_id,
    sequence: Number(eventRow.sequence),
    replayed,
    delivery: { deliveryId, state: "queued" },
  };
}
