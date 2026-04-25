import { NextRequest, NextResponse } from "next/server";
import { upsertBinding } from "@/lib/bindings";
import { validateState, stateCookieName } from "@/lib/oauth-state";
import { sessionOr401 } from "@/lib/session";

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
  if (!validateState(req, "google", state)) {
    return errorRedirect(appUrl, "state_mismatch");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = `${appUrl}/hub/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || tokens.error) {
    return errorRedirect(appUrl, tokens.error ?? "token_exchange_failed");
  }

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
    : null;

  await upsertBinding({
    tenantId: ctx.tenantId,
    provider: "google",
    externalId: user.id ?? user.email ?? null,
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    tokenExpiresAt: expiresAt,
    scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    meta: {
      email: user.email ?? "",
      displayName: user.name ?? user.email ?? "Google",
      picture: user.picture ?? "",
    },
  });

  const res = NextResponse.redirect(`${appUrl}/hub/channels?provider=google&status=connected`);
  res.cookies.delete(stateCookieName("google"));
  return res;
}

function errorRedirect(appUrl: string, reason: string) {
  return NextResponse.redirect(
    `${appUrl}/hub/channels?provider=google&status=error&reason=${encodeURIComponent(reason)}`,
  );
}
