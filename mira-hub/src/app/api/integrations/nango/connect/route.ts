// Nango API-key connect — store a provider API key in Nango for a tenant.
// Called by the Hub channels page when a user submits their MaintainX API key.
// Nango encrypts the key at rest; MIRA never sees it again except via the proxy.

import { type NextRequest, NextResponse } from "next/server";
import { createApiKeyConnection, deleteConnection, getConnectionStatus } from "@/lib/nango";
import { getServerSession } from "next-auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const tenantId: string =
    (session?.user as { tenantId?: string } | undefined)?.tenantId ??
    process.env.HUB_TENANT_ID ??
    "default";

  const body = await req.json() as {
    provider: string;
    apiKey: string;
    connectionId?: string;
  };

  const { provider, apiKey, connectionId } = body;

  if (!provider || !apiKey) {
    return NextResponse.json({ error: "provider and apiKey are required" }, { status: 400 });
  }

  const connId = connectionId ?? `${tenantId}-${provider}`;

  const result = await createApiKeyConnection(provider, connId, apiKey);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to create Nango connection" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    connection_id: connId,
    provider,
  });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  const tenantId: string =
    (session?.user as { tenantId?: string } | undefined)?.tenantId ??
    process.env.HUB_TENANT_ID ??
    "default";

  const { searchParams } = req.nextUrl;
  const provider = searchParams.get("provider");

  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  const connId = `${tenantId}-${provider}`;
  await deleteConnection(provider, connId);

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  const tenantId: string =
    (session?.user as { tenantId?: string } | undefined)?.tenantId ??
    process.env.HUB_TENANT_ID ??
    "default";

  const { searchParams } = req.nextUrl;
  const provider = searchParams.get("provider");

  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  const connId = `${tenantId}-${provider}`;
  const status = await getConnectionStatus(provider, connId);

  return NextResponse.json(status);
}
