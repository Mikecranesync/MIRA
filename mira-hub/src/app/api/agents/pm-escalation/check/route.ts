import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { runEscalationCheck } from "@/lib/agents/pm-escalation";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const result = await runEscalationCheck(ctx.tenantId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/agents/pm-escalation/check]", err);
    return NextResponse.json({ error: "Escalation check failed" }, { status: 500 });
  }
}
