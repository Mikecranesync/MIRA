import { NextResponse } from "next/server";
import { ensureFreshAccessToken } from "@/lib/token-refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;

  if (!clientId || !apiKey || !appId) {
    return NextResponse.json(
      {
        error: "google_picker_not_configured",
        missing: [
          !clientId && "GOOGLE_CLIENT_ID",
          !apiKey && "GOOGLE_PICKER_API_KEY",
          !appId && "GOOGLE_CLOUD_PROJECT_NUMBER",
        ].filter(Boolean),
      },
      { status: 503 },
    );
  }

  try {
    const { accessToken, expiresAt } = await ensureFreshAccessToken("google");
    return NextResponse.json({
      accessToken,
      apiKey,
      clientId,
      appId,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "no_google_binding", detail: (err as Error).message },
      { status: 412 },
    );
  }
}
