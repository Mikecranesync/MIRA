import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceHarness = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  responses: [] as Array<{
    match: RegExp;
    rows: Record<string, unknown>[];
    rowCount?: number;
  }>,
  createNotebookTx: vi.fn(),
  validateTargetTx: vi.fn(),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenantId: string, fn: (client: unknown) => unknown) =>
    fn({
      query: async (sql: string, params: unknown[] = []) => {
        workspaceHarness.calls.push({ sql, params });
        const index = workspaceHarness.responses.findIndex((entry) => entry.match.test(sql));
        if (index < 0) return { rows: [], rowCount: 0 };
        const [entry] = workspaceHarness.responses.splice(index, 1);
        return { rows: entry.rows, rowCount: entry.rowCount ?? entry.rows.length };
      },
    }),
  ),
}));

vi.mock("@/lib/equipment-notebooks", () => ({
  createNotebookTx: (...args: unknown[]) => workspaceHarness.createNotebookTx(...args),
}));

vi.mock("@/lib/workspace-files", () => ({
  validateTargetTx: (...args: unknown[]) => workspaceHarness.validateTargetTx(...args),
}));

import {
  ChannelWorkspaceService,
  pgChannelWorkspaceStore,
  type ChannelWorkspace,
  type ChannelWorkspaceStore,
} from "@/lib/channel-workspaces";
import { parseChannelWorkflowRequest } from "@/lib/channel-workflow-contract";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SESSION_1 = "22222222-2222-4222-8222-222222222221";
const SESSION_2 = "22222222-2222-4222-8222-222222222222";
const NOTEBOOK_1 = "33333333-3333-4333-8333-333333333331";
const NOTEBOOK_2 = "33333333-3333-4333-8333-333333333332";
const NODE_1 = "44444444-4444-4444-8444-444444444441";
const NODE_2 = "44444444-4444-4444-8444-444444444442";
const ASSET = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  workspaceHarness.calls.length = 0;
  workspaceHarness.responses.length = 0;
  workspaceHarness.createNotebookTx.mockReset();
  workspaceHarness.createNotebookTx.mockResolvedValue({ id: NOTEBOOK_2, nodeId: NODE_2 });
  workspaceHarness.validateTargetTx.mockReset();
  workspaceHarness.validateTargetTx.mockResolvedValue({ ok: true, nodeId: null });
});

function request(context: Record<string, string> = {}) {
  return parseChannelWorkflowRequest({
    contractVersion: "1.0",
    tenantId: TENANT,
    actor: { userId: "user-1", externalUserId: "42", uploaderId: "user-1" },
    channel: "telegram",
    eventId: "tg:1",
    conversation: { id: "telegram:-42", ...context },
    action: "message",
    text: "hello",
    caption: "",
    attachments: [],
  });
}

class MemoryWorkspaceStore implements ChannelWorkspaceStore {
  rows: ChannelWorkspace[] = [];
  creates = 0;
  resets = 0;
  cancelled: Array<{ sessionId: string; exceptOperationId: string }> = [];

  async findActive(tenantId: string, channel: string, conversationId: string) {
    return (
      this.rows.find(
        (row) =>
          row.tenantId === tenantId &&
          row.channel === channel &&
          row.conversationId === conversationId &&
          ["awaiting_namespace", "confirmed"].includes(row.status),
      ) ?? null
    );
  }

  async findById(tenantId: string, sessionId: string) {
    return (
      this.rows.find((row) => row.tenantId === tenantId && row.sessionId === sessionId) ?? null
    );
  }

  async create(input: {
    tenantId: string;
    channel: ChannelWorkspace["channel"];
    conversationId: string;
    actorId: string;
    notebookId?: string;
    assetId?: string;
    nodeId?: string;
  }) {
    const raced = await this.findActive(input.tenantId, input.channel, input.conversationId);
    if (raced) return raced;
    this.creates += 1;
    const row: ChannelWorkspace = {
      sessionId: SESSION_1,
      tenantId: input.tenantId,
      channel: input.channel,
      conversationId: input.conversationId,
      generation: 1,
      notebookId: input.notebookId ?? NOTEBOOK_1,
      notebookNodeId: NODE_1,
      selectedNodeId: input.nodeId ?? null,
      assetId: input.assetId ?? null,
      equipmentIdentity: null,
      lastFileId: null,
      lastDocId: null,
      status: input.assetId ? "confirmed" : "awaiting_namespace",
    };
    this.rows.push(row);
    return row;
  }

  async rotate(input: {
    current: ChannelWorkspace;
    actorId: string;
    resetOperationId: string;
  }) {
    this.resets += 1;
    const current = this.rows.find((row) => row.sessionId === input.current.sessionId)!;
    current.status = "abandoned";
    this.cancelled.push({
      sessionId: current.sessionId,
      exceptOperationId: input.resetOperationId,
    });
    const fresh: ChannelWorkspace = {
      sessionId: SESSION_2,
      tenantId: current.tenantId,
      channel: current.channel,
      conversationId: current.conversationId,
      generation: current.generation + 1,
      notebookId: NOTEBOOK_2,
      notebookNodeId: NODE_2,
      selectedNodeId: null,
      assetId: null,
      equipmentIdentity: null,
      lastFileId: null,
      lastDocId: null,
      status: "awaiting_namespace",
    };
    this.rows.push(fresh);
    return fresh;
  }

  async updateState(
    tenantId: string,
    sessionId: string,
    patch: Partial<Pick<ChannelWorkspace, "equipmentIdentity" | "lastFileId" | "lastDocId">>,
  ) {
    const row = this.rows.find(
      (candidate) => candidate.tenantId === tenantId && candidate.sessionId === sessionId,
    );
    if (!row || !["awaiting_namespace", "confirmed"].includes(row.status)) return false;
    Object.assign(row, patch);
    return true;
  }
}

describe("canonical channel conversation workspace", () => {
  it("creates once and reuses one active workspace for the conversation", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new ChannelWorkspaceService(store);
    const first = await service.resolve(request());
    const replay = await service.resolve(request());

    expect(first.sessionId).toBe(SESSION_1);
    expect(replay).toEqual(first);
    expect(store.creates).toBe(1);
  });

  it("preserves supplied notebook, asset, and node context", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new ChannelWorkspaceService(store);
    const workspace = await service.resolve(
      request({ notebookId: NOTEBOOK_1, assetId: ASSET, nodeId: NODE_1 }),
    );

    expect(workspace).toMatchObject({
      notebookId: NOTEBOOK_1,
      assetId: ASSET,
      selectedNodeId: NODE_1,
      status: "confirmed",
    });
  });

  it("fails closed for a supplied foreign/missing session instead of creating around it", async () => {
    const service = new ChannelWorkspaceService(new MemoryWorkspaceStore());
    await expect(service.resolve(request({ sessionId: SESSION_2 }))).rejects.toThrow(
      "workspace_not_found",
    );
  });

  it("rejects context that conflicts with the active canonical workspace", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new ChannelWorkspaceService(store);
    await service.resolve(request({ notebookId: NOTEBOOK_1 }));
    await expect(service.resolve(request({ notebookId: NOTEBOOK_2 }))).rejects.toThrow(
      "workspace_context_conflict",
    );
  });

  it("persists recognized identity and exact File/document ids on the active session", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new ChannelWorkspaceService(store);
    const workspace = await service.resolve(request());
    expect(
      await service.updateState(TENANT, workspace.sessionId, {
        equipmentIdentity: {
          manufacturer: "Danfoss",
          model: "FC-202",
          typeCode: "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
          partNumber: "131H4017",
        },
        lastFileId: "66666666-6666-4666-8666-666666666666",
        lastDocId: "77777777-7777-4777-8777-777777777777",
      }),
    ).toBe(true);

    const stored = await store.findById(TENANT, workspace.sessionId);
    expect(stored).toMatchObject({
      equipmentIdentity: { manufacturer: "Danfoss", model: "FC-202" },
      lastFileId: "66666666-6666-4666-8666-666666666666",
      lastDocId: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("reset abandons the old generation, cancels old work, and returns no stale state", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new ChannelWorkspaceService(store);
    const old = await service.resolve(request({ assetId: ASSET }));
    await service.updateState(TENANT, old.sessionId, {
      equipmentIdentity: { manufacturer: "Danfoss", model: "FC-202" },
      lastFileId: "66666666-6666-4666-8666-666666666666",
      lastDocId: "77777777-7777-4777-8777-777777777777",
    });

    const fresh = await service.reset(request(), "88888888-8888-4888-8888-888888888888");
    expect(fresh).toMatchObject({
      sessionId: SESSION_2,
      generation: 2,
      assetId: null,
      equipmentIdentity: null,
      lastFileId: null,
      lastDocId: null,
      status: "awaiting_namespace",
    });
    expect((await store.findById(TENANT, SESSION_1))?.status).toBe("abandoned");
    expect(store.cancelled).toEqual([
      {
        sessionId: SESSION_1,
        exceptOperationId: "88888888-8888-4888-8888-888888888888",
      },
    ]);
  });
});

function dbRow(workspace: ChannelWorkspace): Record<string, unknown> {
  return {
    session_id: workspace.sessionId,
    tenant_id: workspace.tenantId,
    channel: workspace.channel,
    external_conversation_id: workspace.conversationId,
    generation: workspace.generation,
    notebook_id: workspace.notebookId,
    notebook_node_id: workspace.notebookNodeId,
    selected_node_id: workspace.selectedNodeId,
    asset_id: workspace.assetId,
    equipment_identity: workspace.equipmentIdentity,
    last_file_id: workspace.lastFileId,
    last_doc_id: workspace.lastDocId,
    status: workspace.status,
  };
}

function activeWorkspace(overrides: Partial<ChannelWorkspace> = {}): ChannelWorkspace {
  return {
    sessionId: SESSION_1,
    tenantId: TENANT,
    channel: "telegram",
    conversationId: "telegram:-42",
    generation: 1,
    notebookId: NOTEBOOK_1,
    notebookNodeId: NODE_1,
    selectedNodeId: null,
    assetId: null,
    equipmentIdentity: null,
    lastFileId: null,
    lastDocId: null,
    status: "awaiting_namespace",
    ...overrides,
  };
}

describe("channel workspace PostgreSQL boundary", () => {
  it("serializes creation and tenant-validates every supplied context id", async () => {
    const expected = activeWorkspace({ assetId: ASSET, selectedNodeId: NODE_1, status: "confirmed" });
    workspaceHarness.responses.push(
      { match: /external_conversation_id = \$3[\s\S]*status IN/, rows: [] },
      { match: /FROM equipment_notebooks[\s\S]*id = \$2::uuid/, rows: [{ id: NOTEBOOK_1, node_id: NODE_1 }] },
      { match: /COALESCE\(MAX\(generation\)/, rows: [{ generation: 1 }] },
      { match: /INSERT INTO troubleshooting_sessions/, rows: [{ session_id: SESSION_1 }] },
      { match: /s\.id = \$2::uuid/, rows: [dbRow(expected)] },
    );

    const created = await pgChannelWorkspaceStore.create({
      tenantId: TENANT,
      channel: "telegram",
      conversationId: "telegram:-42",
      actorId: "user-1",
      notebookId: NOTEBOOK_1,
      assetId: ASSET,
      nodeId: NODE_1,
    });
    expect(created).toEqual(expected);
    expect(workspaceHarness.calls[0]).toMatchObject({
      sql: expect.stringContaining("pg_advisory_xact_lock"),
      params: [`channel-workspace:${TENANT}:telegram:telegram:-42`],
    });
    expect(workspaceHarness.validateTargetTx).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      "cmms_asset",
      ASSET,
    );
    expect(workspaceHarness.validateTargetTx).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      "namespace_node",
      NODE_1,
    );
    const notebookLookup = workspaceHarness.calls.find((call) =>
      /FROM equipment_notebooks[\s\S]*id = \$2::uuid/.test(call.sql),
    );
    expect(notebookLookup?.sql).toContain("tenant_id = $1::uuid");
    expect(notebookLookup?.params).toEqual([TENANT, NOTEBOOK_1]);
    const insert = workspaceHarness.calls.find((call) =>
      /INSERT INTO troubleshooting_sessions/.test(call.sql),
    );
    expect(insert?.params[0]).toBe(TENANT);
    expect(insert?.params[7]).toBe(1);
  });

  it("fails closed when a supplied notebook is absent for this tenant", async () => {
    workspaceHarness.responses.push(
      { match: /external_conversation_id = \$3[\s\S]*status IN/, rows: [] },
      { match: /FROM equipment_notebooks[\s\S]*id = \$2::uuid/, rows: [] },
    );
    await expect(
      pgChannelWorkspaceStore.create({
        tenantId: TENANT,
        channel: "telegram",
        conversationId: "telegram:-42",
        actorId: "user-1",
        notebookId: NOTEBOOK_1,
      }),
    ).rejects.toThrow("workspace_notebook_not_found");
    expect(workspaceHarness.createNotebookTx).not.toHaveBeenCalled();
  });

  it("rotates generation and cancels old work without carrying context forward", async () => {
    const current = activeWorkspace({
      assetId: ASSET,
      selectedNodeId: NODE_1,
      equipmentIdentity: { manufacturer: "Danfoss", model: "FC-202" },
      lastFileId: "66666666-6666-4666-8666-666666666666",
      lastDocId: "77777777-7777-4777-8777-777777777777",
      status: "confirmed",
    });
    const fresh = activeWorkspace({
      sessionId: SESSION_2,
      generation: 2,
      notebookId: NOTEBOOK_2,
      notebookNodeId: NODE_2,
    });
    workspaceHarness.responses.push(
      { match: /s\.id = \$2::uuid/, rows: [dbRow(current)] },
      { match: /UPDATE troubleshooting_sessions[\s\S]*status = 'abandoned'/, rows: [], rowCount: 1 },
      { match: /UPDATE channel_operations/, rows: [], rowCount: 1 },
      { match: /INSERT INTO troubleshooting_sessions/, rows: [{ session_id: SESSION_2 }] },
      { match: /s\.id = \$2::uuid/, rows: [dbRow(fresh)] },
    );

    const rotated = await pgChannelWorkspaceStore.rotate({
      current,
      actorId: "user-1",
      resetOperationId: "88888888-8888-4888-8888-888888888888",
    });
    expect(rotated).toEqual(fresh);
    const cancellation = workspaceHarness.calls.find((call) =>
      /UPDATE channel_operations/.test(call.sql),
    );
    expect(cancellation?.sql).toContain("tenant_id = $1::uuid");
    expect(cancellation?.sql).toContain("operation_id <> $3::uuid");
    expect(cancellation?.params).toEqual([
      TENANT,
      SESSION_1,
      "88888888-8888-4888-8888-888888888888",
    ]);
    const inserts = workspaceHarness.calls.filter((call) =>
      /INSERT INTO troubleshooting_sessions/.test(call.sql),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[1]).toBeNull();
    expect(inserts[0].params[7]).toBe(2);
    expect(inserts[0].params[9]).toBeNull();
  });
});
