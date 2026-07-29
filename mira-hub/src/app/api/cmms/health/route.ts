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

  // HUB_CMMS_API_URL is the INTERNAL Docker hostname (e.g. http://cmms-backend:8080)
  // the hub uses for server-side Atlas calls — it is NOT browser-reachable. The `url`
  // we hand back to the client (for "Open Atlas" + the quick links) must be the PUBLIC
  // hostname, or the links 404/crash in the browser (#2197). Prefer an explicit
  // CMMS_PUBLIC_URL (mira-web uses the same var), else the known public Atlas URL.
  const apiUrl = process.env.HUB_CMMS_API_URL ?? "";
  const publicUrl =
    process.env.CMMS_PUBLIC_URL?.trim() || "https://cmms.factorylm.com";
  const hasUrl = apiUrl.length > 0;
  const hasUser = !!process.env.ATLAS_API_USER;
  const hasPass = !!process.env.ATLAS_API_PASSWORD;
  const configured = hasUrl && hasUser && hasPass;

  return NextResponse.json({
    configured,
    // Always a public, browser-reachable URL — never the internal Docker hostname.
    url: publicUrl,
    missing: [
      ...(hasUrl ? [] : ["HUB_CMMS_API_URL"]),
      ...(hasUser ? [] : ["ATLAS_API_USER"]),
      ...(hasPass ? [] : ["ATLAS_API_PASSWORD"]),
    ],
  });
}
