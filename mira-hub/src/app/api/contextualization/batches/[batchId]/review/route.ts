import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { applyHubProposalTransition } from "@/lib/proposal-transition";
import {
  PUBLISHED_APPROVAL_STATE,
  buildEntityInsert,
  buildPublishEntityUpdate,
  decideBatchReview,
  decidePublish,
  parseReviewDecision,
  type EntityApprovalState,
} from "@/lib/contextualization/approval";

export const dynamic = "force-dynamic";

interface PublishRow {
  id: string;
  tag_name: string;
  roles: string[] | null;
  uns_path_proposed: string | null;
  confidence: string | null;
}

/**
 * POST /api/contextualization/batches/[batchId]/review
 * Body: { decision: "approve" | "reject" | "needs_review" }
 *
 * The Hub's batch-level approval gate (HubV3 Phase 4). Transitions
 * ctx_import_batches.review_status. On `approve` — and ONLY on a human approve —
 * it PUBLISHES the batch's accepted staged proposals into the live model:
 * kg_entities go proposed → verified (the engine's grounding surface; this is
 * the "publish to project model + UNS + i3X + MIRA KB" step), and the paired
 * ai_suggestions move pending → accepted so the two Hub projections stay in
 * lockstep (ADR-0017).
 *
 * No path here auto-promotes: import stages `proposed`; this human action is the
 * verification. Approved/deprecated rows are never overwritten — the publish
 * UPDATE carries a DB-level no-overwrite guard.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { batchId } = await params;
  if (!batchId || !/^[0-9a-f-]{36}$/i.test(batchId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const decision = parseReviewDecision(body.decision);
  if (!decision) {
    return NextResponse.json(
      { error: "decision must be one of: approve, reject, needs_review" },
      { status: 400 },
    );
  }

  const reviewerLabel = `human:${ctx.userId}`;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const batch = await c.query<{ review_status: string; project_id: string }>(
        `SELECT review_status, project_id
           FROM ctx_import_batches
          WHERE id = $1 AND tenant_id = $2::uuid`,
        [batchId, ctx.tenantId],
      );
      if (batch.rows.length === 0) return null;

      const outcome = decideBatchReview(
        batch.rows[0].review_status as "proposed" | "approved" | "rejected" | "needs_review",
        decision,
      );

      await c.query(
        `UPDATE ctx_import_batches
            SET review_status = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = $3::uuid`,
        [outcome.status, batchId, ctx.tenantId],
      );

      if (!outcome.publish) {
        return { reviewStatus: outcome.status, published: 0, skipped: 0, publishSkips: [] };
      }

      // Publish: accepted extractions of THIS batch (source of truth =
      // ctx_sources.import_batch_id), upserted by the live natural key.
      const rows = await c
        .query<PublishRow>(
          `SELECT e.id, e.tag_name, e.roles, e.uns_path_proposed, e.confidence::text AS confidence
             FROM ctx_extractions e
             JOIN ctx_sources s ON s.id = e.source_id
            WHERE s.import_batch_id = $1
              AND e.tenant_id = $2::uuid
              AND e.status = 'accepted'
              AND e.uns_path_proposed IS NOT NULL
            ORDER BY e.tag_name`,
          [batchId, ctx.tenantId],
        )
        .then((r) => r.rows);

      let published = 0;
      let skipped = 0;
      const publishSkips: { tag_name: string; reason: string }[] = [];

      for (const row of rows) {
        const unsPath = row.uns_path_proposed!;
        const ltreePath = unsPath.replace(/\//g, ".").replace(/[^a-z0-9_.]/gi, "_");
        const confidence = row.confidence ? parseFloat(row.confidence) : 0.5;
        const properties = {
          roles: row.roles ?? [],
          confidence,
          provenance: {
            ctx_extraction_id: row.id,
            ctx_import_batch_id: batchId,
            published_by: reviewerLabel,
          },
        };
        const propsJson = JSON.stringify(properties);

        // Read the live approval_state and decide insert / update / skip.
        const existing = await c.query<{ approval_state: EntityApprovalState }>(
          `SELECT approval_state FROM kg_entities
            WHERE tenant_id = $1::uuid AND entity_type = 'signal' AND name = $2`,
          [ctx.tenantId, row.tag_name],
        );
        const pd = decidePublish(existing.rows[0] ?? null);

        if (pd.action === "skip") {
          skipped++;
          publishSkips.push({ tag_name: row.tag_name, reason: pd.reason ?? "skipped" });
          continue;
        }

        let wrote = false;
        if (pd.action === "insert") {
          // Approval IS the verification — insert directly as verified.
          const ins = buildEntityInsert({
            tenantId: ctx.tenantId,
            name: row.tag_name,
            unsPath,
            ltreePath,
            propertiesJson: propsJson,
            approvalState: PUBLISHED_APPROVAL_STATE,
          });
          const r = await c.query<{ id: string }>(ins.text, ins.values);
          wrote = r.rows.length > 0;
        }
        if (!wrote) {
          // update path (or lost-race fallback) — guarded so verified/deprecated
          // rows are never overwritten.
          const upd = buildPublishEntityUpdate({
            tenantId: ctx.tenantId,
            name: row.tag_name,
            propertiesJson: propsJson,
          });
          const r = await c.query<{ id: string }>(upd.text, upd.values);
          wrote = r.rows.length > 0;
        }

        if (wrote) {
          published++;
          // Keep the paired ai_suggestions row in lockstep (ADR-0017): the
          // generic /proposals queue must not show this as pending forever once
          // the Review Queue has approved it.
          const sug = await c.query<{ id: string }>(
            `SELECT id FROM ai_suggestions
              WHERE tenant_id = $1::uuid
                AND suggestion_type = 'kg_entity'
                AND extracted_data->>'ctx_extraction_id' = $2
                AND status = 'pending'
              LIMIT 1`,
            [ctx.tenantId, row.id],
          );
          if (sug.rows.length > 0) {
            await applyHubProposalTransition(c, {
              trigger: "accept",
              aiSuggestionId: sug.rows[0].id,
              reviewerLabel,
            });
          }
        } else {
          skipped++;
          publishSkips.push({ tag_name: row.tag_name, reason: "protected — not overwritten" });
        }
      }

      return { reviewStatus: outcome.status, published, skipped, total: rows.length, publishSkips };
    });

    if (!result) {
      return NextResponse.json({ error: "batch not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/contextualization/batches/[batchId]/review POST]", err);
    return NextResponse.json({ error: "Review failed" }, { status: 500 });
  }
}
