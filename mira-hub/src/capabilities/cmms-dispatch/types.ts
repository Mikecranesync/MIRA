/**
 * Row types for the notebook domain-event outbox (migration 111) + the
 * parser for the write-policy JSONB embedded in `tenant_cmms_config.write_policy`
 * (#5020). Centralizing these here means a column rename in 111, or a change
 * to the policy shape, is caught by the type checker at every call site in
 * this capability instead of by a runtime KeyError in one forgotten file.
 *
 * `DomainEventRow` / `DeliveryRow` mirror migration 111's column lists
 * exactly (see `mira-hub/db/migrations/111_notebook_domain_events_outbox.sql`).
 * Timestamp columns are typed `string` here for simplicity even though `pg`
 * may hand back a `Date` for an uncast `timestamptz` column — `new Date(v)`
 * accepts both a `Date` and a string, so callers that need an ISO string do
 * `new Date(row.occurred_at).toISOString()` rather than trusting the exact
 * runtime type of this field.
 */
import type { DeliveryState } from "@/lib/cmms/write-contract";

/** Raw row shape of `notebook_domain_events` (migration 111). Append-only. */
export type DomainEventRow = {
  event_id: string;
  schema_version: number;
  tenant_id: string;
  notebook_id: string;
  turn_id: string | null;
  thread_id: string | null;
  equipment_entity_id: string | null;
  asset_uns_path: string | null;
  aggregate_key: string;
  /** BIGINT — `pg` returns bigint as a string to avoid precision loss. */
  sequence: string;
  event_type: "fix_recorded";
  occurred_at: string;
  recorded_at: string;
  actor_user_id: string | null;
  origin_system: "mira_hub";
  information_status: "technician_reported";
  correlation_id: string;
  causation_id: string | null;
  policy_version: string;
  subject_ref: string;
  payload: Record<string, unknown>;
};

/** Raw row shape of `notebook_event_deliveries` (migration 111). */
export type DeliveryRow = {
  delivery_id: string;
  tenant_id: string;
  event_id: string;
  aggregate_key: string;
  destination: "cmms";
  connection_key: string;
  operation: "append_work_log";
  dedupe_key: string;
  state: DeliveryState;
  attempts: number;
  next_attempt_at: string;
  lease_token: string | null;
  lease_until: string | null;
  external_ref: string | null;
  last_error: string | null;
  receipt: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/** A destination work order named directly by policy. */
export type WorkOrderPolicyTarget =
  | { kind: "work_order"; externalWorkOrderId: string }
  | { kind: "asset_linked_work_order" };

export type FixRecordedPolicy = {
  enabled: boolean;
  /** The only operation `notebook_event_deliveries.operation` allows today
   *  (111's CHECK) — present only when `enabled`. */
  operation?: "append_work_log";
  target?: WorkOrderPolicyTarget;
  internalTest?: boolean;
};

/** Parsed shape of `tenant_cmms_config.write_policy`. `{}` on the row means
 *  "never dispatch" — see `parseWritePolicy` below for how that default is
 *  produced. */
export type WritePolicy = {
  version: 1;
  fixRecorded: FixRecordedPolicy;
};

/** The permanently-disabled default — returned for `{}`, for `null`, and for
 *  any shape `parseWritePolicy` cannot trust. A malformed policy must never
 *  silently enable a CMMS write. */
const DISABLED_POLICY: WritePolicy = { version: 1, fixRecorded: { enabled: false } };

/**
 * Parse `tenant_cmms_config.write_policy` (raw JSONB) into a `WritePolicy`.
 * Unknown/invalid input, or an `enabled: true` block whose `target` doesn't
 * resolve to a supported kind, both degrade to the disabled default rather
 * than a partially-trusted policy — this is a write gate, so the fail mode
 * must be "don't dispatch", never "dispatch with a guessed target".
 *
 * Input is snake_case (as stored: `fix_recorded`, `internal_test`); output is
 * the camelCase `WritePolicy` the rest of this capability reads.
 */
export function parseWritePolicy(raw: unknown): WritePolicy {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return DISABLED_POLICY;
  const obj = raw as Record<string, unknown>;

  const fr = obj.fix_recorded;
  if (fr === null || typeof fr !== "object" || Array.isArray(fr)) return DISABLED_POLICY;
  const frObj = fr as Record<string, unknown>;

  if (frObj.enabled !== true) {
    return { version: 1, fixRecorded: { enabled: false } };
  }

  const rawTarget = frObj.target;
  if (rawTarget === null || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    return DISABLED_POLICY;
  }
  const t = rawTarget as Record<string, unknown>;

  let target: WorkOrderPolicyTarget;
  if (t.kind === "work_order") {
    const extId = t.externalWorkOrderId;
    if (typeof extId !== "string" || extId.trim().length === 0) return DISABLED_POLICY;
    target = { kind: "work_order", externalWorkOrderId: extId };
  } else if (t.kind === "asset_linked_work_order") {
    target = { kind: "asset_linked_work_order" };
  } else {
    return DISABLED_POLICY;
  }

  const internalTest = frObj.internal_test === true;

  return {
    version: 1,
    fixRecorded: {
      enabled: true,
      operation: "append_work_log",
      target,
      ...(internalTest ? { internalTest: true } : {}),
    },
  };
}

/** Stamped onto `notebook_domain_events.policy_version` at enqueue time. */
export const POLICY_VERSION = "write-policy/1";

/** The one `notebook_domain_events.event_type` this capability produces. */
export const EVENT_TYPE_FIX_RECORDED = "fix_recorded";

/** One aggregate per notebook — every fix_recorded event for a notebook
 *  shares this key, which is what gives them a single total sequence order
 *  and lets the dispatcher's ordering guard compare "older event, same
 *  machine" across different fix records. */
export function aggregateKeyFor(notebookId: string): string {
  return `notebook:${notebookId}`;
}

/** `notebook_domain_events.subject_ref` for a `fix_recorded` event — unique
 *  per (tenant, event_type), which is what makes a retried enqueue call a
 *  no-op (ON CONFLICT DO NOTHING) instead of a second event. */
export function subjectRefForFix(fixRecordId: string): string {
  return `asset_fix_records:${fixRecordId}`;
}
