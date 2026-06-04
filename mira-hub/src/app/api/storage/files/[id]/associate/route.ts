import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid file id" }, { status: 400 });
  }

  let body: { nodeId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { nodeId } = body;
  if (!nodeId || !UUID_RE.test(nodeId)) {
    return NextResponse.json(
      { error: "nodeId is required and must be a UUID" },
      { status: 422 },
    );
  }

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const check = await c.query(
        `SELECT id FROM storage_file_index WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      if (check.rows.length === 0) return null;

      const { rows } = await c.query(
        `INSERT INTO storage_file_nodes (tenant_id, file_id, node_id, associated_by, created_by)
         VALUES ($1, $2, $3, 'drag_drop', $4)
         ON CONFLICT (file_id, node_id) DO NOTHING
         RETURNING id, file_id, node_id`,
        [ctx.tenantId, id, nodeId, ctx.userId],
      );
      return rows[0] ?? { file_id: id, node_id: nodeId };
    });

    if (row === null) {
      return NextResponse.json({ error: "file not found" }, { status: 404 });
    }
    return NextResponse.json({ association: row }, { status: 201 });
  } catch (err) {
    console.error("[api/storage/files/:id/associate POST]", err);
    return NextResponse.json({ error: "insert failed" }, { status: 500 });
  }
}
