/**
 * Mission 001 observation store against real Postgres (A1, A2, A5, A6).
 * Harness copied from cmms-dispatch/__tests__/dispatcher.integration.test.ts:
 * the real withTenantContext (SET LOCAL ROLE factorylm_app + RLS) runs against
 * a disposable database. Migration 113 is applied here, twice, from
 * db/proposed (never db/migrations).
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
  insertObservation,
  listObservationHistory,
  listProjectionRows,
  type HistoryRecord,
  type InsertObservationResult,
} from "../store";
import { deriveObservedState } from "../project";
import { loadObservedStateForTurn } from "../turn-context";
import type { ValidatedObservationInput } from "../validate";
import { enqueueFixRecordedEvent } from "@/capabilities/cmms-dispatch/enqueue";
import { withTenantContext } from "@/lib/tenant-context";

const MIGRATION = path.resolve(__dirname, "../../../../db/proposed/113_asset_observations.sql");

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
    expect(projection.length).toBeLessThanOrEqual(5);
    expect(projection.map((r) => r.id)).toEqual(expect.arrayContaining([leak, repair]));
    for (const r of projection) expect(Object.keys(r)).not.toContain("rawReport");

    const full = deriveObservedState(await allRows(tenant, entity), { now });
    const bounded = deriveObservedState(projection, { now });
    expect(bounded.facts).toEqual(full.facts);
    expect(bounded.stateVersion).toBe(full.stateVersion);
    expect(bounded.facts[0]!.state).toBe("repair_reported");

    const { value, results } = await capturingResults(() => loadObservedStateForTurn(tenant, entity, now));
    expect(value.frame?.stateVersion).toBe(full.stateVersion);
    expect(results.length).toBeGreaterThan(0);
    for (const res of results) expect(res.fields).not.toContain("raw_report");
    expect(Math.max(...results.map((r) => r.rowCount))).toBeLessThanOrEqual(5);
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
      const bounded = deriveObservedState(await listProjectionRows(tenant, entity), { now });
      expect({ round, facts: bounded.facts, v: bounded.stateVersion }).toEqual({ round, facts: full.facts, v: full.stateVersion });
    }
  });
});
