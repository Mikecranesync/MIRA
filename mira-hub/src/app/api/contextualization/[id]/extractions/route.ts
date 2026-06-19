import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface ExtractionRow {
  id: string;
  source_id: string;
  file_name: string | null;
  tag_name: string;
  roles: string[];
  uns_path_proposed: string | null;
  i3x_element_id: string | null;
  confidence: string | null;
  status: string;
  evidence_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** GET /api/contextualization/[id]/extractions — list all extractions for a project. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id: projectId } = await params;
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query<ExtractionRow>(
          `SELECT
              e.id,
              e.source_id,
              s.file_name,
              e.tag_name,
              e.roles,
              e.uns_path_proposed,
              e.i3x_element_id,
              e.confidence::text,
              e.status,
              e.evidence_json,
              e.created_at,
              e.updated_at
           FROM ctx_extractions e
           LEFT JOIN ctx_sources s ON s.id = e.source_id
           WHERE e.project_id = $1
             AND e.tenant_id = $2::uuid
           ORDER BY e.tag_name`,
          [projectId, ctx.tenantId],
        )
        .then((r) => r.rows),
    );

    return NextResponse.json({ extractions: rows });
  } catch (err) {
    console.error("[api/contextualization/[id]/extractions GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
