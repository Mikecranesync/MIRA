import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { generateMorningBrief, formatTelegram, formatSlackBlocks } from "@/lib/agents/morning-brief";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const brief = await generateMorningBrief(ctx.tenantId);
    return NextResponse.json({
      brief,
      telegram: formatTelegram(brief),
      slack: formatSlackBlocks(brief),
    });
  } catch (err) {
    console.error("[api/agents/morning-brief]", err);
    return NextResponse.json({ error: "Brief generation failed" }, { status: 500 });
  }
}
