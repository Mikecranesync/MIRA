import { NextResponse } from "next/server";
import { listBindings, type Binding } from "@/lib/bindings";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const bindings = await listBindings(ctx.tenantId);
    return NextResponse.json(toClientShape(bindings));
  } catch (err) {
    console.error("[api/connections] GET", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

function toClientShape(bindings: Binding[]) {
  const out: Record<string, unknown> = {};
  for (const b of bindings) {
    const meta = b.meta ?? {};
    out[b.provider] = {
      connected: true,
      connectedAt: b.connectedAt,
      displayName: meta.displayName,
      workspace: meta.workspace,
      botUsername: meta.botUsername,
      email: meta.email,
      siteName: meta.siteName,
      siteUrl: meta.siteUrl,
      cloudId: meta.cloudId,
    };
  }
  return out;
}
