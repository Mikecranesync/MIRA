import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// Returns the knowledge library rolled up by manufacturer.
// Queries knowledge_entries directly (bypasses RLS via neondb_owner) with an
// explicit tenant_id filter — factorylm_app lacks SELECT on this legacy table,
// and the table's RLS policy reads app.current_tenant_id which withTenantContext
// does not set. Programmatic tenant filter preserves isolation.
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN manufacturer IS NULL OR TRIM(manufacturer) = '' THEN 'Uncategorized'
           ELSE INITCAP(LOWER(TRIM(manufacturer)))
         END AS manufacturer,
         COUNT(*)::bigint AS chunk_count,
         COUNT(DISTINCT source_url)::bigint AS doc_count,
         MAX(created_at) AS last_indexed
       FROM knowledge_entries
       WHERE tenant_id = $1
       GROUP BY 1
       ORDER BY chunk_count DESC`,
      [ctx.tenantId],
    );

    type Mfr = { name: string; chunkCount: number; docCount: number; lastIndexed: unknown };
    const manufacturers: Mfr[] = rows.map((r: Record<string, unknown>) => ({
      name: r.manufacturer as string,
      chunkCount: Number(r.chunk_count),
      docCount: Number(r.doc_count),
      lastIndexed: r.last_indexed,
    }));

    const totalChunks = manufacturers.reduce((s: number, m: Mfr) => s + m.chunkCount, 0);
    const totalDocs = manufacturers.reduce((s: number, m: Mfr) => s + m.docCount, 0);

    return NextResponse.json({
      manufacturers,
      stats: {
        totalChunks,
        totalDocs,
        manufacturerCount: manufacturers.length,
      },
    });
  } catch (err) {
    console.error("[api/knowledge]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
