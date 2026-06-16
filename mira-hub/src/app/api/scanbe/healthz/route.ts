import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Public health probe for MIRA Scan backend. Must remain auth-exempt (see middleware.ts matcher). */
export function GET() {
  return NextResponse.json({ status: "ok", service: "mira-scan", ts: Date.now() });
}
