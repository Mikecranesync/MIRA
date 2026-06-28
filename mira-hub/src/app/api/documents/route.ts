import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/documents?asset_id=&manufacturer=&limit=
 *
 * Returns the document list (one row per source_url) visible to the caller —
 * manuals, datasheets, prints ingested into knowledge_entries. Filters:
 *   - asset_id: scope to docs matching the asset's manufacturer/model
 *   - manufacturer: scope to a specific manufacturer
 *   - limit (default 50, max 200)
 *
 * Tenant scoping — see `.claude/rules/knowledge-entries-tenant-scoping.md` (the
 * law) and #1833. `knowledge_entries` is a HYBRID corpus, so neither pure
 * tenant-scoping nor pure-universal is correct:
 *   - shared OEM corpus (`is_private = false`, legacy non-UUID tenant) → visible
 *     to everyone. Pure `tenant_id = $caller` returns ~0 of it (the #1761 bug).
 *   - per-tenant uploads (`is_private = true`, written by /api/documents/upload
 *     and the folder=brain ingest path) → visible only to the owning tenant.
 *     Leaving them universal leaks tenant A's manual to tenant B (#1833).
 * Canonical read filter: `(is_private = false OR tenant_id = $caller)`. It runs
 * on the raw owner pool (BYPASSRLS) on purpose — withTenantContext's RLS policy
 * is pure `tenant_id = app.tenant_id` and would hide the shared OEM corpus, so it
 * cannot express the hybrid. The cmms_equipment lookup IS pure-tenant data, so it
 * carries an explicit `AND tenant_id = $2` instead (matches /api/assets/[id]).
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
      // of #1833). Explicit tenant_id, not RLS. The hybrid-corpus read-filter
      // on knowledge_entries (below) is the other half of #1833.
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

    // Hybrid corpus filter is ALWAYS first: shared OEM rows (is_private=false)
    // plus the caller's own private uploads, never another tenant's uploads.
    const params: unknown[] = [ctx.tenantId];
    const where: string[] = ["(is_private = false OR tenant_id = $1)"];
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
       WHERE ${where.join(" AND ")}
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
