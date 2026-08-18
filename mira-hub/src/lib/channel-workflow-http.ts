import { NextResponse } from "next/server";

import type { ChannelOperationRecord } from "@/lib/channel-operations";
import type { ChannelWorkflowRequest } from "@/lib/channel-workflow-contract";
import type { RequestContext } from "@/lib/service-request-context";

export type ChannelWorkflowToggle = "enabled" | "disabled" | "invalid";

export function parseChannelWorkflowToggle(
  rawValue = process.env.MIRA_CHANNEL_WORKFLOW_ENABLED,
): ChannelWorkflowToggle {
  const normalized = (rawValue ?? "0").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return "enabled";
  if (["", "0", "false", "no", "off"].includes(normalized)) return "disabled";
  return "invalid";
}

export function channelWorkflowAvailable(): boolean {
  return (
    parseChannelWorkflowToggle() === "enabled" &&
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
