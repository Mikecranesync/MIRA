/**
 * GET  /api/equipment-notebooks/[id]/fixes — list recorded fixes for this notebook.
 * POST /api/equipment-notebooks/[id]/fixes — record a technician-confirmed fix.
 *
 * "Plant memory" (see mira-hub/src/capabilities/fix-records.ts +
 * db/migrations/095_asset_fix_records.sql): a technician records what fixed
 * this machine; the next technician on the same machine sees it as a
 * grounding source. Append-only — there is no PATCH/DELETE here by design.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { insertFixRecord, isUuid, listFixRecords, validateFixInput } from "@/capabilities/fix-records";

export const dynamic = "force-dynamic";

const NOT_FOUND = { error: "notebook_not_found" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  // A malformed id is indistinguishable from an unknown one — never a DB error
  // (Codex #4057 post-split F4).
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }

  // Same rule as chat (Codex #4057 F3): a QR/NFC selection is not a
  // confirmation — the sticker may be on the wrong machine — so a selected but
  // unconfirmed asset exposes no machine-specific repair history.
  if (notebook.asset && !notebook.asset.confirmedAt) {
    return NextResponse.json({ fixes: [], assetConfirmed: false });
  }
  // Cursor pagination (F3): `before` = the last id of the previous page.
  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  if (before !== null && !isUuid(before)) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? undefined : Number(limitParam);
  if (limit !== undefined && !Number.isFinite(limit)) {
    return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
  }
  const { fixes, nextCursor } = await listFixRecords(ctx.tenantId, id, notebook.asset?.entityId ?? null, {
    limit,
    before,
  });
  return NextResponse.json({ fixes, nextCursor, assetConfirmed: notebook.asset ? true : null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  // A repair is filed against the machine the notebook is bound to. A QR/NFC
  // selection is not a confirmation — the sticker may be on the wrong machine
  // — so a machine-scoped fix is refused until a technician confirms it
  // (Codex #4057 post-cap F4). Unbound notebooks record against themselves.
  if (notebook.asset && !notebook.asset.confirmedAt) {
    return NextResponse.json(
      { error: "asset_not_confirmed", message: "Confirm which machine this is before recording a fix." },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const validated = validateFixInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  // Atomic against the CURRENT binding (F1) and idempotent on clientRequestId (F2).
  const result = await insertFixRecord(
    ctx.tenantId,
    notebook.id,
    notebook.asset?.entityId ?? null,
    validated.value,
    ctx.userId ?? null,
  );
  if (result.status === "binding_changed") {
    return NextResponse.json(
      {
        error: "asset_binding_changed",
        message: "This notebook's machine changed while saving. Check the machine and record the fix again.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ fix: result.fix }, { status: result.status === "created" ? 201 : 200 });
}
