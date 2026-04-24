import { NextResponse } from "next/server";
import { newState, stateCookieName } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (!clientId) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=confluence&status=error&reason=oauth_not_configured`,
    );
  }

  const state = newState();
  const url = new URL("https://auth.atlassian.com/authorize");
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set(
    "scope",
    "read:confluence-content.all read:confluence-space.summary offline_access",
  );
  url.searchParams.set("redirect_uri", `${appUrl}/hub/api/auth/confluence/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(stateCookieName("confluence"), state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
