import { NextRequest, NextResponse } from "next/server";
import { upsertBinding } from "@/lib/bindings";
import { validateState, stateCookieName } from "@/lib/oauth-state";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";

  if (error || !code) {
    return errorRedirect(appUrl, error ?? "no_code");
  }
  if (!validateState(req, "slack", state)) {
    return errorRedirect(appUrl, "state_mismatch");
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
    return errorRedirect(appUrl, data.error ?? "token_exchange_failed");
  }

  await upsertBinding({
    tenantId: ctx.tenantId,
    provider: "slack",
    externalId: data.team?.id ?? null,
    accessToken: data.access_token ?? null,
    scopes: (data.scope ?? "").split(",").filter(Boolean),
    meta: {
      workspace: data.team?.name ?? "Slack Workspace",
      workspaceId: data.team?.id ?? "",
      botUserId: data.bot_user_id ?? "",
      displayName: data.team?.name ?? "Slack",
    },
  });

  const res = NextResponse.redirect(`${appUrl}/hub/channels?provider=slack&status=connected`);
  res.cookies.delete(stateCookieName("slack"));
  return res;
}

function errorRedirect(appUrl: string, reason: string) {
  return NextResponse.redirect(
    `${appUrl}/hub/channels?provider=slack&status=error&reason=${encodeURIComponent(reason)}`,
  );
}
