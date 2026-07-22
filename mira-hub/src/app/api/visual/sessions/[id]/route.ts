// mira-hub/src/app/api/visual/sessions/[id]/route.ts
//
// Visual Focus Workspace (PR V2) — one session. Cross-tenant ids return 404
// (never a metadata-rich 403 — PRD §15).

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    const session = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query(
        `SELECT session_id, asset_id, uns_path::text AS uns_path, title, status,
                created_by, created_at, updated_at, metadata
         FROM visual_session
         WHERE session_id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      return res.rows[0] ?? null;
    });
    if (!session) {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (err) {
    console.error("[api/visual/sessions/:id GET]", err);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
}
