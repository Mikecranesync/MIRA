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
import {
  CONFLICTS_SHOWN,
  CONTEST_WINDOW_MS,
  entryOf,
  PROJECTOR_VERSION,
  type ContestSummary,
  type FactEntry,
  type ObservationRow,
} from "./project";
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

/** Rows kept per (fact, value) inside the contest window. The projection needs only the
 *  newest row of the values that do not oppose the current report (the current report and
 *  the newest repair), and only the newest CONFLICTS_SHOWN opposing reports to list them.
 *  Every opposing report is still counted and hashed in SQL (#5099, #5106). */
export const PROJECTION_ROWS_PER_VALUE = CONFLICTS_SHOWN;
export const HISTORY_PAGE_DEFAULT = 50;
export const HISTORY_PAGE_MAX = 100;

const PROJECTION_COLS = `o.id::text AS id, o.fact_key, o.fact_value, o.observed_at, o.recorded_at,
  o.recorded_by, o.verification_method, o.uncertainty, o.supersedes_id::text AS supersedes_id`;
const NOT_SUPERSEDED = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM asset_observations s WHERE s.supersedes_id = ${alias}.id)`;
/** The projector's total order (newestFirst): millisecond observed, millisecond recorded, id ascending. */
const PROJECTOR_ORDER = (alias: string) =>
  `date_trunc('milliseconds', ${alias}.observed_at) DESC, date_trunc('milliseconds', ${alias}.recorded_at) DESC, ${alias}.id ASC`;

/** Sargable superset of "observed in the contest window": the exact millisecond predicates sit
 *  beside it, and this bound lets the (tenant, machine, fact, observed_at) index range-scan the
 *  window instead of the machine's whole history (#5106). */
const IN_WINDOW = (alias: string) =>
  `${alias}.observed_at >= c.key_max - make_interval(secs => $4::double precision) - interval '1 millisecond'`;

/**
 * `cur`: per fact ($3), the current report in the projector's order and the newest active
 * repair inside the window (an older repair cannot move the window start). `contest`: every
 * active report opposing it, by the projector's exact rule at millisecond precision (opposite
 * value, observed no earlier than one hour before the current report and no earlier than the
 * newest repair). The two supersedes exclusions of the projector hold by construction here:
 * both rows are active, so neither supersedes the other.
 * Every read is bounded by the window, not by history: `n` walks the index from the newest
 * row, `m` sorts only that row's millisecond, and `e`, `contest` and the samples carry a
 * sargable 1 ms superset bound beside their exact predicates.
 */
const CONTEST_CTES = `cur AS (
    SELECT k.fact_key, m.id AS cur_id, m.observed_at AS key_max, m.opposing, e.repaired_at
      FROM unnest($3::text[]) AS k(fact_key)
      CROSS JOIN LATERAL (
        SELECT t.observed_at AS newest FROM asset_observations t
         WHERE t.tenant_id = $1::uuid AND t.equipment_entity_id = $2 AND t.fact_key = k.fact_key
           AND ${NOT_SUPERSEDED("t")}
         ORDER BY t.observed_at DESC
         LIMIT 1
      ) n
      CROSS JOIN LATERAL (
        SELECT a.id, a.observed_at,
               CASE a.fact_value WHEN 'present' THEN 'absent' WHEN 'absent' THEN 'present' END AS opposing
          FROM asset_observations a
         WHERE a.tenant_id = $1::uuid AND a.equipment_entity_id = $2 AND a.fact_key = k.fact_key
           AND a.observed_at >= date_trunc('milliseconds', n.newest)
           AND ${NOT_SUPERSEDED("a")}
         ORDER BY ${PROJECTOR_ORDER("a")}
         LIMIT 1
      ) m
      CROSS JOIN LATERAL (
        SELECT max(b.observed_at) AS repaired_at FROM asset_observations b
         WHERE b.tenant_id = $1::uuid AND b.equipment_entity_id = $2 AND b.fact_key = k.fact_key
           AND b.fact_value = 'repaired'
           AND b.observed_at >= m.observed_at - make_interval(secs => $4::double precision) - interval '1 millisecond'
           AND ${NOT_SUPERSEDED("b")}
      ) e
  ),
  contest AS (
    SELECT c.fact_key, o.id
      FROM cur c CROSS JOIN LATERAL (
        SELECT o.id FROM asset_observations o
         WHERE o.tenant_id = $1::uuid AND o.equipment_entity_id = $2
           AND o.fact_key = c.fact_key AND o.fact_value = c.opposing
           AND ${IN_WINDOW("o")}
           AND (c.repaired_at IS NULL OR o.observed_at >= c.repaired_at - interval '1 millisecond')
           AND date_trunc('milliseconds', o.observed_at)
               >= date_trunc('milliseconds', c.key_max) - make_interval(secs => $4::double precision)
           AND (c.repaired_at IS NULL OR date_trunc('milliseconds', o.observed_at) >= date_trunc('milliseconds', c.repaired_at))
           AND ${NOT_SUPERSEDED("o")}
      ) o
  )`;

function toProjectionRow(row: Record<string, unknown>): ObservationRow {
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
}

export type ProjectionInput = { rows: ObservationRow[]; contests: Partial<Record<FactKey, ContestSummary>> };

/**
 * What deriveObservedState needs for this MACHINE, and no more (#5098, #5106), in ONE
 * statement so the sample and the counts come from the same snapshot:
 * - rows: per fact and value, at most PROJECTION_ROWS_PER_VALUE active reports in the
 *   projector's order. For the opposing value they are the newest of the exact contest set
 *   (so the listed conflicts equal the full projection's); for the other values they are the
 *   newest inside the window, with 1 ms of slack (a superset is safe).
 * - contests: per fact, the exact number of opposing reports and the digest of all
 *   contributor ids (contributorDigestOf in SQL), so state, totals and stateVersion equal
 *   the full projection while the app holds a bounded number of rows.
 * The database reads the contest window to count it, never the machine's older history;
 * nothing past the bound leaves it.
 * No raw report, notebook, source turn or fingerprint is selected.
 */
export async function listProjectionRows(tenantId: string, equipmentEntityId: string): Promise<ProjectionInput> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `WITH ${CONTEST_CTES},
       summary AS (
         SELECT c.fact_key,
                (SELECT count(*) FROM contest x WHERE x.fact_key = c.fact_key)::int AS opposing_total,
                encode(sha256(convert_to((
                  SELECT string_agg(i.id, ',' ORDER BY i.id COLLATE "C")
                    FROM (SELECT x.id::text AS id FROM contest x WHERE x.fact_key = c.fact_key
                          UNION ALL SELECT c.cur_id::text) i
                ), 'UTF8')), 'hex') AS contributor_digest
           FROM cur c
       )
       SELECT r.*, s.opposing_total, s.contributor_digest
         FROM cur c
         JOIN summary s ON s.fact_key = c.fact_key
        CROSS JOIN unnest($5::text[]) AS v(fact_value)
        CROSS JOIN LATERAL (
          SELECT ${PROJECTION_COLS} FROM asset_observations o
           WHERE o.tenant_id = $1::uuid AND o.equipment_entity_id = $2
             AND o.fact_key = c.fact_key AND o.fact_value = v.fact_value
             AND ${IN_WINDOW("o")}
             AND CASE WHEN v.fact_value = c.opposing
                      THEN o.id IN (SELECT x.id FROM contest x WHERE x.fact_key = c.fact_key)
                      ELSE ${NOT_SUPERSEDED("o")}
                 END
           ORDER BY ${PROJECTOR_ORDER("o")}
           LIMIT $6::int
        ) r`,
      [tenantId, equipmentEntityId, [...FACT_KEYS], CONTEST_WINDOW_MS / 1000, [...FACT_VALUES], PROJECTION_ROWS_PER_VALUE],
    );
    const contests: ProjectionInput["contests"] = {};
    const rows = res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      contests[row.fact_key as FactKey] = {
        opposingTotal: Number(row.opposing_total),
        contributorDigest: String(row.contributor_digest),
      };
      return toProjectionRow(row);
    });
    return { rows, contests };
  });
}

export type ConflictPage =
  | { status: "ok"; rows: FactEntry[]; nextCursor: string | null }
  | { status: "invalid_cursor" };

/**
 * The reports opposing one fact's current report, in the projector's order, one bounded
 * page at a time (#5106): the continuation of a state's `conflicting` list. The cursor is
 * the id of the last report already seen and must still be in that contest; anything else
 * is `invalid_cursor` (the state changed: reread it), never a silent restart.
 */
export async function listConflictPage(
  tenantId: string,
  equipmentEntityId: string,
  factKey: FactKey,
  opts: { cursor: string | null; limit: number },
): Promise<ConflictPage> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit)), HISTORY_PAGE_MAX);
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `WITH ${CONTEST_CTES},
       page AS (
         SELECT o.*,
                date_trunc('milliseconds', o.observed_at) AS t_obs,
                date_trunc('milliseconds', o.recorded_at) AS t_rec
           FROM contest x JOIN asset_observations o ON o.id = x.id
       ),
       anchor AS (SELECT * FROM page WHERE id = $5::uuid)
       SELECT ${PROJECTION_COLS}, (SELECT count(*) FROM anchor)::int AS cursor_found
         FROM page o
        WHERE $5::uuid IS NULL OR EXISTS (
                SELECT 1 FROM anchor a
                 WHERE o.t_obs < a.t_obs
                    OR (o.t_obs = a.t_obs AND (o.t_rec < a.t_rec OR (o.t_rec = a.t_rec AND o.id > a.id))))
        ORDER BY ${PROJECTOR_ORDER("o")}
        LIMIT $6::int`,
      [tenantId, equipmentEntityId, [factKey], CONTEST_WINDOW_MS / 1000, opts.cursor, limit + 1],
    );
    if (opts.cursor) {
      // An empty page cannot tell "past the end" from "no such cursor": ask once more.
      const found = res.rows.length > 0
        ? Number((res.rows[0] as Record<string, unknown>).cursor_found) > 0
        : (await c.query(
            `WITH ${CONTEST_CTES} SELECT 1 FROM contest WHERE id = $5::uuid`,
            [tenantId, equipmentEntityId, [factKey], CONTEST_WINDOW_MS / 1000, opts.cursor],
          )).rows.length > 0;
      if (!found) return { status: "invalid_cursor" };
    }
    const rows = res.rows.slice(0, limit).map((r) => entryOf(toProjectionRow(r as Record<string, unknown>)));
    return { status: "ok", rows, nextCursor: res.rows.length > limit ? rows[rows.length - 1]!.observationId : null };
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
