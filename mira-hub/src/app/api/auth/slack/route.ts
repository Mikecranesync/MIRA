import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (!clientId) {
    // We have a bot token already — show as connected without web OAuth
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
      return NextResponse.redirect(
        `${appUrl}/hub/channels?provider=slack&status=connected&meta=${encodeURIComponent(JSON.stringify({ workspace: "FactoryLM", method: "bot_token" }))}`
      );
    }
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=slack&status=error&reason=oauth_not_configured`
    );
  }

  const state = Buffer.from(Math.random().toString(36)).toString("base64url");
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "chat:write,channels:read,im:read,im:write,users:read");
  url.searchParams.set("redirect_uri", `${appUrl}/hub/api/auth/slack/callback`);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("oauth_state_slack", state, { httpOnly: true, maxAge: 600, path: "/" });
  return res;
}
