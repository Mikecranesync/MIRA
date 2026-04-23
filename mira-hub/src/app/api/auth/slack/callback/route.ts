import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (error || !code) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=slack&status=error&reason=${error ?? "no_code"}`
    );
  }

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      redirect_uri: `${appUrl}/hub/api/auth/slack/callback`,
    }),
  });

  const data = await tokenRes.json();
  if (!data.ok) {
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=slack&status=error&reason=${data.error}`
    );
  }

  const meta = encodeURIComponent(JSON.stringify({
    workspace: data.team?.name ?? "Slack Workspace",
    workspaceId: data.team?.id ?? "",
    botUserId: data.bot_user_id ?? "",
  }));

  return NextResponse.redirect(
    `${appUrl}/hub/channels?provider=slack&status=connected&meta=${meta}`
  );
}
