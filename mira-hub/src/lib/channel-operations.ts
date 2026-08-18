/**
 * Exactly-once, tenant-scoped channel operation lifecycle.
 *
 * This is intentionally NOT runWorkflow(): that observability wrapper re-runs
 * a duplicate idempotency key and is fail-open. A client event needs one
 * fenced executor and one acknowledged terminal delivery.
 */

import { randomUUID } from "node:crypto";

import { withTenantContext } from "@/lib/tenant-context";
import {
  semanticFingerprint,
  type Channel,
  type ChannelWorkflowRequest,
  type OperationProgressStep,
  type OperationState,
} from "@/lib/channel-workflow-contract";

const TERMINAL_STATES = new Set<OperationState>([
  "complete",
  "candidate_review",
  "insufficient_evidence",
  "failed",
]);

export interface ChannelOperationRecord {
  operationId: string;
  tenantId: string;
  sessionId: string;
  channel: Channel;
  eventId: string;
  requestFingerprint: string;
  request: ChannelWorkflowRequest;
  state: OperationState;
  progressStep: OperationProgressStep;
  semanticKind: string | null;
  result: Record<string, unknown> | null;
  ownerToken: string | null;
  ownerLeaseExpiresAt: string | null;
  deliveryToken: string | null;
  deliveryLeaseExpiresAt: string | null;
  terminalDeliveredAt: string | null;
}

export interface InsertOperationInput {
  operationId: string;
  tenantId: string;
  sessionId: string;
  channel: Channel;
  eventId: string;
  requestFingerprint: string;
  request: ChannelWorkflowRequest;
  ownerToken: string;
  ownerLeaseExpiresAt: string;
}

export interface ChannelOperationStore {
  insert(input: InsertOperationInput): Promise<ChannelOperationRecord | null>;
  getByEvent(
    tenantId: string,
    channel: Channel,
    eventId: string,
  ): Promise<ChannelOperationRecord | null>;
  getById(tenantId: string, operationId: string): Promise<ChannelOperationRecord | null>;
  reclaimExecution(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    ownerLeaseExpiresAt: string;
    now: string;
  }): Promise<ChannelOperationRecord | null>;
  begin(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    ownerLeaseExpiresAt: string;
    now: string;
  }): Promise<boolean>;
  updateProgress(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    progressStep: OperationProgressStep;
    ownerLeaseExpiresAt: string;
  }): Promise<boolean>;
  finalize(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    state: OperationState;
    semanticKind: string;
    result: Record<string, unknown>;
  }): Promise<boolean>;
  claimDelivery(args: {
    tenantId: string;
    operationId: string;
    deliveryToken: string;
    deliveryLeaseExpiresAt: string;
    now: string;
  }): Promise<ChannelOperationRecord | null>;
  ackDelivery(args: {
    tenantId: string;
    operationId: string;
    deliveryToken: string;
  }): Promise<boolean>;
  cancelForSession(args: {
    tenantId: string;
    sessionId: string;
    exceptOperationId: string;
  }): Promise<number>;
}

const SELECT_COLS = `
  operation_id::text AS operation_id,
  tenant_id::text AS tenant_id,
  session_id::text AS session_id,
  channel,
  event_id,
  request_fingerprint,
  request_envelope,
  state,
  progress_step,
  semantic_kind,
  result,
  owner_token::text AS owner_token,
  owner_lease_expires_at,
  delivery_token::text AS delivery_token,
  delivery_lease_expires_at,
  terminal_delivered_at`;

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function rowToOperation(row: Record<string, unknown>): ChannelOperationRecord {
  const request = jsonObject(row.request_envelope);
  if (!request) throw new Error("invalid_channel_operation_request");
  return {
    operationId: String(row.operation_id),
    tenantId: String(row.tenant_id),
    sessionId: String(row.session_id),
    channel: row.channel as Channel,
    eventId: String(row.event_id),
    requestFingerprint: String(row.request_fingerprint),
    request: request as unknown as ChannelWorkflowRequest,
    state: row.state as OperationState,
    progressStep: row.progress_step as OperationProgressStep,
    semanticKind: row.semantic_kind == null ? null : String(row.semantic_kind),
    result: jsonObject(row.result),
    ownerToken: row.owner_token == null ? null : String(row.owner_token),
    ownerLeaseExpiresAt: iso(row.owner_lease_expires_at),
    deliveryToken: row.delivery_token == null ? null : String(row.delivery_token),
    deliveryLeaseExpiresAt: iso(row.delivery_lease_expires_at),
    terminalDeliveredAt: iso(row.terminal_delivered_at),
  };
}

export const pgChannelOperationStore: ChannelOperationStore = {
  async insert(input) {
    return withTenantContext(input.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO channel_operations
           (operation_id, tenant_id, session_id, channel, event_id,
            request_fingerprint, request_envelope, state, owner_token,
            owner_lease_expires_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb,
                 'queued', $8::uuid, $9::timestamptz)
         ON CONFLICT (tenant_id, channel, event_id) DO NOTHING
         RETURNING ${SELECT_COLS}`,
        [
          input.operationId,
          input.tenantId,
          input.sessionId,
          input.channel,
          input.eventId,
          input.requestFingerprint,
          JSON.stringify(input.request),
          input.ownerToken,
          input.ownerLeaseExpiresAt,
        ],
      );
      return result.rows[0] ? rowToOperation(result.rows[0]) : null;
    });
  },

  async getByEvent(tenantId, channel, eventId) {
    return withTenantContext(tenantId, async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_COLS}
           FROM channel_operations
          WHERE tenant_id = $1::uuid AND channel = $2 AND event_id = $3`,
        [tenantId, channel, eventId],
      );
      return result.rows[0] ? rowToOperation(result.rows[0]) : null;
    });
  },

  async getById(tenantId, operationId) {
    return withTenantContext(tenantId, async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_COLS}
           FROM channel_operations
          WHERE tenant_id = $1::uuid AND operation_id = $2::uuid`,
        [tenantId, operationId],
      );
      return result.rows[0] ? rowToOperation(result.rows[0]) : null;
    });
  },

  async reclaimExecution(args) {
    return withTenantContext(args.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE channel_operations
            SET owner_token = $3::uuid,
                owner_lease_expires_at = $4::timestamptz,
                state = 'queued',
                updated_at = now()
          WHERE tenant_id = $1::uuid
            AND operation_id = $2::uuid
            AND state IN ('queued', 'running')
            AND (owner_lease_expires_at IS NULL OR owner_lease_expires_at <= $5::timestamptz)
        RETURNING ${SELECT_COLS}`,
        [
          args.tenantId,
          args.operationId,
          args.ownerToken,
          args.ownerLeaseExpiresAt,
          args.now,
        ],
      );
      return result.rows[0] ? rowToOperation(result.rows[0]) : null;
    });
  },

  async begin(args) {
    return withTenantContext(args.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE channel_operations
            SET state = 'running',
                started_at = COALESCE(started_at, now()),
                owner_lease_expires_at = $4::timestamptz,
                updated_at = now()
          WHERE tenant_id = $1::uuid
            AND operation_id = $2::uuid
            AND owner_token = $3::uuid
            AND state = 'queued'
            AND owner_lease_expires_at > $5::timestamptz`,
        [
          args.tenantId,
          args.operationId,
          args.ownerToken,
          args.ownerLeaseExpiresAt,
          args.now,
        ],
      );
      return (result.rowCount ?? 0) === 1;
    });
  },

  async updateProgress(args) {
    return withTenantContext(args.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE channel_operations
            SET progress_step = $4,
                owner_lease_expires_at = $5::timestamptz,
                updated_at = now()
          WHERE tenant_id = $1::uuid
            AND operation_id = $2::uuid
            AND owner_token = $3::uuid
            AND state = 'running'`,
        [
          args.tenantId,
          args.operationId,
          args.ownerToken,
          args.progressStep,
          args.ownerLeaseExpiresAt,
        ],
      );
      return (result.rowCount ?? 0) === 1;
    });
  },

  async finalize(args) {
    return withTenantContext(args.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE channel_operations
            SET state = $4,
                semantic_kind = $5,
                result = $6::jsonb,
                owner_token = NULL,
                owner_lease_expires_at = NULL,
                finished_at = now(),
                updated_at = now()
          WHERE tenant_id = $1::uuid
            AND operation_id = $2::uuid
            AND owner_token = $3::uuid
            AND state = 'running'`,
        [
          args.tenantId,
          args.operationId,
          args.ownerToken,
          args.state,
          args.semanticKind,
          JSON.stringify(args.result),
        ],
      );
      return (result.rowCount ?? 0) === 1;
    });
  },

  async claimDelivery(args) {
    return withTenantContext(args.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE channel_operations
            SET delivery_token = $3::uuid,
                delivery_lease_expires_at = $4::timestamptz,
                updated_at = now()
          WHERE tenant_id = $1::uuid
            AND operation_id = $2::uuid
            AND state IN ('complete', 'candidate_review', 'insufficient_evidence', 'failed')
            AND terminal_delivered_at IS NULL
            AND (delivery_token IS NULL OR delivery_lease_expires_at <= $5::timestamptz)
        RETURNING ${SELECT_COLS}`,
        [
          args.tenantId,
          args.operationId,
          args.deliveryToken,
          args.deliveryLeaseExpiresAt,
          args.now,
        ],
      );
      return result.rows[0] ? rowToOperation(result.rows[0]) : null;
    });
  },

  async ackDelivery(args) {
    return withTenantContext(args.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE channel_operations
            SET terminal_delivered_at = now(),
                delivery_token = NULL,
                delivery_lease_expires_at = NULL,
                updated_at = now()
          WHERE tenant_id = $1::uuid
            AND operation_id = $2::uuid
            AND delivery_token = $3::uuid
            AND terminal_delivered_at IS NULL`,
        [args.tenantId, args.operationId, args.deliveryToken],
      );
      return (result.rowCount ?? 0) === 1;
    });
  },

  async cancelForSession(args) {
    return withTenantContext(args.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE channel_operations
            SET state = 'cancelled',
                owner_token = NULL,
                owner_lease_expires_at = NULL,
                finished_at = now(),
                updated_at = now()
          WHERE tenant_id = $1::uuid
            AND session_id = $2::uuid
            AND operation_id <> $3::uuid
            AND state IN ('queued', 'running')`,
        [args.tenantId, args.sessionId, args.exceptOperationId],
      );
      return result.rowCount ?? 0;
    });
  },
};

export interface PreparedOperation {
  operationId: string;
  sessionId: string;
  state: OperationState;
  disposition: "execute" | "running" | "terminal" | "cancelled";
  ownerToken: string | null;
  result: Record<string, unknown> | null;
  deliveryToken: string | null;
}

export interface ChannelOperationServiceOptions {
  now?: () => Date;
  randomId?: () => string;
  executionLeaseMs?: number;
  deliveryLeaseMs?: number;
}

export class ChannelOperationService {
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly executionLeaseMs: number;
  private readonly deliveryLeaseMs: number;

  constructor(
    private readonly store: ChannelOperationStore = pgChannelOperationStore,
    opts: ChannelOperationServiceOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.randomId = opts.randomId ?? randomUUID;
    this.executionLeaseMs = opts.executionLeaseMs ?? 5 * 60_000;
    this.deliveryLeaseMs = opts.deliveryLeaseMs ?? 2 * 60_000;
  }

  private expires(ms: number): string {
    return new Date(this.now().getTime() + ms).toISOString();
  }

  private async resolveExisting(
    request: ChannelWorkflowRequest,
    fingerprint: string,
    existing: ChannelOperationRecord,
  ): Promise<PreparedOperation> {
    if (existing.requestFingerprint !== fingerprint) throw new Error("event_id_conflict");

    if (TERMINAL_STATES.has(existing.state)) {
      const delivery = await this.claimTerminalDelivery(request.tenantId, existing.operationId);
      return {
        operationId: existing.operationId,
        sessionId: existing.sessionId,
        state: existing.state,
        disposition: "terminal",
        ownerToken: null,
        result: existing.result,
        deliveryToken: delivery?.deliveryToken ?? null,
      };
    }
    if (existing.state === "cancelled") {
      return {
        operationId: existing.operationId,
        sessionId: existing.sessionId,
        state: existing.state,
        disposition: "cancelled",
        ownerToken: null,
        result: existing.result,
        deliveryToken: null,
      };
    }

    const now = this.now().toISOString();
    if (!existing.ownerLeaseExpiresAt || existing.ownerLeaseExpiresAt <= now) {
      const replacementToken = this.randomId();
      const reclaimed = await this.store.reclaimExecution({
        tenantId: request.tenantId,
        operationId: existing.operationId,
        ownerToken: replacementToken,
        ownerLeaseExpiresAt: this.expires(this.executionLeaseMs),
        now,
      });
      if (reclaimed) {
        return {
          operationId: reclaimed.operationId,
          sessionId: reclaimed.sessionId,
          state: reclaimed.state,
          disposition: "execute",
          ownerToken: replacementToken,
          result: null,
          deliveryToken: null,
        };
      }
    }
    return {
      operationId: existing.operationId,
      sessionId: existing.sessionId,
      state: existing.state,
      disposition: "running",
      ownerToken: null,
      result: null,
      deliveryToken: null,
    };
  }

  async prepare(request: ChannelWorkflowRequest, sessionId: string): Promise<PreparedOperation> {
    const fingerprint = semanticFingerprint(request);

    // The lookup is an allocation-free replay fast path. INSERT remains the
    // authoritative race arbiter through its tenant/channel/event unique key.
    const found = await this.store.getByEvent(
      request.tenantId,
      request.channel,
      request.eventId,
    );
    if (found) return this.resolveExisting(request, fingerprint, found);

    const operationId = this.randomId();
    const ownerToken = this.randomId();
    const inserted = await this.store.insert({
      operationId,
      tenantId: request.tenantId,
      sessionId,
      channel: request.channel,
      eventId: request.eventId,
      requestFingerprint: fingerprint,
      request,
      ownerToken,
      ownerLeaseExpiresAt: this.expires(this.executionLeaseMs),
    });
    if (inserted) {
      return {
        operationId: inserted.operationId,
        sessionId: inserted.sessionId,
        state: inserted.state,
        disposition: "execute",
        ownerToken,
        result: null,
        deliveryToken: null,
      };
    }

    const raced = await this.store.getByEvent(
      request.tenantId,
      request.channel,
      request.eventId,
    );
    if (!raced) throw new Error("operation_claim_race");
    return this.resolveExisting(request, fingerprint, raced);
  }

  async begin(tenantId: string, operationId: string, ownerToken: string): Promise<boolean> {
    return this.store.begin({
      tenantId,
      operationId,
      ownerToken,
      ownerLeaseExpiresAt: this.expires(this.executionLeaseMs),
      now: this.now().toISOString(),
    });
  }

  async finalize(args: {
    tenantId: string;
    operationId: string;
    ownerToken: string;
    state: OperationState;
    semanticKind: string;
    result: Record<string, unknown>;
  }): Promise<boolean> {
    if (!TERMINAL_STATES.has(args.state)) throw new Error("invalid_terminal_state");
    return this.store.finalize(args);
  }

  async updateProgress(
    tenantId: string,
    operationId: string,
    ownerToken: string,
    progressStep: OperationProgressStep,
  ): Promise<boolean> {
    return this.store.updateProgress({
      tenantId,
      operationId,
      ownerToken,
      progressStep,
      ownerLeaseExpiresAt: this.expires(this.executionLeaseMs),
    });
  }

  async claimTerminalDelivery(
    tenantId: string,
    operationId: string,
  ): Promise<{
    deliveryToken: string;
    state: OperationState;
    semanticKind: string | null;
    result: Record<string, unknown> | null;
  } | null> {
    const now = this.now().toISOString();
    const current = await this.store.getById(tenantId, operationId);
    if (
      !current ||
      !TERMINAL_STATES.has(current.state) ||
      current.terminalDeliveredAt ||
      (current.deliveryToken !== null &&
        current.deliveryLeaseExpiresAt !== null &&
        current.deliveryLeaseExpiresAt > now)
    ) {
      return null;
    }
    const deliveryToken = this.randomId();
    const row = await this.store.claimDelivery({
      tenantId,
      operationId,
      deliveryToken,
      deliveryLeaseExpiresAt: this.expires(this.deliveryLeaseMs),
      now,
    });
    if (!row) return null;
    return {
      deliveryToken,
      state: row.state,
      semanticKind: row.semanticKind,
      result: row.result,
    };
  }

  async ackTerminalDelivery(
    tenantId: string,
    operationId: string,
    deliveryToken: string,
  ): Promise<boolean> {
    return this.store.ackDelivery({ tenantId, operationId, deliveryToken });
  }

  async cancelSession(
    tenantId: string,
    sessionId: string,
    exceptOperationId: string,
  ): Promise<number> {
    return this.store.cancelForSession({ tenantId, sessionId, exceptOperationId });
  }

  async get(tenantId: string, operationId: string): Promise<ChannelOperationRecord | null> {
    return this.store.getById(tenantId, operationId);
  }

  async findByEvent(
    tenantId: string,
    channel: Channel,
    eventId: string,
  ): Promise<ChannelOperationRecord | null> {
    return this.store.getByEvent(tenantId, channel, eventId);
  }
}
