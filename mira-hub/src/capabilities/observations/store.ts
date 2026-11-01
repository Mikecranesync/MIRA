/**
 * Technician observations — the writer and the asset-scoped reader.
 *
 * Schema: db/proposed/113_asset_observations.sql (append-only, RLS UUID family).
 * Same shape as capabilities/fix-records.ts::insertFixRecord: one
 * withTenantContext transaction, the binding checked IN the insert statement
 * (FOR SHARE), idempotency keyed on (tenant, client_request_id) with a request
 * fingerprint, and the domain event written by the SAME client. The event row
 * is `observation_recorded` with no delivery row: observations are never
 * dispatched to a CMMS.
 */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withTenantContext } from "@/lib/tenant-context";
import { aggregateKeyFor, POLICY_VERSION } from "@/capabilities/cmms-dispatch/types";
import { lockAggregate, nextAggregateSequence } from "@/capabilities/cmms-dispatch/enqueue";
import { FACT_KEYS, FACT_VALUES, type FactKey, type FactValue } from "./parse";
import { CONTEST_WINDOW_MS, PROJECTOR_VERSION, type ObservationRow } from "./project";
import type { ValidatedObservationInput } from "./validate";

/** What leaves this module: the fact, its author and times, the machine it
 *  is about. No notebook id, no source turn, no request fingerprint. */
export type ObservationRecord = ObservationRow & {
  rawReport: string;
  equipmentEntityId: string;
  assetUnsPath: string | null;
};

export type InsertObservationResult =
  | { status: "created"; observation: ObservationRecord; eventId: string; sequence: number }
  | { status: "existing"; observation: ObservationRecord }
  | { status: "request_id_conflict" }
  | { status: "binding_changed" }
  | { status: "source_turn_not_found" }
  | { status: "supersedes_not_found" };

/** Test seam. Used only by the crash test to throw between the observation
 *  insert and the event insert, proving the pair commits or rolls back together. */
export type InsertObservationDeps = { afterObservationInsert?: () => Promise<void> };

/** What a keyed save was. A retry replays only an identical fingerprint. The
 *  notebook and the machine are part of it, so a reused request id from another
 *  notebook or another machine is a conflict, never someone else's success. */
export function observationFingerprint(
  input: ValidatedObservationInput,
  notebookId: string,
  equipmentEntityId: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        notebookId,
        equipmentEntityId,
        input.factKey,
        input.factValue,
        input.observedAt,
        input.rawReport,
        input.sourceTurnId,
        input.supersedesId,
        input.verificationMethod,
      ]),
    )
    .digest("hex");
}

const RECORD_COLS = `o.id::text AS id, o.equipment_entity_id,
  o.asset_uns_path, o.fact_key, o.fact_value, o.raw_report, o.observed_at, o.recorded_at,
  o.recorded_by, o.verification_method, o.uncertainty, o.supersedes_id::text AS supersedes_id,
  o.request_fingerprint`;

function toRecord(r: Record<string, unknown>): ObservationRecord & { requestFingerprint: string } {
  return {
    id: String(r.id),
    equipmentEntityId: String(r.equipment_entity_id),
    assetUnsPath: (r.asset_uns_path as string) ?? null,
    factKey: r.fact_key as FactKey,
    factValue: r.fact_value as FactValue,
    rawReport: String(r.raw_report),
    observedAt: new Date(r.observed_at as string).toISOString(),
    recordedAt: new Date(r.recorded_at as string).toISOString(),
    recordedBy: (r.recorded_by as string) ?? null,
    verificationMethod: String(r.verification_method),
    uncertainty: String(r.uncertainty),
    supersedesId: (r.supersedes_id as string) ?? null,
    requestFingerprint: String(r.request_fingerprint),
  };
}

/** Strip the fingerprint from what leaves this module. */
function publicRecord(r: ReturnType<typeof toRecord>): ObservationRecord {
  const rest: Partial<ReturnType<typeof toRecord>> = { ...r };
  delete rest.requestFingerprint;
  return rest as ObservationRecord;
}

async function priorByRequest(
  c: PoolClient,
  tenantId: string,
  clientRequestId: string,
): Promise<ReturnType<typeof toRecord> | null> {
  const prior = await c.query(
    `SELECT ${RECORD_COLS} FROM asset_observations o
      WHERE o.tenant_id = $1::uuid AND o.client_request_id = $2::uuid`,
    [tenantId, clientRequestId],
  );
  return prior.rows.length > 0 ? toRecord(prior.rows[0] as Record<string, unknown>) : null;
}

/**
 * Record a technician-confirmed observation against the notebook's CURRENT
 * confirmed binding. `expectedEntityId` is the machine the route checked;
 * the insert refuses unless the notebook is still bound to it and confirmed.
 */
export async function insertObservation(
  tenantId: string,
  notebookId: string,
  expectedEntityId: string,
  assetUnsPath: string | null,
  input: ValidatedObservationInput,
  recordedBy: string | null,
  deps: InsertObservationDeps = {},
): Promise<InsertObservationResult> {
  const fingerprint = observationFingerprint(input, notebookId, expectedEntityId);
  return withTenantContext(tenantId, async (c) => {
    const classify = (prior: ReturnType<typeof toRecord>): InsertObservationResult =>
      prior.requestFingerprint === fingerprint
        ? { status: "existing", observation: publicRecord(prior) }
        : { status: "request_id_conflict" };

    const replay = await priorByRequest(c, tenantId, input.clientRequestId);
    if (replay) return classify(replay);

    if (input.sourceTurnId) {
      const turn = await c.query(
        `SELECT 1 FROM equipment_notebook_turns
          WHERE id = $1::uuid AND tenant_id = $2::uuid AND notebook_id = $3::uuid`,
        [input.sourceTurnId, tenantId, notebookId],
      );
      if (turn.rows.length === 0) return { status: "source_turn_not_found" };
    }
    if (input.supersedesId) {
      // Same tenant, same machine, same fact — a correction cannot cross a
      // machine or a fact. RLS already hides other tenants' rows.
      const target = await c.query(
        `SELECT 1 FROM asset_observations
          WHERE id = $1::uuid AND tenant_id = $2::uuid
            AND equipment_entity_id = $3 AND fact_key = $4`,
        [input.supersedesId, tenantId, expectedEntityId, input.factKey],
      );
      if (target.rows.length === 0) return { status: "supersedes_not_found" };
    }

    const res = await c.query(
      `INSERT INTO asset_observations
         (tenant_id, notebook_id, equipment_entity_id, asset_uns_path, fact_key, fact_value,
          raw_report, source_turn_id, observed_at, recorded_by, verification_method,
          uncertainty, supersedes_id, client_request_id, request_fingerprint, projector_version)
       SELECT $1::uuid, n.id, n.equipment_entity_id, $4, $5, $6, $7, $8::uuid, $9::timestamptz,
              $10, $11, 'unverified', $12::uuid, $13::uuid, $14, $15
         FROM equipment_notebooks n
        WHERE n.id = $2::uuid
          AND n.tenant_id = $1::uuid
          AND n.equipment_entity_id = $3
          AND n.asset_confirmed_at IS NOT NULL
          FOR SHARE
       ON CONFLICT (tenant_id, client_request_id) DO NOTHING
       RETURNING id::text AS id`,
      [
        tenantId,
        notebookId,
        expectedEntityId,
        assetUnsPath,
        input.factKey,
        input.factValue,
        input.rawReport,
        input.sourceTurnId,
        input.observedAt,
        recordedBy,
        input.verificationMethod,
        input.supersedesId,
        input.clientRequestId,
        fingerprint,
        PROJECTOR_VERSION,
      ],
    );

    if (res.rows.length === 0) {
      // Lost a race to the same request id, or the binding moved.
      const raced = await priorByRequest(c, tenantId, input.clientRequestId);
      return raced ? classify(raced) : { status: "binding_changed" };
    }

    const observationId = String((res.rows[0] as { id: string }).id);
    await deps.afterObservationInsert?.();

    // The event is the same transaction. Sequence allocation uses the same
    // per-notebook aggregate lock as fix events, so the two types interleave
    // in one total order.
    const aggregateKey = aggregateKeyFor(notebookId);
    await lockAggregate(c, aggregateKey);
    const sequence = await nextAggregateSequence(c, aggregateKey);
    const event = await c.query<{ event_id: string }>(
      `INSERT INTO notebook_domain_events (
          tenant_id, notebook_id, turn_id, thread_id, equipment_entity_id, asset_uns_path,
          aggregate_key, sequence, event_type, occurred_at, actor_user_id,
          origin_system, information_status, correlation_id, causation_id,
          policy_version, subject_ref, payload
        )
        VALUES (
          $1::uuid, $2::uuid, $3::uuid, NULL, $4, $5,
          $6, $7::bigint, 'observation_recorded', $8::timestamptz, $9,
          'mira_hub', 'technician_reported', gen_random_uuid(), NULL,
          $10, $11, $12::jsonb
        )
        RETURNING event_id::text AS event_id`,
      [
        tenantId,
        notebookId,
        input.sourceTurnId,
        expectedEntityId,
        assetUnsPath,
        aggregateKey,
        sequence,
        input.observedAt,
        recordedBy,
        POLICY_VERSION,
        `asset_observations:${observationId}`,
        JSON.stringify({
          observationId,
          factKey: input.factKey,
          factValue: input.factValue,
          observedAt: input.observedAt,
          verificationMethod: input.verificationMethod,
        }),
      ],
    );

    const row = await c.query(
      `SELECT ${RECORD_COLS} FROM asset_observations o WHERE o.id = $1::uuid`,
      [observationId],
    );
    return {
      status: "created",
      observation: publicRecord(toRecord(row.rows[0] as Record<string, unknown>)),
      eventId: String(event.rows[0]!.event_id),
      sequence,
    };
  });
}

/** Rows kept per (fact, value) inside the contest window, for every value that does
 *  NOT oppose the fact's current report. The projection needs only the newest row of
 *  those values (the current report and the newest repair). The opposing value is never
 *  capped: each of its active reports in the window is a contributor (#5099). */
export const PROJECTION_ROWS_PER_VALUE = 20;
export const HISTORY_PAGE_DEFAULT = 50;
export const HISTORY_PAGE_MAX = 100;

const PROJECTION_COLS = `o.id::text AS id, o.fact_key, o.fact_value, o.observed_at, o.recorded_at,
  o.recorded_by, o.verification_method, o.uncertainty, o.supersedes_id::text AS supersedes_id`;
const NOT_SUPERSEDED = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM asset_observations s WHERE s.supersedes_id = ${alias}.id)`;

/**
 * The rows deriveObservedState needs for this MACHINE, and no more (#5098): per fact,
 * the active (not superseded) reports observed within the contest window of that fact's
 * newest active report. Values that do not oppose the current report keep at most
 * PROJECTION_ROWS_PER_VALUE rows; the opposing value keeps every report after the newest
 * repair, so `conflicting`, the contributors and stateVersion equal the full projection
 * (#5099). Older rows cannot change the state (the window and the repair boundary only
 * look back from the newest report). No raw report, notebook, source turn or
 * fingerprint is selected.
 *
 * `m` picks the current report in the projector's own order (newestFirst: observed,
 * then recorded, both at millisecond precision, then id ascending), so an observed-time
 * tie between opposing reports uncaps the right value. Lower bounds give 1 ms of slack
 * because the projector compares millisecond instants; a superset is safe.
 */
export async function listProjectionRows(tenantId: string, equipmentEntityId: string): Promise<ObservationRow[]> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT r.* FROM unnest($3::text[]) AS k(fact_key)
       CROSS JOIN LATERAL (
         SELECT a.observed_at AS key_max,
                CASE a.fact_value WHEN 'present' THEN 'absent' WHEN 'absent' THEN 'present' END AS opposing
           FROM asset_observations a
          WHERE a.tenant_id = $1::uuid AND a.equipment_entity_id = $2 AND a.fact_key = k.fact_key
            AND ${NOT_SUPERSEDED("a")}
          ORDER BY date_trunc('milliseconds', a.observed_at) DESC, date_trunc('milliseconds', a.recorded_at) DESC, a.id ASC
          LIMIT 1
       ) m
       CROSS JOIN LATERAL (
         SELECT max(b.observed_at) AS repaired_at FROM asset_observations b
          WHERE b.tenant_id = $1::uuid AND b.equipment_entity_id = $2 AND b.fact_key = k.fact_key
            AND b.fact_value = 'repaired' AND ${NOT_SUPERSEDED("b")}
       ) e
       CROSS JOIN unnest($4::text[]) AS v(fact_value)
       CROSS JOIN LATERAL (
         SELECT ${PROJECTION_COLS} FROM asset_observations o
          WHERE o.tenant_id = $1::uuid AND o.equipment_entity_id = $2
            AND o.fact_key = k.fact_key AND o.fact_value = v.fact_value
            AND o.observed_at >= m.key_max - make_interval(secs => $5::double precision) - interval '1 millisecond'
            AND (v.fact_value IS DISTINCT FROM m.opposing OR e.repaired_at IS NULL
                 OR o.observed_at >= e.repaired_at - interval '1 millisecond')
            AND ${NOT_SUPERSEDED("o")}
          ORDER BY o.observed_at DESC, o.recorded_at DESC, o.id DESC
          LIMIT CASE WHEN v.fact_value = m.opposing THEN NULL ELSE $6::int END
       ) r`,
      [tenantId, equipmentEntityId, [...FACT_KEYS], [...FACT_VALUES], CONTEST_WINDOW_MS / 1000, PROJECTION_ROWS_PER_VALUE],
    );
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        factKey: row.fact_key as FactKey,
        factValue: row.fact_value as FactValue,
        observedAt: new Date(row.observed_at as string).toISOString(),
        recordedAt: new Date(row.recorded_at as string).toISOString(),
        recordedBy: (row.recorded_by as string) ?? null,
        verificationMethod: String(row.verification_method),
        uncertainty: String(row.uncertainty),
        supersedesId: (row.supersedes_id as string) ?? null,
      };
    });
  });
}

/** A history row as the customer inspects it: the record plus whether a correction replaced it. */
export type HistoryRecord = ObservationRecord & { superseded: boolean };

export type HistoryPage =
  | { status: "ok"; rows: HistoryRecord[]; nextCursor: string | null }
  | { status: "invalid_cursor" };

const HISTORY_COLS = `${RECORD_COLS},
  EXISTS (SELECT 1 FROM asset_observations s WHERE s.supersedes_id = o.id) AS superseded`;

function toHistory(r: Record<string, unknown>): HistoryRecord {
  return { ...publicRecord(toRecord(r)), superseded: r.superseded === true };
}

/**
 * Every observation on this MACHINE, across all notebooks of the tenant, newest
 * observed first, one bounded page at a time (#5098). The cursor is the id of the
 * last row of the previous page and must be a row of this machine; anything else is
 * `invalid_cursor`, never a silent restart. The readback is asset-scoped, so
 * technician B recovers what A recorded on a different notebook. No source turn,
 * notebook thread or chat text is selected.
 */
export async function listObservationHistory(
  tenantId: string,
  equipmentEntityId: string,
  opts: { cursor: string | null; limit: number },
): Promise<HistoryPage> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit)), HISTORY_PAGE_MAX);
  return withTenantContext(tenantId, async (c) => {
    if (opts.cursor) {
      const cur = await c.query(
        `SELECT 1 FROM asset_observations WHERE id = $1::uuid AND tenant_id = $2::uuid AND equipment_entity_id = $3`,
        [opts.cursor, tenantId, equipmentEntityId],
      );
      if (cur.rows.length === 0) return { status: "invalid_cursor" };
    }
    // The keyset comparison stays in SQL: timestamptz carries microseconds a JS Date would drop.
    const res = await c.query(
      `SELECT ${HISTORY_COLS} FROM asset_observations o
        WHERE o.tenant_id = $1::uuid AND o.equipment_entity_id = $2
          ${opts.cursor ? `AND (o.observed_at, o.recorded_at, o.id) <
            (SELECT c.observed_at, c.recorded_at, c.id FROM asset_observations c WHERE c.id = $4::uuid)` : ""}
        ORDER BY o.observed_at DESC, o.recorded_at DESC, o.id DESC
        LIMIT $3`,
      opts.cursor ? [tenantId, equipmentEntityId, limit + 1, opts.cursor] : [tenantId, equipmentEntityId, limit + 1],
    );
    const rows = res.rows.slice(0, limit).map((r) => toHistory(r as Record<string, unknown>));
    return { status: "ok", rows, nextCursor: res.rows.length > limit ? rows[rows.length - 1]!.id : null };
  });
}

/** One observation on this MACHINE by id (the panel's save readback), or null. */
export async function getObservationForAsset(
  tenantId: string,
  equipmentEntityId: string,
  observationId: string,
): Promise<HistoryRecord | null> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT ${HISTORY_COLS} FROM asset_observations o
        WHERE o.id = $3::uuid AND o.tenant_id = $1::uuid AND o.equipment_entity_id = $2`,
      [tenantId, equipmentEntityId, observationId],
    );
    return res.rows[0] ? toHistory(res.rows[0] as Record<string, unknown>) : null;
  });
}
