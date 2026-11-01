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

import { insertObservation, listObservationsForAsset, type InsertObservationResult } from "../store";
import { deriveObservedState } from "../project";
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
    expect(await listObservationsForAsset(intruder, entity)).toEqual([]);
    expect(await listObservationsForAsset(owner, entity)).toHaveLength(1);
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

    const rows = await listObservationsForAsset(tenant, entity);
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
    const readFromB = await listObservationsForAsset(tenant, entity);
    expect(readFromB.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("control_asset_state_unchanged", async () => {
    const tenant = uuid();
    const pumpA = `cmms-${uuid()}`;
    const pumpB = `cmms-${uuid()}`;
    const nb = await makeNotebook(tenant, pumpA, true);
    created(await insertObservation(tenant, nb, pumpA, null, input(), "tech-1"));

    expect(await listObservationsForAsset(tenant, pumpB)).toEqual([]);
    const controlState = deriveObservedState(await listObservationsForAsset(tenant, pumpB), { now: new Date() });
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
