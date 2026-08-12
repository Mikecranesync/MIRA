/**
 * GET   /api/equipment-notebooks/[id] — notebook + sources + conversation.
 * PATCH /api/equipment-notebooks/[id] — edit identity/metadata.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, listTurns, updateNotebook } from "@/lib/equipment-notebooks";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [sources, turns] = await Promise.all([
    listSources(ctx.tenantId, id),
    listTurns(ctx.tenantId, id),
  ]);
  return NextResponse.json({ notebook, sources, turns });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const ok = await updateNotebook(ctx.tenantId, id, body);
  if (!ok) return NextResponse.json({ error: "not_found_or_empty_patch" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
