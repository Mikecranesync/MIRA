import { NextResponse } from "next/server";

import type { ChannelOperationRecord } from "@/lib/channel-operations";
import type { ChannelWorkflowRequest } from "@/lib/channel-workflow-contract";
import type { RequestContext } from "@/lib/service-request-context";

export function channelWorkflowAvailable(): boolean {
  return (
    process.env.MIRA_CHANNEL_WORKFLOW_ENABLED === "true" &&
    Boolean(process.env.NEON_DATABASE_URL) &&
    Boolean((process.env.HUB_INGEST_TOKEN ?? "").trim())
  );
}

export function unavailableResponse(): NextResponse {
  return NextResponse.json({ error: "channel_workflow_not_configured" }, { status: 503 });
}

export function authorizeWorkflowRequest(
  ctx: RequestContext,
  request: ChannelWorkflowRequest,
): NextResponse | null {
  if (
    request.tenantId !== ctx.tenantId ||
    request.actor.userId !== ctx.userId ||
    request.actor.uploaderId !== ctx.userId
  ) {
    return NextResponse.json({ error: "workflow_identity_mismatch" }, { status: 403 });
  }
  if (ctx.authKind === "service" && ctx.sourceChannel !== request.channel) {
    return NextResponse.json({ error: "workflow_channel_mismatch" }, { status: 403 });
  }
  if (
    ctx.authKind === "session" &&
    request.channel !== "hub" &&
    request.channel !== "mobile"
  ) {
    return NextResponse.json({ error: "workflow_channel_mismatch" }, { status: 403 });
  }
  return null;
}

export function authorizeWorkflowOperation(
  ctx: RequestContext,
  operation: ChannelOperationRecord,
): NextResponse | null {
  return authorizeWorkflowRequest(ctx, operation.request);
}
