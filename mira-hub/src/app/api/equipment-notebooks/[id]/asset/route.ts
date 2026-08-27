/**
 * PUT    /api/equipment-notebooks/[id]/asset — bind this notebook to a canonical asset
 * DELETE /api/equipment-notebooks/[id]/asset — clear the binding
 *
 * A DEDICATED SUB-ROUTE, NOT A FIELD ON PATCH. The notebook PATCH is the
 * free-text identity editor (manufacturer, model, display name — things a
 * technician types). A canonical asset binding is a different kind of claim:
 * it is resolved against the knowledge graph and it scopes what future answers
 * are about. Conflating the two would let a typed metadata edit carry an
 * identity assertion, which is the same trust inversion the sources route
 * already refuses when it rejects a client-supplied `matchState`.
 *
 * Trust boundary: the client may say WHICH asset and HOW it was selected. It may
 * never say that a human confirmed it — `asset_confirmed_by` / `_at` are derived
 * server-side and a body-supplied value is ignored, not honoured.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  ASSET_SELECTION_METHODS,
  bindNotebookAsset,
  unbindNotebookAsset,
  type AssetSelectionMethod,
} from "@/lib/equipment-notebooks";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct, technician-readable message per failure — see below. */
const BIND_ERRORS: Record<string, { status: number; message: string }> = {
  asset_not_found: { status: 404, message: "That asset isn't in this account." },
  asset_not_equipment: {
    status: 422,
    message: "That's a location, not a machine. Pick the equipment itself.",
  },
  asset_not_verified: {
    status: 422,
    message: "That asset hasn't been approved yet, so it can't be used as a notebook's machine.",
  },
  asset_already_bound: {
    status: 409,
    message: "Another notebook is already using that machine.",
  },
  notebook_not_found: { status: 404, message: "Notebook not found." },
};

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_notebook_id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const assetRef = typeof body.assetRef === "string" ? body.assetRef.trim() : "";
  if (!assetRef || assetRef.length > 128) {
    return NextResponse.json({ error: "asset_ref_required" }, { status: 400 });
  }

  const via = body.selectedVia;
  if (typeof via !== "string" || !(ASSET_SELECTION_METHODS as readonly string[]).includes(via)) {
    return NextResponse.json(
      {
        error: "invalid_selected_via",
        code: "invalid_selected_via",
        allowed: ASSET_SELECTION_METHODS,
      },
      { status: 400 },
    );
  }

  const res = await bindNotebookAsset(ctx.tenantId, id, assetRef, {
    selectedVia: via as AssetSelectionMethod,
    // Derived from the session, never from the body. A scan is a selection;
    // only a signed-in human on a non-scan path can confirm.
    confirmedBy: ctx.userId ?? null,
  });

  if (!res.ok) {
    const mapped = BIND_ERRORS[res.error] ?? { status: 400, message: "Could not bind that asset." };
    // The message is what a technician reads. `code` is what a client switches
    // on. Returning only the code renders the literal token `asset_not_found`
    // on the phone, because the mobile error layer surfaces `data.error`
    // verbatim (client.ts:198-208).
    return NextResponse.json(
      {
        error: mapped.message,
        code: res.error,
        ...(res.boundNotebookId ? { boundNotebookId: res.boundNotebookId } : {}),
      },
      { status: mapped.status },
    );
  }

  return NextResponse.json({ ok: true, notebook: res.notebook });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_notebook_id" }, { status: 400 });

  const res = await unbindNotebookAsset(ctx.tenantId, id);
  if (!res.ok) {
    return NextResponse.json({ error: "Notebook not found.", code: "notebook_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
