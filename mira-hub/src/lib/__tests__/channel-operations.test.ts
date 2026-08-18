import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlHarness = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  result: { rows: [] as Record<string, unknown>[], rowCount: 0 },
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenantId: string, fn: (client: unknown) => unknown) =>
    fn({
      query: async (sql: string, params: unknown[] = []) => {
        sqlHarness.calls.push({ sql, params });
        return sqlHarness.result;
      },
    }),
  ),
}));

import {
  ChannelOperationService,
  pgChannelOperationStore,
  type ChannelOperationRecord,
  type ChannelOperationStore,
  type InsertOperationInput,
} from "@/lib/channel-operations";
import {
  parseChannelWorkflowRequest,
  type ChannelWorkflowRequest,
  type OperationState,
} from "@/lib/channel-workflow-contract";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const SESSION = "22222222-2222-4222-8222-222222222222";
const OPERATION = "33333333-3333-4333-8333-333333333333";
const OWNER_1 = "44444444-4444-4444-8444-444444444441";
const OWNER_2 = "44444444-4444-4444-8444-444444444442";
const DELIVERY_1 = "55555555-5555-4555-8555-555555555551";
const DELIVERY_2 = "55555555-5555-4555-8555-555555555552";

beforeEach(() => {
  sqlHarness.calls.length = 0;
  sqlHarness.result = { rows: [], rowCount: 0 };
});

function request(eventId = "tg:100", text = "Find the manual"): ChannelWorkflowRequest {
  return parseChannelWorkflowRequest({
    contractVersion: "1.0",
    tenantId: TENANT,
    actor: { userId: USER, externalUserId: "42", uploaderId: USER },
    channel: "telegram",
    eventId,
    conversation: { id: "telegram:-42" },
    action: "message",
    text,
    caption: text,
    attachments: [],
  });
}

class MemoryOperationStore implements ChannelOperationStore {
  readonly rows = new Map<string, ChannelOperationRecord>();
  executeCount = 0;

  private key(tenantId: string, channel: string, eventId: string): string {
    return `${tenantId}:${channel}:${eventId}`;
  }

  async insert(input: InsertOperationInput): Promise<ChannelOperationRecord | null> {
    const key = this.key(input.tenantId, input.channel, input.eventId);
    if (this.rows.has(key)) return null;
    const record: ChannelOperationRecord = {
      operationId: input.operationId,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      channel: input.channel,
      eventId: input.eventId,
      requestFingerprint: input.requestFingerprint,
      request: input.request,
      state: "queued",
      progressStep: "prepared",
      semanticKind: null,
      result: null,
      ownerToken: input.ownerToken,
      ownerLeaseExpiresAt: input.ownerLeaseExpiresAt,
      deliveryToken: null,
      deliveryLeaseExpiresAt: null,
      terminalDeliveredAt: null,
    };
    this.rows.set(key, record);
    return structuredClone(record);
  }

  async getByEvent(tenantId: string, channel: string, eventId: string) {
    const row = this.rows.get(this.key(tenantId, channel, eventId));
    return row ? structuredClone(row) : null;
  }

  async getById(tenantId: string, operationId: string) {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.tenantId === tenantId && candidate.operationId === operationId,
    );
    return row ? structuredClone(row) : null;
  }

  async reclaimExecution(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    ownerLeaseExpiresAt: string;
    now: string;
  }) {
    const row = [...this.rows.values()].find(
      (candidate) =>
        candidate.tenantId === args.tenantId && candidate.operationId === args.operationId,
    );
    if (!row || !["queued", "running"].includes(row.state)) return null;
    if (row.ownerLeaseExpiresAt !== null && row.ownerLeaseExpiresAt > args.now) return null;
    row.ownerToken = args.ownerToken;
    row.ownerLeaseExpiresAt = args.ownerLeaseExpiresAt;
    row.state = "queued";
    return structuredClone(row);
  }

  async begin(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    ownerLeaseExpiresAt: string;
    now: string;
  }) {
    const row = [...this.rows.values()].find(
      (candidate) =>
        candidate.tenantId === args.tenantId &&
        candidate.operationId === args.operationId &&
        candidate.ownerToken === args.ownerToken,
    );
    if (
      !row ||
      row.state !== "queued" ||
      row.ownerLeaseExpiresAt === null ||
      row.ownerLeaseExpiresAt <= args.now
    ) {
      return false;
    }
    row.state = "running";
    row.ownerLeaseExpiresAt = args.ownerLeaseExpiresAt;
    this.executeCount += 1;
    return true;
  }

  async finalize(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    state: OperationState;
    semanticKind: string;
    result: Record<string, unknown>;
  }) {
    const row = [...this.rows.values()].find(
      (candidate) =>
        candidate.tenantId === args.tenantId &&
        candidate.operationId === args.operationId &&
        candidate.ownerToken === args.ownerToken,
    );
    if (!row || row.state !== "running") return false;
    row.state = args.state;
    row.semanticKind = args.semanticKind;
    row.result = structuredClone(args.result);
    row.ownerToken = null;
    row.ownerLeaseExpiresAt = "";
    return true;
  }

  async updateProgress(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    progressStep: ChannelOperationRecord["progressStep"];
    ownerLeaseExpiresAt: string;
  }) {
    const row = [...this.rows.values()].find(
      (candidate) =>
        candidate.tenantId === args.tenantId &&
        candidate.operationId === args.operationId &&
        candidate.ownerToken === args.ownerToken,
    );
    if (!row || row.state !== "running") return false;
    row.progressStep = args.progressStep;
    row.ownerLeaseExpiresAt = args.ownerLeaseExpiresAt;
    return true;
  }

  async claimDelivery(args: {
    tenantId: string;
    operationId: string;
    deliveryToken: string;
    deliveryLeaseExpiresAt: string;
    now: string;
  }) {
    const row = [...this.rows.values()].find(
      (candidate) =>
        candidate.tenantId === args.tenantId && candidate.operationId === args.operationId,
    );
    if (!row || !["complete", "candidate_review", "insufficient_evidence", "failed"].includes(row.state)) {
      return null;
    }
    if (row.terminalDeliveredAt) return null;
    if (row.deliveryToken && (row.deliveryLeaseExpiresAt ?? "") > args.now) return null;
    row.deliveryToken = args.deliveryToken;
    row.deliveryLeaseExpiresAt = args.deliveryLeaseExpiresAt;
    return structuredClone(row);
  }

  async ackDelivery(args: { tenantId: string; operationId: string; deliveryToken: string }) {
    const row = [...this.rows.values()].find(
      (candidate) =>
        candidate.tenantId === args.tenantId &&
        candidate.operationId === args.operationId &&
        candidate.deliveryToken === args.deliveryToken,
    );
    if (!row || row.terminalDeliveredAt) return false;
    row.terminalDeliveredAt = "delivered";
    row.deliveryToken = null;
    row.deliveryLeaseExpiresAt = null;
    return true;
  }

  async cancelForSession(args: {
    tenantId: string;
    sessionId: string;
    exceptOperationId: string;
  }) {
    let count = 0;
    for (const row of this.rows.values()) {
      if (
        row.tenantId === args.tenantId &&
        row.sessionId === args.sessionId &&
        row.operationId !== args.exceptOperationId &&
        ["queued", "running"].includes(row.state)
      ) {
        row.state = "cancelled";
        row.ownerToken = null;
        count += 1;
      }
    }
    return count;
  }
}

function service(store = new MemoryOperationStore()) {
  let now = new Date("2026-08-18T12:00:00.000Z");
  const ids = [OPERATION, OWNER_1, OWNER_2, DELIVERY_1, DELIVERY_2];
  return {
    store,
    setNow(value: string) {
      now = new Date(value);
    },
    instance: new ChannelOperationService(store, {
      now: () => now,
      randomId: () => ids.shift() ?? "66666666-6666-4666-8666-666666666666",
      executionLeaseMs: 60_000,
      deliveryLeaseMs: 30_000,
    }),
  };
}

describe("channel operation exactly-once lifecycle", () => {
  it("gives one event one operation and only one live executor", async () => {
    const { instance, store } = service();
    const first = await instance.prepare(request(), SESSION);
    const replay = await instance.prepare(request(), SESSION);

    expect(first).toMatchObject({
      operationId: OPERATION,
      disposition: "execute",
      ownerToken: OWNER_1,
      state: "queued",
    });
    expect(replay).toMatchObject({
      operationId: OPERATION,
      disposition: "running",
      state: "queued",
    });
    expect(replay.ownerToken).toBeNull();

    expect(await instance.begin(TENANT, OPERATION, OWNER_1)).toBe(true);
    expect(await instance.begin(TENANT, OPERATION, OWNER_1)).toBe(false);
    expect(store.executeCount).toBe(1);
  });

  it("rejects reuse of an event id with different semantic input", async () => {
    const { instance } = service();
    await instance.prepare(request("tg:100", "Find the manual"), SESSION);
    await expect(
      instance.prepare(request("tg:100", "Delete the manual"), SESSION),
    ).rejects.toThrow("event_id_conflict");
  });

  it("allows a crashed executor to be reclaimed only after its lease expires", async () => {
    const ctx = service();
    const first = await ctx.instance.prepare(request(), SESSION);
    expect(first.ownerToken).toBe(OWNER_1);

    ctx.setNow("2026-08-18T12:00:30.000Z");
    expect((await ctx.instance.prepare(request(), SESSION)).disposition).toBe("running");

    ctx.setNow("2026-08-18T12:01:01.000Z");
    const reclaimed = await ctx.instance.prepare(request(), SESSION);
    expect(reclaimed).toMatchObject({ disposition: "execute", ownerToken: OWNER_2 });
  });

  it("token-fences finalization and gives one acknowledged terminal delivery", async () => {
    const ctx = service();
    const prepared = await ctx.instance.prepare(request(), SESSION);
    await ctx.instance.begin(TENANT, OPERATION, prepared.ownerToken!);

    expect(
      await ctx.instance.finalize({
        tenantId: TENANT,
        operationId: OPERATION,
        ownerToken: "wrong-owner",
        state: "complete",
        semanticKind: "file_intake",
        result: { fileId: "file-1" },
      }),
    ).toBe(false);
    expect(
      await ctx.instance.finalize({
        tenantId: TENANT,
        operationId: OPERATION,
        ownerToken: prepared.ownerToken!,
        state: "complete",
        semanticKind: "file_intake",
        result: { fileId: "file-1" },
      }),
    ).toBe(true);

    const delivery = await ctx.instance.claimTerminalDelivery(TENANT, OPERATION);
    expect(delivery).toMatchObject({ deliveryToken: OWNER_2, result: { fileId: "file-1" } });
    expect(await ctx.instance.claimTerminalDelivery(TENANT, OPERATION)).toBeNull();
    expect(await ctx.instance.ackTerminalDelivery(TENANT, OPERATION, "wrong")).toBe(false);
    expect(
      await ctx.instance.ackTerminalDelivery(TENANT, OPERATION, delivery!.deliveryToken),
    ).toBe(true);
    expect(await ctx.instance.claimTerminalDelivery(TENANT, OPERATION)).toBeNull();
  });

  it("records real progress only for the fenced live executor and renews its lease", async () => {
    const ctx = service();
    const prepared = await ctx.instance.prepare(request(), SESSION);
    await ctx.instance.begin(TENANT, OPERATION, prepared.ownerToken!);

    expect(
      await (ctx.instance as unknown as {
        updateProgress: (...args: string[]) => Promise<boolean>;
      }).updateProgress(TENANT, OPERATION, "wrong-owner", "discovering_manual"),
    ).toBe(false);
    expect(
      await (ctx.instance as unknown as {
        updateProgress: (...args: string[]) => Promise<boolean>;
      }).updateProgress(
        TENANT,
        OPERATION,
        prepared.ownerToken!,
        "discovering_manual",
      ),
    ).toBe(true);
    expect((await ctx.instance.get(TENANT, OPERATION))?.progressStep).toBe(
      "discovering_manual",
    );
  });

  it("reclaims an unacknowledged delivery after the lease, never before", async () => {
    const ctx = service();
    const prepared = await ctx.instance.prepare(request(), SESSION);
    await ctx.instance.begin(TENANT, OPERATION, prepared.ownerToken!);
    await ctx.instance.finalize({
      tenantId: TENANT,
      operationId: OPERATION,
      ownerToken: prepared.ownerToken!,
      state: "candidate_review",
      semanticKind: "nameplate_manual",
      result: { candidate: true },
    });

    const first = await ctx.instance.claimTerminalDelivery(TENANT, OPERATION);
    expect(first?.deliveryToken).toBe(OWNER_2);
    ctx.setNow("2026-08-18T12:00:29.000Z");
    expect(await ctx.instance.claimTerminalDelivery(TENANT, OPERATION)).toBeNull();
    ctx.setNow("2026-08-18T12:00:31.000Z");
    const reclaimed = await ctx.instance.claimTerminalDelivery(TENANT, OPERATION);
    expect(reclaimed?.deliveryToken).toBe(DELIVERY_1);
  });

  it("cancellation revokes execution and terminal delivery", async () => {
    const ctx = service();
    const prepared = await ctx.instance.prepare(request(), SESSION);
    await ctx.instance.begin(TENANT, OPERATION, prepared.ownerToken!);
    expect(await ctx.instance.cancelSession(TENANT, SESSION, "reset-operation")).toBe(1);
    expect(
      await ctx.instance.finalize({
        tenantId: TENANT,
        operationId: OPERATION,
        ownerToken: prepared.ownerToken!,
        state: "complete",
        semanticKind: "grounded_answer",
        result: { answer: "stale" },
      }),
    ).toBe(false);
    expect(await ctx.instance.claimTerminalDelivery(TENANT, OPERATION)).toBeNull();
  });

  it("never resolves or acknowledges another tenant's operation", async () => {
    const ctx = service();
    await ctx.instance.prepare(request(), SESSION);
    expect(await ctx.instance.get(OTHER_TENANT, OPERATION)).toBeNull();
    expect(
      await ctx.instance.ackTerminalDelivery(OTHER_TENANT, OPERATION, DELIVERY_1),
    ).toBe(false);
  });
});

describe("channel operation PostgreSQL boundary", () => {
  it("locks one tenant/channel/event in both the migration and INSERT", async () => {
    const migration = readFileSync(
      new URL("../../../db/migrations/078_channel_workflow.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toMatch(/UNIQUE \(tenant_id, channel, event_id\)/);
    expect(migration).toMatch(/progress_step\s+TEXT/);
    expect(migration).toContain("ALTER TABLE channel_operations ENABLE ROW LEVEL SECURITY");
    expect(migration).toMatch(/WITH CHECK \([\s\S]*?app\.tenant_id/);

    await pgChannelOperationStore.insert({
      operationId: OPERATION,
      tenantId: TENANT,
      sessionId: SESSION,
      channel: "telegram",
      eventId: "tg:100",
      requestFingerprint: "a".repeat(64),
      request: request(),
      ownerToken: OWNER_1,
      ownerLeaseExpiresAt: "2026-08-18T12:01:00.000Z",
    });
    const insert = sqlHarness.calls[0];
    expect(insert.sql).toContain("ON CONFLICT (tenant_id, channel, event_id) DO NOTHING");
    expect(insert.params).toContain(TENANT);
  });

  it("tenant- and owner-fences finalization, then tenant- and token-fences ACK", async () => {
    await pgChannelOperationStore.finalize({
      tenantId: TENANT,
      operationId: OPERATION,
      ownerToken: OWNER_1,
      state: "complete",
      semanticKind: "grounded_answer",
      result: { answer: "safe" },
    });
    await pgChannelOperationStore.ackDelivery({
      tenantId: TENANT,
      operationId: OPERATION,
      deliveryToken: DELIVERY_1,
    });

    const finalize = sqlHarness.calls[0];
    expect(finalize.sql).toMatch(/tenant_id = \$1::uuid/);
    expect(finalize.sql).toMatch(/operation_id = \$2::uuid/);
    expect(finalize.sql).toMatch(/owner_token = \$3::uuid/);
    expect(finalize.sql).toContain("state = 'running'");
    expect(finalize.params.slice(0, 3)).toEqual([TENANT, OPERATION, OWNER_1]);

    const ack = sqlHarness.calls[1];
    expect(ack.sql).toMatch(/tenant_id = \$1::uuid/);
    expect(ack.sql).toMatch(/operation_id = \$2::uuid/);
    expect(ack.sql).toMatch(/delivery_token = \$3::uuid/);
    expect(ack.sql).toContain("terminal_delivered_at IS NULL");
    expect(ack.params).toEqual([TENANT, OPERATION, DELIVERY_1]);
  });

  it("tenant- and owner-fences progress while extending the execution lease", async () => {
    await (pgChannelOperationStore as unknown as {
      updateProgress: (args: Record<string, string>) => Promise<boolean>;
    }).updateProgress({
      tenantId: TENANT,
      operationId: OPERATION,
      ownerToken: OWNER_1,
      progressStep: "ingesting_file",
      ownerLeaseExpiresAt: "2026-08-18T12:01:00.000Z",
    });

    const update = sqlHarness.calls[0];
    expect(update.sql).toMatch(/tenant_id = \$1::uuid/);
    expect(update.sql).toMatch(/owner_token = \$3::uuid/);
    expect(update.sql).toContain("state = 'running'");
    expect(update.sql).toContain("owner_lease_expires_at = $5::timestamptz");
    expect(update.params).toEqual([
      TENANT,
      OPERATION,
      OWNER_1,
      "ingesting_file",
      "2026-08-18T12:01:00.000Z",
    ]);
  });
});
