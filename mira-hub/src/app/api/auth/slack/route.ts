import { NextResponse } from "next/server";
import { upsertBinding } from "@/lib/bindings";
import { newState, stateCookieName } from "@/lib/oauth-state";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const clientId = process.env.SLACK_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (!clientId) {
    // Bot-token shortcut: if we already have a Slack bot token, mark connected.
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
      await upsertBinding({
        tenantId: ctx.tenantId,
        provider: "slack",
        accessToken: botToken,
        scopes: ["chat:write", "channels:read", "im:read", "im:write", "users:read"],
        meta: { workspace: "FactoryLM", displayName: "Slack (bot token)", method: "bot_token" },
      });
      return NextResponse.redirect(`${appUrl}/hub/channels?provider=slack&status=connected`);
    }
    return NextResponse.redirect(
      `${appUrl}/hub/channels?provider=slack&status=error&reason=oauth_not_configured`,
    );
  }

  const state = newState();
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "chat:write,channels:read,im:read,im:write,users:read");
  url.searchParams.set("redirect_uri", `${appUrl}/hub/api/auth/slack/callback`);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(stateCookieName("slack"), state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
