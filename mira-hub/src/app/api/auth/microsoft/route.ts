import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SCOPES = "Files.Read.All Sites.Read.All Mail.Read User.Read offline_access";

export async function GET() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (!clientId) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=microsoft&status=error&reason=oauth_not_configured`
    );
  }

  const state = Buffer.from(Math.random().toString(36)).toString("base64url");
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${appUrl}/hub/api/auth/microsoft/callback`);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("oauth_state_microsoft", state, { httpOnly: true, maxAge: 600, path: "/" });
  return res;
}
