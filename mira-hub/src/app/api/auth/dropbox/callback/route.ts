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
  if (!validateState(req, "dropbox", state)) {
    return errorRedirect(appUrl, "state_mismatch");
  }

  const tokenRes = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: process.env.DROPBOX_APP_KEY!,
      client_secret: process.env.DROPBOX_APP_SECRET!,
      redirect_uri: `${appUrl}${OAUTH_BASE}/api/auth/dropbox/callback`,
    }),
  });
  const tokens = await tokenRes.json();
  if (tokens.error) {
    return errorRedirect(appUrl, tokens.error_description ?? tokens.error);
  }

  // Fetch account info for display meta
  let email = "";
  let displayName = "Dropbox";
  try {
    const accountRes = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (accountRes.ok) {
      const acc = await accountRes.json();
      email = acc.email ?? "";
      displayName = acc.name?.display_name ?? "Dropbox";
    }
  } catch {
    /* non-fatal; meta stays minimal */
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
    : null;

  await upsertBinding({
    tenantId: ctx.tenantId,
    provider: "dropbox",
    externalId: tokens.account_id ?? null,
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    tokenExpiresAt: expiresAt,
    scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    meta: {
      accountId: tokens.account_id ?? "",
      email,
      displayName,
    },
  });

  const res = NextResponse.redirect(`${appUrl}${API_BASE}/channels?provider=dropbox&status=connected`);
  res.cookies.delete(stateCookieName("dropbox"));
  return res;
}

function errorRedirect(appUrl: string, reason: string) {
  return NextResponse.redirect(
    `${appUrl}${API_BASE}/channels?provider=dropbox&status=error&reason=${encodeURIComponent(reason)}`,
  );
}
