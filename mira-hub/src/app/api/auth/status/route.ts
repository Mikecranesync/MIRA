import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN ?? process.env.FACTORYLMDIAGNOSE_TELEGRAM_BOT_TOKEN ?? "";
  const tgUsername = process.env.TELEGRAM_BOT_USERNAME ?? "";
  const slackBotToken = process.env.SLACK_BOT_TOKEN ?? "";

  return NextResponse.json({
    telegram: {
      configured: !!tgToken,
      botUsername: tgUsername || null,
    },
    slack: {
      configured: !!slackBotToken,
      hasOAuth: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
    },
    google: {
      hasOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
    microsoft: {
      hasOAuth: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    },
    dropbox: {
      hasOAuth: !!(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET),
    },
    confluence: {
      hasOAuth: !!(process.env.ATLASSIAN_CLIENT_ID && process.env.ATLASSIAN_CLIENT_SECRET),
    },
  });
}
