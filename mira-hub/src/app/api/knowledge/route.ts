import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
          system_category, subcategory, manufacturer, product_family,
          doc_type, source, COUNT(*) as chunk_count,
          AVG(quality_score) as avg_quality,
          MAX(created_at) as last_indexed,
          array_agg(DISTINCT title ORDER BY title) FILTER (WHERE title IS NOT NULL) as sample_titles
        FROM kb_chunks
        WHERE tenant_id = $1
        GROUP BY system_category, subcategory, manufacturer, product_family, doc_type, source
        ORDER BY chunk_count DESC, avg_quality DESC NULLS LAST`,
        [ctx.tenantId],
      ).then((r) => r.rows),
    );

    const docs = rows.map((r: Record<string, unknown>, i: number) => {
      const name = [r.manufacturer, r.product_family, r.system_category, r.subcategory]
        .filter(Boolean)
        .join(" — ") || r.doc_type || "General Knowledge";
      return {
        id: `chunk-group-${i}`,
        name,
        category: r.system_category ?? "general",
        subcategory: r.subcategory ?? null,
        manufacturer: r.manufacturer ?? null,
        productFamily: r.product_family ?? null,
        docType: r.doc_type ?? "knowledge",
        source: r.source ?? null,
        chunkCount: Number(r.chunk_count),
        avgQuality: r.avg_quality ? Math.round(Number(r.avg_quality) * 10) / 10 : null,
        lastIndexed: r.last_indexed,
        sampleTitles: ((r.sample_titles as string[] | null) ?? []).slice(0, 3),
        indexStatus: "indexed" as const,
      };
    });

    const stats = {
      totalChunks: docs.reduce((s: number, d) => s + d.chunkCount, 0),
      totalDocs: docs.length,
      categories: [...new Set(docs.map((d) => d.category))].filter(Boolean),
    };

    return NextResponse.json({ docs, stats });
  } catch (err) {
    console.error("[api/knowledge]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
