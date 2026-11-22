import { NextResponse } from "next/server";
import { onboardingPolicy } from "@/capabilities/onboarding-policy";
import { publicSignupPolicy } from "@/capabilities/free-technician-signup";

export const dynamic = "force-dynamic";

export function GET(req?: Request) {
  const intent = req && new URL(req.url).searchParams.get("intent") === "pilot" ? "pilot" : "technician";
  return NextResponse.json({ ...publicSignupPolicy(intent), ...onboardingPolicy() }, { headers: { "Cache-Control": "no-store" } });
}
