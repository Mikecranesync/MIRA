/**
 * PATCH  — enable/disable or change match state of a notebook source.
 * DELETE — detach the source from the notebook (does NOT delete the document).
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { detachSource, setSourceState, type MatchState } from "@/lib/equipment-notebooks";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string; docId: string }> };

export async function PATCH(req: NextRequest, { params }: P) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id, docId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const patch: { enabledByDefault?: boolean; matchState?: MatchState } = {};
  if (typeof body.enabledByDefault === "boolean") patch.enabledByDefault = body.enabledByDefault;
  // Trust is SERVER-owned (Codex P1, 2026-08-16): a client may CONFIRM a
  // source (a human decision) or REJECT it — never mint "verified" (earned by
  // server-side applicability proof) and never demote to "candidate" (a
  // system-suggestion state).
  if (body.matchState === "user_confirmed" || body.matchState === "rejected") {
    patch.matchState = body.matchState;
  } else if (body.matchState !== undefined) {
    return NextResponse.json({ error: "invalid_match_state" }, { status: 400 });
  }
  const ok = await setSourceState(ctx.tenantId, id, docId, patch);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: P) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id, docId } = await params;
  const ok = await detachSource(ctx.tenantId, id, docId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
