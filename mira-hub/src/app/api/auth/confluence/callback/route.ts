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
  if (!validateState(req, "confluence", state)) {
    return errorRedirect(appUrl, "state_mismatch");
  }

  const tokenRes = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: process.env.ATLASSIAN_CLIENT_ID,
      client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
      code,
      redirect_uri: `${appUrl}/hub/api/auth/confluence/callback`,
    }),
  });
  const tokens = await tokenRes.json();
  if (tokens.error) {
    return errorRedirect(appUrl, tokens.error);
  }

  // Atlassian OAuth returns accessible sites separately; fetch the first as primary.
  const resourceRes = await fetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" } },
  );
  const resources = resourceRes.ok ? await resourceRes.json() : [];
  const site = Array.isArray(resources) ? resources[0] : null;

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
    : null;

  await upsertBinding({
    tenantId: ctx.tenantId,
    provider: "confluence",
    externalId: site?.id ?? null,
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    tokenExpiresAt: expiresAt,
    scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    meta: {
      siteName: site?.name ?? "Confluence",
      siteUrl: site?.url ?? "",
      cloudId: site?.id ?? "",
      displayName: site?.name ?? "Confluence",
    },
  });

  const res = NextResponse.redirect(`${appUrl}/hub/channels?provider=confluence&status=connected`);
  res.cookies.delete(stateCookieName("confluence"));
  return res;
}

function errorRedirect(appUrl: string, reason: string) {
  return NextResponse.redirect(
    `${appUrl}/hub/channels?provider=confluence&status=error&reason=${encodeURIComponent(reason)}`,
  );
}
