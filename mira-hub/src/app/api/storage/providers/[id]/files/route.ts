import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
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

  const url = new URL(req.url);
  const nodeId = url.searchParams.get("nodeId"); // optional filter

  try {
    const files = await withTenantContext(ctx.tenantId, async (c) => {
      // Verify provider belongs to this tenant
      const check = await c.query(
        `SELECT id FROM connected_storage_providers WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      if (check.rows.length === 0) return null;

      const nodeFilter = nodeId
        ? `AND EXISTS (
             SELECT 1 FROM storage_file_nodes sfn
              WHERE sfn.file_id = sfi.id AND sfn.node_id = $3
           )`
        : "";
      const queryArgs: unknown[] = [id, ctx.tenantId];
      if (nodeId) queryArgs.push(nodeId);

      const { rows } = await c.query(
        `SELECT sfi.id, sfi.external_file_id, sfi.external_url, sfi.filename,
                sfi.mime_type, sfi.file_size_bytes, sfi.last_modified_at,
                sfi.indexed_at, sfi.kb_entry_count, sfi.index_status,
                (
                  SELECT json_agg(json_build_object('nodeId', sfn.node_id, 'confirmedBy', sfn.created_by))
                    FROM storage_file_nodes sfn
                   WHERE sfn.file_id = sfi.id
                ) AS node_associations
           FROM storage_file_index sfi
          WHERE sfi.provider_id = $1
            AND sfi.tenant_id = $2
            AND sfi.index_status != 'removed'
            ${nodeFilter}
          ORDER BY sfi.filename`,
        queryArgs,
      );
      return rows;
    });

    if (files === null) {
      return NextResponse.json({ error: "provider not found" }, { status: 404 });
    }
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[api/storage/providers/:id/files GET]", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
