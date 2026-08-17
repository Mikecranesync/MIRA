/**
 * POST /api/equipment-notebooks/[id]/sources — attach an existing tenant
 * document (hub_uploads id) to the notebook. The doc is validated as belonging
 * to THIS tenant before attaching (IDOR guard); cross-tenant ids 404 without
 * leaking existence.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { attachSource } from "@/lib/equipment-notebooks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const docId = typeof body.docId === "string" ? body.docId : "";
  if (!/^[0-9a-f-]{36}$/i.test(docId)) {
    return NextResponse.json({ error: "invalid_doc_id" }, { status: 400 });
  }
  // Trust is SERVER-owned (Codex P1, 2026-08-16): attaching an existing doc is
  // a user action → user_confirmed. A client may NOT mint "verified" (earned
  // by server-side applicability proof) via this door. "candidate" is a
  // system-suggestion state and is likewise not client-settable here.
  if (body.matchState !== undefined && body.matchState !== "user_confirmed") {
    return NextResponse.json({ error: "invalid_match_state" }, { status: 400 });
  }
  const matchState = "user_confirmed" as const;
  // Mirror the equipment_notebook_sources.source_role CHECK — an unknown role
  // must 400 here, not surface as a DB constraint 500.
  const SOURCE_ROLES = ["manual", "quick_start", "drawing", "work_order", "note", "photo", "other"];
  const sourceRole = typeof body.sourceRole === "string" ? body.sourceRole : null;
  if (sourceRole !== null && !SOURCE_ROLES.includes(sourceRole)) {
    return NextResponse.json({ error: "invalid_source_role" }, { status: 400 });
  }
  const res = await attachSource(ctx.tenantId, id, docId, {
    matchState,
    sourceRole,
    addedBy: ctx.userId ?? null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
