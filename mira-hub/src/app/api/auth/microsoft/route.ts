import { NextResponse } from "next/server";
import { newState, stateCookieName } from "@/lib/oauth-state";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

const SCOPES = "Files.Read.All Sites.Read.All Mail.Read User.Read offline_access";

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (!clientId) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=microsoft&status=error&reason=oauth_not_configured`,
    );
  }

  const state = newState();
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${appUrl}/hub/api/auth/microsoft/callback`);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(stateCookieName("microsoft"), state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
