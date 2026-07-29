import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface BatchRow {
  id: string;
  project_id: string;
  project_name: string;
  ingest_route: string;
  bundle_sha256: string | null;
  review_status: string;
  source_count: string;
  extraction_count: string;
  accepted_count: string;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/contextualization/batches
 *
 * The Review Queue feed. Lists every staged import batch for the tenant with
 * its review_status (proposed | approved | rejected | needs_review) and live
 * source / extraction / accepted counts. Newest first.
 */
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query<BatchRow>(
          `SELECT
              b.id,
              b.project_id,
              p.name AS project_name,
              b.ingest_route,
              b.bundle_sha256,
              b.review_status,
              COUNT(DISTINCT s.id)::text AS source_count,
              COUNT(DISTINCT e.id)::text AS extraction_count,
              COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'accepted')::text AS accepted_count,
              b.created_at,
              b.updated_at
           FROM ctx_import_batches b
           JOIN contextualization_projects p ON p.id = b.project_id
           LEFT JOIN ctx_sources s ON s.import_batch_id = b.id
           LEFT JOIN ctx_extractions e ON e.source_id = s.id
           WHERE b.tenant_id = $1::uuid
           GROUP BY b.id, p.name
           ORDER BY b.created_at DESC`,
          [ctx.tenantId],
        )
        .then((r) => r.rows),
    );

    return NextResponse.json({
      batches: rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        projectName: r.project_name,
        ingestRoute: r.ingest_route,
        bundleSha256: r.bundle_sha256,
        reviewStatus: r.review_status,
        sourceCount: Number(r.source_count),
        extractionCount: Number(r.extraction_count),
        acceptedCount: Number(r.accepted_count),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error("[api/contextualization/batches GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
