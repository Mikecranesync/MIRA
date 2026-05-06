import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

// Reports whether the hub has the env wiring needed to talk to Atlas CMMS.
// The `/cmms` UI uses this to decide between the connected dashboard and the
// "Connect your CMMS" setup card. No Atlas round-trip — env-only check so it
// returns instantly and never blocks page load.
export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = process.env.HUB_CMMS_API_URL ?? "";
  const hasUrl = url.length > 0;
  const hasUser = !!process.env.ATLAS_API_USER;
  const hasPass = !!process.env.ATLAS_API_PASSWORD;
  const configured = hasUrl && hasUser && hasPass;

  return NextResponse.json({
    configured,
    url: hasUrl ? url : null,
    missing: [
      ...(hasUrl ? [] : ["HUB_CMMS_API_URL"]),
      ...(hasUser ? [] : ["ATLAS_API_USER"]),
      ...(hasPass ? [] : ["ATLAS_API_PASSWORD"]),
    ],
  });
}
