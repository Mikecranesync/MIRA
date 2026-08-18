import { NextResponse } from "next/server";

import { ChannelOperationService } from "@/lib/channel-operations";
import {
  authorizeWorkflowOperation,
  channelWorkflowAvailable,
  unavailableResponse,
} from "@/lib/channel-workflow-http";
import { requestContextOr401 } from "@/lib/service-request-context";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Progress-only read. Terminal content remains behind the delivery lease. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!channelWorkflowAvailable()) return unavailableResponse();
  const ctx = await requestContextOr401(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "operation_not_found" }, { status: 404 });
  }
  const operation = await new ChannelOperationService().get(ctx.tenantId, id);
  if (!operation) return NextResponse.json({ error: "operation_not_found" }, { status: 404 });
  const denied = authorizeWorkflowOperation(ctx, operation);
  if (denied) return denied;
  return NextResponse.json({
    operationId: id,
    state: operation.state,
    progressStep: operation.progressStep,
    terminalDelivered: operation.terminalDeliveredAt !== null,
  });
}
