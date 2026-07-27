import { NextRequest, NextResponse } from "next/server";
import { AtlasClient } from "@/lib/atlas/client";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

function atlasPublicBase(): string {
  return (process.env.CMMS_PUBLIC_URL?.trim() || "https://cmms.factorylm.com").replace(/\/+$/, "");
}

function safeRedirectPath(value: string | null): string {
  if (value?.startsWith("/app/")) return value;
  return "/app/work-orders";
}

export async function GET(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const atlas = new AtlasClient();
  if (!atlas.configured) {
    return NextResponse.json({ error: "cmms_sso_not_configured" }, { status: 503 });
  }

  let token: string;
  try {
    token = await atlas.getToken();
  } catch (err) {
    console.error("[api/cmms/sso] Atlas signin failed", err);
    return NextResponse.json(
      { error: "cmms_sso_exchange_failed" },
      { status: 502 },
    );
  }

  if (!token) {
    return NextResponse.json({ error: "cmms_sso_exchange_missing_token" }, { status: 502 });
  }

  const redirect = safeRedirectPath(req.nextUrl.searchParams.get("redirect"));
  const target = new URL("/oauth2/success", atlasPublicBase());
  target.searchParams.set("token", token);
  target.searchParams.set("redirect", redirect);

  return NextResponse.redirect(target);
}
