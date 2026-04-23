import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (!appKey) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=dropbox&status=error&reason=oauth_not_configured`
    );
  }

  const state = Buffer.from(Math.random().toString(36)).toString("base64url");
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.searchParams.set("client_id", appKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("redirect_uri", `${appUrl}/hub/api/auth/dropbox/callback`);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("oauth_state_dropbox", state, { httpOnly: true, maxAge: 600, path: "/" });
  return res;
}
