import { NextRequest, NextResponse } from "next/server";
import { revokeBinding, type Provider } from "@/lib/bindings";

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

/**
 * DELETE /hub/api/connections/:provider
 *
 * Marks the binding revoked and clears stored tokens. Vendor-side revocation
 * (e.g. Slack's auth.revoke, Dropbox's token/revoke) is intentionally NOT
 * called here — we don't want a partially-completed delete if vendor APIs
 * rate-limit or are down. The local binding is the source of truth for the UI.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!VALID.includes(provider as Provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  try {
    const ok = await revokeBinding(provider as Provider);
    return NextResponse.json({ ok });
  } catch (err) {
    console.error(`[api/connections/${provider}] DELETE`, err);
    return NextResponse.json({ error: "Revoke failed" }, { status: 500 });
  }
}
