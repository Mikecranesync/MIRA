/**
 * Mission 001 observation store against real Postgres (A1, A2, A5, A6).
 * Harness copied from cmms-dispatch/__tests__/dispatcher.integration.test.ts:
 * the real withTenantContext (SET LOCAL ROLE factorylm_app + RLS) runs against
 * a disposable database. Migration 113 is applied here, twice, from
 * db/migrations (idempotency).
 *
 * Run (disposable DB only):
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/m001 MIRA_TEST_DB_CONFIRM=DISPOSABLE \
 *     npx vitest run --config vitest.integration.config.ts src/capabilities/observations
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { randomUUID as uuid } from "node:crypto";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import {
  getObservationForAsset,
  HISTORY_PAGE_MAX,
  listConflictPage,
  insertObservation,
  listObservationHistory,
  listProjectionRows,
  PROJECTION_ROWS_PER_VALUE,
  type HistoryRecord,
  type InsertObservationResult,
} from "../store";
import { CONFLICTS_SHOWN, deriveObservedState } from "../project";
import { loadObservedStateForTurn } from "../turn-context";
import type { ValidatedObservationInput } from "../validate";
import { enqueueFixRecordedEvent } from "@/capabilities/cmms-dispatch/enqueue";
import { withTenantContext } from "@/lib/tenant-context";

const MIGRATION = path.resolve(__dirname, "../../../../db/migrations/113_asset_observations.sql");

async function makeNotebook(tenantId: string, entityId: string | null, confirmed: boolean): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, equipment_entity_id, asset_confirmed_at)
     VALUES ($1::uuid, $2::uuid, 'obs test', $3, $4)
     RETURNING id::text AS id`,
    [tenantId, uuid(), entityId, entityId && confirmed ? new Date().toISOString() : null],
  );
  return res.rows[0]!.id;
}

function input(over: Partial<ValidatedObservationInput> = {}): ValidatedObservationInput {
  return {
    factKey: "seal_leak",
    factValue: "present",
    observedAt: new Date(Date.now() - 60_000).toISOString(),
    rawReport: "seal leaking at 09:10 — secret technician words",
    clientRequestId: uuid(),
    sourceTurnId: null,
    supersedesId: null,
    verificationMethod: "self_reported",
    ...over,
  };
}

async function counts(notebookId: string, entityId: string): Promise<{ obs: number; events: number }> {
  const o = await testPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM asset_observations WHERE notebook_id = $1::uuid AND equipment_entity_id = $2`,
    [notebookId, entityId],
  );
  const e = await testPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM notebook_domain_events WHERE notebook_id = $1::uuid AND event_type = 'observation_recorded'`,
    [notebookId],
  );
  return { obs: Number(o.rows[0]!.n), events: Number(e.rows[0]!.n) };
}

/** Every row via the paginated history (the only full read the store offers). */
async function allRows(tenantId: string, entityId: string): Promise<HistoryRecord[]> {
  const out: HistoryRecord[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await listObservationHistory(tenantId, entityId, { cursor, limit: HISTORY_PAGE_MAX });
    if (page.status !== "ok") throw new Error(page.status);
    out.push(...page.rows);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
}

/** The state the app serves: the bounded SQL read plus its exact contest counts. */
async function boundedState(tenantId: string, entityId: string, now: Date) {
  const { rows, contests } = await listProjectionRows(tenantId, entityId);
  return deriveObservedState(rows, { now, contests });
}

function created(r: InsertObservationResult): Extract<InsertObservationResult, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${r.status}`);
  return r;
}

beforeAll(async () => {
  const sql = readFileSync(MIGRATION, "utf8");
  // Idempotency: applying the proposed file twice must leave the same schema.
  await testPool.query(sql);
  await testPool.query(sql);
});

afterAll(async () => {
  await testPool.end();
});

describe("observation store (real Postgres)", () => {
  it("retry_same_request_id_creates_one_observation_and_one_event", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const req = input();

    const first = created(await insertObservation(tenant, nb, entity, "enterprise.lw.line1.pump07", req, "tech-1"));
    const second = await insertObservation(tenant, nb, entity, "enterprise.lw.line1.pump07", req, "tech-1");

    expect(second.status).toBe("existing");
    if (second.status === "existing") expect(second.observation.id).toBe(first.observation.id);
    expect(await counts(nb, entity)).toEqual({ obs: 1, events: 1 });
  });

  it("reused_request_id_with_different_content_conflicts", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const req = input();
    created(await insertObservation(tenant, nb, entity, null, req, "tech-1"));

    const changed = await insertObservation(tenant, nb, entity, null, { ...req, factValue: "absent" }, "tech-1");
    expect(changed.status).toBe("request_id_conflict");
    expect(await counts(nb, entity)).toEqual({ obs: 1, events: 1 });
  });

  it("unconfirmed_binding_cannot_record", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, false);
    const r = await insertObservation(tenant, nb, entity, null, input(), "tech-1");
    expect(r.status).toBe("binding_changed");
    expect(await counts(nb, entity)).toEqual({ obs: 0, events: 0 });
  });

  it("asset_mismatch_cannot_record", async () => {
    const tenant = uuid();
    const bound = `cmms-${uuid()}`;
    const other = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, bound, true);
    const r = await insertObservation(tenant, nb, other, null, input(), "tech-1");
    expect(r.status).toBe("binding_changed");
    expect(await counts(nb, bound)).toEqual({ obs: 0, events: 0 });
  });

  it("other_tenant_cannot_read_or_write", async () => {
    const owner = uuid();
    const intruder = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(owner, entity, true);
    created(await insertObservation(owner, nb, entity, null, input(), "tech-1"));

    const write = await insertObservation(intruder, nb, entity, null, input(), "tech-x");
    expect(write.status).toBe("binding_changed");
    expect(await allRows(intruder, entity)).toEqual([]);
    expect(await allRows(owner, entity)).toHaveLength(1);
  });

  it("event_failure_rolls_back_observation", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const req = input();
    await expect(
      insertObservation(tenant, nb, entity, null, req, "tech-1", {
        afterObservationInsert: async () => {
          throw new Error("simulated crash between observation and event");
        },
      }),
    ).rejects.toThrow("simulated crash");
    expect(await counts(nb, entity)).toEqual({ obs: 0, events: 0 });

    // Retry with the SAME request id after the rollback succeeds exactly once.
    created(await insertObservation(tenant, nb, entity, null, req, "tech-1"));
    expect(await counts(nb, entity)).toEqual({ obs: 1, events: 1 });
  });

  it("readback_from_second_notebook_same_asset_returns_fact_without_thread", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nbA = await makeNotebook(tenant, entity, true);
    created(await insertObservation(tenant, nbA, entity, "enterprise.lw.line1.pump07", input(), "tech-a"));
    // 081 allows one bound notebook per asset per tenant, so the "second
    // notebook" is a handover: A releases the machine and B binds it.
    await testPool.query(
      `UPDATE equipment_notebooks SET equipment_entity_id = NULL, asset_confirmed_at = NULL WHERE id = $1::uuid`,
      [nbA],
    );
    const nbB = await makeNotebook(tenant, entity, true);

    const rows = await allRows(tenant, entity);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ factKey: "seal_leak", factValue: "present", recordedBy: "tech-a" });
    const keys = Object.keys(rows[0]!);
    expect(keys).not.toContain("notebookId");
    expect(keys).not.toContain("sourceTurnId");
    expect(keys).not.toContain("requestFingerprint");

    // Technician B on notebook B sees the same machine state.
    const state = deriveObservedState(rows, { now: new Date() });
    expect(state.facts[0]!.state).toBe("leak_reported");
    expect(nbB).not.toBe(nbA);
    const readFromB = await allRows(tenant, entity);
    expect(readFromB.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("control_asset_state_unchanged", async () => {
    const tenant = uuid();
    const pumpA = `cmms-${uuid()}`;
    const pumpB = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, pumpA, true);
    created(await insertObservation(tenant, nb, pumpA, null, input(), "tech-1"));

    expect(await allRows(tenant, pumpB)).toEqual([]);
    const controlState = deriveObservedState(await allRows(tenant, pumpB), { now: new Date() });
    expect(controlState.facts).toEqual([]);
    expect(controlState.health).toBe("not_established");
  });

  it("event_row_is_uns_scoped_and_typed", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const uns = "enterprise.lw.line1.pump07";
    const ok = created(await insertObservation(tenant, nb, entity, uns, input(), "tech-1"));

    const ev = await testPool.query<{
      event_type: string;
      asset_uns_path: string | null;
      information_status: string;
      subject_ref: string;
      payload: Record<string, unknown>;
      equipment_entity_id: string | null;
    }>(
      `SELECT event_type, asset_uns_path, information_status, subject_ref, payload, equipment_entity_id
         FROM notebook_domain_events WHERE event_id = $1::uuid`,
      [ok.eventId],
    );
    const row = ev.rows[0]!;
    expect(row.event_type).toBe("observation_recorded");
    expect(row.asset_uns_path).toBe(uns);
    expect(row.equipment_entity_id).toBe(entity);
    expect(row.information_status).toBe("technician_reported");
    expect(row.subject_ref).toBe(`asset_observations:${ok.observation.id}`);
    expect(row.payload).not.toHaveProperty("rawReport");
    expect(JSON.stringify(row.payload)).not.toContain("secret technician words");

    // No delivery row: observations are never dispatched to a CMMS.
    const deliveries = await testPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notebook_event_deliveries WHERE event_id = $1::uuid`,
      [ok.eventId],
    );
    expect(Number(deliveries.rows[0]!.n)).toBe(0);
  });

  it("observation_then_fix_on_same_notebook_still_dispatches", async () => {
    // Regression for the dispatcher's ordering check: it reads deliveries, so an
    // observation event with no delivery row must not hold a later fix back.
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    created(await insertObservation(tenant, nb, entity, null, input(), "tech-1"));

    await testPool.query(
      `INSERT INTO tenant_cmms_config (tenant_id, provider, enabled, write_policy)
       VALUES ($1, 'atlas', true, $2::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET write_policy = $2::jsonb, enabled = true`,
      [tenant, JSON.stringify({ version: 1, fix_recorded: { enabled: true, operation: "append_work_log", target: { kind: "asset_linked_work_order" } } })],
    );
    const fixId = uuid();
    const fix = await withTenantContext(tenant, (c) =>
      enqueueFixRecordedEvent(c, {
        tenantId: tenant,
        notebookId: nb,
        fixRecordId: fixId,
        sourceTurnId: null,
        equipmentEntityId: entity,
        symptom: "seal leak",
        faultCode: null,
        fix: "replaced seal",
        recordedBy: "tech-1",
        occurredAt: new Date().toISOString(),
      }),
    );
    expect(fix.delivery.deliveryId).not.toBeNull();
    expect(fix.sequence).toBe(2); // observation took sequence 1 on the same aggregate
  });
  // #5093 (Codex #5091 F2): the rollback documented in 113 must succeed once an
  // observation_recorded event exists. The block is run statement-for-statement in
  // one transaction on a dedicated client, the end state asserted, then rolled back
  // so suites sharing this disposable database keep the table. ADD CONSTRAINT
  // validates immediately (nothing is deferred), so success here means COMMIT succeeds.
  it("documented_rollback_succeeds_after_an_observation_event_exists", async () => {
    const text = readFileSync(MIGRATION, "utf8");
    const m = text.match(/^-- ROLLBACK-BEGIN\n([\s\S]*?)^-- ROLLBACK-END$/m);
    expect(m, "113 must carry a ROLLBACK-BEGIN / ROLLBACK-END block").not.toBeNull();
    const block = m![1]!.split("\n").map((l) => l.replace(/^--   ?/, "")).join("\n").trim();
    expect(block.startsWith("BEGIN;")).toBe(true);
    expect(block.endsWith("COMMIT;")).toBe(true);
    const body = block.slice("BEGIN;".length, -"COMMIT;".length);

    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    created(await insertObservation(tenant, nb, entity, null, input(), "tech-1"));
    const fix = await testPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notebook_domain_events WHERE event_type = 'fix_recorded'`,
    );

    const c = await testPool.connect();
    try {
      await c.query("BEGIN");
      await c.query(body);
      const table = await c.query<{ r: string | null }>(`SELECT to_regclass('public.asset_observations')::text AS r`);
      expect(table.rows[0]!.r).toBeNull();
      const dangling = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM notebook_domain_events WHERE event_type = 'observation_recorded'`,
      );
      expect(dangling.rows[0]!.n).toBe("0");
      const kept = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM notebook_domain_events WHERE event_type = 'fix_recorded'`,
      );
      expect(kept.rows[0]!.n).toBe(fix.rows[0]!.n); // fix events are untouched
      const def = await c.query<{ d: string }>(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'notebook_domain_events_event_type_check'`,
      );
      expect(def.rows[0]!.d).toMatch(/fix_recorded/);
      expect(def.rows[0]!.d).not.toMatch(/observation_recorded/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    const still = await testPool.query<{ r: string | null }>(`SELECT to_regclass('public.asset_observations')::text AS r`);
    expect(still.rows[0]!.r).toBe("asset_observations");
  });
});

// #5098 (Codex #5091 r3 F2): the projection reads only what derives state, and the
// history is served in bounded pages. The table is append-only, so neither read may
// grow with the asset's lifetime.
describe("observation reads are bounded (real Postgres)", () => {
  const MIN = 60_000;

  async function seed(tenant: string, nb: string, entity: string, spec: Array<Partial<ValidatedObservationInput>>) {
    const ids: string[] = [];
    for (const over of spec) ids.push(created(await insertObservation(tenant, nb, entity, null, input(over), "tech-1")).observation.id);
    return ids;
  }

  /** Captures every result the app receives from Postgres while `fn` runs. */
  async function capturingResults<T>(fn: () => Promise<T>): Promise<{ value: T; results: Array<{ fields: string[]; rowCount: number }> }> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require("pg");
    const orig = Client.prototype.query;
    const results: Array<{ fields: string[]; rowCount: number }> = [];
    const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
      const r = orig.apply(this, args);
      if (r && typeof (r as Promise<unknown>).then === "function") {
        (r as Promise<{ fields?: Array<{ name: string }>; rows?: unknown[] }>).then(
          (res) => results.push({ fields: (res.fields ?? []).map((f) => f.name), rowCount: res.rows?.length ?? 0 }),
          () => undefined,
        );
      }
      return r;
    });
    try {
      return { value: await fn(), results };
    } finally {
      spy.mockRestore();
    }
  }

  it("history_is_cursor_paginated_with_a_maximum_page_size", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const t0 = Date.now() - 200 * MIN;
    const ids = await seed(tenant, nb, entity, Array.from({ length: 130 }, (_, i) => ({ observedAt: new Date(t0 + i * MIN).toISOString() })));
    const correction = created(
      await insertObservation(tenant, nb, entity, null, input({ factValue: "absent", supersedesId: ids[129]!, observedAt: new Date(t0 + 140 * MIN).toISOString() }), "tech-2"),
    ).observation.id;

    const p1 = await listObservationHistory(tenant, entity, { cursor: null, limit: 50 });
    if (p1.status !== "ok") throw new Error(p1.status);
    expect(p1.rows).toHaveLength(50);
    expect(p1.nextCursor).toEqual(expect.any(String));
    expect(p1.rows[0]!.id).toBe(correction);
    expect(p1.rows.find((r) => r.id === ids[129])?.superseded).toBe(true);
    expect(p1.rows[0]!.superseded).toBe(false);

    const all = await allRows(tenant, entity);
    expect(all).toHaveLength(131);
    expect(new Set(all.map((r) => r.id)).size).toBe(131);
    const observed = all.map((r) => r.observedAt);
    expect([...observed].sort().reverse()).toEqual(observed);

    const huge = await listObservationHistory(tenant, entity, { cursor: null, limit: 10_000 });
    if (huge.status !== "ok") throw new Error(huge.status);
    expect(huge.rows).toHaveLength(HISTORY_PAGE_MAX);

    // A cursor from another machine (or a made-up one) is refused, never treated as "start over".
    expect((await listObservationHistory(tenant, entity, { cursor: uuid(), limit: 50 })).status).toBe("invalid_cursor");
    const other = `cmms-${uuid()}`;
    const nbOther = await makeNotebook(tenant, other, true);
    const [foreign] = await seed(tenant, nbOther, other, [{}]);
    expect((await listObservationHistory(tenant, entity, { cursor: foreign!, limit: 50 })).status).toBe("invalid_cursor");

    expect((await getObservationForAsset(tenant, entity, ids[3]!))?.id).toBe(ids[3]);
    expect(await getObservationForAsset(tenant, other, ids[3]!)).toBeNull();
    expect(await getObservationForAsset(uuid(), entity, ids[3]!)).toBeNull();
  });

  it("projection_read_is_bounded_has_no_raw_report_and_matches_the_full_projection", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const t0 = Date.now() - 300 * MIN;
    // 120 old reports, then a leak and a repair 5 minutes apart in the last hour.
    await seed(tenant, nb, entity, Array.from({ length: 120 }, (_, i) => ({ observedAt: new Date(t0 + i * MIN).toISOString() })));
    const [leak, repair] = await seed(tenant, nb, entity, [
      { observedAt: new Date(Date.now() - 20 * MIN).toISOString() },
      { factValue: "repaired", observedAt: new Date(Date.now() - 15 * MIN).toISOString() },
    ]);

    const now = new Date();
    const projection = await listProjectionRows(tenant, entity);
    expect(projection.rows.length).toBeLessThanOrEqual(5);
    expect(projection.rows.map((r) => r.id)).toEqual(expect.arrayContaining([leak, repair]));
    for (const r of projection.rows) expect(Object.keys(r)).not.toContain("rawReport");

    const full = deriveObservedState(await allRows(tenant, entity), { now });
    const bounded = deriveObservedState(projection.rows, { now, contests: projection.contests });
    expect(bounded.facts).toEqual(full.facts);
    expect(bounded.stateVersion).toBe(full.stateVersion);
    expect(bounded.facts[0]!.state).toBe("repair_reported");

    const { value, results } = await capturingResults(() => loadObservedStateForTurn(tenant, entity, now));
    expect(value.frame?.stateVersion).toBe(full.stateVersion);
    expect(results.length).toBeGreaterThan(0);
    for (const res of results) expect(res.fields).not.toContain("raw_report");
    expect(Math.max(...results.map((r) => r.rowCount))).toBeLessThanOrEqual(5);
  });

  // #5099 (Codex #5091 r4 F1): every active opposing report in the window contributes,
  // so the per-value bound must never drop one of them.
  for (const [currentValue, opposingValue] of [["absent", "present"], ["present", "absent"]] as const) {
    it(`projection_keeps_every_opposing_report_beyond_the_per_value_bound_${currentValue}`, async () => {
      const tenant = uuid();
      const entity = `cmms-${uuid()}`;
      const nb = await makeNotebook(tenant, entity, true);
      const opposing = await seed(tenant, nb, entity, Array.from({ length: PROJECTION_ROWS_PER_VALUE + 1 }, (_, i) => ({
        factValue: opposingValue,
        observedAt: new Date(Date.now() - (50 - i) * MIN).toISOString(),
      })));
      const [current] = await seed(tenant, nb, entity, [{ factValue: currentValue, observedAt: new Date(Date.now() - 2 * MIN).toISOString() }]);

      const now = new Date();
      const full = deriveObservedState(await allRows(tenant, entity), { now });
      const bounded = await boundedState(tenant, entity, now);
      // Every opposing report is counted; the list is bounded and says where it continues.
      expect(full.facts[0]!.conflictTotal).toBe(PROJECTION_ROWS_PER_VALUE + 2);
      expect(full.facts[0]!.conflicting).toHaveLength(CONFLICTS_SHOWN);
      expect(bounded.facts).toEqual(full.facts);
      expect(bounded.stateVersion).toBe(full.stateVersion);
      expect(bounded.contributorCount).toBe(PROJECTION_ROWS_PER_VALUE + 2);
      expect(bounded.facts[0]!.conflictsNextCursor).toBe(bounded.facts[0]!.conflicting.at(-1)!.observationId);
      expect(bounded.facts[0]!.current.observationId).toBe(current);

      // The listed reports plus the continuation pages are exactly the contest, once each.
      const listed = bounded.facts[0]!.conflicting.slice(1).map((e) => e.observationId);
      const rest = await listConflictPage(tenant, entity, "seal_leak", { cursor: bounded.facts[0]!.conflictsNextCursor, limit: 100 });
      if (rest.status !== "ok") throw new Error(rest.status);
      expect(rest.nextCursor).toBeNull();
      expect([...listed, ...rest.rows.map((e) => e.observationId)].sort()).toEqual([...opposing].sort());

      const turn = await loadObservedStateForTurn(tenant, entity, now);
      expect(turn.frame?.stateVersion).toBe(full.stateVersion);
      expect(turn.frame?.contributorCount).toBe(PROJECTION_ROWS_PER_VALUE + 2);
      expect(turn.frame?.observationIds).toEqual(bounded.shownObservationIds);
      expect(turn.frame?.observationIds).toHaveLength(CONFLICTS_SHOWN);
      const lines = turn.section.split("\n");
      expect(lines.filter((l) => l.startsWith("  - seal_leak="))).toHaveLength(CONFLICTS_SHOWN);
      expect(lines).toContain("  - 2 more conflicting reports are not listed here; they are unresolved, not dismissed.");
    });
  }

  // Two technicians type the same "observed at" with opposite values. The store must pick
  // the projector's current report (newestFirst: recorded ms, then id) or it uncaps the
  // wrong value. Both values exceed the bound, so any wrong pick drops a contributor.
  for (const tieCase of ["recorded_a_second_apart", "recorded_same_instant", "recorded_same_millisecond"] as const) {
    it(`projection_picks_the_projectors_current_report_on_an_observed_time_tie_${tieCase}`, async () => {
      const tenant = uuid();
      const entity = `cmms-${uuid()}`;
      const nb = await makeNotebook(tenant, entity, true);
      for (const factValue of ["present", "absent"] as const) {
        await seed(tenant, nb, entity, Array.from({ length: PROJECTION_ROWS_PER_VALUE + 1 }, (_, i) => ({
          factValue,
          observedAt: new Date(Date.now() - (45 - i) * MIN - (factValue === "absent" ? 1000 : 0)).toISOString(),
        })));
      }
      const tie = new Date(Date.now() - 5 * MIN).toISOString();
      const [presentId] = await seed(tenant, nb, entity, [{ factValue: "present", observedAt: tie }]);
      const [absentId] = await seed(tenant, nb, entity, [{ factValue: "absent", observedAt: tie }]);
      const [lo, hi] = [presentId!, absentId!].sort();
      // Fixture timestamps only (the app role cannot UPDATE; this pool is the owner).
      // One base instant for both rows: now() per statement can cross a millisecond.
      const { rows: [{ base: baseAt }] } = await testPool.query<{ base: string }>(
        "SELECT date_trunc('milliseconds', now())::text AS base",
      );
      const setRecorded = (id: string, expr: string) =>
        testPool.query(`UPDATE asset_observations SET recorded_at = ${expr} WHERE id = $1::uuid`, [id, baseAt]);
      const base = "$2::timestamptz";
      if (tieCase === "recorded_a_second_apart") {
        await setRecorded(presentId!, `${base} - interval '1 second'`);
        await setRecorded(absentId!, base);
      } else if (tieCase === "recorded_same_instant") {
        await setRecorded(presentId!, base);
        await setRecorded(absentId!, base);
      } else {
        // Same millisecond to the projector; the larger id is later in microseconds.
        await setRecorded(lo!, `${base} + interval '100 microseconds'`);
        await setRecorded(hi!, `${base} + interval '600 microseconds'`);
      }

      const now = new Date();
      const full = deriveObservedState(await allRows(tenant, entity), { now });
      const expectedCurrent = tieCase === "recorded_a_second_apart" ? absentId : lo;
      expect(full.facts[0]!.current.observationId).toBe(expectedCurrent);
      expect(full.facts[0]!.conflictTotal).toBe(PROJECTION_ROWS_PER_VALUE + 3);
      const bounded = await boundedState(tenant, entity, now);
      expect(bounded.facts).toEqual(full.facts);
      expect(bounded.stateVersion).toBe(full.stateVersion);
    });
  }

  // #5105 (Codex #5104 r1 F1): more than the per-value bound of same-value reports, tied to
  // the millisecond. The projector picks the lowest id; the capped read must keep that row.
  it("projection_keeps_the_projectors_current_report_among_millisecond_tied_same_value_reports", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const tie = new Date(Date.now() - 5 * MIN).toISOString();
    const ids = await seed(tenant, nb, entity, Array.from({ length: PROJECTION_ROWS_PER_VALUE + 1 }, () => ({ observedAt: tie })));
    const [opposingId] = await seed(tenant, nb, entity, [{ factValue: "absent", observedAt: new Date(Date.now() - 10 * MIN).toISOString() }]);
    // Fixture timestamps only: one millisecond, the lowest id gets the smallest microseconds,
    // so a full-precision "newest recorded first" order ranks the projector's pick last.
    const { rows: [{ base: baseAt }] } = await testPool.query<{ base: string }>(
      "SELECT date_trunc('milliseconds', now())::text AS base",
    );
    const sorted = [...ids].sort();
    for (const [rank, id] of sorted.entries()) {
      await testPool.query(
        `UPDATE asset_observations SET recorded_at = $2::timestamptz + make_interval(secs => $3::double precision) WHERE id = $1::uuid`,
        [id, baseAt, (rank * 10) / 1e6],
      );
    }

    const now = new Date();
    const full = deriveObservedState(await allRows(tenant, entity), { now });
    expect(full.facts[0]!.current.observationId).toBe(sorted[0]);
    expect(full.facts[0]!.contested).toBe(true);
    const bounded = await boundedState(tenant, entity, now);
    expect(bounded.facts[0]!.current.observationId).toBe(sorted[0]);
    expect(bounded.facts).toEqual(full.facts);
    expect(bounded.stateVersion).toBe(full.stateVersion);
    expect(opposingId).toEqual(expect.any(String));
  });

  it("projection_does_not_read_opposing_reports_from_before_the_newest_repair", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    // 30 "no leak" reports, a repair, then a new leak — all inside one hour. The old
    // reports describe the machine before the work, so they neither contest nor get read.
    await seed(tenant, nb, entity, Array.from({ length: 30 }, (_, i) => ({
      factValue: "absent",
      observedAt: new Date(Date.now() - (55 - i / 2) * MIN).toISOString(),
    })));
    await seed(tenant, nb, entity, [
      { factValue: "repaired", observedAt: new Date(Date.now() - 20 * MIN).toISOString() },
      { factValue: "present", observedAt: new Date(Date.now() - 5 * MIN).toISOString() },
    ]);

    const now = new Date();
    const projection = await listProjectionRows(tenant, entity);
    expect(projection.rows.length).toBeLessThanOrEqual(PROJECTION_ROWS_PER_VALUE + 2);
    const full = deriveObservedState(await allRows(tenant, entity), { now });
    expect(full.facts[0]!.state).toBe("leak_reported");
    const bounded = deriveObservedState(projection.rows, { now, contests: projection.contests });
    expect(bounded.facts).toEqual(full.facts);
    expect(bounded.stateVersion).toBe(full.stateVersion);
  });

  it("projection_still_bounds_reports_that_do_not_oppose_the_current_one", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    // 30 agreeing leaks and 30 repairs before a final leak: none opposes the current report.
    await seed(tenant, nb, entity, Array.from({ length: 60 }, (_, i) => ({
      factValue: i % 2 === 0 ? "present" : "repaired",
      observedAt: new Date(Date.now() - (58 - i / 2) * MIN).toISOString(),
    })));
    await seed(tenant, nb, entity, [{ observedAt: new Date(Date.now() - MIN / 4).toISOString() }]);

    const now = new Date();
    const projection = await listProjectionRows(tenant, entity);
    expect(projection.rows.length).toBeLessThanOrEqual(2 * PROJECTION_ROWS_PER_VALUE);
    const full = deriveObservedState(await allRows(tenant, entity), { now });
    const bounded = deriveObservedState(projection.rows, { now, contests: projection.contests });
    expect(bounded.facts).toEqual(full.facts);
    expect(bounded.stateVersion).toBe(full.stateVersion);
  });

  /** Owner-pool bulk seed (fixtures only): `n` reports of one value, observed `obsExpr(i)`. */
  async function bulkSeed(tenant: string, nb: string, entity: string, n: number, factValue: string, obsExpr: string) {
    await testPool.query(
      `INSERT INTO asset_observations (tenant_id, notebook_id, equipment_entity_id, fact_key, fact_value, raw_report,
         observed_at, recorded_by, verification_method, client_request_id, request_fingerprint, projector_version)
       SELECT $1::uuid, $2::uuid, $3, 'seal_leak', $4, 'bulk', ${obsExpr}, 'tech-bulk', 'self_reported',
              gen_random_uuid(), 'bulk', 'fixture'
         FROM generate_series(1, $5::int) AS g(i)`,
      [tenant, nb, entity, factValue, n],
    );
  }

  // #5106 (Codex #5104 r1 F2): an adversarial burst. The state, its exact count and its
  // stateVersion equal the full projection, while every consumer gets a bounded payload.
  it("burst_of_ten_thousand_opposing_reports_is_counted_exactly_and_served_bounded", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const BURST = 10_000;
    await bulkSeed(tenant, nb, entity, BURST, "absent", "now() - interval '50 minutes' + g.i * interval '1 millisecond'");
    const [current] = await seed(tenant, nb, entity, [{ factValue: "present", observedAt: new Date(Date.now() - 2 * MIN).toISOString() }]);

    const now = new Date();
    const { value: turn, results } = await capturingResults(() => loadObservedStateForTurn(tenant, entity, now));
    const BOUND = 3 * PROJECTION_ROWS_PER_VALUE; // fact values × per-value bound, for the one fact
    expect(Math.max(...results.map((r) => r.rowCount))).toBeLessThanOrEqual(BOUND);
    for (const res of results) expect(res.fields).not.toContain("raw_report");

    const bounded = await boundedState(tenant, entity, now);
    const fact = bounded.facts[0]!;
    expect(fact.current.observationId).toBe(current);
    expect(fact.conflictTotal).toBe(BURST + 1);
    expect(bounded.contributorCount).toBe(BURST + 1);
    expect(fact.conflicting).toHaveLength(CONFLICTS_SHOWN);

    const full = deriveObservedState(await allRows(tenant, entity), { now });
    expect(bounded.facts).toEqual(full.facts);
    expect(bounded.stateVersion).toBe(full.stateVersion);

    // Documented hard bounds on what leaves the server.
    expect(JSON.stringify(bounded.facts).length).toBeLessThan(16_384); // GET state payload
    expect(turn.frame?.observationIds).toHaveLength(CONFLICTS_SHOWN); // persisted evidence frame
    expect(turn.frame?.contributorCount).toBe(BURST + 1);
    expect(turn.frame?.stateVersion).toBe(full.stateVersion);
    expect(turn.section.split("\n").length).toBeLessThanOrEqual(CONFLICTS_SHOWN + 4); // prompt section
    expect(turn.section).toContain(`${BURST + 1 - CONFLICTS_SHOWN} more conflicting reports are not listed here`);

    // One more hidden opposing report moves the version even though no listed row changes.
    await bulkSeed(tenant, nb, entity, 1, "absent", "now() - interval '55 minutes'");
    const after = await boundedState(tenant, entity, new Date());
    expect(after.facts[0]!.conflicting).toEqual(fact.conflicting);
    expect(after.facts[0]!.conflictTotal).toBe(BURST + 2);
    expect(after.stateVersion).not.toBe(bounded.stateVersion);
  }, 120_000);

  it("conflict_pages_follow_the_projector_order_through_millisecond_ties_and_refuse_bad_cursors", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    // 45 opposing reports in 3 observed milliseconds; recorded times inside one millisecond.
    await bulkSeed(tenant, nb, entity, 45, "absent", "date_trunc('milliseconds', now()) - interval '30 minutes' + (g.i % 3) * interval '1 millisecond'");
    await testPool.query(
      `UPDATE asset_observations SET recorded_at = date_trunc('milliseconds', now()) + (random() * 900)::int * interval '1 microsecond'
        WHERE equipment_entity_id = $1`,
      [entity],
    );
    const [current] = await seed(tenant, nb, entity, [{ factValue: "present", observedAt: new Date(Date.now() - 2 * MIN).toISOString() }]);
    await seed(tenant, nb, entity, [{ factValue: "repaired", observedAt: new Date(Date.now() - 90 * MIN).toISOString() }]);

    const now = new Date();
    const full = deriveObservedState(await allRows(tenant, entity), { now });
    const expected = full.history.filter((r) => r.factValue === "absent").map((r) => r.id); // projector order
    expect(expected).toHaveLength(45);

    const paged: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await listConflictPage(tenant, entity, "seal_leak", { cursor, limit: 7 });
      if (page.status !== "ok") throw new Error(page.status);
      expect(page.rows.length).toBeLessThanOrEqual(7);
      for (const e of page.rows) expect(Object.keys(e)).not.toContain("rawReport");
      paged.push(...page.rows.map((e) => e.observationId));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(paged).toEqual(expected);

    // The state's own continuation lines up with the pages.
    const bounded = await boundedState(tenant, entity, now);
    const cont = await listConflictPage(tenant, entity, "seal_leak", { cursor: bounded.facts[0]!.conflictsNextCursor, limit: 100 });
    if (cont.status !== "ok") throw new Error(cont.status);
    expect([...bounded.facts[0]!.conflicting.slice(1).map((e) => e.observationId), ...cont.rows.map((e) => e.observationId)]).toEqual(expected);

    // A cursor outside the contest is refused, never a restart: unknown id, the current
    // report itself, and a report on another fact.
    expect((await listConflictPage(tenant, entity, "seal_leak", { cursor: uuid(), limit: 7 })).status).toBe("invalid_cursor");
    expect((await listConflictPage(tenant, entity, "seal_leak", { cursor: current!, limit: 7 })).status).toBe("invalid_cursor");
    expect((await listConflictPage(tenant, entity, "vibration", { cursor: expected[0]!, limit: 7 })).status).toBe("invalid_cursor");
    // The last row is a valid cursor with an empty page after it.
    const last = await listConflictPage(tenant, entity, "seal_leak", { cursor: expected.at(-1)!, limit: 7 });
    expect(last).toEqual({ status: "ok", rows: [], nextCursor: null });
  });

  // The contest window and the repair boundary are compared at millisecond precision, as
  // the projector compares them. Sub-millisecond times on both sides of each edge.
  it("contest_edges_follow_the_projector_at_millisecond_precision", async () => {
    const tenant = uuid();
    const entity = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, entity, true);
    const T = Math.floor(Date.now() / 1000) * 1000 - 5 * MIN;
    const at = (ms: number) => new Date(ms).toISOString();
    const [current] = await seed(tenant, nb, entity, [{ factValue: "present", observedAt: at(T) }]);
    const [inEdge, outEdge, outSubMs, inSubMs] = await seed(tenant, nb, entity, [
      { factValue: "absent", observedAt: at(T - 60 * MIN) },
      { factValue: "absent", observedAt: at(T - 60 * MIN - 1) },
      { factValue: "absent", observedAt: at(T - 60 * MIN - 1) },
      { factValue: "absent", observedAt: at(T - 60 * MIN) },
    ]);
    // Fixture microseconds: current 0.7 ms past T; one row 0.2 ms before the hour edge (the
    // projector truncates it to 1 ms before: out, though a full-precision bound with 1 ms of
    // slack would keep it), one 0.2 ms after the edge (truncates onto it: in).
    const micro = (id: string, us: number) =>
      testPool.query(`UPDATE asset_observations SET observed_at = observed_at + make_interval(secs => $2::double precision) WHERE id = $1::uuid`, [id, us / 1e6]);
    await micro(current!, 700);
    await micro(outSubMs!, 800);
    await micro(inSubMs!, 200);

    const now = new Date();
    const full = deriveObservedState(await allRows(tenant, entity), { now });
    expect(full.facts[0]!.conflicting.map((e) => e.observationId).sort()).toEqual([current!, inEdge!, inSubMs!].sort());
    expect(outEdge).not.toBe(outSubMs);
    const bounded = await boundedState(tenant, entity, now);
    expect(bounded.facts).toEqual(full.facts);
    expect(bounded.stateVersion).toBe(full.stateVersion);

    // Repair boundary: a repair 0.6 ms into a millisecond; an opposing report 0.3 ms into the
    // same millisecond is not before it to the projector, so it still contests.
    const entity2 = `cmms-${uuid()}`;
    const nb2 = await makeNotebook(tenant, entity2, true);
    const R = T - 30 * MIN;
    const [repair, sameMs, before] = await seed(tenant, nb2, entity2, [
      { factValue: "repaired", observedAt: at(R) },
      { factValue: "absent", observedAt: at(R) },
      { factValue: "absent", observedAt: at(R - 1) },
    ]);
    const [cur2] = await seed(tenant, nb2, entity2, [{ factValue: "present", observedAt: at(T) }]);
    await micro(repair!, 600);
    await micro(sameMs!, 300);
    await micro(before!, 900);
    const full2 = deriveObservedState(await allRows(tenant, entity2), { now });
    expect(full2.facts[0]!.conflicting.map((e) => e.observationId).sort()).toEqual([cur2!, sameMs!].sort());
    const bounded2 = await boundedState(tenant, entity2, now);
    expect(bounded2.facts).toEqual(full2.facts);
    expect(bounded2.stateVersion).toBe(full2.stateVersion);

    // Current report inside one millisecond: the report 0.2 ms in was recorded later than the
    // one 0.8 ms in, so the projector picks it; a full-precision "newest" bound would drop it.
    const entity3 = `cmms-${uuid()}`;
    const nb3 = await makeNotebook(tenant, entity3, true);
    // An earlier "present" report opposes the true current report but not the mutant's pick.
    const [late, early, earlier] = await seed(tenant, nb3, entity3, [
      { factValue: "present", observedAt: at(T) },
      { factValue: "absent", observedAt: at(T) },
      { factValue: "present", observedAt: at(T - 10 * MIN) },
    ]);
    await micro(late!, 800);
    await micro(early!, 200);
    await testPool.query(
      `UPDATE asset_observations SET recorded_at = (SELECT recorded_at FROM asset_observations WHERE id = $1::uuid) + interval '5 milliseconds' WHERE id = $2::uuid`,
      [late, early],
    );
    const full3 = deriveObservedState(await allRows(tenant, entity3), { now });
    expect(full3.facts[0]!.current.observationId).toBe(early!);
    expect(full3.facts[0]!.conflictTotal).toBe(3);
    expect(full3.facts[0]!.conflicting.map((e) => e.observationId).sort()).toEqual([early!, late!, earlier!].sort());
    const bounded3 = await boundedState(tenant, entity3, now);
    expect(bounded3.facts).toEqual(full3.facts);
    expect(bounded3.stateVersion).toBe(full3.stateVersion);
  });

  it("projection_matches_the_full_projection_at_millisecond_ties_and_window_edges", async () => {
    let seedN = 5106;
    const rand = () => ((seedN = (seedN * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const values = ["present", "absent", "repaired"] as const;
    for (let round = 0; round < 8; round++) {
      const tenant = uuid();
      const entity = `cmms-${uuid()}`;
      const nb = await makeNotebook(tenant, entity, true);
      const anchorMs = Math.floor(Date.now() / 1000) * 1000 - 10 * MIN;
      // Observed times cluster on the anchor, exactly one hour before it, and one millisecond
      // either side of that edge, so ties and window edges dominate.
      const offsets = [0, 0, 0, -1, -60 * MIN, -60 * MIN - 1, -60 * MIN + 1, -30 * MIN];
      const made: string[] = [];
      for (let i = 0; i < 40; i++) {
        const supersedesId = made.length > 0 && rand() < 0.15 ? made[Math.floor(rand() * made.length)]! : null;
        const r = created(await insertObservation(tenant, nb, entity, null, input({
          factValue: values[Math.floor(rand() * values.length)]!,
          observedAt: new Date(anchorMs + offsets[Math.floor(rand() * offsets.length)]!).toISOString(),
          supersedesId,
        }), "tech-1"));
        made.push(r.observation.id);
      }
      // Sub-millisecond recorded times: half the rows share one millisecond.
      await testPool.query(
        `UPDATE asset_observations SET recorded_at = date_trunc('milliseconds', now())
                + (CASE WHEN random() < 0.5 THEN 0 ELSE 1 END) * interval '1 millisecond'
                + (random() * 999)::int * interval '1 microsecond'
          WHERE equipment_entity_id = $1`,
        [entity],
      );
      const now = new Date();
      const full = deriveObservedState(await allRows(tenant, entity), { now });
      const bounded = await boundedState(tenant, entity, now);
      expect({ round, facts: bounded.facts, v: bounded.stateVersion, n: bounded.contributorCount })
        .toEqual({ round, facts: full.facts, v: full.stateVersion, n: full.contributorCount });
    }
  });

  it("projection_matches_the_full_projection_on_random_report_sequences", async () => {
    let seedN = 5098;
    const rand = () => ((seedN = (seedN * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const keys = ["seal_leak", "vibration"] as const;
    const values = ["present", "absent", "repaired"] as const;
    for (let round = 0; round < 6; round++) {
      const tenant = uuid();
      const entity = `cmms-${uuid()}`;
      const nb = await makeNotebook(tenant, entity, true);
      const made: Array<{ id: string; factKey: string }> = [];
      for (let i = 0; i < 30; i++) {
        const factKey = keys[Math.floor(rand() * keys.length)]!;
        const sameKey = made.filter((m) => m.factKey === factKey);
        const supersedesId = sameKey.length > 0 && rand() < 0.2 ? sameKey[Math.floor(rand() * sameKey.length)]!.id : null;
        const r = created(
          await insertObservation(tenant, nb, entity, null, input({
            factKey,
            factValue: values[Math.floor(rand() * values.length)]!,
            observedAt: new Date(Date.now() - Math.floor(rand() * 180) * MIN - 1000).toISOString(),
            supersedesId,
          }), "tech-1"),
        );
        made.push({ id: r.observation.id, factKey });
      }
      const now = new Date();
      const full = deriveObservedState(await allRows(tenant, entity), { now });
      const bounded = await boundedState(tenant, entity, now);
      expect({ round, facts: bounded.facts, v: bounded.stateVersion }).toEqual({ round, facts: full.facts, v: full.stateVersion });
    }
  });
});
