import { NextRequest, NextResponse } from "next/server";
import { upsertBinding } from "@/lib/bindings";
import { validateState, stateCookieName } from "@/lib/oauth-state";
import { sessionOr401 } from "@/lib/session";
import { API_BASE, OAUTH_BASE } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (error || !code) {
    return errorRedirect(appUrl, error ?? "no_code");
  }
  if (!validateState(req, "microsoft", state)) {
    return errorRedirect(appUrl, "state_mismatch");
  }

  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      redirect_uri: `${appUrl}${OAUTH_BASE}/api/auth/microsoft/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (tokens.error) {
    return errorRedirect(appUrl, tokens.error);
  }

  const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
    : null;

  await upsertBinding({
    tenantId: ctx.tenantId,
    provider: "microsoft",
    externalId: user.id ?? user.mail ?? user.userPrincipalName ?? null,
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    tokenExpiresAt: expiresAt,
    scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    meta: {
      email: user.mail ?? user.userPrincipalName ?? "",
      displayName: user.displayName ?? "Microsoft 365",
    },
  });

  const res = NextResponse.redirect(`${appUrl}${API_BASE}/channels?provider=microsoft&status=connected`);
  res.cookies.delete(stateCookieName("microsoft"));
  return res;
}

function errorRedirect(appUrl: string, reason: string) {
  return NextResponse.redirect(
    `${appUrl}${API_BASE}/channels?provider=microsoft&status=error&reason=${encodeURIComponent(reason)}`,
  );
}
