import { NextResponse, type NextRequest } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  factoryModelToRelationshipSpecs,
  writeRelationshipProposals,
} from "@/lib/factory-model-relationships";

export const dynamic = "force-dynamic";

/**
 * POST /api/connectors/factory-model/relationships — accept a synthetic Phase 1 FactoryModel and
 * propose its relationships into the EXISTING relationship-proposal workflow:
 *   feeds (asset→asset) -> UPSTREAM_OF · asset→signal containment -> HAS_SIGNAL · contains -> HAS_COMPONENT.
 *
 * POST-APPROVAL: only relationships whose BOTH endpoints are already-approved entities
 * (kg_entities / tag_entities) become proposals; the rest are reported `unresolved` (re-run after
 * approving them). Proposals surface in `/knowledge/suggestions`; approving mirrors into
 * `kg_relationships` via the UNCHANGED decide path. Mirrors `/api/connectors/factory-model/import`.
 */
export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let model: unknown;
  try {
    model = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const specs = factoryModelToRelationshipSpecs(model);
  if (specs.length === 0) {
    return NextResponse.json(
      { error: "factory model contained no relationships to propose" },
      { status: 400 },
    );
  }

  const result = await withTenantContext(ctx.tenantId, (c) =>
    writeRelationshipProposals(c, ctx.tenantId, specs),
  );

  return NextResponse.json(
    {
      proposed: result.created.length,
      skipped: result.skipped.length,
      unresolved: result.unresolved.length,
      created: result.created,
      unresolved_detail: result.unresolved,
    },
    { status: 201 },
  );
}
