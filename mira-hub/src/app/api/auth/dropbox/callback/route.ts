import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (error || !code) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=dropbox&status=error&reason=${error ?? "no_code"}`
    );
  }

  const tokenRes = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: process.env.DROPBOX_APP_KEY!,
      client_secret: process.env.DROPBOX_APP_SECRET!,
      redirect_uri: `${appUrl}/hub/api/auth/dropbox/callback`,
    }),
  });

  const tokens = await tokenRes.json();
  if (tokens.error) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=dropbox&status=error&reason=${tokens.error}`
    );
  }

  const meta = encodeURIComponent(JSON.stringify({
    email: tokens.account_id ?? "",
    displayName: "Dropbox",
  }));

  return NextResponse.redirect(
    `${appUrl}/hub/channels?provider=dropbox&status=connected&meta=${meta}`
  );
}
