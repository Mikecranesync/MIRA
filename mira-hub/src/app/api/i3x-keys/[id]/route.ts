import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// DELETE /api/i3x-keys/[id] — revoke a key by hard-deleting it.
// Tenant-scoped: a tenant can only revoke their own keys.
// Uses owner pool.query (no RLS on i3x_api_keys by design).
// Returns 404 on missing row or malformed UUID (Postgres 22P02).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;

  try {
    const result = await pool.query(
      `DELETE FROM i3x_api_keys WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );

    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "22P02") {
      // Malformed UUID — treat as not found
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    console.error("[api/i3x-keys/[id] DELETE]", err);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
