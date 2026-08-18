import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { ChannelOperationService } from "@/lib/channel-operations";
import { createHubWorkflowDependencies } from "@/lib/channel-workflow-hub-adapter";
import {
  authorizeWorkflowOperation,
  channelWorkflowAvailable,
  unavailableResponse,
} from "@/lib/channel-workflow-http";
import {
  executeChannelWorkflow,
  type WorkflowAttachment,
} from "@/lib/channel-workflow-orchestrator";
import type { ChannelWorkflowResult } from "@/lib/channel-workflow-contract";
import { ChannelWorkspaceService } from "@/lib/channel-workspaces";
import { requestContextOr401 } from "@/lib/service-request-context";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEARTBEAT_MS = 60_000;

function failedResult(
  operationId: string,
  workspace: Awaited<ReturnType<ChannelWorkspaceService["resolve"]>>,
  code: string,
): ChannelWorkflowResult {
  return {
    contractVersion: "1.0",
    operationId,
    state: "failed",
    handled: true,
    semanticKind: "fallthrough",
    delegatedRoute: null,
    conversation: {
      sessionId: workspace.sessionId,
      notebookId: workspace.notebookId,
      generation: workspace.generation,
      assetId: workspace.assetId,
      nodeId: workspace.selectedNodeId,
    },
    answer: { text: "This workflow could not complete.", citations: [] },
    provenance: { errorCode: code },
  };
}

function stableFailureCode(err: unknown): string {
  const raw = err instanceof Error ? err.message : "workflow_execution_failed";
  const allowed = new Set([
    "operation_lease_lost",
    "prior_operation_required",
    "prior_operation_not_found",
    "attachment_envelope_mismatch",
    "service_auth_not_configured",
    "workspace_context_conflict",
  ]);
  return allowed.has(raw) ? raw : "workflow_execution_failed";
}

async function attachmentPayloads(
  req: Request,
  expected: {
    attachmentId: string;
    kind: string;
    mimeType: string;
    filename: string;
    sizeBytes: number;
    sha256: string;
  }[],
): Promise<WorkflowAttachment[] | NextResponse> {
  if (expected.length === 0) return [];
  const form = await req.formData().catch(() => null);
  if (!form)
    return NextResponse.json(
      { error: "attachments_required" },
      { status: 422 },
    );
  const allowed = new Set(
    expected.map((item) => `attachment:${item.attachmentId}`),
  );
  for (const [key] of form.entries()) {
    if (!allowed.has(key)) {
      return NextResponse.json(
        { error: "unexpected_attachment" },
        { status: 422 },
      );
    }
  }

  const attachments: WorkflowAttachment[] = [];
  for (const descriptor of expected) {
    const value = form.get(`attachment:${descriptor.attachmentId}`);
    if (!(value instanceof File)) {
      return NextResponse.json(
        { error: "attachment_missing" },
        { status: 422 },
      );
    }
    const bytes = Buffer.from(await value.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      value.name !== descriptor.filename ||
      value.type !== descriptor.mimeType ||
      bytes.length !== descriptor.sizeBytes ||
      digest !== descriptor.sha256
    ) {
      return NextResponse.json(
        { error: "attachment_integrity_mismatch" },
        { status: 422 },
      );
    }
    if (
      descriptor.kind === "pdf" &&
      bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
    ) {
      return NextResponse.json(
        { error: "attachment_pdf_magic_mismatch" },
        { status: 415 },
      );
    }
    attachments.push({
      descriptor: { ...descriptor } as WorkflowAttachment["descriptor"],
      bytes,
    });
  }
  return attachments;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!channelWorkflowAvailable()) return unavailableResponse();
  const ctx = await requestContextOr401(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id: operationId } = await params;
  if (!UUID_RE.test(operationId)) {
    return NextResponse.json({ error: "operation_not_found" }, { status: 404 });
  }

  const operations = new ChannelOperationService();
  const operation = await operations.get(ctx.tenantId, operationId);
  if (!operation)
    return NextResponse.json({ error: "operation_not_found" }, { status: 404 });
  const denied = authorizeWorkflowOperation(ctx, operation);
  if (denied) return denied;

  const ownerToken = (req.headers.get("x-mira-owner-token") ?? "").trim();
  if (!UUID_RE.test(ownerToken) || operation.ownerToken !== ownerToken) {
    return NextResponse.json(
      { error: "operation_owner_mismatch" },
      { status: 409 },
    );
  }

  const attachments = await attachmentPayloads(
    req,
    operation.request.attachments,
  );
  if (attachments instanceof NextResponse) return attachments;

  const executionRequest = {
    ...operation.request,
    conversation: {
      ...operation.request.conversation,
      sessionId: operation.sessionId,
    },
  };
  const workspaces = new ChannelWorkspaceService();
  let workspace;
  try {
    workspace = await workspaces.resolveForExecution(
      executionRequest,
      operationId,
    );
  } catch {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }

  if (!(await operations.begin(ctx.tenantId, operationId, ownerToken))) {
    return NextResponse.json(
      { error: "operation_already_owned" },
      { status: 409 },
    );
  }

  const baseDependencies = createHubWorkflowDependencies({
    request: executionRequest,
    workspace,
    operationId,
    ownerToken,
    operationService: operations,
    workspaceService: workspaces,
  });
  let progressStep = operation.progressStep;
  const dependencies = {
    ...baseDependencies,
    progress: async (step: Parameters<typeof baseDependencies.progress>[0]) => {
      progressStep = step;
      return baseDependencies.progress(step);
    },
  };
  const heartbeat = setInterval(() => {
    void baseDependencies.progress(progressStep);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    const result = await executeChannelWorkflow(
      { request: executionRequest, workspace, operationId, attachments },
      dependencies,
    );
    const finalized = await operations.finalize({
      tenantId: ctx.tenantId,
      operationId,
      ownerToken,
      state: result.state,
      semanticKind: result.semanticKind,
      result: result as unknown as Record<string, unknown>,
    });
    if (!finalized) {
      return NextResponse.json(
        { error: "operation_lease_lost" },
        { status: 409 },
      );
    }
    const delivery = await operations.claimTerminalDelivery(
      ctx.tenantId,
      operationId,
    );
    return NextResponse.json({
      operationId,
      state: result.state,
      deliveryToken: delivery?.deliveryToken ?? null,
      result: { ...result, deliveryToken: delivery?.deliveryToken ?? null },
    });
  } catch (err) {
    const code = stableFailureCode(err);
    const result = failedResult(operationId, workspace, code);
    const finalized = await operations.finalize({
      tenantId: ctx.tenantId,
      operationId,
      ownerToken,
      state: "failed",
      semanticKind: result.semanticKind,
      result: result as unknown as Record<string, unknown>,
    });
    const delivery = finalized
      ? await operations.claimTerminalDelivery(ctx.tenantId, operationId)
      : null;
    console.error(`[channel-workflow execute] ${code}`);
    return NextResponse.json(
      {
        operationId,
        state: "failed",
        deliveryToken: delivery?.deliveryToken ?? null,
        result: { ...result, deliveryToken: delivery?.deliveryToken ?? null },
      },
      { status: finalized ? 500 : 409 },
    );
  } finally {
    clearInterval(heartbeat);
  }
}
