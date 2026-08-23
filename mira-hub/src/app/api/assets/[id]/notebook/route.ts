/**
 * POST /api/assets/[id]/notebook — open THE notebook for this asset, creating
 * and binding it the first time.
 *
 * This is the call that makes "scan the sticker, ask MIRA" one action. Before
 * it, no asset → notebook lookup existed anywhere in the Hub: every
 * `equipment_notebooks` predicate keyed on `id`, `tenant_id` or `node_id`, so a
 * scan could reach an asset card and stop there.
 *
 * IDEMPOTENT BY DESIGN. A technician who taps twice because the first tap felt
 * slow must not end up with two notebooks on one conveyor — they would have
 * disjoint document sets, split turn history, and resolve nondeterministically
 * by `last_opened_at`. The second call returns the same notebook with
 * `created: false`, and a genuine race is resolved by the partial-unique index
 * from migration 081 rather than by hoping.
 *
 * `node_id` stays the notebook's own private node with a NULL `uns_path`. It is
 * NOT repointed at the asset's bridge node: `node_id` scopes DOCUMENTS,
 * `equipment_entity_id` names the MACHINE. Repointing would push this
 * notebook's chunks into the asset chat's retrieval scope.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  ASSET_SELECTION_METHODS,
  createAndBindNotebookTx,
  type AssetSelectionMethod,
} from "@/lib/equipment-notebooks";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, { status: number; message: string }> = {
  asset_not_found: { status: 404, message: "That asset isn't in this account." },
  asset_not_equipment: {
    status: 422,
    message: "That's a location, not a machine. Pick the equipment itself.",
  },
  asset_not_verified: {
    status: 422,
    message: "That asset hasn't been approved yet, so a notebook can't be opened for it.",
  },
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || id.length > 128) {
    return NextResponse.json({ error: "invalid_asset_id" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // A bare POST is the common case (a scan carries no body).
  }

  const via = typeof body.selectedVia === "string" ? body.selectedVia : "asset_picker";
  if (!(ASSET_SELECTION_METHODS as readonly string[]).includes(via)) {
    return NextResponse.json(
      { error: "invalid_selected_via", code: "invalid_selected_via", allowed: ASSET_SELECTION_METHODS },
      { status: 400 },
    );
  }

  try {
    const res = await createAndBindNotebookTx(ctx.tenantId, id, {
      selectedVia: via as AssetSelectionMethod,
      createdBy: ctx.userId ?? null,
      displayName: typeof body.displayName === "string" ? body.displayName : null,
    });

    if (!res.ok) {
      const mapped = ERRORS[res.error] ?? { status: 400, message: "Could not open a notebook for that asset." };
      // Readable sentence in `error`, discriminator in `code` — mira-mobile
      // renders `data.error` verbatim.
      return NextResponse.json({ error: mapped.message, code: res.error }, { status: mapped.status });
    }

    return NextResponse.json(
      { ok: true, created: res.created, notebook: res.notebook },
      { status: res.created ? 201 : 200 },
    );
  } catch (err) {
    if ((err as { code?: string }).code === "NOTEBOOK_RACE") {
      // The losing side of a double-tap. Nothing was written; the client
      // re-issues and takes the already-bound path.
      return NextResponse.json(
        {
          error: "Another request just opened this notebook. Try again.",
          code: "notebook_race",
        },
        { status: 409 },
      );
    }
    console.error("[api/assets/:id/notebook] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not open a notebook for that asset." }, { status: 500 });
  }
}
