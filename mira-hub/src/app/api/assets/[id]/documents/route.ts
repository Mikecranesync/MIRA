import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

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

  try {
    // Fetch the asset first so we know its manufacturer/model.
    const asset = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT manufacturer, model_number, equipment_type
         FROM cmms_equipment
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1`,
        [id, ctx.tenantId],
      ).then((r) => r.rows[0] ?? null),
    );

    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const mfr = (asset.manufacturer as string | null) ?? "";
    const model = (asset.model_number as string | null) ?? "";
    if (!mfr) return NextResponse.json([]);

    // Match knowledge_entries by manufacturer (always) + model_number when present.
    // Group by source_url so a single PDF surfaces as one row with its chunk count.
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
           source_url,
           MIN(equipment_type) AS equipment_type,
           MIN(model_number)   AS model_number,
           COUNT(*)::int       AS chunk_count,
           MAX(created_at)     AS last_indexed,
           BOOL_OR(verified)   AS verified
         FROM knowledge_entries
         WHERE tenant_id = $1
           AND LOWER(manufacturer) = LOWER($2)
           AND ($3 = '' OR model_number ILIKE '%' || $3 || '%')
         GROUP BY source_url
         ORDER BY MAX(created_at) DESC NULLS LAST
         LIMIT 50`,
        [ctx.tenantId, mfr, model],
      ).then((r) => r.rows),
    );

    return NextResponse.json(
      rows.map((r: Record<string, unknown>) => ({
        sourceUrl: r.source_url,
        title:
          ((r.source_url as string) || "").split("/").pop()?.split("?")[0] ??
          (r.source_url as string),
        modelNumber: r.model_number ?? null,
        equipmentType: r.equipment_type ?? null,
        chunkCount: r.chunk_count ?? 0,
        lastIndexed: r.last_indexed ?? null,
        verified: r.verified ?? false,
      })),
    );
  } catch (err) {
    console.error("[api/assets/[id]/documents GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
