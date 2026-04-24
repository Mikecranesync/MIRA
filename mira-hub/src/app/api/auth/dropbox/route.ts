import { NextResponse } from "next/server";
import { newState, stateCookieName } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

export async function GET() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (!appKey) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=dropbox&status=error&reason=oauth_not_configured`,
    );
  }

  const state = newState();
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.searchParams.set("client_id", appKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("redirect_uri", `${appUrl}/hub/api/auth/dropbox/callback`);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(stateCookieName("dropbox"), state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
