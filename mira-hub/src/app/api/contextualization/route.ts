import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/** Parse and validate a POST body. Returns the field values or an error string. */
export function parseCreateBody(body: Record<string, unknown>): { name: string; description: string | null } | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "name is required" };
  const description =
    typeof body.description === "string" ? body.description.trim() || null : null;
  return { name, description };
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  source_count: string;
  extraction_count: string;
  accepted_count: string;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query<ProjectRow>(
          `SELECT
              p.id,
              p.name,
              p.description,
              p.status,
              COUNT(DISTINCT s.id)::text AS source_count,
              COUNT(DISTINCT e.id)::text AS extraction_count,
              COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'accepted')::text AS accepted_count,
              p.created_at,
              p.updated_at
           FROM contextualization_projects p
           LEFT JOIN ctx_sources s ON s.project_id = p.id
           LEFT JOIN ctx_extractions e ON e.project_id = p.id
           WHERE p.tenant_id = $1::uuid
           GROUP BY p.id
           ORDER BY p.updated_at DESC`,
          [ctx.tenantId],
        )
        .then((r) => r.rows),
    );

    return NextResponse.json({
      projects: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        sourceCount: Number(r.source_count),
        extractionCount: Number(r.extraction_count),
        acceptedCount: Number(r.accepted_count),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error("[api/contextualization GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseCreateBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { name, description } = parsed;

  try {
    const row = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query<{ id: string; name: string; description: string | null; status: string; created_at: string }>(
          `INSERT INTO contextualization_projects (tenant_id, name, description)
           VALUES ($1::uuid, $2, $3)
           RETURNING id, name, description, status, created_at`,
          [ctx.tenantId, name, description],
        )
        .then((r) => r.rows[0]),
    );

    return NextResponse.json({ project: row }, { status: 201 });
  } catch (err) {
    console.error("[api/contextualization POST]", err);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
}
