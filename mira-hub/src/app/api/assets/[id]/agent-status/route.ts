import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { meetsApprovalCriteria } from "@/lib/asset-agent-transition";

export const dynamic = "force-dynamic";

// GET /api/assets/[id]/agent-status
// The asset agent's lifecycle state + the derived signals the Validate tab and
// the §5 approve gate read. `id` is a cmms_equipment.id.
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
    const data = await withTenantContext(ctx.tenantId, async (c) => {
      const asset = await c
        .query(
          `SELECT manufacturer, model_number FROM cmms_equipment
           WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [id, ctx.tenantId],
        )
        .then((r) => r.rows[0] ?? null);
      if (!asset) return { asset: null as null };

      const status = await c
        .query(
          `SELECT state, approved_by, approved_at, deployed_at, deployed_by,
                  deploy_surface, citation_coverage, min_groundedness,
                  last_validated_at, notes
           FROM asset_agent_status WHERE equipment_id = $1 LIMIT 1`,
          [id],
        )
        .then((r) => r.rows[0] ?? null);

      const mfr = (asset.manufacturer as string | null) ?? "";
      const model = (asset.model_number as string | null) ?? "";
      const docCount = mfr
        ? await c
            .query(
              `SELECT COUNT(DISTINCT source_url)::int AS n FROM knowledge_entries
               WHERE tenant_id = $1 AND LOWER(manufacturer) = LOWER($2)
                 AND ($3 = '' OR model_number ILIKE '%' || $3 || '%')`,
              [ctx.tenantId, mfr, model],
            )
            .then((r) => Number(r.rows[0]?.n ?? 0))
        : 0;

      const qa = await c
        .query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE reviewer_verdict = 'good')::int AS good,
             COUNT(*) FILTER (
               WHERE reviewer_verdict = 'good' AND jsonb_array_length(citations) > 0
             )::int AS good_cited,
             MIN(groundedness) FILTER (WHERE reviewer_verdict = 'good') AS min_ground
           FROM asset_validation_qa WHERE equipment_id = $1`,
          [id],
        )
        .then((r) => r.rows[0]);

      return { asset, status, docCount, qa };
    });

    if (!data.asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const state = (data.status?.state as string) ?? "draft";
    const citationCoverage = Number(data.qa?.good_cited ?? 0);
    const minGroundedness =
      data.qa?.min_ground == null ? null : Number(data.qa.min_ground);
    // openSafetyCritical: deferred to a later phase (the gate fn supports it).
    const approval = meetsApprovalCriteria({
      citationCoverage,
      minGroundedness,
      openSafetyCritical: 0,
    });

    return NextResponse.json({
      equipmentId: id,
      state,
      exists: !!data.status,
      approvedBy: data.status?.approved_by ?? null,
      approvedAt: data.status?.approved_at ?? null,
      deployedAt: data.status?.deployed_at ?? null,
      deployedBy: data.status?.deployed_by ?? null,
      deploySurface: data.status?.deploy_surface ?? null,
      docCount: data.docCount,
      validationQuestionCount: Number(data.qa?.total ?? 0),
      approvedAnswerCount: Number(data.qa?.good ?? 0),
      citationCoverage,
      minGroundedness,
      readyToApprove: state === "validating" && approval.ok,
      approvalReasons: approval.reasons,
      lastValidatedAt: data.status?.last_validated_at ?? null,
      notes: data.status?.notes ?? null,
    });
  } catch (err) {
    console.error("[api/assets/[id]/agent-status GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
