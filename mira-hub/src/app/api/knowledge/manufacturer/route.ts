import { NextResponse, type NextRequest } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// Returns documents (grouped by source_url) for a manufacturer.
// Manufacturer name is matched case-insensitively to handle case variants
// in the legacy data ('siemens' vs 'Siemens', 'Yaskawa' vs 'Yaskawa Electric Corporation').
// 'Uncategorized' matches NULL or empty manufacturer rows.
export async function GET(req: NextRequest) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name parameter required" }, { status: 400 });
  }

  try {
    const isUncategorized = name.toLowerCase() === "uncategorized";
    const mfrFilter = isUncategorized
      ? "(manufacturer IS NULL OR TRIM(manufacturer) = '')"
      : "LOWER(TRIM(COALESCE(manufacturer, ''))) = LOWER($2)";

    const params: (string | number)[] = [ctx.tenantId];
    if (!isUncategorized) params.push(name);

    const { rows } = await pool.query(
      `SELECT
         source_url,
         MAX(model_number) AS model_number,
         MAX(source_type) AS source_type,
         MAX(equipment_type) AS equipment_type,
         COUNT(*)::bigint AS chunk_count,
         MAX(created_at) AS last_indexed,
         MAX(metadata->>'title') AS title
       FROM knowledge_entries
       WHERE tenant_id = $1
         AND ${mfrFilter}
       GROUP BY source_url
       ORDER BY chunk_count DESC
       LIMIT 500`,
      params,
    );

    const docs = rows.map((r: Record<string, unknown>) => {
      const url = (r.source_url as string | null) ?? "";
      const filename = url.split("/").pop() || url || (r.title as string) || "Untitled";
      return {
        sourceUrl: url,
        title: (r.title as string | null) ?? filename,
        modelNumber: (r.model_number as string | null) ?? null,
        sourceType: (r.source_type as string | null) ?? null,
        equipmentType: (r.equipment_type as string | null) ?? null,
        chunkCount: Number(r.chunk_count),
        lastIndexed: r.last_indexed,
      };
    });

    return NextResponse.json({ manufacturer: name, docs });
  } catch (err) {
    console.error("[api/knowledge/manufacturer]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
