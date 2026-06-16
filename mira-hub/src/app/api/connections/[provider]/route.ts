import { NextRequest, NextResponse } from "next/server";
import { revokeBinding, type Provider } from "@/lib/bindings";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

const VALID: Provider[] = [
  "telegram",
  "slack",
  "teams",
  "openwebui",
  "google",
  "microsoft",
  "dropbox",
  "confluence",
];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { provider } = await params;
  if (!VALID.includes(provider as Provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  try {
    const ok = await revokeBinding(provider as Provider, ctx.tenantId);
    return NextResponse.json({ ok });
  } catch (err) {
    console.error(`[api/connections/${provider}] DELETE`, err);
    return NextResponse.json({ error: "Revoke failed" }, { status: 500 });
  }
}
