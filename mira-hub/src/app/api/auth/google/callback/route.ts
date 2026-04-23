import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (error || !code) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=google&status=error&reason=${error ?? "no_code"}`
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = `${appUrl}/hub/api/auth/google/callback`;

  // Exchange code for tokens
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
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=google&status=error&reason=${tokens.error ?? "token_exchange_failed"}`
    );
  }

  // Get user info to show connected email
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();

  // Get Drive file count (rough)
  let fileCount = 0;
  try {
    const driveRes = await fetch(
      "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=nextPageToken",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (driveRes.ok) fileCount = -1; // -1 = "has files, count pending"
  } catch {/* ignore */}

  const meta = encodeURIComponent(JSON.stringify({
    email: user.email ?? "",
    name: user.name ?? "",
    picture: user.picture ?? "",
    fileCount,
  }));

  return NextResponse.redirect(
    `${appUrl}/hub/channels?provider=google&status=connected&meta=${meta}`
  );
}
