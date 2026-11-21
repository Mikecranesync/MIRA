import { NextResponse } from "next/server";
import { publicSignupPolicy } from "@/capabilities/free-technician-signup";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(publicSignupPolicy(), { headers: { "Cache-Control": "no-store" } });
}
