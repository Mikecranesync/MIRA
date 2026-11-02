import { NextResponse } from "next/server";
import { buildPosthogInitJavaScript, posthogHost, posthogKey } from "@/capabilities/posthog";

export const dynamic = "force-dynamic";

/**
 * Same-origin PostHog snippet. The ingest key is read from Doppler
 * `PLG_POSTHOG_KEY` at request time — never baked into the client bundle,
 * never an admin/personal API key.
 */
export async function GET() {
  const body = buildPosthogInitJavaScript({ key: posthogKey(), host: posthogHost() });
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
