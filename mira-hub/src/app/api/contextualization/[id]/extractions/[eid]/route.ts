import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["accepted", "rejected", "pending"]);

/** PATCH /api/contextualization/[id]/extractions/[eid] — accept or reject a tag extraction. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; eid: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id: projectId, eid } = await params;
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return NextResponse.json({ error: "invalid project id" }, { status: 400 });
  }
  if (!eid || !/^[0-9a-f-]{36}$/i.test(eid)) {
    return NextResponse.json({ error: "invalid extraction id" }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "status must be 'accepted', 'rejected', or 'pending'" },
      { status: 400 },
    );
  }

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query<{ id: string; status: string; updated_at: string }>(
          `UPDATE ctx_extractions
              SET status = $1
            WHERE id = $2
              AND project_id = $3
              AND tenant_id = $4::uuid
            RETURNING id, status, updated_at`,
          [status, eid, projectId, ctx.tenantId],
        )
        .then((r) => r.rows),
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "extraction not found" }, { status: 404 });
    }

    return NextResponse.json({ extraction: rows[0] });
  } catch (err) {
    console.error("[api/contextualization/[id]/extractions/[eid] PATCH]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
