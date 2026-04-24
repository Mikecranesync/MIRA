import { NextResponse } from "next/server";
import { listBindings, type Binding } from "@/lib/bindings";

export const dynamic = "force-dynamic";

/**
 * GET /hub/api/connections
 *
 * Returns the current user's channel/integration bindings. Shape matches
 * Partial<Record<Provider, ConnectionMeta>> so the client can swap in place
 * for its previous localStorage reads.
 */
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  try {
    const bindings = await listBindings();
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
