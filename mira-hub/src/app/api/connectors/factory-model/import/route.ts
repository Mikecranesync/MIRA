import { NextResponse, type NextRequest } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  factoryModelToSuggestions,
  insertFactoryModelSuggestions,
} from "@/lib/factory-model-proposals";

export const dynamic = "force-dynamic";

/**
 * POST /api/connectors/factory-model/import — accept a synthetic Phase 1 FactoryModel
 * (`factory_context` output: `{ source, nodes: [{ level, uns_path, name, archetype, suggestion }], ... }`)
 * and write its assets + signals into `ai_suggestions` (status `pending` / `needs_review`) for the
 * caller's tenant, surfacing in the existing `/knowledge/suggestions` review queue. Nothing is
 * auto-verified; the existing accept path (suggestion-accept.ts) is unchanged.
 *
 * Mirrors `/api/connectors/plc/import`. PR-1 scope: assets + signals only.
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

  const rows = factoryModelToSuggestions(model);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "factory model contained no assets or signals to propose" },
      { status: 400 },
    );
  }

  const ids = await insertFactoryModelSuggestions(ctx.tenantId, rows);
  return NextResponse.json(
    {
      inserted: ids.length,
      assets: rows.filter((r) => r.suggestionType === "kg_entity").length,
      signals: rows.filter((r) => r.suggestionType === "tag_mapping").length,
      needs_review: rows.filter((r) => r.status === "needs_review").length,
      suggestion_ids: ids,
    },
    { status: 201 },
  );
}
