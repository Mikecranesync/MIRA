import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface ExtractionRow {
  id: string;
  tag_name: string;
  roles: string[];
  uns_path_proposed: string | null;
  confidence: string | null;
}

/**
 * POST /api/contextualization/[id]/promote
 *
 * Promotes all accepted ctx_extractions for a project into kg_entities
 * (type=signal, approval_state=proposed) and creates a paired ai_suggestions
 * row (type=kg_entity, status=pending) so the Hub proposals queue picks them up.
 *
 * Idempotent: ON CONFLICT DO NOTHING on both tables.
 */
export async function POST(
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
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      // Verify project belongs to tenant
      const proj = await c.query<{ name: string }>(
        `SELECT name FROM contextualization_projects
          WHERE id = $1 AND tenant_id = $2::uuid`,
        [projectId, ctx.tenantId],
      );
      if (proj.rows.length === 0) return null;

      // Fetch accepted extractions with proposed UNS paths
      const rows = await c
        .query<ExtractionRow>(
          `SELECT id, tag_name, roles, uns_path_proposed, confidence::text
             FROM ctx_extractions
            WHERE project_id = $1
              AND tenant_id = $2::uuid
              AND status = 'accepted'
              AND uns_path_proposed IS NOT NULL
            ORDER BY tag_name`,
          [projectId, ctx.tenantId],
        )
        .then((r) => r.rows);

      if (rows.length === 0) {
        return { projectName: proj.rows[0].name, promoted: 0, skipped: 0 };
      }

      const actorLabel = `import:ctx_project:${projectId}`;
      let promoted = 0;
      let skipped = 0;

      for (const row of rows) {
        const unsPath = row.uns_path_proposed!;
        // ltree uses dots; UNS paths use slashes. Segments are already slug-safe.
        const ltreePath = unsPath.replace(/\//g, ".").replace(/[^a-z0-9_.]/gi, "_");

        const confidence = row.confidence ? parseFloat(row.confidence) : 0.5;
        const properties = {
          roles: row.roles ?? [],
          confidence,
          provenance: { ctx_extraction_id: row.id, ctx_project_id: projectId },
        };

        // Upsert kg_entities: entity_type=signal, entity_id=uns_path (unique within tenant)
        const ent = await c.query<{ id: string; was_new: boolean }>(
          `INSERT INTO kg_entities
               (tenant_id, entity_type, entity_id, name, properties,
                approval_state, uns_path)
             VALUES ($1::uuid, 'signal', $2, $3, $4::jsonb,
                     'proposed', $5::ltree)
             ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING
             RETURNING id, TRUE AS was_new`,
          [ctx.tenantId, unsPath, row.tag_name, JSON.stringify(properties), ltreePath],
        );

        if (ent.rows.length === 0) {
          // Row already existed — still wire up ai_suggestions below (idempotent)
          skipped++;
        } else {
          promoted++;
        }

        // Create an ai_suggestions row only when one doesn't exist for this extraction yet.
        // ai_suggestions has no unique constraint beyond PK, so we check first.
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM ai_suggestions
            WHERE tenant_id = $1::uuid
              AND suggestion_type = 'kg_entity'
              AND extracted_data->>'ctx_extraction_id' = $2
            LIMIT 1`,
          [ctx.tenantId, row.id],
        );

        if (existing.rows.length === 0) {
          await c.query(
            `INSERT INTO ai_suggestions
               (tenant_id, suggestion_type, extracted_data,
                confidence, status, risk_level, proposed_by,
                title, body)
             VALUES ($1::uuid, 'kg_entity',
                     $2::jsonb,
                     $3, 'pending', 'low', $4,
                     $5, $6)`,
            [
              ctx.tenantId,
              JSON.stringify({
                entity_type: "signal",
                uns_path: unsPath,
                properties,
                ctx_extraction_id: row.id,
                ctx_project_id: projectId,
              }),
              Math.min(1.0, Math.max(0.0, confidence)),
              actorLabel,
              `Signal: ${row.tag_name}`,
              `PLC tag "${row.tag_name}" proposed at ${unsPath} (from contextualization project ${projectId})`,
            ],
          );
        }
      }

      return { projectName: proj.rows[0].name, promoted, skipped, total: rows.length };
    });

    if (!result) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/contextualization/[id]/promote POST]", err);
    return NextResponse.json({ error: "Promotion failed" }, { status: 500 });
  }
}
