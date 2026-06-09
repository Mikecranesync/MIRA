import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/documents?asset_id=&manufacturer=&limit=
 *
 * Returns the document list (one row per source_url) for the tenant — manuals,
 * datasheets, prints already ingested into knowledge_entries. Filters:
 *   - asset_id: scope to docs matching the asset's manufacturer/model
 *   - manufacturer: scope to a specific manufacturer
 *   - limit (default 50, max 200)
 *
 * Matches the rollup pattern in /api/library/documents but joins through
 * cmms_equipment when asset_id is supplied. Unlike /api/knowledge (cross-
 * tenant universal corpus), this endpoint stays scoped to the caller's
 * tenant so the tablet sees only the demo customer's library.
 */
export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const assetId = url.searchParams.get("asset_id");
  const mfrFilter = (url.searchParams.get("manufacturer") ?? "").trim();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

  try {
    let mfr = mfrFilter;
    let model = "";
    if (assetId) {
      // cmms_equipment is pure-tenant data — scope by tenant so a stranger
      // can't resolve another tenant's asset by guessing its id (the IDOR half
      // of #1833). Explicit tenant_id, not RLS. (The deeper hybrid-corpus
      // read-filter on knowledge_entries lands separately in #1841.)
      const asset = await pool
        .query(
          `SELECT manufacturer, model_number FROM cmms_equipment
            WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [assetId, ctx.tenantId],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? null);
      if (asset) {
        mfr = mfr || ((asset.manufacturer as string | null) ?? "");
        model = (asset.model_number as string | null) ?? "";
      }
    }

    const where: string[] = [];
    const params: unknown[] = [];
    if (mfr) {
      params.push(mfr);
      where.push(`LOWER(manufacturer) = LOWER($${params.length})`);
    }
    if (model) {
      params.push(model);
      where.push(`model_number ILIKE '%' || $${params.length} || '%'`);
    }

    const sql = `
      SELECT source_url,
             MIN(equipment_type) AS equipment_type,
             MIN(manufacturer)   AS manufacturer,
             MIN(model_number)   AS model_number,
             COUNT(*)::int       AS chunk_count,
             MAX(created_at)     AS last_indexed,
             BOOL_OR(verified)   AS verified
        FROM knowledge_entries
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
       GROUP BY source_url
       ORDER BY MAX(created_at) DESC NULLS LAST
       LIMIT ${limit}`;

    const rows = await pool
      .query(sql, params)
      .then((r: { rows: Record<string, unknown>[] }) => r.rows);

    return NextResponse.json({
      documents: rows.map((r: Record<string, unknown>) => ({
        source_url: r.source_url,
        title: ((r.source_url as string) || "").split("/").pop()?.split("?")[0] ?? r.source_url,
        manufacturer: r.manufacturer,
        model_number: r.model_number,
        equipment_type: r.equipment_type,
        chunk_count: r.chunk_count,
        last_indexed: r.last_indexed,
        verified: r.verified ?? false,
      })),
    });
  } catch (err) {
    console.error("[api/documents GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
