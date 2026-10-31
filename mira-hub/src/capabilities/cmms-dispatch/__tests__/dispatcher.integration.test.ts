/**
 * Integration coverage for the notebook domain-event outbox → CMMS
 * dispatcher (#5020), against real Postgres. Every guarantee this capability
 * exists for — atomicity, replay dedup, the FOR UPDATE SKIP LOCKED claim,
 * per-aggregate ordering, tenant isolation — is a property of real
 * transactions and real row locks that a mocked `pg` client cannot prove
 * (same rationale as `notebook-identity-confirm.integration.test.ts` and
 * `part-search-claim.integration.test.ts`, whose harness pattern this file
 * copies).
 *
 * `@/lib/cmms/mock-write-provider` (MockCmmsWriteProvider) existed by the
 * time this file was written, so it is used directly rather than a local
 * fake.
 *
 * Run:
 *   cd mira-hub
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/mira_test \
 *     npx vitest run --config vitest.integration.config.ts src/capabilities/cmms-dispatch --reporter=basic
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import pg from "pg";
import { randomUUID as uuid } from "node:crypto";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { withTenantContext } from "@/lib/tenant-context";
import { MockCmmsWriteProvider } from "@/lib/cmms/mock-write-provider";
import { AtlasWriteProvider, type AtlasCommentApi } from "@/lib/cmms/atlas-write-provider";
import { AtlasHttpError, type AtlasComment } from "@/lib/atlas/client";
import { enqueueFixRecordedEvent, type EnqueueFixRecordedInput, type EnqueueResult } from "../enqueue";
import { runDispatchTick, type DispatchDeps } from "../dispatcher";
import { deliveryStatusForFixRecords } from "../status";
import { subjectRefForFix } from "../types";
import { deleteNotebook } from "@/lib/equipment-notebooks";

const URL_ = process.env.TEST_DATABASE_URL;

function workOrderPolicy(externalWorkOrderId: string): Record<string, unknown> {
  return {
    version: 1,
    fix_recorded: { enabled: true, operation: "append_work_log", target: { kind: "work_order", externalWorkOrderId } },
  };
}

function assetLinkedPolicy(): Record<string, unknown> {
  return {
    version: 1,
    fix_recorded: { enabled: true, operation: "append_work_log", target: { kind: "asset_linked_work_order" } },
  };
}

async function makeNotebook(tenantId: string): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name)
     VALUES ($1::uuid, $2::uuid, 'cmms-dispatch test')
     RETURNING id::text AS id`,
    [tenantId, uuid()],
  );
  return res.rows[0]!.id;
}

async function setCmmsConfig(
  tenantId: string,
  opts: { provider?: string; enabled?: boolean; writePolicy?: unknown },
): Promise<void> {
  await testPool.query(
    `INSERT INTO tenant_cmms_config (tenant_id, provider, enabled, write_policy)
     VALUES ($1, $2::cmms_provider, $3, $4::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE
       SET provider = $2::cmms_provider, enabled = $3, write_policy = $4::jsonb`,
    [tenantId, opts.provider ?? "atlas", opts.enabled ?? true, JSON.stringify(opts.writePolicy ?? {})],
  );
}

async function makeWorkOrder(
  tenantId: string,
  equipmentEntityId: string,
  opts: { synced: boolean },
): Promise<void> {
  const updatedAt = new Date();
  const syncedAt = opts.synced ? new Date(updatedAt.getTime() + 1000) : null;
  await testPool.query(
    `INSERT INTO work_orders (tenant_id, equipment_id, atlas_id, updated_at, cmms_synced_at)
     VALUES ($1, $2::uuid, $3, $4, $5)`,
    [tenantId, equipmentEntityId, `WO-${equipmentEntityId.slice(0, 8)}`, updatedAt.toISOString(), syncedAt?.toISOString() ?? null],
  );
}

async function enqueueOne(
  tenantId: string,
  notebookId: string,
  overrides: Partial<EnqueueFixRecordedInput> = {},
): Promise<{ fixRecordId: string; result: EnqueueResult }> {
  const fixRecordId = overrides.fixRecordId ?? uuid();
  const input: EnqueueFixRecordedInput = {
    tenantId,
    notebookId,
    sourceTurnId: null,
    equipmentEntityId: null,
    symptom: "Conveyor jams on startup",
    faultCode: "F0004",
    fix: "Replaced belt tensioner",
    recordedBy: "tech-1",
    occurredAt: new Date().toISOString(),
    ...overrides,
    fixRecordId,
  };
  const result = await withTenantContext(tenantId, (c) => enqueueFixRecordedEvent(c, input));
  return { fixRecordId, result };
}

function requireDeliveryId(delivery: EnqueueResult["delivery"]): string {
  if (delivery.deliveryId === null) {
    throw new Error(`expected a delivery id, got reason=${delivery.reason}`);
  }
  return delivery.deliveryId;
}

describe.skipIf(!URL_)("cmms-dispatch (real Postgres)", () => {
  beforeAll(async () => {
    // The disposable schema is shared by every local run. Rows left by an
    // earlier iteration of this suite (in retryable states, due now) would be
    // claimed by a later tick and attributed to the wrong test, so start clean.
    await testPool.query("TRUNCATE notebook_event_deliveries, notebook_domain_events");
    // `work_orders` is a production table altered (not created) by
    // db/migrations/007_atlas_sync_cols.sql — its base CREATE TABLE predates
    // 001 and is not tracked in this migrations directory at all (see
    // mira-hub/AGENTS.md), so it does not exist in the disposable test
    // schema. Stand it up minimally here (see target.ts's header for the
    // same note) and grant the app role the SELECT `resolveWorkOrderTarget`
    // needs when it runs under `withTenantContext` (role factorylm_app).
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS work_orders (
        id uuid primary key default gen_random_uuid(),
        tenant_id text not null,
        equipment_id uuid,
        atlas_id text,
        updated_at timestamptz not null default now(),
        cmms_synced_at timestamptz
      )
    `);
    await testPool.query(`GRANT SELECT ON work_orders TO factorylm_app`);
  });

  afterAll(async () => {
    await testPool.end();
  });

  // `runDispatchTick`'s CLAIM step is deliberately global across tenants
  // (it mirrors the production worker in src/lib/atlas/sync.ts, which has
  // to sweep every tenant's due deliveries in one tick). That means a
  // `queued` row left behind by one test (any test that enqueues but never
  // dispatches to a terminal state) is fair game for the NEXT test's
  // `runDispatchTick` call, inflating its stats with rows it never created.
  // Wipe the outbox before every test so each one only ever claims its own
  // rows. `notebook_event_deliveries` cascades off `notebook_domain_events`
  // (ON DELETE CASCADE), so deleting events is enough, but both are deleted
  // explicitly for clarity.
  beforeEach(async () => {
    await testPool.query(`DELETE FROM notebook_event_deliveries`);
    await testPool.query(`DELETE FROM notebook_domain_events`);
  });

  it("AC1: atomicity — a rolled-back transaction leaves no event and no delivery", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    const fixRecordId = uuid();
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-AC1") });

    const client = new pg.Client({ connectionString: URL_ });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE factorylm_app");
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.current_tenant_id', $1, true)",
        [tenantId],
      );
      await enqueueFixRecordedEvent(client as unknown as PoolClient, {
        tenantId,
        notebookId,
        fixRecordId,
        sourceTurnId: null,
        equipmentEntityId: null,
        symptom: "s",
        faultCode: null,
        fix: "f",
        recordedBy: null,
        occurredAt: new Date().toISOString(),
      });
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }

    const subjectRef = subjectRefForFix(fixRecordId);
    const events = await testPool.query(`SELECT 1 FROM notebook_domain_events WHERE subject_ref = $1`, [subjectRef]);
    expect(events.rowCount).toBe(0);
    const deliveries = await testPool.query(
      `SELECT 1 FROM notebook_event_deliveries d JOIN notebook_domain_events e ON e.event_id = d.event_id WHERE e.subject_ref = $1`,
      [subjectRef],
    );
    expect(deliveries.rowCount).toBe(0);
  });

  it("AC2: enqueuing the same fix record twice produces one event, one delivery, replayed:true on the second call", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-AC2") });

    const fixRecordId = uuid();
    const first = await enqueueOne(tenantId, notebookId, { fixRecordId });
    const second = await enqueueOne(tenantId, notebookId, { fixRecordId });

    expect(first.result.replayed).toBe(false);
    expect(second.result.replayed).toBe(true);
    expect(second.result.eventId).toBe(first.result.eventId);
    expect(second.result.sequence).toBe(first.result.sequence);
    expect(requireDeliveryId(second.result.delivery)).toBe(requireDeliveryId(first.result.delivery));

    const events = await testPool.query(`SELECT count(*)::int AS n FROM notebook_domain_events WHERE event_id = $1`, [
      first.result.eventId,
    ]);
    expect(events.rows[0]!.n).toBe(1);
    const deliveries = await testPool.query(
      `SELECT count(*)::int AS n FROM notebook_event_deliveries WHERE event_id = $1`,
      [first.result.eventId],
    );
    expect(deliveries.rows[0]!.n).toBe(1);
  });

  it("AC2b: a replay after the tenant's provider changed still returns the ORIGINAL delivery, never a second one", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-AC2B") });

    const fixRecordId = uuid();
    const first = await enqueueOne(tenantId, notebookId, { fixRecordId });
    const firstDeliveryId = requireDeliveryId(first.result.delivery);

    // Provider changes between the original enqueue and the replay — the
    // dedupe_key a fresh insert would compute now differs from the one the
    // original delivery was stored under.
    await setCmmsConfig(tenantId, { provider: "fiix", writePolicy: workOrderPolicy("WO-AC2B") });

    const second = await enqueueOne(tenantId, notebookId, { fixRecordId });
    expect(second.result.replayed).toBe(true);
    expect(requireDeliveryId(second.result.delivery)).toBe(firstDeliveryId);

    const deliveries = await testPool.query<{ n: number; connection_key: string }>(
      `SELECT count(*)::int AS n, min(connection_key) AS connection_key
         FROM notebook_event_deliveries WHERE event_id = $1`,
      [first.result.eventId],
    );
    expect(deliveries.rows[0]!.n).toBe(1);
    expect(deliveries.rows[0]!.connection_key).toBe("atlas"); // the ORIGINAL provider, not "fiix"
  });

  it("AC3: two concurrent dispatch ticks on one queued delivery → the provider sees exactly one appendWorkLog call", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-AC3") });
    const { result } = await enqueueOne(tenantId, notebookId);
    requireDeliveryId(result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const deps: DispatchDeps = { providerFor: () => mock, tenantAllowlist: new Set([tenantId]) };

    await Promise.all([runDispatchTick(deps), runDispatchTick(deps)]);

    expect(mock.calls.filter((c) => c.op === "appendWorkLog")).toHaveLength(1);
  });

  it("AC4: deliveryStatusForFixRecords and RLS both enforce tenant isolation", async () => {
    const tenantA = uuid();
    const tenantB = uuid();
    const notebookA = await makeNotebook(tenantA);
    await setCmmsConfig(tenantA, { writePolicy: workOrderPolicy("WO-AC4") });
    const { fixRecordId, result } = await enqueueOne(tenantA, notebookA);
    requireDeliveryId(result.delivery);

    const statusForB = await deliveryStatusForFixRecords(tenantB, [fixRecordId]);
    expect(statusForB.size).toBe(0);

    const statusForA = await deliveryStatusForFixRecords(tenantA, [fixRecordId]);
    expect(statusForA.get(fixRecordId)?.state).toBe("queued");

    const rawRows = await withTenantContext(tenantB, (c) =>
      c.query(`SELECT 1 FROM notebook_domain_events WHERE subject_ref = $1`, [subjectRefForFix(fixRecordId)]),
    );
    expect(rawRows.rowCount).toBe(0);
  });

  it("AC5: disabling the write policy after enqueue blocks dispatch but keeps the delivery row", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-AC5") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);

    await setCmmsConfig(tenantId, { writePolicy: {} });

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.blocked).toBe(1);
    expect(mock.calls).toHaveLength(0);

    const row = await testPool.query<{ state: string }>(
      `SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("blocked_policy");
  });

  it("AC6: provider reports unsupported → state unsupported, retained, never rescheduled", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-AC6") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas", supportsWorkLog: false });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.unsupported).toBe(1);

    const row = await testPool.query<{ state: string }>(
      `SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("unsupported");

    const stats2 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats2.claimed).toBe(0);
  });

  it("AC7: happy path → verified_by_readback with an external_ref and exactly one record", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-AC7") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.verified).toBe(1);

    const row = await testPool.query<{ state: string; external_ref: string | null }>(
      `SELECT state, external_ref FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("verified_by_readback");
    expect(row.rows[0]!.external_ref).not.toBeNull();
    expect(mock.records("WO-AC7")).toHaveLength(1);
  });

  it("AC8: lost_response → outcome_unknown, then a second tick reconciles it by read-back only (no second append) → verified, exactly one record", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-AC8") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    mock.failNext("lost_response");

    const stats1 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats1.unknown).toBe(1);
    let row = await testPool.query<{ state: string }>(
      `SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("outcome_unknown");

    // Bypass the real backoff wait so the second tick can reclaim it now.
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [
      deliveryId,
    ]);

    const stats2 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats2.verified).toBe(1);
    row = await testPool.query<{ state: string }>(`SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`, [
      deliveryId,
    ]);
    expect(row.rows[0]!.state).toBe("verified_by_readback");
    expect(mock.records("WO-AC8")).toHaveLength(1);
    // Round 3 (F9): the second tick never calls appendWorkLog — read-back only.
    expect(mock.calls.map((c) => c.op)).toEqual(["appendWorkLog", "readBackWorkLog"]);
  });

  it("AC9: poison (throw) quarantines after maxAttempts while a sibling aggregate verifies in the same ticks", async () => {
    const tenantA = uuid(); // poison
    const tenantB = uuid(); // sibling / good
    const notebookA = await makeNotebook(tenantA);
    const notebookB = await makeNotebook(tenantB);
    await setCmmsConfig(tenantA, { provider: "atlas", writePolicy: workOrderPolicy("WO-POISON") });
    await setCmmsConfig(tenantB, { provider: "fiix", writePolicy: workOrderPolicy("WO-GOOD") });

    const poison = await enqueueOne(tenantA, notebookA);
    const good = await enqueueOne(tenantB, notebookB);
    const poisonDeliveryId = requireDeliveryId(poison.result.delivery);
    requireDeliveryId(good.result.delivery);

    const poisonMock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const goodMock = new MockCmmsWriteProvider({ providerId: "fiix" }); // tenantB's connection is fiix
    const providerFor = (key: string): MockCmmsWriteProvider | null =>
      key === "atlas" ? poisonMock : key === "fiix" ? goodMock : null;
    const allow = new Set([tenantA, tenantB]);
    const maxAttempts = 2;

    poisonMock.failNext("throw");
    const stats1 = await runDispatchTick({ providerFor, tenantAllowlist: allow, maxAttempts });
    expect(stats1.claimed).toBe(2);
    // poison, attempt 1 of 2 — not yet exhausted. The adapter was invoked
    // before it threw, so the write may have landed: ambiguous, not
    // retryable (Codex round 4) — the next attempt only reads back.
    expect(stats1.unknown).toBe(1);
    expect(stats1.verified).toBe(1); // good, verified on the very first try

    let poisonRow = await testPool.query<{ state: string }>(
      `SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [poisonDeliveryId],
    );
    expect(poisonRow.rows[0]!.state).toBe("outcome_unknown");

    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [
      poisonDeliveryId,
    ]);

    poisonMock.failNext("throw");
    const stats2 = await runDispatchTick({ providerFor, tenantAllowlist: allow, maxAttempts });
    // The good delivery is already terminal (verified_by_readback) — only the
    // poison delivery is eligible for reclaim this tick.
    expect(stats2.claimed).toBe(1);
    expect(stats2.quarantined).toBe(1);

    poisonRow = await testPool.query<{ state: string }>(
      `SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [poisonDeliveryId],
    );
    expect(poisonRow.rows[0]!.state).toBe("quarantined");
    // appendWorkLog logs every attempt (including ones that throw) in
    // `.calls`. The first attempt threw after the adapter was invoked, so the
    // second only reads back — exactly one append, never a second write.
    expect(poisonMock.calls.map((c) => c.op)).toEqual(["appendWorkLog", "readBackWorkLog"]);
    expect(poisonMock.records("WO-POISON")).toHaveLength(0);
  });

  it("AC10: ordering — a newer delivery on the same aggregate is skipped while an older one is still active", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-AC10") });

    const older = await enqueueOne(tenantId, notebookId);
    const newer = await enqueueOne(tenantId, notebookId);
    const olderDeliveryId = requireDeliveryId(older.result.delivery);
    const newerDeliveryId = requireDeliveryId(newer.result.delivery);

    // Simulate the older delivery already having failed once and being
    // mid-backoff — a non-terminal state whose next_attempt_at is in the
    // future, so the CLAIM step itself won't pick it up this tick.
    await testPool.query(
      `UPDATE notebook_event_deliveries
          SET state = 'retryable_failure', next_attempt_at = now() + interval '1 hour'
        WHERE delivery_id = $1`,
      [olderDeliveryId],
    );

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });

    expect(stats.claimed).toBe(1); // only the newer one was even eligible to claim
    expect(stats.skippedOrdering).toBe(1);
    expect(mock.calls).toHaveLength(0);

    const row = await testPool.query<{ state: string; attempts: number }>(
      `SELECT state, attempts FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [newerDeliveryId],
    );
    expect(row.rows[0]!.state).toBe("queued");
    expect(row.rows[0]!.attempts).toBe(0); // the claim's +1 was undone by the put-back
  });

  it("AC11: a tenant outside the allowlist is blocked without ever touching the provider", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-AC11") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set() });
    expect(stats.blocked).toBe(1);
    expect(mock.calls).toHaveLength(0);

    const row = await testPool.query<{ state: string; last_error: string | null }>(
      `SELECT state, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("blocked_policy");
    expect(row.rows[0]!.last_error).toBe("tenant_not_allowlisted");
  });

  it("extra (target.ts): asset_linked_work_order resolves the newest synced work order and dispatches", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    const equipmentEntityId = uuid();
    await setCmmsConfig(tenantId, { writePolicy: assetLinkedPolicy() });
    await makeWorkOrder(tenantId, equipmentEntityId, { synced: true });

    const { result } = await enqueueOne(tenantId, notebookId, { equipmentEntityId });
    const deliveryId = requireDeliveryId(result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.verified).toBe(1);

    const row = await testPool.query<{ state: string }>(
      `SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("verified_by_readback");
  });

  it("extra (target.ts): asset_linked_work_order with a pending legacy push → retryable_failure, never a write race", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    const equipmentEntityId = uuid();
    await setCmmsConfig(tenantId, { writePolicy: assetLinkedPolicy() });
    await makeWorkOrder(tenantId, equipmentEntityId, { synced: false });

    const { result } = await enqueueOne(tenantId, notebookId, { equipmentEntityId });
    const deliveryId = requireDeliveryId(result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.retryable).toBe(1);
    expect(mock.calls).toHaveLength(0);

    const row = await testPool.query<{ state: string; last_error: string | null }>(
      `SELECT state, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("retryable_failure");
    expect(row.rows[0]!.last_error).toBe("legacy_push_pending");
  });

  // ── Codex round 1 remediation proofs (PR #5024) ────────────────────────────

  it("F1: a read-back reconciliation after a lost response targets the PINNED work order, never a retargeted one", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-F1-A") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    mock.failNext("lost_response"); // the comment lands on WO-F1-A, the response is lost
    const stats1 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats1.unknown).toBe(1);
    expect(mock.records("WO-F1-A")).toHaveLength(1);

    // The destination was persisted BEFORE the external write.
    const pinned = await testPool.query<{ receipt: Record<string, unknown> }>(
      `SELECT receipt FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect((pinned.rows[0]!.receipt.pinned_target as { externalWorkOrderId: string }).externalWorkOrderId).toBe("WO-F1-A");

    // Policy is retargeted to a different work order while the delivery is in flight.
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-F1-B") });
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);

    const stats2 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats2.verified).toBe(1);
    // Reconciled on A; nothing ever reaches B.
    expect(mock.records("WO-F1-A")).toHaveLength(1);
    expect(mock.records("WO-F1-B")).toHaveLength(0);
    const row = await testPool.query<{ state: string; external_ref: string | null }>(
      `SELECT state, external_ref FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("verified_by_readback");
  });

  it("F1b: policy REVOCATION after the first attempt still stops delivery (pinning never overrides revocation)", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-F1B") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);
    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    mock.failNext("lost_response");
    await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    await setCmmsConfig(tenantId, { enabled: false, writePolicy: workOrderPolicy("WO-F1B") });
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
    const stats2 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats2.blocked).toBe(1);
    const row = await testPool.query<{ state: string }>(`SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(row.rows[0]!.state).toBe("blocked_policy");
  });

  it("F3: a worker whose lease is no longer valid at pin-time never writes; a later owner delivers exactly once", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-F3") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);

    // Worker A claims with a zero-length lease: by the time it reaches the
    // pin/renew step its lease has already expired, exactly the "slow batch
    // consumed the window" condition. It must skip, not write.
    const mockA = new MockCmmsWriteProvider({ providerId: "atlas" });
    const statsA = await runDispatchTick({ providerFor: () => mockA, tenantAllowlist: new Set([tenantId]), leaseMs: 0 });
    expect(statsA.claimed).toBe(1);
    expect(statsA.leaseLost).toBe(1);
    expect(mockA.calls.filter((c) => c.op === "appendWorkLog")).toHaveLength(0);
    expect(mockA.records("WO-F3")).toHaveLength(0);

    // Worker B reclaims the expired row and delivers it once.
    const mockB = new MockCmmsWriteProvider({ providerId: "atlas" });
    const statsB = await runDispatchTick({ providerFor: () => mockB, tenantAllowlist: new Set([tenantId]) });
    expect(statsB.verified).toBe(1);
    expect(mockB.records("WO-F3")).toHaveLength(1);
    const row = await testPool.query<{ state: string }>(`SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(row.rows[0]!.state).toBe("verified_by_readback");
  });

  it("F4: ordering follows the EVENT sequence even when delivery created_at disagrees", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { writePolicy: workOrderPolicy("WO-F4") });
    const first = await enqueueOne(tenantId, notebookId); // sequence 1
    const second = await enqueueOne(tenantId, notebookId); // sequence 2
    const d1 = requireDeliveryId(first.result.delivery);
    const d2 = requireDeliveryId(second.result.delivery);

    // Make the FIRST event's delivery still active but not due, and give the
    // SECOND event's delivery an EARLIER created_at than the first's — the
    // disagreement a created_at-based guard would get wrong.
    await testPool.query(
      `UPDATE notebook_event_deliveries SET state = 'retryable_failure', next_attempt_at = now() + interval '1 hour' WHERE delivery_id = $1`,
      [d1],
    );
    await testPool.query(`UPDATE notebook_event_deliveries SET created_at = now() - interval '1 day' WHERE delivery_id = $1`, [d2]);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.skippedOrdering).toBe(1);
    expect(mock.records("WO-F4")).toHaveLength(0);
    const row = await testPool.query<{ state: string }>(`SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`, [d2]);
    expect(row.rows[0]!.state).toBe("queued");
  });

  it("F5: every rescheduled outcome is bounded — ambiguous outcomes are quarantined, retryable ones become permanent", async () => {
    const maxAttempts = 2;

    // (a) outcome_unknown forever (the provider never stores the record).
    const ambiguous: import("@/lib/cmms/write-contract").CmmsWriteProvider = {
      providerId: "atlas",
      capabilities: async () => ({
        append_work_log: { support: "implemented" },
        read_work_log: { support: "implemented" },
        attach_evidence: { support: "unsupported" },
        record_reading: { support: "unsupported" },
        transition_work_order: { support: "unsupported" },
        list_changes: { support: "unsupported" },
      }),
      appendWorkLog: async () => ({ kind: "outcome_unknown", reason: "always_ambiguous", receipt: {} }),
      readBackWorkLog: async () => ({ kind: "not_found", receipt: {} }),
    };
    const tenantA = uuid();
    const nbA = await makeNotebook(tenantA);
    await setCmmsConfig(tenantA, { writePolicy: workOrderPolicy("WO-F5A") });
    const a = requireDeliveryId((await enqueueOne(tenantA, nbA)).result.delivery);
    await runDispatchTick({ providerFor: () => ambiguous, tenantAllowlist: new Set([tenantA]), maxAttempts });
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [a]);
    const s2 = await runDispatchTick({ providerFor: () => ambiguous, tenantAllowlist: new Set([tenantA]), maxAttempts });
    expect(s2.quarantined).toBe(1);
    const rowA = await testPool.query<{ state: string; last_error: string | null }>(
      `SELECT state, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [a],
    );
    expect(rowA.rows[0]!.state).toBe("quarantined");
    expect(rowA.rows[0]!.last_error).toBe("max_attempts_unreconciled:outcome_unknown");

    // (b) legacy_push_pending forever (asset-linked work order never synced).
    const tenantB = uuid();
    const nbB = await makeNotebook(tenantB);
    const equipmentEntityId = uuid();
    await setCmmsConfig(tenantB, { writePolicy: assetLinkedPolicy() });
    await makeWorkOrder(tenantB, equipmentEntityId, { synced: false });
    const b = requireDeliveryId((await enqueueOne(tenantB, nbB, { equipmentEntityId })).result.delivery);
    const mockB = new MockCmmsWriteProvider({ providerId: "atlas" });
    await runDispatchTick({ providerFor: () => mockB, tenantAllowlist: new Set([tenantB]), maxAttempts });
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [b]);
    const s4 = await runDispatchTick({ providerFor: () => mockB, tenantAllowlist: new Set([tenantB]), maxAttempts });
    expect(s4.permanent).toBe(1);
    const rowB = await testPool.query<{ state: string; last_error: string | null }>(
      `SELECT state, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [b],
    );
    expect(rowB.rows[0]!.state).toBe("permanent_failure");
    expect(rowB.rows[0]!.last_error).toBe("max_attempts:legacy_push_pending");
    expect(mockB.calls).toHaveLength(0);

    // A quarantined/permanent predecessor is terminal: a later event on the
    // same aggregate is no longer deferred behind it.
    const laterA = requireDeliveryId((await enqueueOne(tenantA, nbA)).result.delivery);
    const good = new MockCmmsWriteProvider({ providerId: "atlas" });
    const s5 = await runDispatchTick({ providerFor: () => good, tenantAllowlist: new Set([tenantA]), maxAttempts });
    expect(s5.skippedOrdering).toBe(0);
    expect(s5.verified).toBe(1);
    const rowLater = await testPool.query<{ state: string }>(`SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`, [laterA]);
    expect(rowLater.rows[0]!.state).toBe("verified_by_readback");
  });

  // ── Codex round 2 (F1 residual, F7, F8) ────────────────────────────────────

  it("F1c (round 2): a provider change after enqueue blocks dispatch before any target resolution or vendor call", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-F1C") });
    const { result } = await enqueueOne(tenantId, notebookId);
    const deliveryId = requireDeliveryId(result.delivery);
    expect(result.delivery.deliveryId).not.toBeNull();

    // The tenant switches to Fiix and names a numeric Fiix work order. The
    // queued delivery still says connection_key = atlas.
    await setCmmsConfig(tenantId, { provider: "fiix", writePolicy: workOrderPolicy("43") });

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.blocked).toBe(1);
    expect(mock.calls).toHaveLength(0);
    expect(mock.records("43")).toHaveLength(0);
    const row = await testPool.query<{ state: string; last_error: string | null; connection_key: string }>(
      `SELECT state, last_error, connection_key FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("blocked_policy");
    expect(row.rows[0]!.last_error).toBe("provider_changed:atlas->fiix");
    expect(row.rows[0]!.connection_key).toBe("atlas");
  });

  it("F1d (round 2): a provider change AFTER the destination was pinned blocks the retry — the pinned Atlas record is never touched again", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-F1D") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    mock.failNext("lost_response"); // lands on WO-F1D, response lost → outcome_unknown, target pinned
    const stats1 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats1.unknown).toBe(1);
    expect(mock.records("WO-F1D")).toHaveLength(1);

    await setCmmsConfig(tenantId, { provider: "fiix", writePolicy: workOrderPolicy("43") });
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);

    const stats2 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats2.blocked).toBe(1);
    expect(mock.calls).toHaveLength(1); // only the original append — nothing on the retry
    expect(mock.records("43")).toHaveLength(0);
    const row = await testPool.query<{ state: string; last_error: string | null }>(
      `SELECT state, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("blocked_policy");
    expect(row.rows[0]!.last_error).toBe("provider_changed:atlas->fiix");
  });

  it("F1e (round 2): an adapter whose providerId differs from the queued connection is refused before any call", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-F1E") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);

    const wrongAdapter = new MockCmmsWriteProvider({ providerId: "fiix" });
    const stats = await runDispatchTick({ providerFor: () => wrongAdapter, tenantAllowlist: new Set([tenantId]) });
    expect(stats.blocked).toBe(1);
    expect(wrongAdapter.calls).toHaveLength(0);
    const row = await testPool.query<{ state: string; last_error: string | null }>(
      `SELECT state, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("blocked_policy");
    expect(row.rows[0]!.last_error).toBe("provider_mismatch:adapter=fiix,target=atlas,connection=atlas");
  });

  it("F7 (round 2): an ACKNOWLEDGED write whose read-back lags is reconciled read-only — exactly one create across ticks, then verified", async () => {
    // A fake Atlas v1.6+ whose comment search does not yet expose fresh
    // comments (eventual visibility), until `visible` is flipped.
    let visible = false;
    let nextId = 1;
    const stored: AtlasComment[] = [];
    let creates = 0;
    const api: AtlasCommentApi = {
      async countComments() {
        return { count: stored.length };
      },
      async createComment(payload) {
        creates++;
        const c: AtlasComment = { id: nextId++, content: payload.content, system: false };
        stored.push(c);
        return c;
      },
      async searchComments() {
        return visible ? [...stored] : [];
      },
    };
    const atlas = new AtlasWriteProvider(api);

    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("7") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    const deps = { providerFor: () => atlas, tenantAllowlist: new Set([tenantId]) };

    // Tick 1: create is acknowledged (id 1) but search cannot see it yet.
    const s1 = await runDispatchTick(deps);
    expect(s1.accepted).toBe(1);
    expect(creates).toBe(1);
    let row = await testPool.query<{ state: string; external_ref: string | null; last_error: string | null }>(
      `SELECT state, external_ref, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("accepted_pending_verification");
    expect(row.rows[0]!.external_ref).toBe("1");

    // Tick 2: still not visible — the dispatcher must NOT create a second comment.
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
    const s2 = await runDispatchTick(deps);
    expect(s2.accepted).toBe(1);
    expect(creates).toBe(1);
    expect(stored).toHaveLength(1);
    row = await testPool.query(`SELECT state, external_ref, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(row.rows[0]!.state).toBe("accepted_pending_verification");
    expect(row.rows[0]!.external_ref).toBe("1"); // the acknowledged ref is retained
    expect(row.rows[0]!.last_error).toBe("readback_not_yet_visible");

    // Tick 3: visibility catches up → verified by read-back, still one comment.
    visible = true;
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
    const s3 = await runDispatchTick(deps);
    expect(s3.verified).toBe(1);
    expect(creates).toBe(1);
    expect(stored).toHaveLength(1);
    row = await testPool.query(`SELECT state, external_ref, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(row.rows[0]!.state).toBe("verified_by_readback");
    expect(row.rows[0]!.external_ref).toBe("1");
  });

  it("F8 (round 2): a maximum-length accepted fix reaches the work log in full — the final instruction is never cut", async () => {
    const instruction = "DO NOT RESTART UNTIL GUARD IS REINSTALLED";
    const fix = `${"x".repeat(2000 - instruction.length - 1)} ${instruction}`;
    expect(fix).toHaveLength(2000);
    const symptom = `S${"y".repeat(498)}Z`;
    expect(symptom).toHaveLength(500);

    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-F8") });
    const deliveryId = requireDeliveryId(
      (await enqueueOne(tenantId, notebookId, { symptom, faultCode: "F0004", fix })).result.delivery,
    );
    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.verified).toBe(1);
    const row = await testPool.query<{ state: string }>(`SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(row.rows[0]!.state).toBe("verified_by_readback");

    const records = mock.records("WO-F8");
    expect(records).toHaveLength(1);
    const content = records[0]!.content;
    expect(content).toContain(instruction);
    expect(content).toContain(symptom);
    expect(content).toContain("fault code: F0004");
    expect(content).toContain(fix);
  });

  // ── Codex round 3 (F9, F10) ──────────────────────────────────────────────

  /** A fake Atlas v1.6+ whose create COMMITS but whose response is lost on the
   *  first call (network error after send), and whose search lags until
   *  `visible` is flipped. */
  function lossyAtlas(): { api: AtlasCommentApi; stored: AtlasComment[]; creates: () => number; show: () => void } {
    let visible = false;
    let nextId = 1;
    let creates = 0;
    const stored: AtlasComment[] = [];
    const api: AtlasCommentApi = {
      async countComments() {
        return { count: stored.length };
      },
      async createComment(payload) {
        creates++;
        stored.push({ id: nextId++, content: payload.content, system: false });
        if (creates === 1) throw new TypeError("fetch failed"); // committed, response lost
        return stored[stored.length - 1]!;
      },
      async searchComments() {
        return visible ? [...stored] : [];
      },
    };
    return { api, stored, creates: () => creates, show: () => void (visible = true) };
  }

  it("F9 (round 3): a committed-but-lost write (outcome_unknown) whose read-back lags is reconciled read-only — exactly one create, then verified", async () => {
    const atlas = lossyAtlas();
    const provider = new AtlasWriteProvider(atlas.api);
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("9") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    const deps = { providerFor: () => provider, tenantAllowlist: new Set([tenantId]) };

    const s1 = await runDispatchTick(deps);
    expect(s1.unknown).toBe(1);
    expect(atlas.creates()).toBe(1);
    let row = await testPool.query<{ state: string; external_ref: string | null; last_error: string | null }>(
      `SELECT state, external_ref, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("outcome_unknown");
    expect(row.rows[0]!.external_ref).toBeNull();

    // Still invisible: the dispatcher must NOT create again, and must not
    // pretend the vendor acknowledged anything.
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
    const s2 = await runDispatchTick(deps);
    expect(s2.unknown).toBe(1);
    expect(atlas.creates()).toBe(1);
    expect(atlas.stored).toHaveLength(1);
    row = await testPool.query(`SELECT state, external_ref, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(row.rows[0]!.state).toBe("outcome_unknown");
    expect(row.rows[0]!.external_ref).toBeNull();
    expect(row.rows[0]!.last_error).toBe("readback_not_yet_visible");

    atlas.show();
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
    const s3 = await runDispatchTick(deps);
    expect(s3.verified).toBe(1);
    expect(atlas.creates()).toBe(1);
    expect(atlas.stored).toHaveLength(1);
    row = await testPool.query(`SELECT state, external_ref, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(row.rows[0]!.state).toBe("verified_by_readback");
    expect(row.rows[0]!.external_ref).toBe("1");
  });

  it("F9b (round 3): persistent uncertainty quarantines at the budget WITHOUT another create", async () => {
    const atlas = lossyAtlas(); // never made visible
    const provider = new AtlasWriteProvider(atlas.api);
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("9") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    const deps = { providerFor: () => provider, tenantAllowlist: new Set([tenantId]), maxAttempts: 2 };

    const s1 = await runDispatchTick(deps);
    expect(s1.unknown).toBe(1);
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
    const s2 = await runDispatchTick(deps);
    expect(s2.quarantined).toBe(1);
    expect(atlas.creates()).toBe(1);
    expect(atlas.stored).toHaveLength(1);
    const row = await testPool.query<{ state: string; last_error: string | null }>(
      `SELECT state, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    expect(row.rows[0]!.state).toBe("quarantined");
    expect(row.rows[0]!.last_error).toBe("max_attempts_unreconciled:outcome_unknown");
  });

  it("F9c (round 3): an expired-lease reclaim whose previous owner had PINNED the destination is reconciled, never re-written; one that never pinned is delivered", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-F9C") });

    // (a) A worker pinned WO-F9C, then died before (or during) the write: its
    // lease has expired and the receipt carries the pin. The write may have
    // landed, so the reclaiming worker must only read back.
    const pinnedId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    await testPool.query(
      `UPDATE notebook_event_deliveries
          SET state = 'leased', lease_token = gen_random_uuid(), lease_until = now() - interval '1 second',
              attempts = 1, receipt = receipt || $2::jsonb
        WHERE delivery_id = $1`,
      [pinnedId, JSON.stringify({ pinned_target: { providerId: "atlas", externalWorkOrderId: "WO-F9C", source: "work_order", pinnedAt: new Date().toISOString() } })],
    );
    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const s1 = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(s1.claimed).toBe(1);
    expect(s1.unknown).toBe(1);
    expect(mock.calls.map((c) => c.op)).toEqual(["readBackWorkLog"]);
    expect(mock.records("WO-F9C")).toHaveLength(0);
    const rowA = await testPool.query<{ state: string }>(`SELECT state FROM notebook_event_deliveries WHERE delivery_id = $1`, [pinnedId]);
    expect(rowA.rows[0]!.state).toBe("outcome_unknown");

    // (b) Control: a reclaim whose previous owner never got as far as the pin
    // was never written — it is delivered normally.
    await testPool.query(`DELETE FROM notebook_event_deliveries WHERE delivery_id = $1`, [pinnedId]);
    const unpinnedId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    await testPool.query(
      `UPDATE notebook_event_deliveries
          SET state = 'leased', lease_token = gen_random_uuid(), lease_until = now() - interval '1 second', attempts = 1
        WHERE delivery_id = $1`,
      [unpinnedId],
    );
    const mockB = new MockCmmsWriteProvider({ providerId: "atlas" });
    const s2 = await runDispatchTick({ providerFor: () => mockB, tenantAllowlist: new Set([tenantId]) });
    expect(s2.verified).toBe(1);
    expect(mockB.calls.map((c) => c.op)).toEqual(["appendWorkLog"]);
    expect(mockB.records("WO-F9C")).toHaveLength(1);
  });

  it("F10 (round 3): a policy that explicitly names another version or operation never dispatches — no delivery at enqueue, blocked on retry", async () => {
    // (a) Explicitly incompatible at enqueue time → the record is saved, no delivery row.
    const tenantA = uuid();
    const nbA = await makeNotebook(tenantA);
    await setCmmsConfig(tenantA, {
      provider: "atlas",
      writePolicy: { version: 99, fix_recorded: { enabled: true, operation: "attach_evidence", target: { kind: "work_order", externalWorkOrderId: "7" } } },
    });
    const a = (await enqueueOne(tenantA, nbA)).result.delivery;
    expect(a.deliveryId).toBeNull();
    if (a.deliveryId !== null) throw new Error("expected no delivery row");
    expect(a.reason).toBe("policy_disabled");
    const mockA = new MockCmmsWriteProvider({ providerId: "atlas" });
    const sA = await runDispatchTick({ providerFor: () => mockA, tenantAllowlist: new Set([tenantA]) });
    expect(sA.claimed).toBe(0);
    expect(mockA.calls).toHaveLength(0);

    // (b) Valid at enqueue, flipped to a non-append operation before dispatch → blocked, zero calls.
    const tenantB = uuid();
    const nbB = await makeNotebook(tenantB);
    await setCmmsConfig(tenantB, { provider: "atlas", writePolicy: workOrderPolicy("WO-F10") });
    const b = requireDeliveryId((await enqueueOne(tenantB, nbB)).result.delivery);
    await setCmmsConfig(tenantB, {
      provider: "atlas",
      writePolicy: { version: 1, fix_recorded: { enabled: true, operation: "attach_evidence", target: { kind: "work_order", externalWorkOrderId: "WO-F10" } } },
    });
    const mockB = new MockCmmsWriteProvider({ providerId: "atlas" });
    const sB = await runDispatchTick({ providerFor: () => mockB, tenantAllowlist: new Set([tenantB]) });
    expect(sB.blocked).toBe(1);
    expect(mockB.calls).toHaveLength(0);
    const row = await testPool.query<{ state: string; last_error: string | null }>(
      `SELECT state, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [b],
    );
    expect(row.rows[0]!.state).toBe("blocked_policy");
    expect(row.rows[0]!.last_error).toBe("policy_disabled");
  });

  // ── Codex round 4 (F9 reopened, F11) ─────────────────────────────────────

  /** A fake Atlas v1.6+ whose creates always COMMIT, whose search lags until
   *  `show()`, and whose first create can answer with an injected error
   *  AFTER committing (a gateway that lost the upstream's 2xx). */
  function laggingAtlas(firstCreateError?: () => Error): {
    api: AtlasCommentApi;
    stored: AtlasComment[];
    creates: () => number;
    show: () => void;
  } {
    let visible = false;
    let nextId = 1;
    let creates = 0;
    const stored: AtlasComment[] = [];
    const api: AtlasCommentApi = {
      async countComments() {
        return { count: stored.length };
      },
      async createComment(payload) {
        creates++;
        stored.push({ id: nextId++, content: payload.content, system: false });
        if (creates === 1 && firstCreateError) throw firstCreateError();
        return stored[stored.length - 1]!;
      },
      async searchComments() {
        return visible ? [...stored] : [];
      },
    };
    return { api, stored, creates: () => creates, show: () => void (visible = true) };
  }

  /** Make exactly one pool query whose SQL contains `needle` reject. */
  function failOnceOn(needle: string): { restore: () => void; fired: () => boolean } {
    const real = testPool.query.bind(testPool) as (...args: unknown[]) => Promise<unknown>;
    let fired = false;
    const spy = vi.spyOn(testPool, "query").mockImplementation(((...args: unknown[]) => {
      if (!fired && typeof args[0] === "string" && args[0].includes(needle)) {
        fired = true;
        return Promise.reject(new Error(`injected failure on: ${needle}`));
      }
      return real(...args);
    }) as never);
    return { restore: () => spy.mockRestore(), fired: () => fired };
  }

  async function deliveryRow(deliveryId: string) {
    const res = await testPool.query<{ state: string; external_ref: string | null; last_error: string | null }>(
      `SELECT state, external_ref, last_error FROM notebook_event_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    );
    return res.rows[0]!;
  }

  async function makeDue(deliveryId: string): Promise<void> {
    await testPool.query(`UPDATE notebook_event_deliveries SET next_attempt_at = now() WHERE delivery_id = $1`, [deliveryId]);
  }

  it("F9 (round 4): a FINALIZE that fails after an acknowledged write keeps the ack and its external_ref — never a second create", async () => {
    const atlas = laggingAtlas();
    const provider = new AtlasWriteProvider(atlas.api);
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("41") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    const deps = { providerFor: () => provider, tenantAllowlist: new Set([tenantId]) };

    // The vendor commits and acknowledges; the first FINALIZE UPDATE fails,
    // the error-path FINALIZE succeeds.
    const inject = failOnceOn("SET state = $1");
    let s1;
    try {
      s1 = await runDispatchTick(deps);
    } finally {
      inject.restore();
    }
    expect(inject.fired()).toBe(true);
    expect(s1.accepted).toBe(1);
    expect(atlas.creates()).toBe(1);
    let row = await deliveryRow(deliveryId);
    expect(row.state).toBe("accepted_pending_verification");
    expect(row.external_ref).toBe("1");

    // Still invisible: reconcile only.
    await makeDue(deliveryId);
    await runDispatchTick(deps);
    expect(atlas.creates()).toBe(1);
    row = await deliveryRow(deliveryId);
    expect(row.state).toBe("accepted_pending_verification");

    atlas.show();
    await makeDue(deliveryId);
    const s3 = await runDispatchTick(deps);
    expect(s3.verified).toBe(1);
    expect(atlas.creates()).toBe(1);
    expect(atlas.stored).toHaveLength(1);
    row = await deliveryRow(deliveryId);
    expect(row.state).toBe("verified_by_readback");
    expect(row.external_ref).toBe("1");
  });

  it("F9b (round 4): an error before the vendor step on an outcome_unknown retry keeps it ambiguous — later ticks stay read-only", async () => {
    const atlas = laggingAtlas(() => new TypeError("fetch failed"));
    const provider = new AtlasWriteProvider(atlas.api);
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("42") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    const deps = { providerFor: () => provider, tenantAllowlist: new Set([tenantId]) };

    await runDispatchTick(deps);
    expect((await deliveryRow(deliveryId)).state).toBe("outcome_unknown");
    expect(atlas.creates()).toBe(1);

    // The retry errors before reaching the vendor (the ordering query fails).
    await makeDue(deliveryId);
    const inject = failOnceOn("SELECT d2.state");
    try {
      await runDispatchTick(deps);
    } finally {
      inject.restore();
    }
    expect(inject.fired()).toBe(true);
    let row = await deliveryRow(deliveryId);
    expect(row.state).toBe("outcome_unknown");
    expect(row.last_error).toMatch(/^tick_error: injected failure/);

    await makeDue(deliveryId);
    await runDispatchTick(deps);
    expect(atlas.creates()).toBe(1);

    atlas.show();
    await makeDue(deliveryId);
    const s4 = await runDispatchTick(deps);
    expect(s4.verified).toBe(1);
    expect(atlas.creates()).toBe(1);
    row = await deliveryRow(deliveryId);
    expect(row.state).toBe("verified_by_readback");
  });

  it.each([502, 504, 500])(
    "F11 (round 4): a create that Atlas committed but answered %i is outcome_unknown — reconciled, exactly one create",
    async (status) => {
      const atlas = laggingAtlas(() => new AtlasHttpError(status, "upstream response lost", "/comments"));
      const provider = new AtlasWriteProvider(atlas.api);
      const tenantId = uuid();
      const notebookId = await makeNotebook(tenantId);
      await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("43") });
      const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
      const deps = { providerFor: () => provider, tenantAllowlist: new Set([tenantId]) };

      const s1 = await runDispatchTick(deps);
      expect(s1.unknown).toBe(1);
      let row = await deliveryRow(deliveryId);
      expect(row.state).toBe("outcome_unknown");
      expect(row.last_error).toBe(`create_ambiguous_http_${status}`);

      await makeDue(deliveryId);
      await runDispatchTick(deps);
      expect(atlas.creates()).toBe(1);

      atlas.show();
      await makeDue(deliveryId);
      const s3 = await runDispatchTick(deps);
      expect(s3.verified).toBe(1);
      expect(atlas.creates()).toBe(1);
      expect(atlas.stored).toHaveLength(1);
      row = await deliveryRow(deliveryId);
      expect(row.state).toBe("verified_by_readback");
    },
  );

  it("F11b (round 4): a committed-but-502 create that never becomes visible quarantines at the budget without another create", async () => {
    const atlas = laggingAtlas(() => new AtlasHttpError(502, "upstream response lost", "/comments"));
    const provider = new AtlasWriteProvider(atlas.api);
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("44") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    const deps = { providerFor: () => provider, tenantAllowlist: new Set([tenantId]), maxAttempts: 3 };

    for (let i = 0; i < 3; i++) {
      await runDispatchTick(deps);
      await makeDue(deliveryId);
    }
    expect(atlas.creates()).toBe(1);
    const row = await deliveryRow(deliveryId);
    expect(row.state).toBe("quarantined");
    expect(row.last_error).toBe("max_attempts_unreconciled:outcome_unknown");
  });

  // ── Codex round 5 (F12) ──────────────────────────────────────────────────

  async function outboxCounts(notebookId: string): Promise<{ events: number; deliveries: number }> {
    const res = await testPool.query<{ events: number; deliveries: number }>(
      `SELECT (SELECT count(*)::int FROM notebook_domain_events WHERE notebook_id = $1::uuid) AS events,
              (SELECT count(*)::int FROM notebook_event_deliveries d
                 JOIN notebook_domain_events e ON e.event_id = d.event_id
                WHERE e.notebook_id = $1::uuid) AS deliveries`,
      [notebookId],
    );
    return res.rows[0]!;
  }

  it("F12 (round 5): deleting a notebook removes its outbox events and queued deliveries — a later tick sends nothing", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-F12") });
    const deliveryId = requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);
    expect(await outboxCounts(notebookId)).toEqual({ events: 1, deliveries: 1 });

    const res = await deleteNotebook(tenantId, notebookId);
    expect(res.deleted).toBe(true);
    expect(await outboxCounts(notebookId)).toEqual({ events: 0, deliveries: 0 });
    const gone = await testPool.query(`SELECT 1 FROM notebook_event_deliveries WHERE delivery_id = $1`, [deliveryId]);
    expect(gone.rowCount).toBe(0);

    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    const stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    expect(stats.claimed).toBe(0);
    expect(mock.calls).toHaveLength(0);
    expect(mock.records("WO-F12")).toHaveLength(0);
  });

  it("F12b (round 5): an enqueue that loses the race with a notebook delete fails instead of leaving an orphan event", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-F12B") });
    expect((await deleteNotebook(tenantId, notebookId)).deleted).toBe(true);

    await expect(enqueueOne(tenantId, notebookId)).rejects.toMatchObject({ code: "23503" });
    expect(await outboxCounts(notebookId)).toEqual({ events: 0, deliveries: 0 });
  });

  it("F12c (round 5): a notebook deleted after the dispatcher planned but before the PIN is never written", async () => {
    const tenantId = uuid();
    const notebookId = await makeNotebook(tenantId);
    await setCmmsConfig(tenantId, { provider: "atlas", writePolicy: workOrderPolicy("WO-F12C") });
    requireDeliveryId((await enqueueOne(tenantId, notebookId)).result.delivery);

    // Delete the notebook at the instant the dispatcher issues its PIN.
    const real = testPool.query.bind(testPool) as (...args: unknown[]) => Promise<unknown>;
    let deletedAtPin = false;
    const spy = vi.spyOn(testPool, "query").mockImplementation((async (...args: unknown[]) => {
      if (!deletedAtPin && typeof args[0] === "string" && args[0].includes("SET receipt = receipt || $1::jsonb")) {
        deletedAtPin = (await deleteNotebook(tenantId, notebookId)).deleted;
      }
      return real(...args);
    }) as never);
    const mock = new MockCmmsWriteProvider({ providerId: "atlas" });
    let stats;
    try {
      stats = await runDispatchTick({ providerFor: () => mock, tenantAllowlist: new Set([tenantId]) });
    } finally {
      spy.mockRestore();
    }
    expect(deletedAtPin).toBe(true);
    expect(stats.leaseLost).toBe(1);
    expect(mock.calls).toHaveLength(0);
    expect(mock.records("WO-F12C")).toHaveLength(0);
    expect(await outboxCounts(notebookId)).toEqual({ events: 0, deliveries: 0 });
  });

});
