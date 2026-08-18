/**
 * Canonical conversation workspace for every thin-client channel.
 *
 * One external conversation maps to one active troubleshooting session and
 * one Equipment Notebook generation. The PostgreSQL store allocates and
 * rotates the entire workspace in a single tenant-scoped transaction.
 */

import type { PoolClient } from "pg";

import { createNotebookTx } from "@/lib/equipment-notebooks";
import { withTenantContext } from "@/lib/tenant-context";
import type {
  Channel,
  ChannelWorkflowRequest,
  EquipmentIdentity,
} from "@/lib/channel-workflow-contract";
import { validateTargetTx } from "@/lib/workspace-files";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES = new Set<ChannelWorkspaceStatus>(["awaiting_namespace", "confirmed"]);

export type ChannelWorkspaceStatus =
  | "awaiting_namespace"
  | "confirmed"
  | "resolved"
  | "abandoned";

export interface ChannelWorkspace {
  sessionId: string;
  tenantId: string;
  channel: Channel;
  conversationId: string;
  generation: number;
  notebookId: string;
  /** Backing namespace node owned by the Equipment Notebook. */
  notebookNodeId: string;
  /** Optional node explicitly selected by the client. */
  selectedNodeId: string | null;
  assetId: string | null;
  equipmentIdentity: EquipmentIdentity | null;
  lastFileId: string | null;
  lastDocId: string | null;
  status: ChannelWorkspaceStatus;
}

export interface CreateChannelWorkspaceInput {
  tenantId: string;
  channel: Channel;
  conversationId: string;
  actorId: string;
  notebookId?: string;
  assetId?: string;
  nodeId?: string;
}

export interface RotateChannelWorkspaceInput {
  current: ChannelWorkspace;
  actorId: string;
  resetOperationId: string;
}

export type ChannelWorkspaceStatePatch = Partial<
  Pick<ChannelWorkspace, "equipmentIdentity" | "lastFileId" | "lastDocId">
>;

export interface ChannelWorkspaceStore {
  findActive(
    tenantId: string,
    channel: Channel,
    conversationId: string,
  ): Promise<ChannelWorkspace | null>;
  findById(tenantId: string, sessionId: string): Promise<ChannelWorkspace | null>;
  create(input: CreateChannelWorkspaceInput): Promise<ChannelWorkspace>;
  rotate(input: RotateChannelWorkspaceInput): Promise<ChannelWorkspace>;
  updateState(
    tenantId: string,
    sessionId: string,
    patch: ChannelWorkspaceStatePatch,
  ): Promise<boolean>;
}

const WORKSPACE_COLS = `
  s.id::text AS session_id,
  s.tenant_id::text AS tenant_id,
  s.channel,
  s.external_conversation_id,
  s.generation,
  s.notebook_id::text AS notebook_id,
  n.node_id::text AS notebook_node_id,
  s.selected_node_id::text AS selected_node_id,
  s.asset_id::text AS asset_id,
  s.equipment_identity,
  s.last_file_id::text AS last_file_id,
  s.last_doc_id::text AS last_doc_id,
  s.status`;

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowToWorkspace(row: Record<string, unknown>): ChannelWorkspace {
  if (!row.notebook_id || !row.notebook_node_id || !row.external_conversation_id) {
    throw new Error("invalid_channel_workspace");
  }
  return {
    sessionId: String(row.session_id),
    tenantId: String(row.tenant_id),
    channel: row.channel as Channel,
    conversationId: String(row.external_conversation_id),
    generation: Number(row.generation),
    notebookId: String(row.notebook_id),
    notebookNodeId: String(row.notebook_node_id),
    selectedNodeId: row.selected_node_id == null ? null : String(row.selected_node_id),
    assetId: row.asset_id == null ? null : String(row.asset_id),
    equipmentIdentity: jsonObject(row.equipment_identity) as EquipmentIdentity | null,
    lastFileId: row.last_file_id == null ? null : String(row.last_file_id),
    lastDocId: row.last_doc_id == null ? null : String(row.last_doc_id),
    status: row.status as ChannelWorkspaceStatus,
  };
}

async function findActiveTx(
  c: PoolClient,
  tenantId: string,
  channel: Channel,
  conversationId: string,
): Promise<ChannelWorkspace | null> {
  const result = await c.query(
    `SELECT ${WORKSPACE_COLS}
       FROM troubleshooting_sessions s
       JOIN equipment_notebooks n
         ON n.tenant_id = s.tenant_id AND n.id = s.notebook_id
      WHERE s.tenant_id = $1::uuid
        AND s.channel = $2
        AND s.external_conversation_id = $3
        AND s.status IN ('awaiting_namespace', 'confirmed')
      ORDER BY s.generation DESC
      LIMIT 1`,
    [tenantId, channel, conversationId],
  );
  return result.rows[0] ? rowToWorkspace(result.rows[0]) : null;
}

async function findByIdTx(
  c: PoolClient,
  tenantId: string,
  sessionId: string,
): Promise<ChannelWorkspace | null> {
  const result = await c.query(
    `SELECT ${WORKSPACE_COLS}
       FROM troubleshooting_sessions s
       JOIN equipment_notebooks n
         ON n.tenant_id = s.tenant_id AND n.id = s.notebook_id
      WHERE s.tenant_id = $1::uuid AND s.id = $2::uuid
      LIMIT 1`,
    [tenantId, sessionId],
  );
  return result.rows[0] ? rowToWorkspace(result.rows[0]) : null;
}

async function lockConversationTx(
  c: PoolClient,
  tenantId: string,
  channel: Channel,
  conversationId: string,
): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `channel-workspace:${tenantId}:${channel}:${conversationId}`,
  ]);
}

async function validateNotebookTx(
  c: PoolClient,
  tenantId: string,
  notebookId: string,
): Promise<{ id: string; nodeId: string }> {
  const result = await c.query(
    `SELECT id::text AS id, node_id::text AS node_id
       FROM equipment_notebooks
      WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, notebookId],
  );
  if (!result.rows[0]) throw new Error("workspace_notebook_not_found");
  return { id: String(result.rows[0].id), nodeId: String(result.rows[0].node_id) };
}

async function validateOptionalContextTx(
  c: PoolClient,
  input: Pick<CreateChannelWorkspaceInput, "tenantId" | "assetId" | "nodeId">,
): Promise<void> {
  if (input.assetId) {
    const asset = await validateTargetTx(c, input.tenantId, "cmms_asset", input.assetId);
    if (!asset.ok) throw new Error("workspace_asset_not_found");
  }
  if (input.nodeId) {
    const node = await validateTargetTx(c, input.tenantId, "namespace_node", input.nodeId);
    if (!node.ok) throw new Error("workspace_node_not_found");
  }
}

function technicianId(actorId: string): string | null {
  return UUID_RE.test(actorId) ? actorId.toLowerCase() : null;
}

async function nextGenerationTx(
  c: PoolClient,
  tenantId: string,
  channel: Channel,
  conversationId: string,
): Promise<number> {
  const result = await c.query(
    `SELECT COALESCE(MAX(generation), 0) + 1 AS generation
       FROM troubleshooting_sessions
      WHERE tenant_id = $1::uuid
        AND channel = $2
        AND external_conversation_id = $3`,
    [tenantId, channel, conversationId],
  );
  return Number(result.rows[0]?.generation ?? 1);
}

async function insertWorkspaceTx(
  c: PoolClient,
  input: CreateChannelWorkspaceInput,
  generation: number,
  notebook: { id: string; nodeId: string },
): Promise<ChannelWorkspace> {
  const confirmed = Boolean(input.assetId);
  const result = await c.query(
    `INSERT INTO troubleshooting_sessions
       (tenant_id, asset_id, technician_user_id, channel, status,
        confirmed_at, metadata, external_conversation_id, generation,
        notebook_id, selected_node_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5,
             CASE WHEN $5 = 'confirmed' THEN now() ELSE NULL END,
             $6::jsonb, $7, $8, $9::uuid, $10::uuid)
     RETURNING id::text AS session_id`,
    [
      input.tenantId,
      input.assetId ?? null,
      technicianId(input.actorId),
      input.channel,
      confirmed ? "confirmed" : "awaiting_namespace",
      JSON.stringify({ actorId: input.actorId, source: "channel_workflow" }),
      input.conversationId,
      generation,
      notebook.id,
      input.nodeId ?? null,
    ],
  );
  const workspace = await findByIdTx(c, input.tenantId, String(result.rows[0].session_id));
  if (!workspace) throw new Error("workspace_create_failed");
  return workspace;
}

export const pgChannelWorkspaceStore: ChannelWorkspaceStore = {
  async findActive(tenantId, channel, conversationId) {
    return withTenantContext(tenantId, (c) =>
      findActiveTx(c, tenantId, channel, conversationId),
    );
  },

  async findById(tenantId, sessionId) {
    return withTenantContext(tenantId, (c) => findByIdTx(c, tenantId, sessionId));
  },

  async create(input) {
    return withTenantContext(input.tenantId, async (c) => {
      await lockConversationTx(c, input.tenantId, input.channel, input.conversationId);
      const raced = await findActiveTx(c, input.tenantId, input.channel, input.conversationId);
      if (raced) return raced;

      await validateOptionalContextTx(c, input);
      const notebook = input.notebookId
        ? await validateNotebookTx(c, input.tenantId, input.notebookId)
        : await createNotebookTx(c, input.tenantId, {
            displayName: `MIRA ${input.channel} workspace`,
            createdBy: input.actorId,
          }).then((created) => ({ id: created.id, nodeId: created.nodeId }));
      const generation = await nextGenerationTx(
        c,
        input.tenantId,
        input.channel,
        input.conversationId,
      );
      return insertWorkspaceTx(c, input, generation, notebook);
    });
  },

  async rotate(input) {
    const { current } = input;
    return withTenantContext(current.tenantId, async (c) => {
      await lockConversationTx(c, current.tenantId, current.channel, current.conversationId);
      const persisted = await findByIdTx(c, current.tenantId, current.sessionId);
      if (
        !persisted ||
        !ACTIVE_STATUSES.has(persisted.status) ||
        persisted.channel !== current.channel ||
        persisted.conversationId !== current.conversationId
      ) {
        throw new Error("workspace_not_found");
      }

      const abandoned = await c.query(
        `UPDATE troubleshooting_sessions
            SET status = 'abandoned', updated_at = now()
          WHERE tenant_id = $1::uuid
            AND id = $2::uuid
            AND status IN ('awaiting_namespace', 'confirmed')`,
        [current.tenantId, current.sessionId],
      );
      if ((abandoned.rowCount ?? 0) !== 1) throw new Error("workspace_reset_race");

      await c.query(
        `UPDATE channel_operations
            SET state = 'cancelled', owner_token = NULL,
                owner_lease_expires_at = NULL, finished_at = now(), updated_at = now()
          WHERE tenant_id = $1::uuid
            AND session_id = $2::uuid
            AND operation_id <> $3::uuid
            AND state IN ('queued', 'running')`,
        [current.tenantId, current.sessionId, input.resetOperationId],
      );

      const notebook = await createNotebookTx(c, current.tenantId, {
        displayName: `MIRA ${current.channel} workspace`,
        createdBy: input.actorId,
      });
      return insertWorkspaceTx(
        c,
        {
          tenantId: current.tenantId,
          channel: current.channel,
          conversationId: current.conversationId,
          actorId: input.actorId,
        },
        current.generation + 1,
        { id: notebook.id, nodeId: notebook.nodeId },
      );
    });
  },

  async updateState(tenantId, sessionId, patch) {
    const assignments: string[] = [];
    const values: unknown[] = [tenantId, sessionId];
    if ("equipmentIdentity" in patch) {
      values.push(patch.equipmentIdentity ? JSON.stringify(patch.equipmentIdentity) : null);
      assignments.push(`equipment_identity = $${values.length}::jsonb`);
    }
    if ("lastFileId" in patch) {
      values.push(patch.lastFileId ?? null);
      assignments.push(`last_file_id = $${values.length}::uuid`);
    }
    if ("lastDocId" in patch) {
      values.push(patch.lastDocId ?? null);
      assignments.push(`last_doc_id = $${values.length}::uuid`);
    }
    if (assignments.length === 0) return false;

    return withTenantContext(tenantId, async (c) => {
      const result = await c.query(
        `UPDATE troubleshooting_sessions
            SET ${assignments.join(", ")}, updated_at = now()
          WHERE tenant_id = $1::uuid
            AND id = $2::uuid
            AND status IN ('awaiting_namespace', 'confirmed')`,
        values,
      );
      return (result.rowCount ?? 0) === 1;
    });
  },
};

function assertContextMatches(
  workspace: ChannelWorkspace,
  request: ChannelWorkflowRequest,
): void {
  if (
    workspace.tenantId !== request.tenantId ||
    workspace.channel !== request.channel ||
    workspace.conversationId !== request.conversation.id ||
    (request.conversation.notebookId !== undefined &&
      request.conversation.notebookId !== workspace.notebookId) ||
    (request.conversation.assetId !== undefined &&
      request.conversation.assetId !== workspace.assetId) ||
    (request.conversation.nodeId !== undefined &&
      request.conversation.nodeId !== workspace.selectedNodeId)
  ) {
    throw new Error("workspace_context_conflict");
  }
}

export class ChannelWorkspaceService {
  constructor(private readonly store: ChannelWorkspaceStore = pgChannelWorkspaceStore) {}

  async resolve(request: ChannelWorkflowRequest): Promise<ChannelWorkspace> {
    let workspace: ChannelWorkspace | null;
    if (request.conversation.sessionId) {
      workspace = await this.store.findById(request.tenantId, request.conversation.sessionId);
      if (!workspace || !ACTIVE_STATUSES.has(workspace.status)) {
        throw new Error("workspace_not_found");
      }
      assertContextMatches(workspace, request);
      return workspace;
    }

    workspace = await this.store.findActive(
      request.tenantId,
      request.channel,
      request.conversation.id,
    );
    if (workspace) {
      assertContextMatches(workspace, request);
      return workspace;
    }
    return this.store.create({
      tenantId: request.tenantId,
      channel: request.channel,
      conversationId: request.conversation.id,
      actorId: request.actor.userId,
      notebookId: request.conversation.notebookId,
      assetId: request.conversation.assetId,
      nodeId: request.conversation.nodeId,
    });
  }

  async reset(
    request: ChannelWorkflowRequest,
    resetOperationId: string,
  ): Promise<ChannelWorkspace> {
    const current = await this.resolve(request);
    return this.store.rotate({
      current,
      actorId: request.actor.userId,
      resetOperationId,
    });
  }

  async updateState(
    tenantId: string,
    sessionId: string,
    patch: ChannelWorkspaceStatePatch,
  ): Promise<boolean> {
    return this.store.updateState(tenantId, sessionId, patch);
  }
}
