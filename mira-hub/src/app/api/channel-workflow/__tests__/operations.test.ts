import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  context: vi.fn(),
  operations: {
    findByEvent: vi.fn(),
    prepare: vi.fn(),
    get: vi.fn(),
    begin: vi.fn(),
    finalize: vi.fn(),
    claimTerminalDelivery: vi.fn(),
    ackTerminalDelivery: vi.fn(),
    updateProgress: vi.fn(),
  },
  workspaces: {
    resolve: vi.fn(),
    reset: vi.fn(),
    updateState: vi.fn(),
  },
  execute: vi.fn(),
  createDependencies: vi.fn(),
}));

vi.mock("@/lib/service-request-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/service-request-context")>(
    "@/lib/service-request-context",
  );
  return { ...actual, requestContextOr401: harness.context };
});

vi.mock("@/lib/channel-operations", () => ({
  ChannelOperationService: class {
    constructor() {
      return harness.operations;
    }
  },
}));

vi.mock("@/lib/channel-workspaces", () => ({
  ChannelWorkspaceService: class {
    constructor() {
      return harness.workspaces;
    }
  },
}));

vi.mock("@/lib/channel-workflow-orchestrator", () => ({
  executeChannelWorkflow: harness.execute,
}));

vi.mock("@/lib/channel-workflow-hub-adapter", () => ({
  createHubWorkflowDependencies: harness.createDependencies,
}));

import { POST as prepareOperation } from "../operations/route";
import { POST as executeOperation } from "../operations/[id]/execute/route";
import { GET as operationStatus } from "../operations/[id]/route";
import {
  GET as claimDelivery,
  POST as ackDelivery,
} from "../operations/[id]/delivery/route";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const NOTEBOOK = "44444444-4444-4444-8444-444444444444";
const NODE = "55555555-5555-4555-8555-555555555555";
const OPERATION = "66666666-6666-4666-8666-666666666666";
const OWNER = "77777777-7777-4777-8777-777777777777";
const DELIVERY = "88888888-8888-4888-8888-888888888888";
const FILE_ID = "99999999-9999-4999-8999-999999999999";
const DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PDF = Buffer.from("%PDF-1.7\nfixture");
const SHA = createHash("sha256").update(PDF).digest("hex");

function rawRequest(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1.0",
    tenantId: TENANT,
    actor: { userId: USER, externalUserId: "42", uploaderId: USER },
    channel: "telegram",
    eventId: "tg:9001",
    conversation: { id: "telegram:-42" },
    action: "message",
    text: "",
    caption: "VLT User Manual",
    attachments: [
      {
        attachmentId: "pdf:1",
        kind: "pdf",
        mimeType: "application/pdf",
        filename: "VLT User Manual.pdf",
        sizeBytes: PDF.length,
        sha256: SHA,
      },
    ],
    ...overrides,
  };
}

const workspace = {
  sessionId: SESSION,
  tenantId: TENANT,
  channel: "telegram",
  conversationId: "telegram:-42",
  generation: 1,
  notebookId: NOTEBOOK,
  notebookNodeId: NODE,
  selectedNodeId: null,
  assetId: null,
  equipmentIdentity: null,
  lastFileId: null,
  lastDocId: null,
  pendingIntent: null,
  status: "awaiting_namespace",
};

function operation(overrides: Record<string, unknown> = {}) {
  return {
    operationId: OPERATION,
    tenantId: TENANT,
    sessionId: SESSION,
    channel: "telegram",
    eventId: "tg:9001",
    requestFingerprint: SHA,
    request: rawRequest(),
    state: "queued",
    progressStep: "prepared",
    semanticKind: null,
    result: null,
    ownerToken: OWNER,
    ownerLeaseExpiresAt: "2026-08-18T06:00:00.000Z",
    deliveryToken: null,
    terminalDeliveryClaimedAt: null,
    terminalDeliveredAt: null,
    ...overrides,
  };
}

function serviceContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    userId: USER,
    email: "",
    status: "service",
    trialExpiresAt: null,
    role: "service",
    authKind: "service",
    sourceChannel: "telegram",
    ...overrides,
  };
}

function multipart(bytes = PDF, filename = "VLT User Manual.pdf") {
  const form = new FormData();
  form.append("attachment:pdf:1", new File([new Uint8Array(bytes)], filename, { type: "application/pdf" }));
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIRA_CHANNEL_WORKFLOW_ENABLED = "true";
  process.env.NEON_DATABASE_URL = "postgresql://configured";
  process.env.HUB_INGEST_TOKEN = "configured-test-token";
  harness.context.mockResolvedValue(serviceContext());
  harness.operations.findByEvent.mockResolvedValue(null);
  harness.operations.prepare.mockResolvedValue({
    operationId: OPERATION,
    sessionId: SESSION,
    state: "queued",
    disposition: "execute",
    ownerToken: OWNER,
    result: null,
    deliveryToken: null,
  });
  harness.operations.get.mockResolvedValue(operation());
  harness.operations.begin.mockResolvedValue(true);
  harness.operations.finalize.mockResolvedValue(true);
  harness.operations.claimTerminalDelivery.mockResolvedValue({
    deliveryToken: DELIVERY,
    state: "complete",
    semanticKind: "file_intake",
    result: null,
  });
  harness.operations.ackTerminalDelivery.mockResolvedValue(true);
  harness.operations.updateProgress.mockResolvedValue(true);
  harness.workspaces.resolve.mockResolvedValue(workspace);
  harness.createDependencies.mockReturnValue({ progress: vi.fn() });
  harness.execute.mockResolvedValue({
    contractVersion: "1.0",
    operationId: OPERATION,
    state: "complete",
    handled: true,
    semanticKind: "file_intake",
    delegatedRoute: null,
    conversation: { sessionId: SESSION, notebookId: NOTEBOOK, generation: 1 },
    files: [
      {
        fileId: FILE_ID,
        documentId: DOC_ID,
        filename: "VLT User Manual.pdf",
        indexed: true,
        processingState: "indexed",
      },
    ],
    provenance: {},
  });
});

describe("POST /api/channel-workflow/operations", () => {
  it("accepts the same enabled toggle vocabulary as deployment health", async () => {
    process.env.MIRA_CHANNEL_WORKFLOW_ENABLED = "1";

    const response = await prepareOperation(
      new Request("https://hub.test/api/channel-workflow/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rawRequest()),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("allocates one operation against the canonical conversation workspace", async () => {
    const response = await prepareOperation(
      new Request("https://hub.test/api/channel-workflow/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rawRequest()),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      operationId: OPERATION,
      sessionId: SESSION,
      disposition: "execute",
      ownerToken: OWNER,
    });
    expect(harness.workspaces.resolve).toHaveBeenCalledTimes(1);
    expect(harness.operations.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, eventId: "tg:9001" }),
      SESSION,
    );
  });

  it("resolves a duplicate event before workspace lookup, including after reset", async () => {
    harness.operations.findByEvent.mockResolvedValue(operation({ state: "complete" }));
    harness.operations.prepare.mockResolvedValue({
      operationId: OPERATION,
      sessionId: SESSION,
      state: "complete",
      disposition: "terminal",
      ownerToken: null,
      result: { semanticKind: "reset" },
      deliveryToken: DELIVERY,
    });
    const response = await prepareOperation(
      new Request("https://hub.test/api/channel-workflow/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rawRequest()),
      }),
    );
    expect(response.status).toBe(200);
    expect(harness.workspaces.resolve).not.toHaveBeenCalled();
    expect(harness.operations.prepare).toHaveBeenCalledWith(expect.anything(), SESSION);
  });

  it("denies a request whose tenant or actor differs from authenticated service identity", async () => {
    const response = await prepareOperation(
      new Request("https://hub.test/api/channel-workflow/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rawRequest({ tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })),
      }),
    );
    expect(response.status).toBe(403);
    expect(harness.operations.prepare).not.toHaveBeenCalled();
  });
});

describe("POST /api/channel-workflow/operations/:id/execute", () => {
  it("verifies exact attachment bytes, executes once, finalizes, and leases one terminal delivery", async () => {
    const response = await executeOperation(
      new Request(`https://hub.test/api/channel-workflow/operations/${OPERATION}/execute`, {
        method: "POST",
        headers: { "X-Mira-Owner-Token": OWNER },
        body: multipart(),
      }),
      { params: Promise.resolve({ id: OPERATION }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      operationId: OPERATION,
      state: "complete",
      deliveryToken: DELIVERY,
      result: { semanticKind: "file_intake" },
    });
    expect(harness.operations.begin).toHaveBeenCalledWith(TENANT, OPERATION, OWNER);
    expect(harness.execute).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OPERATION, attachments: [expect.objectContaining({ bytes: PDF })] }),
      expect.anything(),
    );
    expect(harness.operations.finalize).toHaveBeenCalledTimes(1);
  });

  it("rejects a byte/hash mismatch before claiming execution", async () => {
    const response = await executeOperation(
      new Request(`https://hub.test/api/channel-workflow/operations/${OPERATION}/execute`, {
        method: "POST",
        headers: { "X-Mira-Owner-Token": OWNER },
        body: multipart(Buffer.from("%PDF-mutated")),
      }),
      { params: Promise.resolve({ id: OPERATION }) },
    );
    expect(response.status).toBe(422);
    expect(harness.operations.begin).not.toHaveBeenCalled();
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it("allows at most one live executor for a duplicate delivery attempt", async () => {
    harness.operations.begin.mockResolvedValue(false);
    const response = await executeOperation(
      new Request(`https://hub.test/api/channel-workflow/operations/${OPERATION}/execute`, {
        method: "POST",
        headers: { "X-Mira-Owner-Token": OWNER },
        body: multipart(),
      }),
      { params: Promise.resolve({ id: OPERATION }) },
    );
    expect(response.status).toBe(409);
    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.operations.finalize).not.toHaveBeenCalled();
  });
});

describe("terminal delivery claim", () => {
  it("exposes durable progress without bypassing terminal-delivery ownership", async () => {
    harness.operations.get.mockResolvedValueOnce(
      operation({ state: "running", progressStep: "ingesting_file", result: { secret: "terminal" } }),
    );
    const response = await operationStatus(
      new Request(`https://hub.test/api/channel-workflow/operations/${OPERATION}`),
      { params: Promise.resolve({ id: OPERATION }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      operationId: OPERATION,
      state: "running",
      progressStep: "ingesting_file",
      terminalDelivered: false,
    });
  });

  it("claims and acknowledges exactly one authenticated delivery token", async () => {
    const claimed = await claimDelivery(
      new Request(`https://hub.test/api/channel-workflow/operations/${OPERATION}/delivery`),
      { params: Promise.resolve({ id: OPERATION }) },
    );
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toMatchObject({ deliveryToken: DELIVERY });

    const acked = await ackDelivery(
      new Request(`https://hub.test/api/channel-workflow/operations/${OPERATION}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryToken: DELIVERY }),
      }),
      { params: Promise.resolve({ id: OPERATION }) },
    );
    expect(acked.status).toBe(200);
    expect(harness.operations.ackTerminalDelivery).toHaveBeenCalledWith(
      TENANT,
      OPERATION,
      DELIVERY,
    );
  });
});
