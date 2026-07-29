// POST /api/namespace/files/[id]/verify — mark a filed document verified (or
// un-verify it). Verified documents are the filing cabinet's permanent record:
// they cannot be deleted (API 409 + migration 059 BEFORE DELETE trigger) until
// an admin explicitly un-verifies them.
//
// Verification is a governance action ("promotion to verified is an admin
// action" — CLAUDE.md / ADR-0017), so it is gated on `namespace.admin`
// (admin/owner in the tenant role→capability matrix, #2360).

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const denied = requireCapability(ctx, "namespace.admin");
  if (denied) return denied;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { verified?: unknown };
  try {
    body = (await req.json()) as { verified?: unknown };
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  if (typeof body.verified !== "boolean") {
    return NextResponse.json({ error: "verified (boolean) is required" }, { status: 422 });
  }
  const verified = body.verified;

  try {
    const updated = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<{ id: string; verified: boolean; verified_at: string | null }>(
        `UPDATE namespace_direct_uploads
            SET verified    = $3,
                verified_at = CASE WHEN $3 THEN now() ELSE NULL END,
                verified_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, verified, verified_at`,
        [id, ctx.tenantId, verified, ctx.userId ?? null],
      );
      return res.rows[0] ?? null;
    });

    if (!updated) {
      return NextResponse.json({ error: "file not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, file: updated });
  } catch (err) {
    console.error("[api/namespace/files/:id/verify POST]", err);
    return NextResponse.json({ error: "Verify failed" }, { status: 500 });
  }
}
