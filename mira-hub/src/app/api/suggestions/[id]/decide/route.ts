import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { decideSuggestion } from "@/lib/suggestion-accept";

export const dynamic = "force-dynamic";

/**
 * POST /api/suggestions/[id]/decide — verify or reject an `ai_suggestions` proposal (the non-edge
 * accept path; `kg_edge` proposals use /api/proposals/[id]/decide instead).
 *
 * On verify of a `kg_entity` proposal (e.g. a PLC-parser asset), a verified `kg_entities` row is
 * created and immediately served by the i3X API. Body: { "decision": "verify" | "reject", "reason"? }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  // Deciding an ai_suggestions proposal (verify→creates a verified kg_entities row
  // served by i3X) is the same admin governance action as /api/proposals/[id]/decide
  // (CLAUDE.md / ADR-0017: proposed→verified is an admin action). #2360/#578.
  const denied = requireCapability(ctx, "proposals.decide");
  if (denied) return denied;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { decision?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const decision = (body.decision ?? "").toLowerCase();
  if (decision !== "verify" && decision !== "reject") {
    return NextResponse.json({ error: "decision must be 'verify' or 'reject'" }, { status: 400 });
  }
  const reason = (body.reason ?? "").slice(0, 1000);

  try {
    const result = await decideSuggestion(ctx.tenantId, ctx.userId, id, decision, reason);
    if (result.kind === "not_found") {
      return NextResponse.json({ error: "suggestion not found" }, { status: 404 });
    }
    if (result.kind === "wrong_state") {
      return NextResponse.json(
        { error: `cannot decide a suggestion in '${result.status}' state` },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      id,
      decision: result.decision,
      status: result.status,
      entityId: result.entityId,
    });
  } catch (err) {
    console.error("[api/suggestions/:id/decide POST]", err);
    return NextResponse.json({ error: "Decide failed" }, { status: 500 });
  }
}
