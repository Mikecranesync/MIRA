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
import { insertFixRecord, listFixRecords, validateFixInput } from "@/capabilities/fix-records";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }

  const fixes = await listFixRecords(ctx.tenantId, id, notebook.asset?.entityId ?? null, 10);
  return NextResponse.json({ fixes });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
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

  const fix = await insertFixRecord(
    ctx.tenantId,
    { id: notebook.id, equipmentEntityId: notebook.asset?.entityId ?? null },
    validated.value,
    ctx.userId ?? null,
  );

  return NextResponse.json({ fix }, { status: 201 });
}
