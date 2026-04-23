import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (error || !code) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=confluence&status=error&reason=${error ?? "no_code"}`
    );
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
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=confluence&status=error&reason=${tokens.error}`
    );
  }

  // Get accessible resources (cloud IDs)
  const resourceRes = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
  });
  const resources = await resourceRes.json();
  const site = Array.isArray(resources) ? resources[0] : null;

  const meta = encodeURIComponent(JSON.stringify({
    siteName: site?.name ?? "Confluence",
    siteUrl: site?.url ?? "",
    cloudId: site?.id ?? "",
  }));

  return NextResponse.redirect(
    `${appUrl}/hub/channels?provider=confluence&status=connected&meta=${meta}`
  );
}
