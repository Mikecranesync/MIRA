import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";
import {
  ASSET_AGENT_STATES,
  type AssetAgentState,
  transitionAssetAgent,
  meetsApprovalCriteria,
  IllegalTransitionError,
  MissingActorError,
} from "@/lib/asset-agent-transition";

export const dynamic = "force-dynamic";

// POST /api/assets/[id]/agent-status/transition  { to, deploySurface? }
// Advances the asset agent's lifecycle. All state changes go through the
// transition helper (no raw UPDATE). Promotion to `approved` enforces the §5
// gate server-side and records the human actor.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  // Driving the asset-agent approval/deploy gate is an admin action
  // (train-before-deploy spec; approval records an admin actor). #2360.
  const denied = requireCapability(ctx, "asset_agent.transition");
  if (denied) return denied;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    to?: string;
    deploySurface?: string;
  };
  const to = body.to as AssetAgentState | undefined;
  if (!to || !(ASSET_AGENT_STATES as readonly string[]).includes(to)) {
    return NextResponse.json(
      { error: `'to' must be one of ${ASSET_AGENT_STATES.join(", ")}` },
      { status: 400 },
    );
  }

  const actor = `human:${ctx.userId}`;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const asset = await c
        .query(
          `SELECT 1 FROM cmms_equipment WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [id, ctx.tenantId],
        )
        .then((r) => r.rows[0] ?? null);
      if (!asset) return { kind: "not_found" as const };

      // Lazily materialise a draft row (with the asset's UNS path) so the first
      // transition has something to advance.
      await c.query(
        `INSERT INTO asset_agent_status (tenant_id, equipment_id, uns_path, state)
         SELECT $1, $2, e.uns_path, 'draft'
         FROM cmms_equipment e WHERE e.id = $2 AND e.tenant_id = $1
         ON CONFLICT (tenant_id, equipment_id) DO NOTHING`,
        [ctx.tenantId, id],
      );

      // §5 gate: approval is only allowed when the validation evidence holds.
      if (to === "approved") {
        const qa = await c
          .query(
            `SELECT
               COUNT(*) FILTER (
                 WHERE reviewer_verdict = 'good' AND jsonb_array_length(citations) > 0
               )::int AS good_cited,
               MIN(groundedness) FILTER (WHERE reviewer_verdict = 'good') AS min_ground
             FROM asset_validation_qa WHERE equipment_id = $1`,
            [id],
          )
          .then((r) => r.rows[0]);
        const citationCoverage = Number(qa?.good_cited ?? 0);
        const minGroundedness = qa?.min_ground == null ? null : Number(qa.min_ground);
        const gate = meetsApprovalCriteria({
          citationCoverage,
          minGroundedness,
          openSafetyCritical: 0,
        });
        if (!gate.ok) {
          return { kind: "gate_failed" as const, reasons: gate.reasons };
        }
        // Snapshot the signals onto the row so the future deployment gate has them.
        await c.query(
          `UPDATE asset_agent_status
           SET citation_coverage = $2, min_groundedness = $3, last_validated_at = now()
           WHERE equipment_id = $1`,
          [id, citationCoverage, minGroundedness],
        );
      }

      const updated = await transitionAssetAgent(c, {
        equipmentId: id,
        to,
        approvedBy: actor,
        deploySurface: body.deploySurface,
      });
      return { kind: "ok" as const, updated };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    if (result.kind === "gate_failed") {
      return NextResponse.json(
        { error: "Approval criteria not met", reasons: result.reasons },
        { status: 422 },
      );
    }
    return NextResponse.json({ status: result.updated });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof MissingActorError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[api/assets/[id]/agent-status/transition POST]", err);
    return NextResponse.json({ error: "Transition failed" }, { status: 500 });
  }
}
