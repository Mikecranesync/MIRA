import { NextRequest, NextResponse } from "next/server";
import { upsertBinding } from "@/lib/bindings";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { token, setWebhook, webhookUrl } = await req.json();

  if (!token || typeof token !== "string" || !token.match(/^\d+:[\w-]{35}$/)) {
    return NextResponse.json({ error: "Invalid token format" }, { status: 400 });
  }

  // Validate token with Telegram
  const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const me = await meRes.json();

  if (!me.ok) {
    return NextResponse.json(
      { error: me.description ?? "Invalid bot token" },
      { status: 400 },
    );
  }

  const bot = me.result;

  // Optionally set webhook
  let webhookResult = null;
  if (setWebhook && webhookUrl) {
    const whRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"] }),
    });
    webhookResult = await whRes.json();
  } else {
    const whInfoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    webhookResult = await whInfoRes.json();
  }

  // Persist binding (bot token stored encrypted). Scopes are implicit in Telegram Bot API.
  await upsertBinding({
    provider: "telegram",
    externalId: String(bot.id),
    accessToken: token,
    meta: {
      botUsername: `@${bot.username}`,
      displayName: bot.first_name,
      canJoinGroups: bot.can_join_groups,
      supportsInlineQueries: bot.supports_inline_queries,
      webhookUrl: webhookResult?.result?.url ?? null,
    },
  });

  return NextResponse.json({
    valid: true,
    bot: {
      id: bot.id,
      username: `@${bot.username}`,
      firstName: bot.first_name,
      canJoinGroups: bot.can_join_groups,
      supportsInlineQueries: bot.supports_inline_queries,
    },
    webhook: webhookResult?.result ?? null,
  });
}
