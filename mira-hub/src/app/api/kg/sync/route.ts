import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { syncCmmsToKg } from "@/lib/knowledge-graph/cmms-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/kg/sync
 *
 * Triggers a full CMMS → Knowledge Graph batch import for the
 * authenticated tenant. Idempotent — safe to call repeatedly;
 * upserts will not create duplicates.
 *
 * Response: SyncResult with entity/relationship counts + duration.
 */
export async function POST() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const result = await syncCmmsToKg(ctx.tenantId);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[api/kg/sync] sync failed:", err);
    return NextResponse.json({ error: "KG sync failed" }, { status: 500 });
  }
}
