import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const deleted = await withTenantContext(ctx.tenantId, async (c) => {
      const { rowCount } = await c.query(
        `DELETE FROM connected_storage_providers
          WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      return (rowCount ?? 0) > 0;
    });

    if (!deleted) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/storage/providers/:id DELETE]", err);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
