// GET /api/decision-trace/[id]
//
// Returns one decision_traces row for the "Why MIRA Thinks This" panel.
// Tenant-scoped via withTenantContext (decision_traces is a pure-tenant table;
// it does NOT join knowledge_entries, so the hybrid raw-pool rule does not apply
// here — see .claude/rules/knowledge-entries-tenant-scoping.md). A trace owned by
// another tenant returns 404 by construction (the tenant predicate excludes it).

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid trace id" }, { status: 400 });
  }

  try {
    const row = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT trace_id, platform, uns_path, user_question,
                  tag_evidence, manual_evidence, kg_evidence,
                  recommendation, citations_present, confidence, outcome,
                  model_used, latency_ms, ts
             FROM decision_traces
            WHERE trace_id = $1 AND tenant_id = $2
            LIMIT 1`,
          [id, ctx.tenantId],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? null),
    );

    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
