// GET /api/decision-trace?limit=N&before=<iso>
//
// Returns the most recent decision_traces rows for the authenticated tenant,
// newest first. Used by the /decision-traces admin list page.
// Tenant-scoped via withTenantContext (pure-tenant table — no OEM corpus join).

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT);
  const before = url.searchParams.get("before") ?? null;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT trace_id, session_id, platform, uns_path::text AS uns_path,
                  user_question, citations_present, confidence, outcome,
                  model_used, latency_ms, ts
             FROM decision_traces
            WHERE tenant_id = $1
              AND ($2::timestamptz IS NULL OR ts < $2::timestamptz)
            ORDER BY ts DESC
            LIMIT $3`,
          [ctx.tenantId, before, limit],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows),
    );

    return NextResponse.json({ rows, next: rows.length === limit ? rows[rows.length - 1]?.ts : null });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
