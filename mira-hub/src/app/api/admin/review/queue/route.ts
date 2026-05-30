import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { getReviewQueue, isReviewAdmin } from "@/lib/review-queue";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!isReviewAdmin(ctx.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const data = await withTenantContext(ctx.tenantId, (c) => getReviewQueue(c, ctx.tenantId));
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/admin/review/queue]", err);
    return NextResponse.json({ error: "Queue load failed" }, { status: 500 });
  }
}
