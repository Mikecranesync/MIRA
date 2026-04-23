import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (error || !code) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=microsoft&status=error&reason=${error ?? "no_code"}`
    );
  }

  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      redirect_uri: `${appUrl}/hub/api/auth/microsoft/callback`,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();
  if (tokens.error) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=microsoft&status=error&reason=${tokens.error}`
    );
  }

  const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();

  const meta = encodeURIComponent(JSON.stringify({
    email: user.mail ?? user.userPrincipalName ?? "",
    name: user.displayName ?? "",
  }));

  return NextResponse.redirect(
    `${appUrl}/hub/channels?provider=microsoft&status=connected&meta=${meta}`
  );
}
