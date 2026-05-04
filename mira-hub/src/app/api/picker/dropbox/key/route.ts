import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const appKey = process.env.DROPBOX_APP_KEY;
  if (!appKey) {
    return NextResponse.json({ error: "dropbox_not_configured" }, { status: 503 });
  }
  return NextResponse.json({ appKey });
}
