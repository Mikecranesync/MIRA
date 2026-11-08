/**
 * TASK-S7 — finish job -> outbox -> Atlas work log.
 *
 * When a job sheet finishes, it enqueues ONE `job_finished` domain event
 * through the SAME transactional outbox fix records use
 * (src/capabilities/cmms-dispatch/**, migrations 111/112 + 114's widening of
 * `notebook_domain_events_event_type_check`). No second delivery system: the
 * dispatcher (dispatcher.ts) already claims, delivers, and verifies
 * `notebook_domain_events` rows regardless of `event_type` — this file only
 * has to put a row there, in the SAME transaction as the `job_finished`
 * sheet event itself, so both land or neither does (store.ts::appendEvent
 * calls `enqueueJobFinishedEvent` before committing).
 *
 * POLICY GATE DECISION (reversible by Mike): this reuses the fix-records
 * gate verbatim — `config.enabled && config.policy.fixRecorded.enabled` —
 * rather than adding a separate `jobFinished` policy flag. Rationale: a
 * finished job sheet's work-log note is the same CLASS of export a recorded
 * fix is (a technician-reported note on the linked work order), and 114
 * intentionally does not add a new `tenant_cmms_config.write_policy` field.
 * If Mike wants job-finished notes gated independently of fix records, add
 * `fixRecorded`'s sibling (`jobFinished: { enabled, target }`) to
 * `cmms-dispatch/types.ts::WritePolicy` and branch here — this file is the
 * only call site that would need to change.
 *
 * WORDING RULE: MIRA's own framing in this note never says "fixed", "safe",
 * "repaired" or "resolved". Technician-typed text (job title, step text) is
 * quoted verbatim inside double quotes and never rewritten. A work record
 * that silently changes what the tech wrote is worse than one that quotes
 * them. `view.finished.summary` is not included.
 */
import type { PoolClient } from "pg";
import type { SheetReadingView, SheetStepView, SheetView } from "./reduce";
import {
  aggregateKeyFor,
  lockAggregate,
  loadTenantWritePolicy,
  nextAggregateSequence,
  POLICY_VERSION,
  type DomainEventRow,
  type EnqueueResult,
} from "@/capabilities/cmms-dispatch";

/** `notebook_domain_events.subject_ref` for a `job_finished` event — unique
 *  per (tenant, event_type), so a retried finish (same job) can never
 *  enqueue a second event (ON CONFLICT DO NOTHING in enqueueJobFinishedEvent
 *  below finds this one instead). */
export function subjectRefForJobFinished(jobId: string): string {
  return `work_sheet_jobs:${jobId}`;
}

/** Up to 3 open steps named explicitly ("step N \"text\""), then a "(+K
 *  more)" tail — bounds the clause's length regardless of how many steps are
 *  still open (the under-1000-char budget has to hold for a 50-step sheet,
 *  not just a typical one). */
function openStepsClause(steps: SheetStepView[]): string {
  const total = steps.length;
  if (total === 0) return "";
  const doneCount = steps.filter((s) => s.done).length;
  const open = steps.map((s, i) => ({ step: s, position: i + 1 })).filter(({ step }) => !step.done);
  if (open.length === 0) return ` Steps done ${doneCount} of ${total}.`;
  const shown = open
    .slice(0, 3)
    .map(({ step, position }) => `step ${position} "${step.text}"`)
    .join(", ");
  const extra = open.length > 3 ? ` (+${open.length - 3} more)` : "";
  return ` Steps done ${doneCount} of ${total}; still open: ${shown}${extra}.`;
}

function openQuestionsClause(openQuestions: number): string {
  return openQuestions > 0 ? ` Open questions: ${openQuestions}.` : "";
}

/** Only a reading that was ACTUALLY corrected (more than one history entry)
 *  gets a clause — a reading recorded once and never corrected has nothing
 *  noteworthy to say here. "Corrected from" cites the most recent superseded
 *  value, which is the one the current value replaced. */
function readingsClause(readings: SheetReadingView[]): string {
  const corrected = readings.filter((r) => r.history.length > 1);
  if (corrected.length === 0) return "";
  const parts = corrected.map((r) => {
    const superseded = r.history.filter((h) => h.superseded);
    const prior = superseded[superseded.length - 1];
    const priorText = prior ? ` (corrected from ${prior.value} ${prior.unit})` : "";
    return `${r.what} ${r.current.value} ${r.current.unit}${priorText}`;
  });
  return ` Readings: ${parts.join("; ")}.`;
}

/** Pure, no I/O. Deliberately excludes `view.finished.summary` (the
 *  technician's own free-text close-out note) — see the file header's
 *  WORDING RULE. Capped well under 1000 chars by the open-
 *  steps clause's own "(+K more)" bound, plus a hard truncate as a backstop
 *  for any combination this function didn't anticipate. */
export function jobFinishedNote(view: SheetView): string {
  const by = view.finished?.by ?? null;
  const prefix = `Job sheet finished${by ? ` (reported by ${by})` : ""}: "${view.title}".`;
  const raw = `${prefix}${openStepsClause(view.steps)}${openQuestionsClause(view.openQuestions)}${readingsClause(view.readings)}`;
  return raw.length > 999 ? `${raw.slice(0, 950)}…` : raw;
}

export type EnqueueJobFinishedInput = {
  tenantId: string;
  notebookId: string;
  jobId: string;
  view: SheetView;
  actorUserId: string | null;
  occurredAt: string;
};

/**
 * Enqueue one `job_finished` domain event (+ its delivery row, when policy
 * allows it). Runs INSIDE the caller's transaction (never BEGIN/COMMIT
 * itself) — store.ts::appendEvent calls this in the SAME transaction as the
 * `job_finished` work_sheet_events row, so both land or neither does.
 *
 * Mirrors `cmms-dispatch/enqueue.ts::enqueueFixRecordedEvent`'s structure
 * (shared aggregate lock + sequence allocation, same ON CONFLICT DO NOTHING
 * idempotency on `(tenant_id, event_type, subject_ref)`, same replay-finds-
 * its-own-delivery handling, same policy-gate-then-delivery shape) but skips
 * the causation / turn-snapshot steps `enqueueFixRecordedEvent` does — a
 * finished job sheet has no prior "fix_recorded" lineage to chain off of
 * and, per TASK-S7, is never sourced from a chat turn.
 */
export async function enqueueJobFinishedEvent(c: PoolClient, input: EnqueueJobFinishedInput): Promise<EnqueueResult> {
  const aggregateKey = aggregateKeyFor(input.notebookId);
  const subjectRef = subjectRefForJobFinished(input.jobId);

  // (a) Serialize sequence allocation for this notebook's aggregate — shared
  // with fix_recorded and observation_recorded events on the same notebook.
  await lockAggregate(c, aggregateKey);

  // (b) Next sequence for this aggregate, under the advisory lock from (a).
  const sequence = await nextAggregateSequence(c, aggregateKey);

  const note = jobFinishedNote(input.view);
  const payload = {
    jobId: input.jobId,
    title: input.view.title,
    finishedBy: input.view.finished?.by ?? null,
    summary: note,
    openSteps: input.view.openSteps,
    openQuestions: input.view.openQuestions,
    finishSeq: input.view.seq,
    // So the EXISTING dispatcher fallback (buildNoteText) can still read a
    // job_finished event unchanged if dispatcher.ts's branch is ever reverted.
    symptom: input.view.title,
    faultCode: null as string | null,
    fix: note,
  };

  // (c) Insert, deduplicated on (tenant_id, event_type, subject_ref). A
  // conflict means a prior call already created the canonical event for
  // this job's finish — fetch it instead of creating a second one.
  const insertRes = await c.query<DomainEventRow>(
    `INSERT INTO notebook_domain_events (
        tenant_id, notebook_id, turn_id, thread_id, equipment_entity_id, asset_uns_path,
        aggregate_key, sequence, event_type, occurred_at, actor_user_id,
        origin_system, information_status, correlation_id, causation_id,
        policy_version, subject_ref, payload
      )
      VALUES (
        $1::uuid, $2::uuid, NULL, NULL, $3, NULL,
        $4, $5::bigint, 'job_finished', $6::timestamptz, $7,
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
        WHERE tenant_id = $1::uuid AND event_type = 'job_finished' AND subject_ref = $2`,
      [input.tenantId, subjectRef],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) {
      // notebook_domain_events is append-only (no DELETE grant) — a conflict
      // with no row behind it should be unreachable. Fail loud rather than
      // silently invent a second event.
      throw new Error(`enqueueJobFinishedEvent: conflict on ${subjectRef} but no existing row found`);
    }
    eventRow = existingRow;

    // On replay, the event's existing delivery (if any) is authoritative.
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
    // at the original enqueue time) — fall through, which may create one now
    // under the CURRENT policy.
  }

  // (d) Policy gate + delivery, keyed on the EVENT's own id so a concurrent
  // double-attempt at creating the FIRST delivery for this event collides on
  // notebook_event_deliveries_dedupe_uniq and is resolved by lookup — never a
  // second delivery row. Gate reused verbatim from fix records — see the
  // file header's POLICY GATE DECISION note.
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
      throw new Error(`enqueueJobFinishedEvent: conflict on delivery ${dedupeKey} but no existing row found`);
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
