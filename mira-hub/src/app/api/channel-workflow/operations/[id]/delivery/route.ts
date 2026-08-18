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

async function contextForOperation(req: Request, operationId: string) {
  if (!channelWorkflowAvailable()) return { response: unavailableResponse() } as const;
  const ctx = await requestContextOr401(req);
  if (ctx instanceof NextResponse) return { response: ctx } as const;
  if (!UUID_RE.test(operationId)) {
    return {
      response: NextResponse.json({ error: "operation_not_found" }, { status: 404 }),
    } as const;
  }
  const operations = new ChannelOperationService();
  const operation = await operations.get(ctx.tenantId, operationId);
  if (!operation) {
    return {
      response: NextResponse.json({ error: "operation_not_found" }, { status: 404 }),
    } as const;
  }
  const denied = authorizeWorkflowOperation(ctx, operation);
  if (denied) return { response: denied } as const;
  return { ctx, operations, operation } as const;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const resolved = await contextForOperation(req, id);
  if ("response" in resolved) return resolved.response!;
  const delivery = await resolved.operations.claimTerminalDelivery(resolved.ctx.tenantId, id);
  if (!delivery) {
    return NextResponse.json(
      {
        operationId: id,
        state: resolved.operation.state,
        progressStep: resolved.operation.progressStep,
        deliveryToken: null,
      },
      { status: 202 },
    );
  }
  return NextResponse.json({ operationId: id, ...delivery });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const resolved = await contextForOperation(req, id);
  if ("response" in resolved) return resolved.response!;
  const body = (await req.json().catch(() => null)) as { deliveryToken?: unknown } | null;
  const token = typeof body?.deliveryToken === "string" ? body.deliveryToken : "";
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "invalid_delivery_token" }, { status: 422 });
  }
  const acknowledged = await resolved.operations.ackTerminalDelivery(
    resolved.ctx.tenantId,
    id,
    token,
  );
  if (!acknowledged) {
    return NextResponse.json({ error: "delivery_token_not_active" }, { status: 409 });
  }
  return NextResponse.json({ operationId: id, acknowledged: true });
}
