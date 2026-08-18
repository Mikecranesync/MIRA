/** Hub-backed dependencies for the channel-neutral orchestrator. */

import { ChannelOperationService } from "@/lib/channel-operations";
import type {
  ChannelWorkflowRequest,
  ChannelCitation,
  EquipmentIdentity,
} from "@/lib/channel-workflow-contract";
import {
  type ChannelWorkflowDependencies,
  type FileIntakeOutcome,
  type NotebookAnswerOutcome,
  type RecognizedImageKind,
  type WorkflowAttachment,
} from "@/lib/channel-workflow-orchestrator";
import {
  ChannelWorkspaceService,
  type ChannelWorkspace,
} from "@/lib/channel-workspaces";
import { listSources } from "@/lib/equipment-notebooks";
import { discoverManual } from "@/lib/manual-discovery";
import { parseFrame } from "@/lib/notebook-chat-types";
import { internalServiceHeaders } from "@/lib/service-request-context";
import type { AttachTarget } from "@/lib/workspace-files";

const INTERNAL_ORIGIN = "http://mira-hub.internal";

function headersFor(request: ChannelWorkflowRequest, json = false): Headers {
  const headers = new Headers(
    internalServiceHeaders({
      tenantId: request.tenantId,
      userId: request.actor.userId,
      sourceChannel: request.channel,
    }),
  );
  if (json) headers.set("Content-Type", "application/json");
  return headers;
}

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function text(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function canonicalFileTargets(
  workspace: ChannelWorkspace,
  filename: string,
): AttachTarget[] {
  const label = filename.slice(0, 255);
  return [
    {
      targetType: "troubleshooting_session",
      targetId: workspace.sessionId,
      role: "conversation_upload",
      displayLabel: label,
    },
    {
      targetType: "equipment_notebook",
      targetId: workspace.notebookId,
      role: "manual",
      displayLabel: label,
    },
    ...(workspace.assetId
      ? [
          {
            targetType: "cmms_asset" as const,
            targetId: workspace.assetId,
            role: "manual",
            displayLabel: label,
          },
        ]
      : []),
    ...(workspace.selectedNodeId
      ? [
          {
            targetType: "namespace_node" as const,
            targetId: workspace.selectedNodeId,
            role: "manual",
            displayLabel: label,
          },
        ]
      : []),
  ];
}

function errorCode(body: Record<string, unknown>, fallback: string): string {
  const raw = text(body.error) ?? fallback;
  return raw.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 100);
}

/** Collapse the canonical chat SSE without changing its grounding semantics. */
export async function parseNotebookChatResponse(
  response: Response,
): Promise<NotebookAnswerOutcome> {
  if (!response.ok) {
    const body = record(await response.json().catch(() => null));
    throw new Error(`notebook_chat_${errorCode(body, `http_${response.status}`)}`);
  }
  const content: string[] = [];
  let citations: ChannelCitation[] = [];
  let status: NotebookAnswerOutcome["status"] | null = null;
  let statusMessage = "";
  for (const line of (await response.text()).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const frame = parseFrame(data);
    if (!frame) continue;
    if (frame.kind === "content") content.push(frame.content);
    if (frame.kind === "sources") {
      citations = frame.citations.map((citation) => ({
        citationId: citation.citationId,
        docId: citation.docId,
        fileId: citation.fileId,
        sourceTitle: citation.sourceTitle,
        page: citation.page,
        quote: citation.quote ?? "",
      }));
    }
    if (frame.kind === "status") {
      status = frame.status;
      statusMessage = frame.message ?? "";
    }
  }
  if (!status) throw new Error("notebook_chat_missing_terminal_status");
  return {
    status,
    text: content.join("") || statusMessage,
    citations,
  };
}

function fileFromAttachment(attachment: WorkflowAttachment): File {
  return new File([new Uint8Array(attachment.bytes)], attachment.descriptor.filename, {
    type: attachment.descriptor.mimeType,
  });
}

async function recognizeThroughHub(
  workspace: ChannelWorkspace,
  attachment: WorkflowAttachment,
  request: ChannelWorkflowRequest,
) {
  const form = new FormData();
  form.append("image", fileFromAttachment(attachment));
  const { POST } = await import(
    "@/app/api/equipment-notebooks/[id]/nameplate/recognize/route"
  );
  const response = await POST(
    new Request(
      `${INTERNAL_ORIGIN}/api/equipment-notebooks/${workspace.notebookId}/nameplate/recognize`,
      { method: "POST", headers: headersFor(request), body: form },
    ) as never,
    { params: Promise.resolve({ id: workspace.notebookId }) },
  );
  const body = record(await response.json().catch(() => null));
  const candidate = record(body.candidate);
  const imageKind: RecognizedImageKind =
    body.imageKind === "nameplate" ||
    body.imageKind === "electrical_print" ||
    body.imageKind === "other"
      ? body.imageKind
      : "unknown";
  return {
    ok: response.ok,
    statusCode: response.status,
    fileId: text(body.fileId),
    imageKind,
    candidate: candidate as EquipmentIdentity,
    confidence: typeof body.confidence === "number" ? body.confidence : null,
    rawObservation: Object.keys(record(body.rawObservation)).length
      ? record(body.rawObservation)
      : null,
    error: text(body.error),
  };
}

async function confirmThroughHub(
  workspace: ChannelWorkspace,
  args: Parameters<ChannelWorkflowDependencies["confirmIdentity"]>[1],
  request: ChannelWorkflowRequest,
) {
  const { POST } = await import(
    "@/app/api/equipment-notebooks/[id]/nameplate/confirm/route"
  );
  const response = await POST(
    new Request(
      `${INTERNAL_ORIGIN}/api/equipment-notebooks/${workspace.notebookId}/nameplate/confirm`,
      {
        method: "POST",
        headers: headersFor(request, true),
        body: JSON.stringify(args),
      },
    ) as never,
    { params: Promise.resolve({ id: workspace.notebookId }) },
  );
  return {
    ok: response.ok,
    statusCode: response.status,
    body: record(await response.json().catch(() => null)),
  };
}

async function intakeThroughHub(
  workspace: ChannelWorkspace,
  attachment: WorkflowAttachment,
  request: ChannelWorkflowRequest,
): Promise<FileIntakeOutcome> {
  const form = new FormData();
  form.append("file", fileFromAttachment(attachment));
  form.append(
    "targets",
    JSON.stringify(canonicalFileTargets(workspace, attachment.descriptor.filename)),
  );
  const { POST } = await import("@/app/api/files/route");
  const response = await POST(
    new Request(`${INTERNAL_ORIGIN}/api/files`, {
      method: "POST",
      headers: headersFor(request),
      body: form,
    }),
  );
  const body = record(await response.json().catch(() => null));
  const indexed = body.indexed === true;
  const sourcesSynced = body.sourcesSynced !== false;
  const processingState =
    indexed && sourcesSynced
      ? "indexed"
      : body.indexing === true || response.status === 202
        ? "processing"
        : body.warning
          ? "stored_not_indexed"
          : response.ok
            ? "stored"
            : "failed";
  return {
    ok: response.ok && body.ok === true,
    statusCode: response.status,
    fileId: text(body.fileId),
    documentId: text(body.uploadId),
    indexed,
    sourcesSynced,
    processingState,
    warning: text(body.warning),
    error: text(body.error),
  };
}

async function answerThroughHub(
  workspace: ChannelWorkspace,
  question: string,
  sourceDocIds: string[],
  request: ChannelWorkflowRequest,
): Promise<NotebookAnswerOutcome> {
  const { POST } = await import("@/app/api/equipment-notebooks/[id]/chat/route");
  const response = await POST(
    new Request(
      `${INTERNAL_ORIGIN}/api/equipment-notebooks/${workspace.notebookId}/chat`,
      {
        method: "POST",
        headers: headersFor(request, true),
        body: JSON.stringify({ message: question, sourceDocIds, history: [] }),
      },
    ) as never,
    { params: Promise.resolve({ id: workspace.notebookId }) },
  );
  return parseNotebookChatResponse(response);
}

export interface HubWorkflowDependencyOptions {
  request: ChannelWorkflowRequest;
  workspace: ChannelWorkspace;
  operationId: string;
  ownerToken: string;
  operationService?: ChannelOperationService;
  workspaceService?: ChannelWorkspaceService;
}

export function createHubWorkflowDependencies(
  options: HubWorkflowDependencyOptions,
): ChannelWorkflowDependencies {
  const operations = options.operationService ?? new ChannelOperationService();
  const workspaces = options.workspaceService ?? new ChannelWorkspaceService();
  const request = options.request;
  return {
    progress: (step) =>
      operations.updateProgress(
        request.tenantId,
        options.operationId,
        options.ownerToken,
        step,
      ),
    updateWorkspace: (patch) =>
      workspaces.updateState(request.tenantId, options.workspace.sessionId, patch),
    resetWorkspace: (resetRequest, operationId) =>
      workspaces.reset(resetRequest, operationId),
    recognizeNameplate: recognizeThroughHub,
    discoverManual,
    confirmIdentity: confirmThroughHub,
    intakeFile: intakeThroughHub,
    listSources: (workspace) => listSources(workspace.tenantId, workspace.notebookId),
    answerNotebook: (workspace, question, sourceDocIds) =>
      answerThroughHub(workspace, question, sourceDocIds, request),
    getPriorOperation: async (tenantId, operationId) => {
      const operation = await operations.get(tenantId, operationId);
      return operation
        ? { tenantId: operation.tenantId, state: operation.state, result: operation.result }
        : null;
    },
  };
}
