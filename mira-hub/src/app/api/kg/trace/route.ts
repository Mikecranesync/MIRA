// src/app/api/kg/trace/route.ts
/**
 * GET /api/kg/trace?sessionId=<uuid>[&turn=<n>]
 * Returns the reasoning subgraph the latest MIRA answer in a session traversed,
 * for the /graph page to highlight. Session-authed, tenant-isolated.
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface TraceRow {
  question_turn_index: number;
  root_id: string | null;
  question: string | null;
  answer_provider: string | null;
  entity_ids: string[];
  edges: unknown;
}

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const turn = url.searchParams.get("turn");

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query<TraceRow>(
        `SELECT question_turn_index, root_id, question, answer_provider, entity_ids, edges
           FROM kg_query_traces
          WHERE tenant_id = $1::uuid AND session_id = $2::uuid
            ${turn !== null ? "AND question_turn_index = $3" : ""}
          ORDER BY created_at DESC
          LIMIT 1`,
        turn !== null ? [ctx.tenantId, sessionId, Number(turn)] : [ctx.tenantId, sessionId],
      ),
    );
    const r = rows.rows[0];
    if (!r) return NextResponse.json({ error: "no trace for session" }, { status: 404 });
    return NextResponse.json({
      entityIds: r.entity_ids ?? [],
      edges: r.edges ?? [],
      rootId: r.root_id,
      question: r.question,
      provider: r.answer_provider,
      turnIndex: r.question_turn_index,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
