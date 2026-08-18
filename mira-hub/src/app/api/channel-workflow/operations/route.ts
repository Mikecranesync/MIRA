import { NextResponse } from "next/server";

import { ChannelOperationService } from "@/lib/channel-operations";
import {
  ChannelContractError,
  parseChannelWorkflowRequest,
} from "@/lib/channel-workflow-contract";
import {
  authorizeWorkflowRequest,
  channelWorkflowAvailable,
  unavailableResponse,
} from "@/lib/channel-workflow-http";
import { ChannelWorkspaceService } from "@/lib/channel-workspaces";
import { requestContextOr401 } from "@/lib/service-request-context";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!channelWorkflowAvailable()) return unavailableResponse();
  const ctx = await requestContextOr401(req);
  if (ctx instanceof NextResponse) return ctx;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const request = parseChannelWorkflowRequest(raw);
    const denied = authorizeWorkflowRequest(ctx, request);
    if (denied) return denied;

    const operations = new ChannelOperationService();
    const workspaces = new ChannelWorkspaceService();
    // Replay lookup comes before workspace resolution. A reset abandons the old
    // session, but replay of that same event must still resolve its terminal
    // operation rather than accidentally allocating a new workspace operation.
    const existing = await operations.findByEvent(
      request.tenantId,
      request.channel,
      request.eventId,
    );
    const sessionId = existing
      ? existing.sessionId
      : (await workspaces.resolve(request)).sessionId;
    const prepared = await operations.prepare(request, sessionId);
    return NextResponse.json(prepared, {
      status: !existing && prepared.disposition === "execute" ? 201 : 200,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "workflow_prepare_failed";
    if (err instanceof ChannelContractError) {
      return NextResponse.json({ error: err.code }, { status: 422 });
    }
    if (code === "event_id_conflict" || code === "workspace_context_conflict") {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    if (code === "workspace_not_found") {
      return NextResponse.json({ error: code }, { status: 404 });
    }
    console.error("[channel-workflow prepare]", err);
    return NextResponse.json({ error: "workflow_prepare_failed" }, { status: 500 });
  }
}
