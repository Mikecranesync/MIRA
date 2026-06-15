import { NextResponse } from "next/server";
import { serverInfo } from "@/lib/i3x";

export const dynamic = "force-dynamic";

// i3X requires /info to be reachable WITHOUT authentication.
export async function GET() {
  return NextResponse.json({ success: true, result: serverInfo() });
}
