import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  getReviewQueue,
  isReviewQueueSchemaBehind,
  schemaBehindNotice,
} from "@/lib/review-queue";
import { requireCapability } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

const EMPTY_COUNTS = {
  proposal: 0,
  cartoon: 0,
  screenshot: 0,
  audit: 0,
  total: 0,
};

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  // review_queue.read maps to the same isReviewAdmin(email) allowlist this route
  // always used — behavior-identical, now via the shared guard (#1932).
  const denied = requireCapability(ctx, "review_queue.read");
  if (denied) return denied;
  try {
    const data = await withTenantContext(ctx.tenantId, (c) => getReviewQueue(c, ctx.tenantId));
    return NextResponse.json(data);
  } catch (err) {
    if (isReviewQueueSchemaBehind(err)) {
      const sqlstate = (err as { code?: string } | null | undefined)?.code;
      console.warn("[api/admin/review/queue] schema behind", sqlstate, err);
      return NextResponse.json({
        items: [],
        counts: EMPTY_COUNTS,
        notice: schemaBehindNotice(sqlstate),
      });
    }
    console.error("[api/admin/review/queue]", err);
    return NextResponse.json({ error: "Queue load failed" }, { status: 500 });
  }
}
