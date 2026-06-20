import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  IMPORT_APPROVAL_STATE,
  buildEntityInsert,
  decidePromotion,
  type EntityApprovalState,
} from "@/lib/contextualization/approval";

export const dynamic = "force-dynamic";

interface ExtractionRow {
  id: string;
  tag_name: string;
  roles: string[];
  uns_path_proposed: string | null;
  confidence: string | null;
  import_batch_id: string | null;
}

/**
 * POST /api/contextualization/[id]/promote
 *
 * Stages all accepted ctx_extractions for a project into kg_entities
 * (type=signal, approval_state=proposed) and creates a paired ai_suggestions
 * row (type=kg_entity, status=pending). This is import-time STAGING — it never
 * publishes. Publishing (proposed → verified) is a human action via the batch
 * review-queue (POST .../batches/[batchId]/review {decision:"approve"}).
 *
 * Approval-aware: before writing, it reads the existing kg_entities.approval_state
 * and REFUSES to overwrite approved data (verified/deprecated). Skipped rows are
 * reported with a reason instead of a silent ON CONFLICT DO NOTHING.
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

      // Fetch accepted extractions with proposed UNS paths + their import batch
      // (the batch comes from the source the extraction was parsed from).
      const rows = await c
        .query<ExtractionRow>(
          `SELECT e.id, e.tag_name, e.roles, e.uns_path_proposed,
                  e.confidence::text AS confidence, s.import_batch_id
             FROM ctx_extractions e
             LEFT JOIN ctx_sources s ON s.id = e.source_id
            WHERE e.project_id = $1
              AND e.tenant_id = $2::uuid
              AND e.status = 'accepted'
              AND e.uns_path_proposed IS NOT NULL
            ORDER BY e.tag_name`,
          [projectId, ctx.tenantId],
        )
        .then((r) => r.rows);

      if (rows.length === 0) {
        return { projectName: proj.rows[0].name, promoted: 0, skipped: 0, skips: [] };
      }

      const actorLabel = `import:ctx_project:${projectId}`;
      let promoted = 0;
      let skipped = 0;
      const skips: { tag_name: string; reason: string; protected: boolean }[] = [];

      for (const row of rows) {
        const unsPath = row.uns_path_proposed!;
        // ltree uses dots; UNS paths use slashes. Segments are already slug-safe.
        const ltreePath = unsPath.replace(/\//g, ".").replace(/[^a-z0-9_.]/gi, "_");

        const confidence = row.confidence ? parseFloat(row.confidence) : 0.5;
        const properties = {
          roles: row.roles ?? [],
          confidence,
          provenance: {
            ctx_extraction_id: row.id,
            ctx_project_id: projectId,
            ctx_import_batch_id: row.import_batch_id, // audit link, not a lookup key
          },
        };

        // Approval gate: read existing approval_state on the live natural key
        // (tenant_id, entity_type, name) and refuse to overwrite approved data.
        const existing = await c.query<{ approval_state: EntityApprovalState }>(
          `SELECT approval_state FROM kg_entities
            WHERE tenant_id = $1::uuid AND entity_type = 'signal' AND name = $2`,
          [ctx.tenantId, row.tag_name],
        );
        const decision = decidePromotion(existing.rows[0] ?? null);

        if (decision.action === "skip") {
          skipped++;
          skips.push({
            tag_name: row.tag_name,
            reason: decision.reason ?? "skipped",
            protected: decision.protectedRow ?? false,
          });
          continue; // do not touch the row, do not create a new suggestion
        }

        // Stage a fresh proposed entity (correct conflict target — migration 026).
        const ins = buildEntityInsert({
          tenantId: ctx.tenantId,
          name: row.tag_name,
          unsPath,
          ltreePath,
          propertiesJson: JSON.stringify(properties),
          approvalState: IMPORT_APPROVAL_STATE,
        });
        const ent = await c.query<{ id: string }>(ins.text, ins.values);
        if (ent.rows.length === 0) {
          // Lost a race to a concurrent insert — treat as already-staged.
          skipped++;
          skips.push({ tag_name: row.tag_name, reason: "already staged (race)", protected: false });
          continue;
        }
        promoted++;

        // Paired ai_suggestions row (one review surface stays in lockstep on
        // approve — see batches/[batchId]/review). Create only when absent.
        const existingSug = await c.query<{ id: string }>(
          `SELECT id FROM ai_suggestions
            WHERE tenant_id = $1::uuid
              AND suggestion_type = 'kg_entity'
              AND extracted_data->>'ctx_extraction_id' = $2
            LIMIT 1`,
          [ctx.tenantId, row.id],
        );

        if (existingSug.rows.length === 0) {
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

      return { projectName: proj.rows[0].name, promoted, skipped, total: rows.length, skips };
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
