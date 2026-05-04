import { NextRequest, NextResponse } from "next/server";
import { upsertBinding } from "@/lib/bindings";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /hub/api/auth/openwebui
 *
 * Open WebUI has no OAuth flow; the customer runs their own instance. We
 * record the base URL so the Hub knows which instance to talk to.
 */
export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { url, apiKey } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "URL must be http or https" }, { status: 400 });
  }

  // Best-effort reachability probe — non-fatal if the instance is temporarily down.
  let reachable = false;
  try {
    const probe = await fetch(`${parsed.origin}/api/version`, {
      signal: AbortSignal.timeout(3_000),
    });
    reachable = probe.ok;
  } catch {
    /* leave reachable=false */
  }

  await upsertBinding({
    tenantId: ctx.tenantId,
    provider: "openwebui",
    externalId: parsed.origin,
    accessToken: apiKey ?? null,
    meta: {
      workspace: parsed.origin,
      displayName: "Open WebUI",
      reachable,
    },
  });

  return NextResponse.json({ ok: true, reachable });
}
