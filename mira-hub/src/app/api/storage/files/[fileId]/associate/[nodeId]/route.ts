import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ fileId: string; nodeId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { fileId, nodeId } = await params;
  if (!fileId || !UUID_RE.test(fileId) || !nodeId || !UUID_RE.test(nodeId)) {
    return NextResponse.json({ error: "invalid ids" }, { status: 400 });
  }

  try {
    const deleted = await withTenantContext(ctx.tenantId, async (c) => {
      const { rowCount } = await c.query(
        `DELETE FROM storage_file_nodes sfn
          USING storage_file_index sfi
          WHERE sfn.file_id = $1 AND sfn.node_id = $2
            AND sfi.id = sfn.file_id AND sfi.tenant_id = $3`,
        [fileId, nodeId, ctx.tenantId],
      );
      return (rowCount ?? 0) > 0;
    });

    if (!deleted) {
      return NextResponse.json({ error: "association not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/storage/files/:fileId/associate/:nodeId DELETE]", err);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
