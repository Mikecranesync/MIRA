/**
 * Enqueue one `fix_recorded` domain event (+ its delivery row, when policy
 * allows it) into the transactional outbox (migration 111). This is the
 * write side of #5020's trusted interaction loop: a technician's accepted
 * fix must become ONE durable event in the SAME transaction as
 * `asset_fix_records` itself — never a second, eventually-consistent
 * database, never fire-and-forget from the web request.
 *
 * Runs INSIDE the caller's transaction (never BEGIN/COMMIT itself) — the
 * caller is expected to be the same `withTenantContext` callback that just
 * inserted the `asset_fix_records` row (see `fix-records.ts::insertFixRecord`
 * for the pattern this hangs off of).
 *
 * Idempotency has two independent layers, both enforced by Postgres
 * constraints rather than an app-level check-then-act (the TOCTOU class of
 * bug `.claude/rules/mira-hub-migrations.md` and the part-search-claim
 * capability both exist to avoid):
 *   - the EVENT is unique on (tenant_id, event_type, subject_ref) — a retried
 *     enqueue for the same fix record finds the existing event via
 *     `ON CONFLICT ... DO NOTHING` and never creates a second one;
 *   - the DELIVERY is unique on `dedupe_key`, which is derived from the
 *     event's own id — so re-running the policy/delivery step against an
 *     already-enqueued event (the replay path) naturally dedupes the same
 *     way, with no special-casing needed.
 *
 * Sequence allocation (`aggregate_key, sequence`) is serialized with
 * `pg_advisory_xact_lock(hashtext(aggregate_key))`: two concurrent enqueues
 * for the SAME notebook must never compute the same next sequence, which a
 * bare `SELECT MAX(sequence)+1` cannot guarantee under concurrency.
 */
import type { PoolClient } from "pg";
import { loadTenantWritePolicy } from "./policy";
import { aggregateKeyFor, POLICY_VERSION, subjectRefForFix, type DomainEventRow } from "./types";

export type EnqueueResult = {
  eventId: string;
  sequence: number;
  /** True when this call found an existing event for the same fix record
   *  instead of creating a new one (a retried request, or a duplicate
   *  enqueue call) — the event and its delivery (if any) are always the
   *  ones from the FIRST successful enqueue, never a second pair. */
  replayed: boolean;
  delivery:
    | { deliveryId: string; state: "queued" }
    | { deliveryId: null; reason: "no_connection" | "connection_disabled" | "policy_disabled" };
};

export type EnqueueFixRecordedInput = {
  tenantId: string;
  notebookId: string;
  fixRecordId: string;
  sourceTurnId: string | null;
  equipmentEntityId: string | null;
  symptom: string;
  faultCode: string | null;
  fix: string;
  recordedBy: string | null;
  occurredAt: string;
};

/** Serialize sequence allocation for one aggregate. Held for the rest of the
 *  CALLER's transaction (xact-scoped — no manual unlock). Shared with the
 *  observation writer (observations/store.ts) so both event types on one
 *  notebook take the same lock. */
export async function lockAggregate(c: PoolClient, aggregateKey: string): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [aggregateKey]);
}

/** Next sequence for an aggregate. Only meaningful under `lockAggregate`. */
export async function nextAggregateSequence(c: PoolClient, aggregateKey: string): Promise<number> {
  const seqRes = await c.query<{ next_sequence: string }>(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM notebook_domain_events WHERE aggregate_key = $1`,
    [aggregateKey],
  );
  return Number(seqRes.rows[0]!.next_sequence);
}

export async function enqueueFixRecordedEvent(
  c: PoolClient,
  input: EnqueueFixRecordedInput,
): Promise<EnqueueResult> {
  const aggregateKey = aggregateKeyFor(input.notebookId);
  const subjectRef = subjectRefForFix(input.fixRecordId);

  // (a) Serialize sequence allocation for this notebook's aggregate.
  await lockAggregate(c, aggregateKey);

  // (b) Per-turn snapshot (081): the machine + thread this answer was
  // actually grounded on, never re-resolved live. Nullable — not every fix
  // originates from a chat turn.
  let threadId: string | null = null;
  let turnAssetUnsPath: string | null = null;
  if (input.sourceTurnId) {
    const turnRes = await c.query<{ asset_uns_path: string | null; thread_id: string | null }>(
      `SELECT asset_uns_path, thread_id FROM equipment_notebook_turns
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND notebook_id = $3::uuid`,
      [input.sourceTurnId, input.tenantId, input.notebookId],
    );
    const row = turnRes.rows[0];
    if (row) {
      turnAssetUnsPath = row.asset_uns_path;
      threadId = row.thread_id;
    }
  }

  // (c) Causation: the most recent prior fix_recorded event on the SAME
  // machine within this notebook (aggregate_key is per-notebook, so a plain
  // sequence ordering is sufficient and avoids any clock-skew risk a
  // recorded_at ORDER BY would carry).
  let causationId: string | null = null;
  let supersedesFixRecordId: string | null = null;
  const priorRes = await c.query<{ event_id: string; payload: Record<string, unknown> }>(
    `SELECT event_id, payload FROM notebook_domain_events
      WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND event_type = 'fix_recorded'
        AND equipment_entity_id IS NOT DISTINCT FROM $3
      ORDER BY sequence DESC
      LIMIT 1`,
    [input.tenantId, input.notebookId, input.equipmentEntityId],
  );
  const priorRow = priorRes.rows[0];
  if (priorRow) {
    causationId = priorRow.event_id;
    const priorFixRecordId = priorRow.payload?.fixRecordId;
    if (typeof priorFixRecordId === "string") supersedesFixRecordId = priorFixRecordId;
  }

  // (d) Next sequence for this aggregate, under the advisory lock from (a).
  const sequence = await nextAggregateSequence(c, aggregateKey);

  const payload = {
    fixRecordId: input.fixRecordId,
    symptom: input.symptom,
    faultCode: input.faultCode,
    fix: input.fix,
    supersedesFixRecordId,
  };

  // (e) Insert, deduplicated on (tenant_id, event_type, subject_ref). A
  // conflict means a prior call already created the canonical event for
  // this fix record — fetch it instead of creating a second one.
  const insertRes = await c.query<DomainEventRow>(
    `INSERT INTO notebook_domain_events (
        tenant_id, notebook_id, turn_id, thread_id, equipment_entity_id, asset_uns_path,
        aggregate_key, sequence, event_type, occurred_at, actor_user_id,
        origin_system, information_status, correlation_id, causation_id,
        policy_version, subject_ref, payload
      )
      VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
        $7, $8::bigint, 'fix_recorded', $9::timestamptz, $10,
        'mira_hub', 'technician_reported', gen_random_uuid(), $11::uuid,
        $12, $13, $14::jsonb
      )
      ON CONFLICT ON CONSTRAINT notebook_domain_events_subject_uniq DO NOTHING
      RETURNING *`,
    [
      input.tenantId,
      input.notebookId,
      input.sourceTurnId,
      threadId,
      input.equipmentEntityId,
      turnAssetUnsPath,
      aggregateKey,
      sequence,
      input.occurredAt,
      input.recordedBy,
      causationId,
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
        WHERE tenant_id = $1::uuid AND event_type = 'fix_recorded' AND subject_ref = $2`,
      [input.tenantId, subjectRef],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) {
      // The unique constraint fired (a conflict happened) but the row is
      // gone — notebook_domain_events is append-only (no DELETE grant), so
      // this should be unreachable. Fail loud rather than silently invent
      // a second event.
      throw new Error(`enqueueFixRecordedEvent: conflict on ${subjectRef} but no existing row found`);
    }
    eventRow = existingRow;

    // On replay, the event's existing delivery (if any) is authoritative —
    // return it as-is rather than re-running the policy gate below. This
    // matters because the dedupe_key below is built from the CURRENT
    // tenant_cmms_config.provider: if the tenant's provider changed between
    // the original enqueue and this replay, re-deriving the key would miss
    // the original delivery row and mint a second one for the same event,
    // which is exactly the "never a second event or delivery" guarantee
    // this function exists to uphold.
    const existingDelivery = await c.query<{ delivery_id: string }>(
      `SELECT delivery_id::text AS delivery_id FROM notebook_event_deliveries
        WHERE event_id = $1::uuid ORDER BY created_at LIMIT 1`,
      [eventRow.event_id],
    );
    if (existingDelivery.rows.length > 0) {
      return {
        eventId: eventRow.event_id,
        sequence: Number(eventRow.sequence),
        replayed: true,
        delivery: { deliveryId: existingDelivery.rows[0]!.delivery_id, state: "queued" },
      };
    }
    // No delivery was ever created for this event (e.g. policy was disabled
    // at the original enqueue time) — fall through to (f) below, which may
    // create one now under the CURRENT policy.
  }

  // (f) Policy gate + delivery, keyed on the EVENT's own id so a concurrent
  // double-attempt at creating the FIRST delivery for this event (same
  // tenant, same provider) collides on notebook_event_deliveries_dedupe_uniq
  // and is resolved by lookup — never a second delivery row.
  const config = await loadTenantWritePolicy(c, input.tenantId);

  if (!config) {
    return { eventId: eventRow.event_id, sequence: Number(eventRow.sequence), replayed, delivery: { deliveryId: null, reason: "no_connection" } };
  }
  if (!config.enabled) {
    return { eventId: eventRow.event_id, sequence: Number(eventRow.sequence), replayed, delivery: { deliveryId: null, reason: "connection_disabled" } };
  }
  if (!config.policy.fixRecorded.enabled) {
    return { eventId: eventRow.event_id, sequence: Number(eventRow.sequence), replayed, delivery: { deliveryId: null, reason: "policy_disabled" } };
  }

  const dedupeKey = `${input.tenantId}|${config.provider}|${eventRow.event_id}|append_work_log`;
  const insertDelivery = await c.query<{ delivery_id: string }>(
    `INSERT INTO notebook_event_deliveries (
        tenant_id, event_id, aggregate_key, destination, connection_key, operation, dedupe_key, state
      )
      VALUES ($1::uuid, $2::uuid, $3, 'cmms', $4, 'append_work_log', $5, 'queued')
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
      throw new Error(`enqueueFixRecordedEvent: conflict on delivery ${dedupeKey} but no existing row found`);
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
