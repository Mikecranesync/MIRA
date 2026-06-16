import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/library/tree
 *
 * Returns the KB library tree grouped by manufacturer → model → source.
 * Reads `knowledge_entries` (the real 74K-row vector store, not the
 * empty kb_chunks stub).
 *
 * Response shape:
 *   {
 *     totalChunks: 74714,
 *     totalManufacturers: 12,
 *     manufacturers: [
 *       {
 *         name: "Allen-Bradley",
 *         chunkCount: 32584,
 *         modelCount: 47,
 *         models: [
 *           {
 *             name: "PowerFlex 525",
 *             chunkCount: 1842,
 *             documentCount: 3,
 *             sources: [
 *               { url: "https://…", title: "User Manual v3", chunkCount: 624, sourceType: "manual" },
 *               …
 *             ],
 *           },
 *           …
 *         ],
 *       },
 *       …
 *     ],
 *   }
 *
 * Library page Phase 4 — UNS+KG unification spec.
 */

type SourceRow = {
  manufacturer: string | null;
  model_number: string | null;
  source_url: string | null;
  source_type: string | null;
  title: string | null;
  chunk_count: string;
};

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const data = await withTenantContext(ctx.tenantId, async (c) => {
      // Pull every (manufacturer, model, source_url, title) bucket once
      // and shape it client-side. With ~74K rows and roughly hundreds of
      // distinct sources, this is well under 1 round-trip's worth of
      // payload — and it lets the tree render without N+1 follow-ups.
      const { rows: sources } = await c.query(
        `SELECT
            COALESCE(NULLIF(TRIM(manufacturer), ''), '__unknown__') AS manufacturer,
            COALESCE(NULLIF(TRIM(model_number), ''), '__unknown__') AS model_number,
            source_url,
            source_type,
            metadata->>'title' AS title,
            COUNT(*)::text AS chunk_count
          FROM knowledge_entries
          WHERE tenant_id = $1
          GROUP BY manufacturer, model_number, source_url, source_type, metadata->>'title'
          ORDER BY chunk_count DESC NULLS LAST`,
        [ctx.tenantId],
      );
      const { rows: totals } = await c.query(
        `SELECT COUNT(*)::text AS total_chunks FROM knowledge_entries WHERE tenant_id = $1`,
        [ctx.tenantId],
      );
      return { sources: sources as SourceRow[], totalChunks: Number(totals[0]?.total_chunks ?? 0) };
    });

    // Shape: manufacturer → model → source
    const mfrMap = new Map<
      string,
      Map<
        string,
        Array<{
          source_url: string | null;
          source_type: string | null;
          title: string | null;
          chunk_count: number;
        }>
      >
    >();

    for (const row of data.sources) {
      const mfr = (row.manufacturer === "__unknown__" ? "Unknown manufacturer" : row.manufacturer)!;
      const model = (row.model_number === "__unknown__" ? "Unspecified model" : row.model_number)!;
      const count = Number(row.chunk_count);

      if (!mfrMap.has(mfr)) mfrMap.set(mfr, new Map());
      const modelMap = mfrMap.get(mfr)!;
      if (!modelMap.has(model)) modelMap.set(model, []);
      modelMap.get(model)!.push({
        source_url: row.source_url,
        source_type: row.source_type,
        title: row.title,
        chunk_count: count,
      });
    }

    const manufacturers = Array.from(mfrMap.entries())
      .map(([name, modelMap]) => {
        const models = Array.from(modelMap.entries())
          .map(([modelName, sources]) => {
            const chunkCount = sources.reduce((s, x) => s + x.chunk_count, 0);
            return {
              name: modelName,
              chunkCount,
              documentCount: sources.length,
              sources: sources
                .map((s) => ({
                  url: s.source_url,
                  title: s.title ?? deriveTitleFromUrl(s.source_url),
                  chunkCount: s.chunk_count,
                  sourceType: s.source_type ?? "unknown",
                }))
                .sort((a, b) => b.chunkCount - a.chunkCount),
            };
          })
          .sort((a, b) => b.chunkCount - a.chunkCount);

        const chunkCount = models.reduce((s, m) => s + m.chunkCount, 0);
        return { name, chunkCount, modelCount: models.length, models };
      })
      .sort((a, b) => b.chunkCount - a.chunkCount);

    return NextResponse.json({
      totalChunks: data.totalChunks,
      totalManufacturers: manufacturers.length,
      manufacturers,
    });
  } catch (err) {
    console.error("[api/library/tree]", err);
    return NextResponse.json({ error: "Tree query failed" }, { status: 500 });
  }
}

function deriveTitleFromUrl(url: string | null): string {
  if (!url) return "Untitled document";
  // Strip query string, take last path segment, strip extension.
  const base = url.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const last = base.split("/").pop() ?? base;
  return decodeURIComponent(last.replace(/\.(pdf|html?|md|txt)$/i, "")) || base;
}
