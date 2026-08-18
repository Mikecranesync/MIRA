import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  executeChannelWorkflow,
  type ChannelWorkflowDependencies,
  type WorkflowAttachment,
} from "@/lib/channel-workflow-orchestrator";
import {
  parseChannelWorkflowRequest,
  type Channel,
  type ChannelWorkflowRequest,
} from "@/lib/channel-workflow-contract";
import type { ChannelWorkspace } from "@/lib/channel-workspaces";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const NOTEBOOK = "44444444-4444-4444-8444-444444444444";
const NODE = "55555555-5555-4555-8555-555555555555";
const ASSET = "66666666-6666-4666-8666-666666666666";
const OPERATION = "77777777-7777-4777-8777-777777777777";
const PHOTO_FILE = "88888888-8888-4888-8888-888888888888";
const PDF_FILE = "99999999-9999-4999-8999-999999999999";
const PDF_DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const DANFOSS_IDENTITY = {
  manufacturer: "Danfoss",
  productFamily: "VLT AQUA Drive",
  series: "FC-202",
  model: "FC-202",
  typeCode: "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
  partNumber: "131H4017",
  serialNumber: "02334H073",
  rating: "15 kW / 20 HP",
  input: "3-phase 200-240 V",
  confidence: 0.97,
};

function workspace(overrides: Partial<ChannelWorkspace> = {}): ChannelWorkspace {
  return {
    sessionId: SESSION,
    tenantId: TENANT,
    channel: "telegram",
    conversationId: "telegram:-42",
    generation: 1,
    notebookId: NOTEBOOK,
    notebookNodeId: NODE,
    selectedNodeId: null,
    assetId: ASSET,
    equipmentIdentity: null,
    lastFileId: null,
    lastDocId: null,
    pendingIntent: null,
    pendingOperationId: null,
    status: "confirmed",
    ...overrides,
  };
}

function request(
  overrides: Partial<ChannelWorkflowRequest> & { channel?: Channel } = {},
): ChannelWorkflowRequest {
  return parseChannelWorkflowRequest({
    contractVersion: "1.0",
    tenantId: TENANT,
    actor: { userId: USER, externalUserId: "42", uploaderId: USER },
    channel: overrides.channel ?? "telegram",
    eventId: "event:1",
    conversation: { id: "telegram:-42", assetId: ASSET },
    action: "message",
    text: "Can you find the user manual?",
    caption: "Can you find the user manual?",
    attachments: [],
    ...overrides,
  });
}

function attachment(kind: "image" | "pdf", filename: string): WorkflowAttachment {
  const bytes = Buffer.from(kind === "pdf" ? "%PDF-1.7\nfixture" : "jpeg-fixture");
  return {
    descriptor: {
      attachmentId: `${kind}:1`,
      kind,
      mimeType: kind === "pdf" ? "application/pdf" : "image/jpeg",
      filename,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    bytes,
  };
}

function dependencies(active: ChannelWorkspace): ChannelWorkflowDependencies {
  return {
    progress: vi.fn(async () => true),
    updateWorkspace: vi.fn(async (patch) => {
      Object.assign(active, patch);
      return true;
    }),
    resetWorkspace: vi.fn(async () => workspace({
      sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      notebookId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      notebookNodeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      generation: active.generation + 1,
      assetId: null,
      equipmentIdentity: null,
      lastFileId: null,
      lastDocId: null,
      pendingIntent: null,
      pendingOperationId: null,
    })),
    recognizeNameplate: vi.fn(async () => ({
      ok: true,
      statusCode: 200,
      fileId: PHOTO_FILE,
      imageKind: "nameplate" as const,
      candidate: DANFOSS_IDENTITY,
      confidence: 0.97,
      rawObservation: {
        provider: "fixture",
        rawText: [
          "Danfoss VLT AQUA Drive FC-202",
          "TYPE FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
          "P/N 131H4017",
          "S/N 02334H073",
        ],
      },
    })),
    discoverManual: vi.fn(async () => ({
      serviceAvailable: true,
      found: true,
      candidate: {
        url: "https://assets.danfoss.com/documents/latest/vlt-aqua-fc202.pdf",
        title: "VLT AQUA Drive FC 202 Design Guide",
        host: "assets.danfoss.com",
        score: 0.99,
        docType: "manual",
        isDirectPdf: true,
        validated: true,
      },
      validated: true,
      isDirectPdf: true,
      oemHost: true,
      trustedDistributorHost: false,
      reason: "official OEM candidate found",
    })),
    confirmIdentity: vi.fn(async () => ({
      ok: true,
      statusCode: 200,
      body: {
        status: "complete",
        manual: {
          fileId: PDF_FILE,
          docId: PDF_DOC,
          indexed: true,
          matchState: "verified",
          enabledByDefault: true,
        },
      },
    })),
    intakeFile: vi.fn(async () => ({
      ok: true,
      statusCode: 201,
      fileId: PDF_FILE,
      documentId: PDF_DOC,
      indexed: true,
      sourcesSynced: true,
      processingState: "indexed",
    })),
    listSources: vi.fn(async () => [
      {
        docId: PDF_DOC,
        filename: "VLT User Manual.pdf",
        status: "ready",
        enabledByDefault: true,
        matchState: "user_confirmed" as const,
        sourceRole: "manual",
        pages: 120,
        fileId: PDF_FILE,
        matchEvidence: null,
      },
    ]),
    answerNotebook: vi.fn(async () => ({
      status: "answered" as const,
      text: "Set parameter 1-90 to Motor thermal protection [1].",
      citations: [
        {
          citationId: "1",
          docId: PDF_DOC,
          fileId: PDF_FILE,
          sourceTitle: "VLT User Manual.pdf",
          page: 72,
          quote: "Motor thermal protection",
        },
      ],
    })),
    getPriorOperation: vi.fn(async () => null),
  };
}

function requestWithAttachment(
  item: WorkflowAttachment,
  overrides: Partial<ChannelWorkflowRequest> = {},
): ChannelWorkflowRequest {
  return request({ attachments: [item.descriptor], ...overrides });
}

describe("channel-neutral canonical workflow", () => {
  let active: ChannelWorkspace;
  let deps: ChannelWorkflowDependencies;

  beforeEach(() => {
    active = workspace();
    deps = dependencies(active);
  });

  it("routes the exact Danfoss manual request to nameplate discovery, never PrintSense", async () => {
    const photo = attachment("image", "danfoss-fc202.jpg");
    const result = await executeChannelWorkflow(
      { request: requestWithAttachment(photo), workspace: active, operationId: OPERATION, attachments: [photo] },
      deps,
    );

    expect(result).toMatchObject({
      state: "candidate_review",
      handled: true,
      semanticKind: "nameplate_manual",
      delegatedRoute: null,
      identity: DANFOSS_IDENTITY,
      manual: {
        state: "official_candidate",
        official: true,
        requiresIdentityConfirmation: true,
      },
    });
    expect(deps.discoverManual).toHaveBeenCalledWith(DANFOSS_IDENTITY);
    expect(deps.updateWorkspace).toHaveBeenCalledWith({
      equipmentIdentity: DANFOSS_IDENTITY,
      lastFileId: PHOTO_FILE,
      pendingIntent: "manual_discovery",
      pendingOperationId: OPERATION,
    });
  });

  it("resolves a plain-text confirmation from durable canonical candidate state", async () => {
    const photo = attachment("image", "danfoss-fc202.jpg");
    const candidate = await executeChannelWorkflow(
      {
        request: requestWithAttachment(photo),
        workspace: active,
        operationId: OPERATION,
        attachments: [photo],
      },
      deps,
    );
    vi.mocked(deps.getPriorOperation).mockResolvedValueOnce({
      tenantId: TENANT,
      sessionId: SESSION,
      state: "candidate_review",
      result: candidate as unknown as Record<string, unknown>,
    });

    const result = await executeChannelWorkflow(
      {
        request: request({
          eventId: "event:confirm",
          text: "Yes, confirm it",
          caption: "",
        }),
        workspace: active,
        operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        attachments: [],
      },
      deps,
    );

    expect(deps.getPriorOperation).toHaveBeenCalledWith(TENANT, OPERATION);
    expect(deps.confirmIdentity).toHaveBeenCalledWith(
      active,
      expect.objectContaining({ identity: DANFOSS_IDENTITY, discover: true }),
      expect.objectContaining({ channel: "telegram" }),
    );
    expect(deps.recognizeNameplate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      state: "complete",
      semanticKind: "nameplate_manual",
      provenance: { sourceOperationId: OPERATION },
    });
    expect(active.pendingOperationId).toBeNull();
  });

  it("uses a strictly parsed user correction when confirming a candidate", async () => {
    active.pendingOperationId = OPERATION;
    vi.mocked(deps.getPriorOperation).mockResolvedValueOnce({
      tenantId: TENANT,
      sessionId: SESSION,
      state: "candidate_review",
      result: {
        identity: DANFOSS_IDENTITY,
        provenance: {
          nameplateFileId: PHOTO_FILE,
          confidence: 0.97,
          rawObservation: { provider: "fixture" },
        },
      },
    });
    const corrected = { ...DANFOSS_IDENTITY, serialNumber: "02334H073-CORRECTED" };

    await executeChannelWorkflow(
      {
        request: request({
          action: "confirm_identity",
          priorOperationId: OPERATION,
          confirmedIdentity: corrected,
          text: "",
          caption: "",
        }),
        workspace: active,
        operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        attachments: [],
      },
      deps,
    );

    expect(deps.confirmIdentity).toHaveBeenCalledWith(
      active,
      expect.objectContaining({ identity: corrected }),
      expect.anything(),
    );
    expect(active.equipmentIdentity).toEqual(corrected);
  });

  it("rejects a candidate operation from another conversation workspace", async () => {
    active.pendingOperationId = OPERATION;
    vi.mocked(deps.getPriorOperation).mockResolvedValueOnce({
      tenantId: TENANT,
      sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      state: "candidate_review",
      result: {
        identity: DANFOSS_IDENTITY,
        provenance: { nameplateFileId: PHOTO_FILE },
      },
    });

    await expect(
      executeChannelWorkflow(
        {
          request: request({ text: "Yes, confirm it", caption: "" }),
          workspace: active,
          operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          attachments: [],
        },
        deps,
      ),
    ).rejects.toThrow("prior_operation_not_found");
    expect(deps.confirmIdentity).not.toHaveBeenCalled();
  });

  it("reuses persisted identity on the model-number follow-up without another image inference", async () => {
    active.equipmentIdentity = DANFOSS_IDENTITY;
    active.lastFileId = PHOTO_FILE;
    active.pendingIntent = "manual_discovery";
    const result = await executeChannelWorkflow(
      {
        request: request({
          eventId: "event:2",
          text: "Here's the model number: FC-202",
          caption: "",
        }),
        workspace: active,
        operationId: OPERATION,
        attachments: [],
      },
      deps,
    );

    expect(result.semanticKind).toBe("nameplate_manual");
    expect(result.identity).toEqual(DANFOSS_IDENTITY);
    expect(deps.recognizeNameplate).not.toHaveBeenCalled();
    expect(deps.discoverManual).toHaveBeenCalledTimes(1);
  });

  it("intakes one supplied PDF with conversation/asset links, then cites that exact doc", async () => {
    const pdf = attachment("pdf", "VLT User Manual.pdf");
    const intake = await executeChannelWorkflow(
      {
        request: requestWithAttachment(pdf, {
          eventId: "event:pdf",
          text: "",
          caption: "VLT User Manual",
        }),
        workspace: active,
        operationId: OPERATION,
        attachments: [pdf],
      },
      deps,
    );

    expect(intake).toMatchObject({
      state: "complete",
      semanticKind: "file_intake",
      files: [
        {
          fileId: PDF_FILE,
          documentId: PDF_DOC,
          filename: "VLT User Manual.pdf",
          indexed: true,
          processingState: "indexed",
        },
      ],
    });
    expect(deps.intakeFile).toHaveBeenCalledWith(
      active,
      pdf,
      expect.objectContaining({ channel: "telegram" }),
    );
    expect(active).toMatchObject({ lastFileId: PDF_FILE, lastDocId: PDF_DOC });

    const answer = await executeChannelWorkflow(
      {
        request: request({
          eventId: "event:question",
          text: "How do I configure motor thermal protection?",
          caption: "",
          attachments: [],
        }),
        workspace: active,
        operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        attachments: [],
      },
      deps,
    );
    expect(deps.answerNotebook).toHaveBeenCalledWith(
      active,
      "How do I configure motor thermal protection?",
      [PDF_DOC],
    );
    expect(answer).toMatchObject({
      semanticKind: "grounded_answer",
      answer: {
        citations: [{ docId: PDF_DOC, fileId: PDF_FILE, page: 72 }],
      },
    });
  });

  it("delegates a real electrical print and does not run manual discovery", async () => {
    const photo = attachment("image", "electrical-print.jpg");
    vi.mocked(deps.recognizeNameplate).mockResolvedValueOnce({
      ok: true,
      statusCode: 200,
      fileId: PHOTO_FILE,
      imageKind: "electrical_print",
      candidate: { manufacturer: "Danfoss" },
      confidence: 0.99,
      rawObservation: { provider: "fixture", rawText: ["PAGE 1", "K1", "M1"] },
    });

    const result = await executeChannelWorkflow(
      { request: requestWithAttachment(photo), workspace: active, operationId: OPERATION, attachments: [photo] },
      deps,
    );
    expect(result).toMatchObject({
      handled: false,
      semanticKind: "fallthrough",
      delegatedRoute: "printsense",
    });
    expect(deps.discoverManual).not.toHaveBeenCalled();
  });

  it("never selects candidate or disabled sources for a grounded answer", async () => {
    vi.mocked(deps.listSources).mockResolvedValueOnce([
      {
        docId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        filename: "unofficial.pdf",
        status: "ready",
        enabledByDefault: false,
        matchState: "candidate",
        sourceRole: "manual",
        pages: 1,
        fileId: null,
        matchEvidence: { oemHost: false },
      },
      ...(await deps.listSources(active)),
    ]);
    await executeChannelWorkflow(
      {
        request: request({ text: "What does the manual say?", caption: "" }),
        workspace: active,
        operationId: OPERATION,
        attachments: [],
      },
      deps,
    );
    expect(deps.answerNotebook).toHaveBeenCalledWith(
      active,
      "What does the manual say?",
      [PDF_DOC],
    );
  });

  it("rotates every canonical context field on reset", async () => {
    Object.assign(active, {
      equipmentIdentity: DANFOSS_IDENTITY,
      lastFileId: PDF_FILE,
      lastDocId: PDF_DOC,
      pendingIntent: "manual_discovery",
      pendingOperationId: OPERATION,
    });
    const result = await executeChannelWorkflow(
      {
        request: request({ action: "reset", text: "/new", caption: "" }),
        workspace: active,
        operationId: OPERATION,
        attachments: [],
      },
      deps,
    );
    expect(result).toMatchObject({
      state: "complete",
      semanticKind: "reset",
      identity: null,
      conversation: { generation: 2, assetId: null },
    });
  });

  it("produces one semantic outcome for Hub, mobile, Telegram, and Slack", async () => {
    const photo = attachment("image", "danfoss-fc202.jpg");
    const results = await Promise.all(
      (["hub", "mobile", "telegram", "slack"] as const).map((channel) => {
        const channelWorkspace = workspace({ channel, conversationId: `${channel}:42` });
        const channelDeps = dependencies(channelWorkspace);
        return executeChannelWorkflow(
          {
            request: requestWithAttachment(photo, {
              channel,
              eventId: `${channel}:1`,
              conversation: { id: `${channel}:42`, assetId: ASSET },
            }),
            workspace: channelWorkspace,
            operationId: OPERATION,
            attachments: [photo],
          },
          channelDeps,
        );
      }),
    );
    const semantic = results.map((result) => ({
      state: result.state,
      handled: result.handled,
      kind: result.semanticKind,
      identity: result.identity,
      manual: result.manual,
    }));
    expect(semantic.slice(1)).toEqual([semantic[0], semantic[0], semantic[0]]);
  });
});
