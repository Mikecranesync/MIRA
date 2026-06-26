import { SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

function atlasApiBase(): string {
  return (process.env.HUB_CMMS_API_URL ?? "https://cmms.factorylm.com").replace(/\/+$/, "");
}

function atlasPublicBase(): string {
  return (process.env.CMMS_PUBLIC_URL?.trim() || "https://cmms.factorylm.com").replace(/\/+$/, "");
}

function safeRedirectPath(value: string | null): string {
  if (value?.startsWith("/app/")) return value;
  return "/app/work-orders";
}

async function createHubAssertion(args: {
  email: string;
  userId: string;
  tenantId: string;
}): Promise<string> {
  const secret = process.env.HUB_SSO_SECRET?.trim();
  if (!secret) throw new Error("missing_hub_sso_secret");

  const issuer = process.env.HUB_SSO_ISSUER?.trim() || "factorylm-hub";
  const audience = process.env.HUB_SSO_AUDIENCE?.trim() || "atlas-cmms";
  const key = new TextEncoder().encode(secret);

  return new SignJWT({
    email: args.email,
    tenantId: args.tenantId,
    userId: args.userId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(args.email)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(key);
}

export async function GET(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let assertion: string;
  try {
    assertion = await createHubAssertion({
      email: ctx.email,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    });
  } catch {
    return NextResponse.json({ error: "cmms_sso_not_configured" }, { status: 503 });
  }

  const atlasRes = await fetch(`${atlasApiBase()}/auth/sso/hub`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assertion }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!atlasRes.ok) {
    return NextResponse.json(
      { error: "cmms_sso_exchange_failed", status: atlasRes.status },
      { status: 502 },
    );
  }

  const data = (await atlasRes.json()) as { accessToken?: string; token?: string };
  const token = data.accessToken ?? data.token;
  if (!token) {
    return NextResponse.json({ error: "cmms_sso_exchange_missing_token" }, { status: 502 });
  }

  const redirect = safeRedirectPath(req.nextUrl.searchParams.get("redirect"));
  const target = new URL("/oauth2/success", atlasPublicBase());
  target.searchParams.set("token", token);
  target.searchParams.set("redirect", redirect);

  return NextResponse.redirect(target);
}
